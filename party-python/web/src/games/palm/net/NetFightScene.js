// =============================================================
// NetFightScene — 대결 장면의 멀티플레이판
//
// 원본 FightScene 의 화면·연출(게이지, 파티클, 팝업, 소리, 화면 흔들림)은 그대로 물려받고,
// 경기 진행만 서버 상태로 바꾼다.
//
//   내 키 입력  → 바뀔 때마다 서버로 전송
//   서버 상태   → 두 선수의 균형·동작·남은 시간
//   서버 사건   → 맞음·헛손질·버티기 등 연출
//
// 내 경기는 내가 왼쪽에 보인다. 이번 라운드에 쉬는 사람은 첫 번째 경기를 관전한다.
// =============================================================
import { FightScene } from '../scenes/FightScene.js';
import { drawText } from '../ui/PixelFont.js';
import { drawPanel } from '../ui/UIKit.js';
import { PAL } from '../palette.js';
import { MirrorMatch } from './MirrorMatch.js';

/** 사건에 들어 있는 자리 이름('a' | 'b')을 화면의 선수로 바꿀 필드들 */
const FIGHTER_FIELDS = ['who', 'attacker', 'defender', 'feinter', 'holder', 'a', 'b'];

export class NetFightScene extends FightScene {
  constructor(game) {
    const net = game.net;
    const s = net.snap;
    const me = game.me;
    // 내가 뛰는 경기를 찾는다. 없으면(쉬는 라운드) 첫 번째 경기를 본다
    let index = s.matches.findIndex((m) => me && (m.a === me.id || m.b === me.id));
    const spectate = index < 0;
    if (spectate) index = 0;
    const pair = s.matches[index] || { a: null, b: null };
    const a = game.playerById(pair.a);
    const b = game.playerById(pair.b);
    const swap = !spectate && me && pair.b === me.id;
    // 원본 생성자가 '왼쪽 선수'로 쓰는 값
    game._viewPlayer = swap ? b : a;
    super(game);

    this.matchIndex = index;
    this.spectate = spectate;
    this.match = new MirrorMatch({ cfg: this.cfg, a, b, swap });
    this.player = this.match.player;
    this.round = s.round;
    this.rounds = s.rounds;
    this.lastSent = '';
    this.lastCountSec = -1;
    this.endHandled = false;
    net.clearEvents();
  }

  // 한 사람이 멈출 수 없다
  get pausable() {
    return false;
  }

  enter() {
    this.game.audio.setBgmIntensity(0.35);
  }

  update() {
    const g = this.game;
    const net = g.net;
    const s = net.snap;
    const m = this.match;
    const M = this.cfg.MATCH;
    this.t++;

    // 다른 라운드의 상태가 오기 시작하면 이 장면은 그대로 두고 Game 이 장면을 바꾸길 기다린다
    const d = s && s.round === this.round ? s.duels[this.matchIndex] : null;
    if (d) m.apply(d);

    if (s && s.round === this.round && (s.phase === 'intro' || s.phase === 'countdown')) {
      // ---- 카운트다운: 서버가 정한 시작 시각까지 남은 시간으로 숫자를 정한다 ----
      this.phase = 'countdown';
      const total = M.COUNTDOWN * 60;
      const elapsed = Math.round((net.now() - s.countdownAt) * 60);
      this.countT = Math.max(0, Math.min(total - 1, elapsed));
      const sec = Math.floor(this.countT / 60);
      if (elapsed >= 0 && sec !== this.lastCountSec) {
        this.lastCountSec = sec;
        g.audio.play('count');
      }
    } else if (d && !d.over && s.phase === 'fight') {
      if (this.phase !== 'fight') {
        this.phase = 'fight';
        g.audio.play('go');
        g.audio.setBgmIntensity(0.6);
        this.banner('시작!', 40);
      }
      if (!this.spectate) this.sendInput();
      this.timeWarnings();
    } else if (d && d.over && !this.endHandled) {
      // 종료 사건을 놓쳤더라도(재접속 등) 상태로 알 수 있다
      this.handleMatchEnd(d.result);
    }

    for (const e of net.takeEvents(this.matchIndex)) this.handleServerEvent(e);

    m.update();
    this.ambientFx(1);
    this.particles.update(1);
    this.popups.update(1);
    if (this.bannerT > 0) this.bannerT--;
    if (this.bannerT <= 0 && this.nextBanner) {
      this.banner(this.nextBanner[0], this.nextBanner[1]);
      this.nextBanner = null;
    }
    this.updateCamera();
  }

  /** 조작 상태가 바뀌었거나 손빼기를 눌렀으면 서버로 보낸다 */
  sendInput() {
    const f = this.game.input.playerFrame();
    const key = `${f.lean}|${f.pushDown ? 1 : 0}|${f.holdDown ? 1 : 0}`;
    if (key === this.lastSent && !f.feintPressed) return;
    this.lastSent = key;
    this.game.net.sendInput({ lean: f.lean, push: f.pushDown, hold: f.holdDown, feint: f.feintPressed });
  }

  /** 서버 사건의 자리 이름을 화면의 선수로 바꿔 원본 연출 코드에 넘긴다 */
  handleServerEvent(e) {
    if (e.type === 'matchEnd') {
      this.handleMatchEnd(e.result);
      return;
    }
    const ev = { ...e };
    for (const field of FIGHTER_FIELDS) {
      if (ev[field] === 'a' || ev[field] === 'b') ev[field] = this.match.byKey(ev[field]);
    }
    if (ev.type === 'splash' && ev.who) ev.x = ev.who.fallWaterX();
    if (ev.type === 'timeUp') ev.winner = this.viewWinner(ev.winner);
    this.handleEvent(ev);
  }

  /** 서버의 승자('a' | 'b' | 'draw') → 화면 기준('player' = 왼쪽, 'cpu' = 오른쪽, 'draw') */
  viewWinner(winner) {
    if (winner !== 'a' && winner !== 'b') return 'draw';
    return this.match.byKey(winner) === this.match.player ? 'player' : 'cpu';
  }

  handleMatchEnd(result) {
    if (this.endHandled || !result) return;
    this.endHandled = true;
    const winner = this.viewWinner(result.winner);
    this.onMatchEnd({ ...result, winner });
    if (this.spectate && winner !== 'draw') {
      // 관전 중에는 이긴 사람 이름으로 알린다
      const name = (winner === 'player' ? this.match.player : this.match.cpu).name;
      const text = `${name} 승리!`;
      if (this.nextBanner) this.nextBanner = [text, 100];
      else this.banner(text, 120);
    }
  }

  draw(ctx) {
    super.draw(ctx);
    const s = this.game.net.snap;
    // 라운드 표시
    drawText(ctx, `ROUND ${this.round}/${this.rounds}`, 160, 150, {
      font: 's', color: PAL.white, outline: PAL.ink, align: 'center',
    });
    let note = null;
    if (this.spectate) note = '이번 라운드는 쉬어요 — 관전 중';
    else if (this.endHandled && s && s.phase === 'fight') note = '다른 경기가 끝나기를 기다리는 중…';
    if (note) {
      drawPanel(ctx, 80, 35, 160, 12, 'dark');
      drawText(ctx, note, 160, 36, { font: 's', color: PAL.sand, align: 'center' });
    }
  }
}
