// =============================================================
// NetPlayScene — 플레이 장면의 멀티플레이판
//
// 원본 PlayScene 의 화면·연출(피버, 미끄러짐, 종료 연출, HUD)은 그대로 물려받고,
// 판정·힘·점수·승패만 서버 결과로 바꾼다.
//
//   내 키 입력 → 누른 시각을 서버로 전송 (화면에는 예상 판정을 바로 표시)
//   서버 판정 결과 → 다른 선수의 동작·효과 표시, 내 예상 판정이 달랐으면 서버 값으로 고침
//   서버 상태     → 줄 위치, 점수, 라운드 종료
// =============================================================
import { PlayScene } from '../scenes/PlayScene.js';
import { BeatTimeline, TimelineJudge } from './timeline.js';

const MAX_INPUT_LAG = 0.25;   // 키를 누른 순간과 처리 시점의 차이 보정 상한 (초)
const MAX_SNAP_AGE = 0.25;    // 서버 상태가 이보다 오래됐으면 그만큼만 앞으로 계산 (초)
const HAND_OFFSET = 6;        // 발 중앙에서 손(줄 잡는 곳)까지 x 거리

export class NetPlayScene extends PlayScene {
  constructor(game) {
    super(game);
    this.timeline = null;
    this.predictor = null;
    this._appliedSnap = null;
  }

  enter(params = {}) {
    const game = this.game;
    const cfg = game.config;
    const net = game.net;
    const s = net.snap;

    // 이번 라운드의 박자 격자(피버 템포 포함)와 내 화면용 예상 판정기
    this.timeline = new BeatTimeline(cfg);
    this.predictor = new TimelineJudge(cfg, this.timeline);
    game.beat.enterRound(s.startAt, this.timeline);
    if (!(params && params.carryBeat)) {
      // 카운트다운 없이 들어온 경우(중간 접속): 남은 예약음을 지우고 다음 박부터 예약
      game.music.stopAll();
      this._scheduleBeats([game.beat.lastBeatIndex]);
    }
    net.takeJudges(); // 이전 장면에서 쌓인 판정은 버린다

    this.tempoRequest = null;
    this.musicFever = false;
    this.timeLeft = Math.max(0, cfg.ROUND_TIME - game.beat.time);
    this.t = 0;
    this.ended = false;
    this.endT = 0;
    this.winnerSide = null;
    this.leaving = false;
    this.pulse = 1;
    this.feverFireT = 0;
    this.slipDustT = { left: 0, right: 0 };
    this.slipSoundT = { left: 0, right: 0 };
    this._appliedSnap = null;
    this._round = s.round;
    game.camX = 0;
    game.world.layoutTeams();
    game.fever.update(0);

    // 카운트다운 START 직전에 누른 입력도 보낸다
    const early = params && Array.isArray(params.earlyPresses) ? params.earlyPresses : [];
    if (early.length) this._handlePresses(early.map((a) => a.ev));
  }

  update(dt) {
    const game = this.game;
    const cfg = game.config;
    const beat = game.beat;
    const s = game.net.snap;
    this.t += dt;
    this.pulse = Math.max(0, this.pulse - dt * 4);

    // 1) 박자 시계 (서버 시각 기준)
    const beats = beat.update(dt);
    if (beats.length) this.pulse = 1;

    if (this.ended) {
      this._scheduleBeats(beats);
      this._updateEnded(dt);
      return;
    }

    // 2) 피버 연출 + 음악 예약
    this._updateFever(dt);
    this.tempoRequest = null; // 템포는 박자 격자가 정한다
    this._scheduleBeats(beats);

    // 3) 내 입력 전송 + 서버 판정 반영
    const me = game.players.find((p) => p.isMe);
    if (me && me.side && me.powerSource) this._handlePresses(me.powerSource.poll(game) || []);
    this._applyJudges();

    // 4) 줄: 서버 상태를 기준으로, 상태 사이 구간은 같은 물리로 이어 그린다
    this._applyRope(dt, s);
    game.world.layoutTeams();
    this._updateSlip(dt);
    for (const p of game.players) p.update(dt, game.fx.frozen);

    // 5) 카메라 + 관중 들썩임
    game.camX = Math.round(game.rope.pos * cfg.CAMERA_FOLLOW);
    this.timeLeft = Math.max(0, cfg.ROUND_TIME - beat.time);
    const lean = Math.min(1, Math.abs(game.rope.pos) / game.rope.winDistance);
    const urgency = this.timeLeft <= 5 ? 0.2 : 0;
    game.background.setExcitement(Math.min(1, 0.25 + lean * 0.45 + (game.fever.active ? 0.3 : 0) + urgency));

    // 6) 라운드 종료는 서버가 알린다
    if (s && s.round === game.round && s.phase === 'ended') {
      game.rope.pos = s.rope.pos;
      game.world.layoutTeams();
      this._endRound(s.winnerSide);
    } else if (s && s.round !== this._round && s.phase === 'play') {
      // 연결이 오래 끊겨 다음 라운드가 이미 시작된 경우: 이 장면을 새 라운드로 다시 시작
      this.enter({});
    }
  }

  /** 다음 박의 음악·틱 예약. 그 박에서 시작하는 구간이 피버 템포면 피버 편곡 */
  _scheduleBeats(beats) {
    if (!beats || beats.length === 0) return;
    const game = this.game;
    this.musicFever = this.timeline.isFastAfter(game.beat.nextBeatIndex);
    game.scheduleBeatAudio(beats, 'play', { fever: this.musicFever });
  }

  /** 내 키 입력들: 누른 시각(라운드 기준)을 서버로 보내고, 예상 판정을 바로 보여준다 */
  _handlePresses(events) {
    const game = this.game;
    const cfg = game.config;
    const net = game.net;
    const me = game.players.find((p) => p.isMe);
    if (!me || !me.side || !net.snap) return;
    const nowMs = performance.now();
    const roundNow = net.now() - net.snap.startAt;
    for (const ev of events) {
      const ts = ev && typeof ev.timeStamp === 'number' ? ev.timeStamp : nowMs;
      const lag = Math.min(MAX_INPUT_LAG, Math.max(0, (nowMs - ts) / 1000));
      const t = roundNow - lag - cfg.INPUT_OFFSET;
      if (t < -cfg.GOOD_WINDOW || t > cfg.ROUND_TIME) continue;
      net.sendPull(t);
      const { grade } = this.predictor.judge(me.id, t);
      this._showJudge(me, grade);
    }
  }

  /** 서버 판정 결과 반영 */
  _applyJudges() {
    const game = this.game;
    for (const ev of game.net.takeJudges()) {
      const player = game.players.find((p) => p.id === ev.playerId);
      if (!player || !player.side) continue;
      if (player.isMe) {
        // 내 판정은 이미 예상값으로 보여줬다. 서버 판정이 다르면 표시만 서버 값으로 고친다
        if (player.pop && player.pop.grade !== ev.grade) player.pop.grade = ev.grade;
      } else {
        this._showJudge(player, ev.grade);
      }
    }
  }

  /** 판정 하나의 화면·소리 연출 (원본 PlayScene._processInputs 의 연출 부분) */
  _showJudge(player, grade) {
    const game = this.game;
    const cfg = game.config;
    const L = cfg.LAYOUT;
    player.onPull(grade);
    const dir = player.side === 'left' ? 1 : -1;
    const handX = Math.round(player.x) + dir * HAND_OFFSET;
    game.audio.play(grade, { pan: player.side === 'left' ? -0.3 : 0.3 });
    if (grade === 'perfect') {
      game.fx.hitstop(cfg.HITSTOP);
      game.rope.kick(2);
      game.fx.shake(cfg.SHAKE_PERFECT.intensity, cfg.SHAKE_PERFECT.duration);
      game.particles.emit('sparkle', handX, L.ROPE_Y, { count: 6 });
    } else if (grade === 'good') {
      game.particles.emit('dust', Math.round(player.x), L.GROUND_Y, { count: 3, dir: -dir });
    } else if (grade === 'spam') {
      game.particles.emit('spark', handX, L.ROPE_Y, { count: 2 });
    }
  }

  /** 줄 위치: 새 서버 상태가 오면 그 값에서 다시 시작하고, 그 사이에는 같은 물리로 진행 */
  _applyRope(dt, s) {
    const rope = this.game.rope;
    if (s && s.rope && s !== this._appliedSnap && s.round === this.game.round) {
      this._appliedSnap = s;
      rope.pos = s.rope.pos;
      rope.vel = s.rope.vel;
      rope.leftForce = s.rope.lf;
      rope.rightForce = s.rope.rf;
      // 상태가 만들어진 뒤 지난 시간만큼 앞으로
      const age = Math.min(MAX_SNAP_AGE, Math.max(0, this.game.net.now() - s.now));
      rope.update(age);
    } else {
      rope.update(dt);
    }
  }

  /** FINISH 연출 뒤 라운드 결과 장면으로. 결과는 서버가 계산한 값 */
  _updateEnded(dt) {
    const game = this.game;
    this.endT += dt;
    for (const p of game.players) p.update(dt, game.fx.frozen);
    if (!this.leaving && this.endT >= 1.0 && !game.fx.transitioning) {
      this.leaving = game.goto('roundResult', { result: game.endRound(this.winnerSide) }, { transition: 'none' });
    }
  }
}
