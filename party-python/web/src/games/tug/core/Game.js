// =============================================================
// Game — 게임 루프 + 장면(상태) 관리 + 라운드 진행
//
// 장면들은 이 객체(game)를 통해 모든 서브시스템에 접근한다 (SPEC 2.25).
// 전역 상태 없음: 모든 상태는 인스턴스에 있으므로 한 페이지에 여러 게임을 띄워도 서로 간섭하지 않는다.
// =============================================================
import { mergeConfig, resolvePlayers } from '../config.js';
import { PALETTE, C, TIME_OF_DAY } from '../palette.js';
import { Loop } from './Loop.js';
import { KeyboardInput } from '../input/KeyboardInput.js';
import { PointerInput } from '../input/PointerInput.js';
import { PowerSource, KeyboardPowerSource } from '../input/PowerSource.js';
import { NetBeat } from '../net/NetBeat.js';
import { NetFever } from '../net/NetFever.js';
import { NetScoreBoard } from '../net/NetScoreBoard.js';
import { NetPlayScene } from '../net/NetPlayScene.js';
import { WaitScene } from '../net/WaitScene.js';
import { BeatJudge } from '../systems/BeatJudge.js';
import { Rope } from '../systems/Rope.js';
import { Team, TeamAssigner, assignTeams } from '../systems/Team.js';
import { ScoreBoard } from '../systems/ScoreBoard.js';
import { Fever } from '../systems/Fever.js';
import { computePower } from '../systems/PowerCalculator.js';
import { Player } from '../entities/Player.js';
import { loadAssets } from '../assets/AssetLoader.js';
import { Renderer } from '../render/Renderer.js';
import { Background } from '../render/Background.js';
import { Particles } from '../render/Particles.js';
import { Effects } from '../render/Effects.js';
import { WorldRenderer } from '../render/WorldRenderer.js';
import { UI } from '../ui/UI.js';
import { MUTE_BUTTON_RECT, drawMuteButton } from '../ui/HUD.js';
import { measureBitmapText } from '../ui/PixelFont.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Music } from '../audio/Music.js';
import { TitleScene } from '../scenes/TitleScene.js';
import { TeamAssignScene } from '../scenes/TeamAssignScene.js';
import { CountdownScene } from '../scenes/CountdownScene.js';
import { PlayScene } from '../scenes/PlayScene.js';
import { RoundResultScene } from '../scenes/RoundResultScene.js';
import { ScoreSummaryScene } from '../scenes/ScoreSummaryScene.js';
import { FinalResultScene } from '../scenes/FinalResultScene.js';
import { PauseOverlay } from '../scenes/PauseOverlay.js';

/** 장면 이름 → 클래스. 인스턴스는 처음 goto 할 때 만든다 (에셋 로딩 후라 생성자에서 assets 를 써도 안전) */
const SCENE_CLASSES = Object.freeze({
  title: TitleScene,
  teamAssign: TeamAssignScene,
  countdown: CountdownScene,
  play: PlayScene,
  roundResult: RoundResultScene,
  scoreSummary: ScoreSummaryScene,
  finalResult: FinalResultScene,
});

/** 멀티플레이(서버 판정)에서 쓰는 장면: 플레이 장면을 서버 연동판으로 바꾸고 대기 장면을 더한다 */
const NET_SCENE_CLASSES = Object.freeze({ ...SCENE_CLASSES, play: NetPlayScene, wait: WaitScene });

/** 일시정지(키·창 포커스 잃음)가 허용되는 장면 */
const PAUSABLE_SCENES = Object.freeze(['play', 'countdown']);

/** 게임 캔버스 표시 속성 — 한 페이지에 게임이 여러 개일 때 '다른 게임 캔버스에 포커스가 있는지' 판단용 */
const GAME_CANVAS_ATTR = 'data-pixel-tug-of-war';

/** 로딩 화면: 점 깜빡임 속도 (초당 단계 수) */
const LOADING_DOT_RATE = 3;
/** 로딩 화면: 진행 블록 개수 */
const LOADING_BLOCKS = 8;

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas 화면 캔버스
   * @param {{ players?: object[], config?: object, onFinish?: Function, createPowerSource?: Function }} options
   */
  constructor(canvas, options = {}) {
    const opts = options || {};
    this.canvas = canvas;
    this.options = opts;
    this.onFinish = typeof opts.onFinish === 'function' ? opts.onFinish : null;
    // 멀티플레이: 서버와의 연결(NetLink). 있으면 판정·점수·팀·진행을 서버 상태에서 받아 온다
    this.net = opts.net || null;
    this._sceneClasses = this.net ? NET_SCENE_CLASSES : SCENE_CLASSES;
    this._netRound = 0;           // 팀 배치를 마친 라운드 번호

    // ---- 설정 / 기본 필드 ----
    this.config = mergeConfig(opts.config);
    const config = this.config;
    this.W = config.WIDTH;
    this.H = config.HEIGHT;
    this.time = 0;        // mount 이후 경과 초 (일시정지 중엔 멈춤)
    this.round = 1;       // 현재 라운드 (1부터)
    this.camX = 0;        // 카메라 x (정수)
    this.paused = false;
    this.destroyed = false;
    this.loading = false;
    this.loadFailed = false;
    this.assets = null;   // loadAssets() 이후 채워짐
    this.scene = null;
    this.sceneName = null;
    this.scenes = {};     // 이름 → 장면 인스턴스 (지연 생성)

    this._started = false;
    this._finished = false;      // onFinish 호출 여부 (게임당 1회)
    this._finalResults = null;
    this._loadT = 0;
    this._muteIcons = null;
    this._bonusLedger = new Map(); // applyBonus 로 들어온 점수 (playerId → { total, byRound: Map })
    this._sceneFrozen = false;     // restart 전환이 화면을 덮는 동안 나가는 장면을 멈춘다
    this._focusCheckPending = false; // 플레이/카운트다운 진입 후 창 포커스 확인 예약
    this._markedCanvas = false;

    const win = (canvas && canvas.ownerDocument && canvas.ownerDocument.defaultView) || globalThis.window;
    this._win = win;
    this._doc = canvas && canvas.ownerDocument ? canvas.ownerDocument : globalThis.document;

    // ---- 플레이어 ----
    const defs = resolvePlayers(opts.players, { exact: !!this.net });
    this.players = defs.map((def, i) => new Player(def, i, config));
    const playerIds = this.players.map((p) => p.id);

    // ---- 입력 ----
    const preventCodes = new Set(this.players.map((p) => p.key));
    preventCodes.add('Space');
    preventCodes.add(config.PAUSE_KEY);
    preventCodes.add(config.MUTE_KEY);
    preventCodes.add(config.START_KEY);
    // 키 리스너는 창에 걸지만(캔버스 포커스 없이도 5명이 바로 칠 수 있게), 다른 게임 캔버스에
    // 포커스가 있으면 그 게임 몫이므로 받지 않는다 (_acceptsKey). 버튼·링크·입력란 포커스는 KeyboardInput 이 거른다.
    this.input = new KeyboardInput(win, {
      preventCodes: [...preventCodes].filter(Boolean),
      accept: (e) => this._acceptsKey(e),
    });
    if (canvas && typeof canvas.setAttribute === 'function'
      && !(typeof canvas.hasAttribute === 'function' && canvas.hasAttribute(GAME_CANVAS_ATTR))) {
      canvas.setAttribute(GAME_CANVAS_ATTR, '');
      this._markedCanvas = true;
    }

    // ---- 렌더링 ----
    this.renderer = new Renderer(canvas, config);
    this.g = this.renderer.g;
    this.pointer = new PointerInput(canvas, { width: this.W, height: this.H });
    this.ui = new UI(config);
    this.background = new Background(config);
    this.particles = new Particles();
    this.fx = new Effects(config);

    // ---- 오디오 ----
    this.audio = new AudioEngine(config);
    this.music = new Music(this.audio, config);
    if (config.START_MUTED) this.audio.setMuted(true);

    // ---- 게임 시스템 ----
    const net = this.net;
    this.beat = net ? new NetBeat(config, net) : new BeatJudge(config);
    this.rope = new Rope(config);
    this.fever = net ? new NetFever(config, net) : new Fever(config);
    this.scoreBoard = net ? new NetScoreBoard(net, playerIds) : new ScoreBoard(playerIds, config);
    this.teamAssigner = net ? net.teamAssigner() : new TeamAssigner(playerIds);
    this.teams = { left: new Team('left', config), right: new Team('right', config) };

    // ---- 힘 입력원 ----
    for (const player of this.players) {
      // TODO(AI): createPowerSource(player, game) 로 AI 판정/퀴즈 보너스 등 다른 PowerSource 를 주입할 수 있다.
      //           (예: AIPlayerPowerSource — input/PowerSource.js 의 주석 골격 참고). 없으면 키보드 입력.
      const custom = typeof opts.createPowerSource === 'function' ? opts.createPowerSource(player, this) : null;
      // 키가 없는 선수(멀티플레이의 다른 참가자)는 이 화면에서 입력을 만들지 않는다
      player.powerSource = custom ?? (player.key ? new KeyboardPowerSource(player, this.input) : new PowerSource(player));
    }

    // ---- 월드 그리기 / 일시정지 오버레이 (game 필드가 모두 준비된 뒤 생성) ----
    this.world = new WorldRenderer(this);
    this.pauseOverlay = new PauseOverlay(this);

    // ---- 루프 ----
    this.loop = new Loop({
      step: 1 / (config.FPS || 60),
      maxSteps: config.MAX_FRAME_STEPS || 5,
      update: (dt) => this._step(dt),
      render: () => this._render(),
    });

    // ---- 창/캔버스 리스너 ----
    // 첫 사용자 입력에서 오디오 잠금 해제 (브라우저 자동재생 정책)
    this._onGestureKey = () => this._unlockAudio();
    this._onGesturePointer = () => {
      this._unlockAudio();
      // 캔버스를 클릭하면 키보드 포커스도 캔버스로
      if (this.canvas && typeof this.canvas.focus === 'function') {
        try { this.canvas.focus({ preventScroll: true }); } catch (e) { /* 포커스 실패는 무시 */ }
      }
    };
    this._onResize = () => { if (!this.destroyed) this.renderer.resize(); };
    this._onBlur = () => this._autoPause();
    this._onVisibility = () => { if (this._doc && this._doc.hidden) this._autoPause(); };
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('keydown', this._onGestureKey);
      win.addEventListener('resize', this._onResize);
      win.addEventListener('blur', this._onBlur);
    }
    if (canvas && typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('pointerdown', this._onGesturePointer);
    }
    if (this._doc && typeof this._doc.addEventListener === 'function') {
      this._doc.addEventListener('visibilitychange', this._onVisibility);
    }
  }

  // =========================================================
  // 상태 getter
  // =========================================================

  get muted() {
    return !!this.audio.muted;
  }

  // =========================================================
  // 시작 / 장면 전환
  // =========================================================

  /** 에셋 로딩 → 'title' 장면. 로딩 동안에도 루프는 돌며 LOADING 화면을 그린다 */
  async start() {
    if (this._started || this.destroyed) return;
    this._started = true;
    this.loading = true;
    this._loadT = 0;
    this.renderer.resize();
    this.loop.start();

    let assets = null;
    try {
      assets = await loadAssets(this.config);
    } catch (err) {
      console.error('[PixelTugOfWar] 에셋 로딩 실패', err);
    }
    // 로딩 중 destroy() 됐으면 아무것도 하지 않는다
    if (this.destroyed) return;

    if (!assets) {
      this.loadFailed = true;
      return;
    }
    this.assets = assets;
    this._muteIcons = { on: assets.icon('speakerOn'), off: assets.icon('speakerOff') };
    // 폰트가 로딩되기 전에 대체 폰트로 만든 텍스트 캐시를 버린다
    this.ui.clearCache();
    this.loading = false;
    // 멀티플레이는 대기실에서 준비를 마치고 들어오므로 타이틀 없이 서버 상태를 기다린다
    this.goto(this.net ? 'wait' : 'title', {}, { transition: 'none' });
  }

  /** 장면 인스턴스 (없으면 생성) */
  _getScene(name) {
    if (this.scenes[name]) return this.scenes[name];
    const Cls = this._sceneClasses[name];
    if (!Cls) return null;
    const scene = new Cls(this);
    this.scenes[name] = scene;
    return scene;
  }

  /**
   * 장면 전환. transition: 'pixelFade' | 'circleWipe' | 'none'
   * 전환 중 중복 호출은 무시한다. → 전환을 시작(또는 즉시 전환)했으면 true
   */
  goto(name, params = {}, { transition = 'pixelFade', beforeEnter = null } = {}) {
    if (this.destroyed || this.loading) return false;
    if (this.fx.transitioning) return false;
    const next = this._getScene(name);
    if (!next) {
      console.error(`[PixelTugOfWar] 알 수 없는 장면: ${name}`);
      return false;
    }
    const doSwitch = () => {
      if (this.destroyed) return;
      const old = this.scene;
      if (old && typeof old.exit === 'function') old.exit();
      // (내부) 장면이 바뀌는 순간 실행할 일 — 예: restart 의 상태 초기화는 화면이 덮인 뒤에 한다
      if (typeof beforeEnter === 'function') beforeEnter();
      this._sceneFrozen = false;
      this.scene = next;
      this.sceneName = name;
      next.enter(params || {});
      // 플레이/카운트다운에 들어왔는데 창 포커스가 이미 없으면 (전환이 끝난 뒤) 자동 일시정지
      if (PAUSABLE_SCENES.includes(name)) this._focusCheckPending = true;
    };
    if (transition === 'none' || !this.scene) doSwitch();
    else this.fx.transition(transition, doSwitch);
    return true;
  }

  // =========================================================
  // 라운드 진행
  // =========================================================

  /** 라운드 준비: 팀 배정 → 줄/피버/박자 초기화 → 점수 라운드 시작 → 배경 시간대 → 선수 초기화 */
  setupRound(round) {
    this.round = round;
    const split = this.teamAssigner.next();
    assignTeams(this.teams, this.players, split);
    if (this.net) this.net.applyTeamMultipliers(this.teams); // 힘 보정 배율은 서버가 정한 값

    this.rope.reset();
    this.fever.reset();
    this.beat.reset(this.config.BPM);
    this.scoreBoard.startRound(round);
    this.background.setTimeOfDay(this.timeOfDayFor(round));
    this.background.setExcitement(0);
    this.particles.clear();
    this.camX = 0;

    for (const p of this.players) p.resetForRound();
    this.world.layoutTeams();

    // 각 입력원에게 라운드 정보를 알린다 (AI 입력원이 팀 구성을 알 수 있게)
    for (const p of this.players) {
      if (!p.powerSource || !p.side) continue;
      const own = this.teams[p.side];
      const other = this.teams[p.side === 'left' ? 'right' : 'left'];
      p.powerSource.onRoundStart({
        round,
        side: p.side,
        teammates: own.members.filter((m) => m.id !== p.id).map((m) => m.id),
        opponents: other.members.map((m) => m.id),
      });
    }
    return split;
  }

  /**
   * 라운드 종료 처리. winnerSide: 'left' | 'right' | null(무승부)
   * → scoreBoard.endRound 결과 + { round, isLastRound, left: [id], right: [id] }  (roundResult 장면에 넘김)
   */
  endRound(winnerSide) {
    if (this.net) return this.net.roundResult(); // 멀티플레이: 서버가 계산한 라운드 결과
    const round = this.round;
    const res = this.scoreBoard.endRound(round, winnerSide ?? null, this.teams);
    for (const p of this.players) {
      if (p.powerSource) p.powerSource.onRoundEnd({ round, winnerSide: winnerSide ?? null });
    }
    return {
      ...res,
      round,
      winnerSide: winnerSide ?? null,
      isLastRound: round >= this.config.ROUNDS,
      left: this.teams.left.members.map((m) => m.id),
      right: this.teams.right.members.map((m) => m.id),
    };
  }

  /** 라운드 → 시간대 ('day' → 'sunset' → 'night' 순환) */
  timeOfDayFor(round) {
    const n = TIME_OF_DAY.length;
    const i = ((((round | 0) - 1) % n) + n) % n;
    return TIME_OF_DAY[i];
  }

  /**
   * beat.update() 결과로 다음 박의 음악·틱을 예약한다 (장면에서 매 스텝 호출).
   * beat.reset() 직후에는 scheduleBeatAudio([0], mode) 로 첫 박(1)을 예약할 것.
   * (확장) indexOffset: 음악·틱에 넘길 박 index 보정 — 카운트다운이 음수 박(-6..-1)으로 예약해
   *        플레이 시작 박이 행진곡 첫 마디(0박)와 맞도록 할 때 쓴다.
   */
  scheduleBeatAudio(beatIndices, mode = 'play', { indexOffset = 0, fever = null } = {}) {
    if (!beatIndices || beatIndices.length === 0) return;
    const beat = this.beat;
    const delay = Math.max(0, beat.timeToNextBeat());
    const index = beat.nextBeatIndex + (indexOffset | 0);
    const isPlay = mode === 'play';
    // 예약하는 박(nextBeatIndex)의 구간 길이: 템포 변경이 예약돼 있으면 바로 그 박 경계에서 적용되므로 새 템포 길이다
    const interval = beat.pendingBpm > 0 ? 60 / beat.pendingBpm : beat.interval;
    // (확장) fever: 장면이 '그 박 구간'의 피버 편곡 여부를 직접 지정 (null 이면 지금 피버 상태)
    const feverOn = isPlay && (fever === null || fever === undefined ? this.fever.active : !!fever);
    this.music.scheduleBeat(index, delay, interval, { mode, fever: feverOn });
    if (isPlay) {
      // 틱도 음악과 같은 출력 지연 보정을 적용해 박 시각에 맞춘다
      const latency = Number(this.audio.latency) || 0;
      this.audio.play(((index % 4) + 4) % 4 === 0 ? 'tickAccent' : 'tick', { delay: Math.max(0, delay - latency) });
    }
  }

  // =========================================================
  // 결과
  // =========================================================

  /** 최종 결과 [{ playerId, name, score, rank, isWinner, stats }] (applyBonus 점수 포함) */
  results() {
    const base = this.scoreBoard.results(this.players);
    if (this._bonusLedger.size === 0) return base;
    // applyBonus 로 들어온 점수를 더한 뒤 순위·우승자를 다시 계산한다
    const merged = base.map((r) => {
      const bonus = this._bonusLedger.get(r.playerId)?.total ?? 0;
      return { ...r, score: Math.max(0, r.score + bonus), stats: { ...r.stats, bonusPoints: bonus } };
    });
    merged.sort((a, b) => b.score - a.score);
    const top = merged.length ? merged[0].score : 0;
    for (const r of merged) {
      r.rank = 1 + merged.filter((o) => o.score > r.score).length;
      r.isWinner = r.score === top;
    }
    return merged;
  }

  /** 플레이어 누적 점수 (applyBonus 점수 포함) — 점수 표시용 헬퍼 */
  totalScore(playerId) {
    const s = this.scoreBoard.get(playerId);
    const bonus = this._bonusLedger.get(playerId)?.total ?? 0;
    return Math.max(0, (s ? s.total : 0) + bonus);
  }

  /** 라운드 점수 (applyBonus 점수 포함) — 점수 표시용 헬퍼. round 는 1부터 */
  roundScore(playerId, round) {
    const s = this.scoreBoard.get(playerId);
    const base = s && Array.isArray(s.roundScores) ? s.roundScores[round - 1] : undefined;
    if (base === undefined) return null;
    const bonus = this._bonusLedger.get(playerId)?.byRound.get(round) ?? 0;
    return Math.max(0, base + bonus);
  }

  /** onFinish(results) 를 게임당 정확히 1회 호출 → results */
  finish() {
    if (this._finished) return this._finalResults;
    this._finished = true;
    const results = this.results();
    this._finalResults = results;
    if (this.onFinish) {
      try {
        this.onFinish(results);
      } catch (err) {
        console.error('[PixelTugOfWar] onFinish 콜백 오류', err);
      }
    }
    return results;
  }

  /**
   * 점수·팀 기록 초기화 후 타이틀로 (onFinish 다시 호출 가능해짐).
   * 초기화는 원형 와이프가 화면을 다 덮은 순간(장면 교체 직전)에 한다 — 덮이는 동안 나가는 장면은 멈춰 둔다.
   * (바로 초기화하면 덮이는 0.3초 동안 캐릭터가 사라지고 점수·게이지가 튀며, 플레이 장면이 메뉴 템포로 틱을 예약한다)
   */
  restart() {
    if (this.destroyed || this.loading) return;
    if (this.paused) this.resume();
    this.music.stopAll();
    // 전환 중에 눌렸어도 반드시 타이틀로 간다
    let transition = 'circleWipe';
    if (this.fx.transitioning) {
      this.fx.reset();
      transition = 'none';
    }
    const ok = this.goto('title', {}, { transition, beforeEnter: () => this._resetMatch() });
    if (ok && transition !== 'none' && this.fx.transitioning) this._sceneFrozen = true;
  }

  /** (내부) 경기 상태 초기화 — restart 전환의 중간(화면이 덮인 순간)에 호출 */
  _resetMatch() {
    this.scoreBoard.reset();
    this.teamAssigner.reset();
    this._bonusLedger.clear();
    this._finished = false;
    this._finalResults = null;
    this.round = 1;
    this.camX = 0;
    this.rope.reset();
    this.fever.reset();
    this.beat.reset(this.config.BPM_MENU);
    this.music.stopAll();
    this.teams.left.setMembers([]);
    this.teams.right.setMembers([]);
    for (const p of this.players) {
      p.side = null;
      p.slot = 0;
      p.ready = false;
      p.pop = null;
      p.setAnim('idle', true);
    }
  }

  // =========================================================
  // 일시정지 / 음소거
  // =========================================================

  pause() {
    if (this.net) return; // 멀티플레이는 한 사람이 멈출 수 없다
    if (this.paused || this.destroyed || this.loading || !this.scene) return;
    this.paused = true;
    this.audio.setPaused(true); // 오디오 시계도 멈춰서 예약된 음악이 박자와 어긋나지 않는다
    if (typeof this.pauseOverlay.enter === 'function') this.pauseOverlay.enter();
  }

  resume() {
    if (!this.paused || this.destroyed) return;
    this.paused = false;
    this.input.releaseAll(); // 일시정지 중 누르고 있던 키는 다시 눌러야 한다
    this.audio.setPaused(false);
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
  }

  setMuted(b) {
    this.audio.setMuted(!!b);
  }

  toggleMute() {
    this.audio.toggleMute();
    if (!this.audio.muted) this.audio.play('click');
  }

  // =========================================================
  // TODO(AI): 외부 보너스 주입
  // =========================================================

  /**
   * 외부(AI 판정·퀴즈 정답 등)에서 즉시 보너스를 준다. 'play' 장면에서만 적용.
   * - powerMult: 'perfect' 1회분의 힘 × powerMult 를 그 선수 팀 쪽으로 바로 더한다 (computePower 와 같은 규칙)
   * - scorePoints: ScoreBoard.record 는 판정 등급 기반이라 콤보를 건드리지 않도록 Game 의 보너스 장부
   *   (_bonusLedger)에 따로 쌓고, results()/totalScore()/roundScore() 에서 합산한다.
   * → 적용했으면 true
   */
  applyBonus(playerId, bonus = {}) {
    // TODO(AI): AI 판정 서버 / 퀴즈 결과를 여기로 연결한다. 더 정교한 규칙이 필요하면 PowerCalculator 를 확장할 것.
    if (this.destroyed || this.paused || this.sceneName !== 'play' || !bonus) return false;
    const player = this.players.find((p) => p.id === String(playerId));
    if (!player || !player.side) return false;
    const team = this.teams[player.side];
    let applied = false;

    const mult = Number(bonus.powerMult);
    if (Number.isFinite(mult) && mult > 0) {
      const amount = computePower({
        grade: 'perfect',
        config: this.config,
        teamMultiplier: team.multiplier,
        fever: this.fever.active,
        bonus: { powerMult: mult },
      });
      this.rope.addForce(player.side, amount);
      this.scoreBoard.addPower(player.id, amount);
      applied = true;
    }

    const points = Math.round(Number(bonus.scorePoints) || 0);
    if (points !== 0) {
      let entry = this._bonusLedger.get(player.id);
      if (!entry) {
        entry = { total: 0, byRound: new Map() };
        this._bonusLedger.set(player.id, entry);
      }
      entry.total += points;
      entry.byRound.set(this.round, (entry.byRound.get(this.round) ?? 0) + points);
      applied = true;
    }

    if (applied) {
      player.pressT = 0;
      this.particles.emit('sparkle', player.x, player.y - 34, { count: 8 });
      this.audio.play('perfect', { volume: 0.6 });
    }
    return applied;
  }

  // =========================================================
  // 정리
  // =========================================================

  /** 루프 정지, 리스너 해제, 오디오 닫기, 입력원 정리. 여러 번 호출해도 안전 */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const safe = (fn) => {
      try { fn(); } catch (err) { console.error('[PixelTugOfWar] destroy 중 오류', err); }
    };
    safe(() => this.loop.stop());
    safe(() => { if (this.scene && typeof this.scene.exit === 'function') this.scene.exit(); });
    const win = this._win;
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('keydown', this._onGestureKey);
      win.removeEventListener('resize', this._onResize);
      win.removeEventListener('blur', this._onBlur);
    }
    if (this.canvas && typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener('pointerdown', this._onGesturePointer);
    }
    if (this._markedCanvas && this.canvas && typeof this.canvas.removeAttribute === 'function') {
      safe(() => this.canvas.removeAttribute(GAME_CANVAS_ATTR));
    }
    if (this._doc && typeof this._doc.removeEventListener === 'function') {
      this._doc.removeEventListener('visibilitychange', this._onVisibility);
    }
    safe(() => this.input.dispose());
    safe(() => this.pointer.dispose());
    for (const p of this.players) {
      safe(() => { if (p.powerSource) p.powerSource.dispose(); });
    }
    safe(() => this.music.stopAll());
    safe(() => this.audio.dispose());
    safe(() => this.renderer.dispose());
    this.scene = null;
    this.sceneName = null;
  }

  // =========================================================
  // 내부: 스텝 / 렌더
  // =========================================================

  _unlockAudio() {
    if (this.destroyed) return;
    if (!this.audio.ready) this.audio.unlock();
  }

  _canPause() {
    return !!this.scene && PAUSABLE_SCENES.includes(this.sceneName) && !this.fx.transitioning;
  }

  /**
   * 키 이벤트를 이 게임의 입력으로 받을지.
   * 이 캔버스에 포커스가 있거나, 아무 게임 캔버스에도 포커스가 없으면(body 등) 받는다.
   * 다른 게임 캔버스에 포커스가 있으면 그 게임 몫 → 한 페이지의 여러 게임이 같은 키에 함께 반응하지 않는다.
   */
  _acceptsKey() {
    const doc = this._doc;
    const active = doc ? doc.activeElement : null;
    if (!active || active === this.canvas) return true;
    if (typeof active.getAttribute === 'function' && active.getAttribute(GAME_CANVAS_ATTR) !== null) return false;
    return true;
  }

  /** 창(문서)이 지금 키보드 포커스를 잃은 상태인가 */
  _lostFocus() {
    const doc = this._doc;
    if (!doc) return false;
    if (doc.hidden) return true;
    if (typeof doc.hasFocus === 'function') {
      try { return !doc.hasFocus(); } catch (e) { return false; }
    }
    return false;
  }

  /** 창 포커스를 잃으면 플레이/카운트다운 중 자동 일시정지 */
  _autoPause() {
    if (this.destroyed || this.paused || !this.config.AUTO_PAUSE_ON_BLUR) return;
    if (this._canPause()) this.pause();
  }

  _pointInMuteButton(pt) {
    const r = MUTE_BUTTON_RECT;
    return !!pt && pt.x >= r.x && pt.x < r.x + r.w && pt.y >= r.y && pt.y < r.y + r.h;
  }

  /** 플레이어 키와 겹치는 전역 키는 쓰지 않는다 (예: 누군가 M 을 자기 키로 쓰는 경우) */
  _isPlayerKey(code) {
    return this.players.some((p) => p.key === code);
  }

  /**
   * (멀티플레이) 서버가 알려준 진행 상태(phase)에 맞는 장면으로 옮긴다.
   * 장면이 스스로 넘어가는 경우는 둘뿐이다: 카운트다운 → 플레이(START 박), 플레이 → 라운드 결과(FINISH 연출 뒤).
   * 늦게 들어오거나 다시 접속해도 같은 규칙으로 현재 장면을 찾아간다.
   */
  _netSync() {
    const net = this.net;
    const s = net.snap;
    if (!s || this.fx.transitioning || this.loading) return;
    const name = this.sceneName;
    const ensureRound = () => {
      if (this._netRound === s.round) return;
      this._netRound = s.round;
      this.setupRound(s.round);
    };
    switch (s.phase) {
      case 'assign':
        if (this._netRound !== s.round) {
          this._netRound = s.round;
          // 팀 배정 장면이 setupRound 를 부른다
          this.goto('teamAssign', { round: s.round }, { transition: name === 'wait' ? 'none' : 'circleWipe' });
        } else if (name === 'teamAssign' && net.now() >= s.countdownAt - this.config.TRANSITION_TIME / 2) {
          // 화면 전환의 중간(장면이 바뀌는 순간)이 카운트다운 시작 시각과 맞도록 조금 일찍 출발
          this.goto('countdown', {}, { transition: 'pixelFade' });
        }
        break;
      case 'countdown':
        ensureRound();
        if (name !== 'countdown' && name !== 'play') {
          this.goto('countdown', {}, { transition: name === 'teamAssign' ? 'pixelFade' : 'none' });
        }
        break;
      case 'play':
        ensureRound();
        if (name !== 'play' && name !== 'countdown') this.goto('play', {}, { transition: 'none' });
        break;
      case 'ended':
        ensureRound();
        // 플레이 장면이면 FINISH 연출 뒤 스스로 결과 장면으로 간다
        if (name !== 'play' && name !== 'roundResult') {
          this.goto('roundResult', { result: net.roundResult() }, { transition: 'none' });
        }
        break;
      case 'summary':
        if (name !== 'scoreSummary') this.goto('scoreSummary', {}, { transition: name === 'wait' ? 'none' : 'circleWipe' });
        break;
      case 'final':
      case 'done':
        if (name !== 'finalResult') this.goto('finalResult', {}, { transition: name === 'wait' ? 'none' : 'circleWipe' });
        break;
      default:
        break;
    }
  }

  /** 고정 스텝 1회 */
  _step(dt) {
    if (this.destroyed) return;
    this.input.beginFrame();
    this.pointer.beginFrame();

    // ---- 로딩 중 ----
    if (this.loading || !this.scene) {
      this._loadT += dt;
      return;
    }

    const cfg = this.config;
    const input = this.input;
    const pointer = this.pointer;

    // ---- 전역: 음소거 (키 또는 버튼 클릭) ----
    let muteToggle = cfg.MUTE_KEY && !this._isPlayerKey(cfg.MUTE_KEY) && input.pressed(cfg.MUTE_KEY);
    if (this._pointInMuteButton(pointer.clicked)) {
      muteToggle = true;
      pointer.clicked = null; // 음소거 버튼 클릭은 장면으로 전달하지 않는다
    }
    if (this._pointInMuteButton(pointer.downThisFrame)) pointer.downThisFrame = null;
    if (muteToggle) this.toggleMute();

    // ---- 전역: 일시정지 토글 (플레이·카운트다운에서만) ----
    if (cfg.PAUSE_KEY && !this._isPlayerKey(cfg.PAUSE_KEY) && input.pressed(cfg.PAUSE_KEY)) {
      if (this.paused) this.resume();
      else if (this._canPause()) this.pause();
    }

    // ---- 플레이/카운트다운 진입 후 포커스 확인 (blur 가 그 전 장면에서 일어났어도 놓치지 않게) ----
    if (this._focusCheckPending && !this.fx.transitioning) {
      this._focusCheckPending = false;
      if (!this.paused && this._lostFocus()) this._autoPause();
    }

    // ---- 멀티플레이: 서버 상태에 맞춰 장면 전환 ----
    if (this.net) this._netSync();

    // ---- 일시정지 중: 오버레이만 ----
    if (this.paused) {
      this.pauseOverlay.update(dt);
      return;
    }

    // ---- 장면·연출 진행 ----
    if (this._sceneFrozen && !this.fx.transitioning) this._sceneFrozen = false; // 안전장치: 전환이 끝났으면 해제
    if (!this._sceneFrozen) this.scene.update(dt);
    if (this.destroyed) return;
    this.background.update(dt);
    if (!this.fx.frozen) this.particles.update(dt); // 히트스톱 중엔 입자도 멈춘다
    this.fx.update(dt);
    this.time += dt;
  }

  /** 렌더 1회 */
  _render() {
    if (this.destroyed) return;
    const g = this.g;
    this.renderer.begin();

    if (this.loading || this.loadFailed || !this.scene) {
      this._renderLoading(g);
      this.renderer.present(0, 0);
      return;
    }

    this.scene.render(g);
    if (this.paused) this.pauseOverlay.render(g);
    // 음소거 버튼은 모든 장면·오버레이 위에 (일시정지 중에도 누를 수 있게)
    const p = this.pointer;
    const hover = p.inside && this._pointInMuteButton(p);
    drawMuteButton(g, this.ui, {
      muted: this.muted,
      hover,
      pressed: hover && p.isDown,
      icons: this._muteIcons,
    });
    this.fx.render(g);
    const off = this.fx.shakeOffset || { x: 0, y: 0 };
    this.renderer.present(off.x | 0, off.y | 0);
  }

  /** 로딩 화면 (비트맵 폰트만 사용 — Galmuri 로딩 전이므로) */
  _renderLoading(g) {
    const W = this.W, H = this.H;
    const cx = W >> 1, cy = H >> 1;
    const ui = this.ui;
    ui.bitmapText(g, 'PIXEL TUG-OF-WAR', cx, cy - 26, {
      color: PALETTE[C.YELLOW], scale: 2, align: 'center', shadow: PALETTE[C.PLUM],
    });
    if (this.loadFailed) {
      ui.bitmapText(g, 'LOAD FAILED - SEE CONSOLE', cx, cy + 4, { color: PALETTE[C.RED], align: 'center' });
      return;
    }
    // 'LOADING...' — 점 개수가 바뀌어도 글자가 흔들리지 않게 왼쪽 정렬 고정 위치
    const dots = 1 + (Math.floor(this._loadT * LOADING_DOT_RATE) % 3);
    const x0 = cx - (measureBitmapText('LOADING...') >> 1);
    ui.bitmapText(g, 'LOADING' + '.'.repeat(dots), x0, cy + 2, { color: PALETTE[C.WHITE] });

    // 진행 블록: 하나씩 밝아지는 픽셀 칸
    const bw = 5, gap = 2;
    const total = LOADING_BLOCKS * bw + (LOADING_BLOCKS - 1) * gap;
    const bx = cx - (total >> 1);
    const by = cy + 16;
    const lit = Math.floor(this._loadT * 8) % LOADING_BLOCKS;
    for (let i = 0; i < LOADING_BLOCKS; i++) {
      g.fillStyle = i === lit ? PALETTE[C.YELLOW] : i < lit ? PALETTE[C.ORANGE] : PALETTE[C.CHARCOAL];
      g.fillRect(bx + i * (bw + gap), by, bw, bw);
    }
  }
}
