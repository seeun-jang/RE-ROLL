// =============================================================
// GrooveScreen — 잭팟 그루브 화면 (원본 js/scenes/play.js + result.js + game.js 를 옮긴 것)
//
// 흐름: 곡 소개(intro) → 카운트인 · 연주(play) → FINISH!(outro) → 최종 순위(final)
//  - 장면(phase)과 곡의 0초가 되는 서버 시각(startAt)은 서버가 정한다.
//  - 곡 시계 = 서버 시계 − startAt. 노트 위치 · 판정 예측 · 소리 예약이 모두 이 시계를 따른다
//    → 모든 참가자가 같은 순간에 같은 박을 듣고 같은 노트를 본다.
//  - 키를 누르면 "누른 순간의 곡 시간"을 서버로 보내고, 같은 계산(performer.js)으로 결과를 바로 보여 준다(예측).
//    점수 · 순위는 서버가 보낸 값만 쓴다.
//  - 원본 '개인 화면' 배치(큰 레인 1개 + 춤추는 내 캐릭터 + 오른쪽 점수판)에
//    다른 사람 점수판(왼쪽 위)과 해설 자막(맨 아래)을 더했다.
// =============================================================
import { ANIMAL_COLORS, CONFIG, SOLO_LANES, SYNC_KEY } from '../config.js';
import { C } from '../palette.js';
import { BitmapFont } from '../font.js';
import { KText, drawGradeBadge, drawPanel } from '../ui.js';
import { LANE_COLORS, SPR, initSprites, loadCharacterImages, spritesOf } from '../sprites.js';
import { SONGS, expandSong } from '../song.js';
import { buildChart } from '../chart.js';
import { Performer } from '../performer.js';
import { AudioManager, MusicPlayer } from '../audio.js';
import { ParticleSystem } from '../particles.js';
import { Stage } from '../stage.js';
import { DITHER, Highway } from '../highway.js';
import { Dancer } from '../dancer.js';

const W = CONFIG.WIDTH;
const H = CONFIG.HEIGHT;
const SAY_FRAMES = 60 * 4;      // 자막이 떠 있는 시간
const BOARD_X = 4;              // 왼쪽 위: 모두의 점수판
const BOARD_Y = 8;
const DANCER_X = 58;            // 내 캐릭터
const DANCER_FEET = 162;
const HUD_X = 214;              // 오른쪽: 내 점수판

function loadSync() {
  try {
    const v = parseFloat(localStorage.getItem(SYNC_KEY));
    return Number.isNaN(v) ? 0 : Math.max(-CONFIG.SYNC_RANGE, Math.min(CONFIG.SYNC_RANGE, v));
  } catch (e) {
    return 0;
  }
}

function saveSync(v) {
  try {
    localStorage.setItem(SYNC_KEY, String(v));
  } catch (e) { /* 저장 못 해도 게임은 된다 */ }
}

export class GrooveScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.players = players || [];
    this.meId = me && me.id;
    this.options = options || {};
    this.byId = new Map(this.players.map((p) => [p.id, p]));

    // 곡 · 채보 (서버가 고른 곡 id 와 난이도로 서버와 똑같은 채보를 만든다)
    this.songDef = SONGS[this.options.song] || SONGS.groove;
    this.song = expandSong(this.songDef);
    this.difficulty = CONFIG.DIFFICULTY[this.options.difficulty] ? this.options.difficulty : 'normal';
    this.diff = CONFIG.DIFFICULTY[this.difficulty];
    this.approach = this.options.approach || this.diff.approach;
    this.chart = buildChart(this.songDef, this.difficulty);
    if (this.options.notes && this.options.notes !== this.chart.length) {
      console.warn('[groove] 채보가 서버와 다릅니다', this.options.notes, this.chart.length);
    }
    this.lead = this.options.lead || this.song.barSec + CONFIG.FLOW.LEAD_EXTRA;

    // 시계
    this.delta = 0;            // 서버 시계 − 내 시계(performance.now 초)
    this.audioMap = null;      // 오디오 시계 − 내 시계 (천천히 따라가며 맞춘다)
    this.sync = loadSync();    // 소리 출력 지연 보정(초) — 기기마다 다르므로 브라우저에 저장한다

    this.phase = 'wait';
    this.frame = 0;
    this.t = 0;                // 장면별 프레임
    this.banner = null;
    this.lastBar = -1;
    this.caption = null;       // 해설 자막 { text, ai, who, t }
    this.verdict = null;       // AI 총평
    this.notice = null;        // 소리 끔/켬 · 싱크 알림 { text, t }
    this.rowFlash = {};        // 점수판 줄 반짝임 (다른 사람이 50콤보마다)
    this.scoreShown = 0;
    this.musicOn = false;
    this.resultMusic = false;
    this.restored = false;
    this.stampsDone = false;
    this.keysHeld = new Set();
    this._destroyed = false;
    this._raf = 0;

    this.audio = new AudioManager();
    this.music = new MusicPlayer(this.audio, this.songDef);
    this._buildDom();
    this._bindInput();
    this._fit();
    this.audio.unlock();        // 이미 클릭 · 타자를 한 적이 있으면 바로 켜진다. 아니면 첫 키 입력 때 켜진다.
  }

  // ---------- 준비: 폰트 → 캐릭터 그림 → 스프라이트 ----------
  async init() {
    // 픽셀 폰트를 먼저 불러와야 한글이 제대로 그려짐 (최대 3초 대기)
    try {
      if (typeof FontFace !== 'undefined' && !document.fonts.check('bold 12px Galmuri11')) {
        const url = new URL('../assets/fonts/Galmuri11-Bold.woff2', import.meta.url).href;
        const face = new FontFace('Galmuri11', `url(${url}) format('woff2')`, { weight: 'bold' });
        document.fonts.add(face);
        face.load().catch(() => {});
      }
      await Promise.race([
        Promise.all([
          document.fonts.load('bold 12px Galmuri11'),
          document.fonts.load('10px Galmuri9'),
          document.fonts.load('15px Galmuri14'),
        ]),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (e) {
      console.warn('[groove] 폰트 로딩 실패, 기본 글꼴 사용', e);
    }
    KText.clear();
    await loadCharacterImages();
    if (this._destroyed) return;
    initSprites();

    // 내 연주자(예측용) · 레인 · 캐릭터
    const mine = this.byId.get(this.meId) || this.players[0] || { id: '', name: '', character: 'bear' };
    this.mine = mine;
    this.me = new Performer(this.chart, {
      def: { color: ANIMAL_COLORS[mine.character] || '9' }, spr: spritesOf(mine.character), name: mine.name,
    });
    const L = CONFIG.LAYOUT_PERSONAL;
    this.highway = new Highway(this.me, { x: L.X, laneW: L.LANE_W, top: L.TOP, judgeY: L.JUDGE_Y, size: L.NOTE }, ['<', '^', '>']);
    this.dancer = new Dancer(this.me, DANCER_X, DANCER_FEET, 2);
    this.stage = new Stage();
    this.particles = new ParticleSystem();
    this.me.on('judge', (kind, lane, isTail) => this.onJudge(kind, lane, isTail));
    this.me.on('tap', (lane) => this.audio.sfx('tap', lane));
    this.me.on('fever', () => {
      this.audio.sfx('fever');
      this.particles.text(this.highway.centerX, L.TOP + 16, 'FEVER!', C('9'), { life: 50, scale: 2 });
    });
    this.me.on('break', (combo) => {
      if (combo >= 30) this.particles.text(this.highway.centerX, L.TOP + 16, 'BREAK', C('j'), { life: 40 });
    });

    this._last = performance.now();
    this._acc = 0;
    const loop = (now) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      let dt = now - this._last;
      this._last = now;
      if (dt > 250) dt = 250; // 탭 전환 후 폭주 방지
      this._acc += dt;
      while (this._acc >= CONFIG.STEP_MS) {
        this.update();
        this._acc -= CONFIG.STEP_MS;
      }
      this.render(this._acc / CONFIG.STEP_MS);
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('pointerdown', this._onPointer);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.music.stop();
    this.audio.close();
    this.root.remove();
  }

  // ---------- 화면 틀 ----------
  _buildDom() {
    this.root = document.createElement('div');
    this.root.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#120a1c;overflow:hidden;';
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.cssText = 'display:block;image-rendering:pixelated;image-rendering:crisp-edges;';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.root.appendChild(this.canvas);
    this.container.appendChild(this.root);
    this.autoHeight = this.container.clientHeight === 0;
    this._onResize = () => this._fit();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.container);
    }
  }

  // container 크기에 맞춰 정수배로만 확대 (원본처럼 '실제 모니터 픽셀' 기준 정수배 → 글씨가 뭉개지지 않음)
  _fit() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.root.clientWidth || W * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.floor(Math.min((w * dpr) / W, (h * dpr) / H)));
    this.canvas.style.width = `${(W * s) / dpr}px`;
    this.canvas.style.height = `${(H * s) / dpr}px`;
    if (this.autoHeight) this.root.style.height = `${(H * s) / dpr}px`;
  }

  // ---------- 시계 ----------
  // perfMs(performance.now 기준 ms) 시점의 곡 시간. 키 입력 시각을 그대로 넣으면 정확한 판정 시각이 된다.
  songTimeAt(perfMs) {
    const snap = this.net.snap;
    if (!snap) return -999;
    return perfMs / 1000 + this.delta - snap.startAt;
  }

  get songTime() {
    return this.songTimeAt(performance.now());
  }

  _syncClocks() {
    const perf = performance.now() / 1000;
    this.delta = this.net.now() - perf;
    const c = this.audio.ctx;
    if (c && c.state === 'running') {
      // 오디오 시계는 띄엄띄엄 갱신되므로 천천히 따라가며 맞춘다 (크게 어긋나면 바로 맞춤)
      const raw = c.currentTime - perf;
      if (this.audioMap === null || Math.abs(raw - this.audioMap) > 0.05) this.audioMap = raw;
      else this.audioMap += (raw - this.audioMap) * 0.02;
    }
  }

  // 곡 시간 songSec 이 "들려야" 하는 오디오 시각
  //  = 그 곡 시간의 내 시계 + (오디오 시계 − 내 시계) − 출력 지연(스피커까지 걸리는 시간) − 사용자 싱크 보정
  audioTimeOf(songSec) {
    const c = this.audio.ctx;
    const snap = this.net.snap;
    const latency = (c.outputLatency || 0) + (c.baseLatency || 0);
    return snap.startAt + songSec - this.delta + (this.audioMap || 0) - latency - this.sync;
  }

  // 곡 재생 시작(또는 중간부터 합류): 오디오가 켜져 있고 곡이 아직 안 끝났을 때 한 번
  _ensureMusic(t) {
    const c = this.audio.ctx;
    if (this.musicOn || !c || c.state !== 'running' || this.audioMap === null || !this.net.snap) return;
    if ((this.phase !== 'intro' && this.phase !== 'play') || t > this.song.duration) return;
    this.musicOn = true;
    const st = this.song.stepSec;
    this.music.play({ timeOf: (step) => this.audioTimeOf(step * st), countIn: true });
  }

  get audioReady() {
    const hasAPI = !!(window.AudioContext || window.webkitAudioContext);
    if (!hasAPI) return true;
    return !!(this.audio.ctx && this.audio.ctx.state === 'running');
  }

  // ---------- 입력 ----------
  _bindInput() {
    const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    // 이벤트 발생 시각 (performance.now 기준 ms)
    const stamp = (e) => {
      const ts = e.timeStamp;
      const now = performance.now();
      return ts > 0 && ts <= now + 5 ? ts : now;
    };
    const laneOf = (code) => SOLO_LANES.findIndex((codes) => codes.includes(code));
    this._onKeyDown = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (block.has(e.code)) e.preventDefault();
      this.audio.unlock();
      if (e.repeat || this.keysHeld.has(e.code)) return; // 꾹 누를 때 자동 반복은 무시
      this.keysHeld.add(e.code);
      if (e.code === 'KeyM') {
        this.audio.toggleMute();
        this.notice = { text: this.audio.muted ? '소리 끔' : '소리 켬', t: 90 };
      } else if (e.code === 'BracketLeft' || e.code === 'BracketRight' || e.code === 'Minus' || e.code === 'Equal') {
        this._nudgeSync(e.code === 'BracketLeft' || e.code === 'Minus' ? -1 : 1);
      }
      const lane = laneOf(e.code);
      if (lane >= 0) this._laneInput(lane, true, stamp(e));
    };
    this._onKeyUp = (e) => {
      if (!this.keysHeld.delete(e.code)) return;
      const lane = laneOf(e.code);
      // 같은 레인의 다른 키(← 와 A)를 아직 누르고 있으면 뗀 것이 아니다
      if (lane >= 0 && !SOLO_LANES[lane].some((code) => this.keysHeld.has(code))) this._laneInput(lane, false, stamp(e));
    };
    // 창 포커스를 잃으면 눌린 키 초기화 (키가 계속 눌린 상태로 남는 버그 방지)
    this._onBlur = () => {
      const now = performance.now();
      this.keysHeld.clear();
      if (this.me) for (let l = 0; l < 3; l++) if (this.me.keyDown[l]) this._laneInput(l, false, now);
    };
    this._onPointer = () => this.audio.unlock();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('pointerdown', this._onPointer);
  }

  // 레인 키를 누르거나 뗐다: 서버로 보내고, 같은 계산으로 바로 보여 준다(예측)
  _laneInput(lane, down, perfMs) {
    const p = this.me;
    if (!p || !this.meId || !this.byId.has(this.meId)) return;
    const t = this.songTimeAt(perfMs);
    const playing = this.phase === 'play' || (this.phase === 'intro' && t >= -this.lead);
    if (!playing) {
      // 연주 중이 아니면 키캡만 눌러 보인다
      p.keyDown[lane] = down;
      if (down) p.pressT[lane] = 8;
      return;
    }
    if (down && p.keyDown[lane]) return;
    this.net.key(lane, down, t);
    p.sweep(t);
    p.input(lane, t, down);
  }

  // 싱크(소리 출력 지연) 조절: 10ms 단위, ±200ms. 소리가 늦게 들리면 +
  _nudgeSync(dir) {
    const v = Math.round((this.sync + dir * CONFIG.SYNC_STEP) * 1000) / 1000;
    this.sync = Math.max(-CONFIG.SYNC_RANGE, Math.min(CONFIG.SYNC_RANGE, v));
    saveSync(this.sync);
    this.notice = { text: `싱크 ${this.syncLabel}`, t: 90 };
  }

  get syncLabel() {
    return `${this.sync > 0 ? '+' : ''}${Math.round(this.sync * 1000)}ms`;
  }

  // ---------- 서버 사건 ----------
  onEvent(ev) {
    if (ev.type === 'say') {
      this.caption = { text: String(ev.text || ''), ai: ev.source === 'gemini', who: ev.who || '', t: 0 };
    } else if (ev.type === 'verdict') {
      this.verdict = { headline: ev.headline, mvp: ev.mvp, cheer: ev.cheer };
    } else if (ev.type === 'combo' || ev.type === 'lead') {
      this.rowFlash[ev.playerId] = 40;
      if (ev.type === 'lead' && ev.playerId === this.meId) this.audio.sfx('select');
    }
  }

  // 장면이 바뀌었을 때
  onPhase(phase) {
    const wasFinal = this.phase === 'final';
    this.phase = phase;
    if (wasFinal && phase === 'done') return; // 결과 화면이 이어진다
    this.t = 0;
    if (phase === 'final' || phase === 'done') {
      this.music.stop(0.8);
      this._startResultMusic();
    }
  }

  // 결과 배경음: 인트로 구간 반복 (조용히) — 원본 result.js
  _startResultMusic() {
    const c = this.audio.ctx;
    if (this.resultMusic || !c || c.state !== 'running') return;
    this.resultMusic = true;
    this.musicOn = true;
    const at = c.currentTime + 1.2;
    const st = this.song.stepSec;
    this.resultAt = performance.now() / 1000 + 1.2;
    setTimeout(() => {
      if (!this._destroyed) this.music.play({ timeOf: (step) => at + step * st, fromBar: 0, toBar: 4, loop: true, vol: 0.5 });
    }, 850);
  }

  // 판정 연출 (불꽃, 링, 캐릭터 동작) — 원본 play.js
  onJudge(kind, lane, isTail) {
    const p = this.me;
    const hw = this.highway;
    this.dancer.onJudge(kind, lane);
    if (kind === 'miss') {
      this.audio.sfx('miss');
      return;
    }
    const x = hw.laneX(lane);
    const y = hw.L.judgeY;
    const lc = LANE_COLORS[lane];
    if (kind === 'perfect') {
      this.particles.burst(x, y, 14, [C(lc.hi), C('b'), C('9')], 2.2, 20, 1);
      this.particles.ring(x, y, 1.4, C(lc.hi), 10);
    } else {
      this.particles.burst(x, y, 8, [C(lc.body), C(lc.hi)], 1.2, 16, 1);
    }
    if (isTail) this.particles.burst(x, y - 4, 6, [C('9'), C('b')], 2, 18, 1, 0.05);
    this.audio.sfx('hit');
    if (p.combo > 0 && p.combo % 50 === 0) {
      this.audio.sfx('combo');
      this.particles.text(hw.centerX, hw.L.top + 16, p.combo + ' COMBO!', C('9'), { life: 50 });
    }
  }

  // 서버가 알려 준 내 기록 (없으면 null)
  get myStats() {
    const snap = this.net.snap;
    return (snap && snap.players && snap.players[this.meId]) || null;
  }

  // 게임 도중에 들어왔을 때(재접속): 이미 지나간 노트를 다시 MISS 로 세지 않게 진행 상황을 맞춘다
  _restoreIfNeeded(t) {
    if (this.restored) return;
    this.restored = true;
    if (t < 0.5) return;
    let dump = this.net.meDump;
    if (!dump) {
      // 서버가 내 진행 상황을 따로 알려 주지 않았으면 시각으로 어림한다
      const st = this.myStats || {};
      dump = {
        ptr: this.me.lanes.map((list) => list.filter((n) => n.time < t - CONFIG.JUDGE.good).length), hold: [null, null, null],
        perfect: st.perfect || 0, great: st.great || 0, good: st.good || 0, miss: st.miss || 0,
        combo: st.combo || 0, maxCombo: st.maxCombo || 0, judged: st.judged || 0,
      };
    }
    this.me.restore(dump);
  }

  // ---------- 업데이트 (초당 60번) ----------
  update() {
    this.frame++;
    this.t++;
    this._syncClocks();
    for (const ev of this.net.takeEvents()) this.onEvent(ev);
    const snap = this.net.snap;
    if (snap && snap.phase !== this.phase) this.onPhase(snap.phase);
    if (snap && snap.verdict && !this.verdict) this.verdict = snap.verdict;
    const t = this.songTime;
    if (snap) {
      this._restoreIfNeeded(t);
      this._ensureMusic(t);
      this.me.update(t);
    }
    this.updateWorld(t);
    if (this.caption && ++this.caption.t > SAY_FRAMES) this.caption = null;
    if (this.notice && --this.notice.t <= 0) this.notice = null;
    for (const id in this.rowFlash) if (--this.rowFlash[id] <= 0) delete this.rowFlash[id];

    if (this.phase === 'play') {
      // 구간 알림
      const bar = Math.floor(t / this.song.barSec);
      if (bar !== this.lastBar && bar >= 0 && bar < this.song.bars.length) {
        this.lastBar = bar;
        const b = this.song.bars[bar];
        if (b.firstOfSection) {
          if (b.fever) this.banner = { text: '★ 잭팟 타임! ★', color: '9', panel: 'red', t: 0 };
          else if (b.section === 'break') this.banner = { text: '롱노트! 꾹 누르기', color: 'h', panel: 'blue', t: 0 };
          else if (b.section === 'outro') this.banner = { text: '피날레!', color: 'a', panel: 'red', t: 0 };
        }
      }
    }
    if (this.banner && ++this.banner.t > 150) this.banner = null;
    if (this.phase === 'outro') this.updateOutro();
    if (this.phase === 'final' || this.phase === 'done') this.updateFinal();
  }

  updateWorld(t) {
    const inSong = t >= 0 && t < this.song.duration;
    const fever = this.phase === 'final' || (inSong && this.song.bars[Math.floor(t / this.song.barSec)].fever);
    // 결과 화면에서는 결과 배경음 박자에 맞춘다
    const beatT = this.phase === 'final' || this.phase === 'done' ? performance.now() / 1000 - (this.resultAt || 0) : t;
    this.beatT = beatT;
    this.stage.update(beatT, this.song.beatSec, fever);
    this.highway.update();
    this.dancer.update();
    this.particles.update();
    // 점수 숫자가 촤라락 올라감 (서버가 알려 준 점수까지)
    const st = this.myStats;
    const target = st ? st.score : 0;
    this.scoreShown += Math.ceil((target - this.scoreShown) * 0.2);
  }

  // FINISH! 연출 — 원본 updateOutro
  updateOutro() {
    if (this.t >= 20 && !this.stampsDone) {
      this.stampsDone = true;
      // FULL COMBO / ALL PERFECT 도장 (서버 결과 기준)
      const mine = this.myResult();
      const s = mine ? mine.stats : null;
      if (s && s.allPerfect) this.highway.stamp = 'ALL PERFECT';
      else if (s && s.fullCombo) this.highway.stamp = 'FULL COMBO';
      this.audio.sfx(this.highway.stamp ? 'fullcombo' : 'clear');
      if (this.highway.stamp) this.audio.sfx('stamp');
    }
    if (this.t > 20) this.dancer.cheer = true;
    if (this.t % 6 === 0) {
      const cols = [C('9'), C('8'), C('5'), C('h'), C('e'), C('p')];
      this.particles.add(Math.random() * W, -2, (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.6, 300, cols[(Math.random() * cols.length) | 0], 2);
    }
  }

  updateFinal() {
    if (this.t === 1) {
      this.particles.clear();
      this.audio.sfx('clear');
      // 1등은 무대에서 춤
      const rows = this.results();
      const top = rows.length ? this.byId.get(rows[0].playerId) : null;
      this.winner = new Dancer({ spr: spritesOf(top ? top.character : 'bear'), fever: true }, 292, 140, 1);
      this.winner.cheer = true;
    }
    if (!this.resultMusic) this._startResultMusic();
    if (this.winner) this.winner.update();
    if (this.t % 4 === 0) {
      const cols = [C('9'), C('8'), C('5'), C('h'), C('e'), C('p')];
      this.particles.add(Math.random() * W, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 1);
    }
  }

  results() {
    const snap = this.net.snap;
    return (snap && snap.results) || [];
  }

  myResult() {
    return this.results().find((r) => r.playerId === this.meId) || null;
  }

  colorOf(playerId) {
    const pl = this.byId.get(playerId);
    return C(ANIMAL_COLORS[pl && pl.character] || 'a');
  }

  // ---------- 그리기 ----------
  render(alpha) {
    const ctx = this.ctx;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, H);
    if (!this.stage) return;
    if (this.phase === 'final' || this.phase === 'done') this.renderFinal(ctx, alpha);
    else this.renderPlay(ctx, alpha);
    this.renderCaption(ctx);
    if (this.notice) {
      const tw = KText.width(this.notice.text, 's') + 12;
      drawPanel(ctx, W - tw - 6, H - 40, tw, 20, 'dark');
      KText.draw(ctx, this.notice.text, W - 6 - tw / 2, H - 36, C('a'), { align: 'center', font: 's' });
    }
  }

  renderPlay(ctx, alpha) {
    const t = this.songTime;
    const f = this.frame;
    const beat = this.song.beatSec;
    this.stage.renderBack(ctx, f / 60, f);
    this.stage.renderFloor(ctx);

    // 구간 알림 띠 (캐릭터 뒤, 노트를 가리지 않음)
    if (this.banner) {
      const b = this.banner;
      const k = Math.min(1, b.t / 10);
      const out = b.t > 130 ? (b.t - 130) / 20 : 0;
      const bx = Math.round(-W + k * W + out * W);
      drawPanel(ctx, bx + 4, 122, W - 8, 18, b.panel);
      KText.draw(ctx, b.text, bx + W / 2, 124, C(b.color), { align: 'center', font: 'b', outline: C('1') });
    }

    // 캐릭터 발밑 조명 + 캐릭터
    const p = this.me;
    const lvl = p.fever ? 8 : 4 + Math.round(this.stage.pulse * 3);
    this.stage.renderSpot(ctx, this.dancer.x, this.dancer.feetY, 26, p.fever ? '9' : 'a', lvl);
    this.dancer.render(ctx, t, beat, alpha, f);

    // 레인
    this.highway.render(ctx, t, this.approach, f, beat);
    this.particles.render(ctx);

    this.renderHud(ctx);
    this.renderBoard(ctx);
    this.renderProgress(ctx, t);

    // 카운트다운 3 · 2 · 1 · GO (카운트인 한 마디)
    const bar = this.song.barSec;
    if (this.phase === 'play' && t < 0.3 && t >= -bar) {
      const i = Math.floor((t + bar) / beat);
      const label = ['3', '2', '1', 'GO!'][Math.max(0, Math.min(3, i))];
      const ph = ((t + bar) / beat) % 1;
      const s = ph < 0.15 ? 5 : 4;
      BitmapFont.draw(ctx, label, this.highway.centerX, 50 - (s - 4) * 2, C(i >= 3 ? '9' : 'a'), { align: 'center', scale: s, outline: C('1') });
    }

    if (this.phase === 'intro' || this.phase === 'wait') this.renderIntro(ctx);
    if (this.phase === 'outro' && this.t > 4) {
      const k = Math.min(1, this.t / 12);
      KText.draw(ctx, 'FINISH!', HUD_X / 2, 36 - Math.round((1 - k) * 30), C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    }
  }

  // 오른쪽 점수판 (원본 개인 화면) — 점수는 서버 값, 나머지는 방금 친 결과를 바로 보여 준다
  renderHud(ctx) {
    const p = this.me;
    const x = HUD_X;
    drawPanel(ctx, x, 12, 100, 148, 'dark');
    KText.draw(ctx, this.mine.name || '', x + 50, 16, C(p.def.color), { align: 'center', font: 'b', outline: C('1') });
    KText.draw(ctx, 'SCORE', x + 8, 30, C('k'), { font: 's' });
    BitmapFont.draw(ctx, String(Math.max(0, this.scoreShown)).padStart(7, '0'), x + 50, 44, C('9'), { align: 'center', scale: 2, outline: C('1') });
    const g = p.liveGrade; // 지금까지의 정확도로 예상 등급
    KText.draw(ctx, 'RANK', x + 8, 56, C('k'), { font: 's' });
    if (g) KText.draw(ctx, g.grade, x + 24, 66, C(g.color), { align: 'center', font: 'b', scale: 2, outline: C('1') });
    else KText.draw(ctx, '-', x + 24, 66, C('j'), { align: 'center', font: 'b', scale: 2 });
    KText.draw(ctx, 'COMBO', x + 56, 56, C('k'), { font: 's' });
    BitmapFont.draw(ctx, String(p.combo), x + 56, 71, p.fever ? C('9') : C('a'), { scale: 2 });
    KText.draw(ctx, `최대 ${p.maxCombo}`, x + 56, 81, C('j'), { font: 'n' });
    const rows = [['PERFECT', 'perfect', '9'], ['GREAT', 'great', 'h'], ['GOOD', 'good', 'e'], ['MISS', 'miss', 'j']];
    rows.forEach(([lab, k, col], i) => {
      const y = 98 + i * 14;
      KText.draw(ctx, lab, x + 8, y, C(col), { font: 's' });
      BitmapFont.draw(ctx, String(p.counts[k]), x + 92, y + 2, C('a'), { align: 'right', scale: 2 });
    });
  }

  // 왼쪽 위: 모두의 점수 · 콤보 (서버 값, 점수 높은 순)
  renderBoard(ctx) {
    const snap = this.net.snap;
    const stats = (snap && snap.players) || {};
    const rows = this.players.map((pl, i) => ({ pl, i, st: stats[pl.id] || { score: 0, combo: 0 } }));
    rows.sort((a, b) => b.st.score - a.st.score || a.i - b.i);
    const x = BOARD_X;
    const y = BOARD_Y;
    const w = 108;
    drawPanel(ctx, x, y, w, rows.length * 11 + 7, 'dark');
    rows.forEach((r, k) => {
      const ry = y + 3 + k * 11;
      const mine = r.pl.id === this.meId;
      const flash = this.rowFlash[r.pl.id] && this.frame % 8 < 4;
      if (mine || flash) {
        ctx.fillStyle = C(flash ? '7' : '2');
        ctx.fillRect(x + 2, ry, w - 5, 11);
      }
      BitmapFont.draw(ctx, String(k + 1), x + 5, ry + 3, k === 0 && r.st.score > 0 ? C('9') : C('j'));
      // 이름은 칸을 넘지 않게 잘라서
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 11, ry - 1, 46, 13);
      ctx.clip();
      KText.draw(ctx, r.pl.name || '', x + 11, ry - 1, this.colorOf(r.pl.id), { font: 'n' });
      ctx.restore();
      if (r.st.combo >= 5) BitmapFont.draw(ctx, `x${r.st.combo}`, x + 75, ry + 3, r.st.combo >= CONFIG.FEVER_COMBO ? C('9') : C('k'), { align: 'right' });
      BitmapFont.draw(ctx, String(r.st.score).padStart(7, '0'), x + w - 4, ry + 3, mine ? C('a') : C('k'), { align: 'right' });
    });
  }

  // 맨 위 곡 진행 막대 (구간마다 눈금, 코러스는 금색)
  renderProgress(ctx, t) {
    const k = Math.max(0, Math.min(1, t / this.song.duration));
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 4);
    this.song.bars.forEach((b, i) => {
      const x = Math.floor((i / this.song.bars.length) * W);
      const x2 = Math.floor(((i + 1) / this.song.bars.length) * W);
      ctx.fillStyle = C(b.fever ? '7' : '2');
      ctx.fillRect(x, 1, x2 - x, 2);
    });
    const fx = Math.round(k * W);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, 1, fx, 2);
    ctx.fillStyle = C('9');
    ctx.fillRect(0, 1, fx, 1);
    ctx.fillStyle = C('b');
    ctx.fillRect(Math.max(0, fx - 1), 0, 2, 4);
  }

  // 곡 소개 카드 (오른쪽 점수판을 가리지 않게 왼쪽에)
  renderIntro(ctx) {
    const cw = HUD_X;
    const k = Math.min(1, this.t / 14);
    const y = Math.round(26 - (1 - k) * 60);
    drawPanel(ctx, cw / 2 - 100, y, 200, 92, 'red');
    KText.draw(ctx, this.songDef.title, cw / 2, y + 1, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    KText.draw(ctx, this.songDef.artist, cw / 2, y + 35, C('k'), { align: 'center', font: 's' });
    const stars = '★'.repeat(this.diff.stars) + '☆'.repeat(5 - this.diff.stars);
    KText.draw(ctx, `${this.diff.label} ${stars}`, cw / 2, y + 48, C('8'), { align: 'center', font: 's' });
    KText.draw(ctx, `BPM ${this.songDef.bpm} · 노트 ${this.chart.length}개`, cw / 2, y + 61, C('a'), { align: 'center', font: 's' });
    KText.draw(ctx, '칩이 아래 키에 닿는 순간 눌러!', cw / 2, y + 75, C('a'), { align: 'center', font: 's' });
    drawPanel(ctx, cw / 2 - 100, y + 96, 200, 18, 'dark');
    if (!this.audioReady && this.frame % 40 < 28) {
      KText.draw(ctx, '아무 키나 누르면 소리가 켜져요!', cw / 2, y + 98, C('9'), { align: 'center', font: 's' });
    } else {
      KText.draw(ctx, `← ↑ → / A S D · 싱크 ${this.syncLabel} ( [ ] )`, cw / 2, y + 99, C('k'), { align: 'center', font: 'n' });
    }
  }

  // 해설 자막 (맨 아래 한 줄) — AI 가 쓴 줄에는 작은 "AI" 표시
  renderCaption(ctx) {
    const c = this.caption;
    if (!c || !c.text) return;
    if (c.t > SAY_FRAMES - 20 && c.t % 4 < 2) return; // 사라질 때 깜빡임
    const y = H - 15;
    drawPanel(ctx, 4, y, W - 8, 15, 'default');
    let x = 9;
    if (c.ai) {
      ctx.fillStyle = C('9');
      ctx.fillRect(x, y + 3, 11, 9);
      BitmapFont.draw(ctx, 'AI', x + 2, y + 5, C('1'));
      x += 14;
    }
    if (c.who) {
      KText.draw(ctx, c.who, x, y + 1, C('t'), { font: 'n' });
      x += KText.width(c.who, 'n') + 5;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, W - 8 - x, 15);
    ctx.clip();
    const wide = KText.width(c.text, 's') > W - 10 - x;
    KText.draw(ctx, c.text, x, y + (wide ? 1 : 0), C('a'), { font: wide ? 'n' : 's' });
    ctx.restore();
  }

  // 최종 순위 (원본 result.js 의 순위표) + AI 총평
  renderFinal(ctx, alpha) {
    const t = this.t;
    this.stage.renderBack(ctx, this.frame / 60, this.frame);
    this.stage.renderFloor(ctx);
    ctx.fillStyle = DITHER.get(ctx, 'o', 8);
    ctx.fillRect(0, 0, W, H);
    this.particles.render(ctx);
    KText.draw(ctx, '최종 순위', 8, 5, C('9'), { font: 'b', outline: C('1') });
    KText.draw(ctx, `${this.songDef.title} · ${this.diff.label}`, 262, 6, C('k'), { font: 'n', align: 'right', outline: C('1') });
    const rows = this.results();
    const rowH = 24;
    const y0 = 22;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const s = r.stats || {};
      const pl = this.byId.get(r.playerId) || {};
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 12;
      const x = 6 - slide;
      const y = y0 + i * rowH;
      drawPanel(ctx, x, y, 256, rowH - 2, r.rank === 1 ? 'red' : r.playerId === this.meId ? 'blue' : 'dark');
      BitmapFont.draw(ctx, String(r.rank), x + 12, y + 6, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      const jump = r.rank === 1 ? Math.abs(Math.round(Math.sin(t / 8) * 2)) : 0;
      const face = spritesOf(pl.character).portrait;
      const fh = Math.min(19, face.height);
      ctx.drawImage(face, 0, 0, face.width, fh, Math.round(x + 38 - face.width / 2), y + 1 - jump, face.width, fh);
      if (r.rank === 1) ctx.drawImage(SPR.crown, x + 36, y - 2 - jump);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 57, y, 54, rowH);
      ctx.clip();
      KText.draw(ctx, r.name || '', x + 58, y + 3, this.colorOf(r.playerId), { font: 'b', outline: C('1') });
      ctx.restore();
      // 등급
      drawGradeBadge(ctx, x + 122, y + 10, s.grade || 'D');
      // 점수 + 최대 콤보
      BitmapFont.draw(ctx, String(r.score).padStart(7, '0'), x + 164, y + 6, C('a'), { align: 'center', scale: 2 });
      // 풀콤보 FC / 올퍼펙트 AP 딱지
      if (s.fullCombo) {
        const tag = s.allPerfect ? 'AP' : 'FC';
        drawPanel(ctx, x + 196, y + 3, 22, 16, s.allPerfect ? 'default' : 'felt');
        KText.draw(ctx, tag, x + 207, y + 4, s.allPerfect ? C('9') : C('e'), { align: 'center', font: 'b' });
      }
      BitmapFont.draw(ctx, `X${s.maxCombo || 0}`, x + 250, y + 9, C('e'), { align: 'right' });
    });
    // 1등 춤
    if (this.winner) {
      this.stage.renderSpot(ctx, 292, 140, 15, '9', 6);
      this.winner.render(ctx, this.beatT || 0, this.song.beatSec, alpha, this.frame);
    }
    // AI 총평 (도착했을 때만)
    const v = this.verdict;
    if (v && v.headline && !(this.caption && this.caption.text)) {
      const y = 144;
      drawPanel(ctx, 6, y, 308, 34, 'default');
      ctx.fillStyle = C('9');
      ctx.fillRect(11, y + 4, 11, 9);
      BitmapFont.draw(ctx, 'AI', 13, y + 6, C('1'));
      KText.draw(ctx, '총평', 25, y + 2, C('t'), { font: 'n' });
      KText.draw(ctx, v.headline, 50, y + 1, C('9'), { font: 's' });
      if (v.mvp) KText.draw(ctx, `1등에게: ${v.mvp}`, 11, y + 13, C('a'), { font: 'n' });
      if (v.cheer) KText.draw(ctx, `응원: ${v.cheer}`, 11, y + 22, C('k'), { font: 'n' });
    }
  }
}
