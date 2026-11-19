// =============================================================
// FightScene.js — 대결 화면
//   단계: countdown(3,2,1,시작!) → fight → end(슬로모션 + 관중 환호) → RoundResult
//   Match(순수 로직)의 이벤트를 받아 사운드/파티클/히트스톱/화면 흔들림으로 연출한다.
// =============================================================
import { PAL } from '../palette.js';
import { drawText } from '../ui/PixelFont.js';
import { drawPanel, drawBalanceGauge, drawTimer, drawKeyCap, drawIcon, drawChargeMeter } from '../ui/UIKit.js';
import { Match } from '../game/Match.js';
import { FighterRenderer } from '../game/FighterRenderer.js';
import { Particles, Popups } from '../game/Particles.js';
import { createRng, clamp } from '../util.js';
import { drawWorld } from './common.js';

export class FightScene {
  constructor(game) {
    this.game = game;
    const cfg = game.cfg;
    this.cfg = cfg;
    this.player = game.currentPlayer;
    this.match = new Match({
      cfg,
      playerName: this.player.name,
      playerLook: this.player.lookId,
      cpuName: cfg.CPU.NAME,
      cpuLook: 'champ',
    });
    this.renderer = new FighterRenderer(cfg, game.assets);
    this.particles = new Particles(createRng(cfg.MATCH.SEED + 17));
    this.popups = new Popups();
    this.phase = 'countdown';
    this.t = 0; // 씬 경과 프레임 (실시간)
    this.countT = 0;
    this.endT = 0;
    this.shake = 0;
    this.camX = 0;
    this.camY = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.chargers = new Set();
    this.lastWarnSec = -1;
    this.done = false;
    this.bannerText = null;
    this.bannerT = 0;
    this.nextBanner = null;
  }

  get pausable() {
    return this.phase === 'countdown' || this.phase === 'fight';
  }

  enter() {
    const g = this.game;
    g.cpuController.reset({ keepMemory: !!this.cfg.CPU.MEMORY_PERSIST });
    g.cpuController.observe({ type: 'roundStart', playerName: this.player.name, frame: 0 });
    g.audio.setBgmIntensity(0.35);
  }

  exit() {
    this.game.audio.stopCharge();
  }

  bgState() {
    const m = this.match;
    const worst = Math.max(Math.abs(m.player.body.b), Math.abs(m.cpu.body.b));
    return { time: m.elapsedSec, tension: clamp(worst / 100, 0, 1) * 0.8 + m.wobble * 0.2 };
  }

  // ---------------- 업데이트 ----------------
  update() {
    const g = this.game;
    const M = this.cfg.MATCH;
    this.t++;
    const m = this.match;

    if (this.phase === 'countdown') {
      // 3초 카운트다운 — 매 초 삐 소리, 0에서 "시작!"
      const total = M.COUNTDOWN * 60;
      if (this.countT % 60 === 0 && this.countT < total) g.audio.play('count');
      this.countT++;
      if (this.countT >= total) {
        this.phase = 'fight';
        m.start();
        g.audio.play('go');
        g.audio.setBgmIntensity(0.6);
        this.banner('시작!', 40);
      }
      // 카운트다운 중에도 숨쉬기 애니메이션은 진행
      m.update(1, null, null);
      this.particles.update(1);
      this.popups.update(1);
      this.updateCamera();
      return;
    }

    let dt = 1;
    if (this.phase === 'fight') {
      const pIn = g.input.playerFrame();
      // CPU는 매 프레임 스냅샷을 받는다 (내부적으로 반응 지연 + 비동기 결정)
      // 히트스톱(멈춤) 동안에는 CPU 계획도 같이 멈춘다
      const cIn = m.hitstop > 0 ? null : g.cpuController.update(m.snapshotForCpu());
      m.update(1, pIn, cIn);
      this.timeWarnings();
    } else if (this.phase === 'end') {
      this.endT++;
      // 승부가 난 직후 슬로모션
      dt = this.endT < M.END_SLOWMO_FRAMES ? M.END_SLOWMO : 1;
      m.update(dt, null, null);
      if (this.endT >= M.RESULT_DELAY && !this.done) this.finishRound();
    }

    for (const e of m.drainEvents()) this.handleEvent(e);
    this.ambientFx(dt);
    this.particles.update(dt);
    this.popups.update(dt);
    if (this.bannerT > 0) this.bannerT--;
    if (this.bannerT <= 0 && this.nextBanner) {
      this.banner(this.nextBanner[0], this.nextBanner[1]);
      this.nextBanner = null;
    }
    this.updateCamera();
  }

  banner(text, frames = 60) {
    this.bannerText = text;
    this.bannerT = frames;
  }

  timeWarnings() {
    const left = Math.ceil(this.match.timeLeft);
    if (left <= 5 && left >= 1 && left !== this.lastWarnSec) {
      this.lastWarnSec = left;
      this.game.audio.play('tick', { pitch: 1 + (5 - left) * 0.1 });
    }
  }

  // 상시 연출: 위험할 때 땀방울, 차지 중 기운, 받침대 흔들림 먼지
  ambientFx(dt) {
    const m = this.match;
    const B = this.cfg.BALANCE;
    for (const f of [m.player, m.cpu]) {
      if (f.fallen) continue;
      const head = this.renderer.headPos(f);
      if (Math.abs(f.body.b) > B.DANGER && this.t % 9 === 0) this.particles.sweat(head.x, head.y + 4, -f.dir);
      if (f.state === 'charge' && this.t % 3 === 0) {
        const palm = this.renderer.palmPos(f);
        this.particles.chargeGlow(palm.x - f.dir * 4, palm.y, f.charge);
      }
    }
    // 차지가 카운터/휘청임으로 끊긴 경우(chargeEnd 이벤트 없음)도 정리
    if (this.chargers.size) {
      for (const f of this.chargers) {
        if (f.state !== 'charge' && f.state !== 'release') this.chargers.delete(f);
      }
      if (this.chargers.size === 0) this.game.audio.stopCharge();
    }
    // CPU 차지 소리 레벨 갱신
    if (this.chargers.size) {
      let lvl = 0;
      for (const f of this.chargers) lvl = Math.max(lvl, f.charge);
      this.game.audio.setCharge(lvl);
    }
  }

  updateCamera() {
    const J = this.cfg.JUICE;
    const m = this.match;
    // 두 선수의 화면상 기울기 평균 쪽으로 카메라가 살짝 따라감
    const target = clamp(((m.player.screenBalance + m.cpu.screenBalance) / 2) * 0.08, -J.CAMERA_RANGE, J.CAMERA_RANGE);
    this.camX += (target - this.camX) * J.CAMERA_FOLLOW;
    // 화면 흔들림 (정수 픽셀)
    if (this.shake > 0.3) {
      this.shakeX = Math.round((this.particles.rng() * 2 - 1) * this.shake);
      this.shakeY = Math.round((this.particles.rng() * 2 - 1) * this.shake * 0.6);
      this.shake *= J.SHAKE_DECAY;
    } else {
      this.shake = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  addShake(v) {
    this.shake = Math.max(this.shake, v);
  }

  // ---------------- 이벤트 연출 ----------------
  handleEvent(e) {
    const g = this.game;
    const a = g.audio;
    const J = this.cfg.JUICE;
    const m = this.match;
    const cpu = g.cpuController;
    const side = (f) => (f === m.player ? 'player' : 'cpu');
    const frame = Math.floor(m.frame);
    const contact = { x: Math.round((m.player.baseX + m.cpu.baseX) / 2), y: this.cfg.STAGE.FLOOR_Y - 18 };
    const tagColor = (f) => (f === m.player ? PAL.lime : PAL.orange);
    const actionOf = (f) => (f.charged ? 'charge' : 'push');

    switch (e.type) {
      case 'windup':
        if (e.who === m.player) cpu.observe({ type: 'playerAction', action: 'push', frame });
        break;
      case 'chargeStart':
        if (this.chargers.size === 0) a.startCharge();
        this.chargers.add(e.who);
        if (e.who === m.player) cpu.observe({ type: 'playerAction', action: 'charge', frame });
        break;
      case 'chargeEnd':
        this.chargers.delete(e.who);
        if (this.chargers.size === 0) a.stopCharge();
        break;
      case 'feint':
        a.play('feint');
        if (e.who === m.player) cpu.observe({ type: 'playerAction', action: 'feint', frame });
        break;
      case 'holdStart':
        if (e.who === m.player) cpu.observe({ type: 'playerAction', action: 'hold', frame });
        break;

      case 'hit': {
        const big = e.charged;
        a.play(big ? 'clapBig' : 'clap', { pitch: big ? 0.9 : 1 + this.particles.rng() * 0.1 });
        m.hitstop = Math.max(m.hitstop, big ? J.HITSTOP_CHARGE : J.HITSTOP_PUSH);
        this.addShake(big ? J.SHAKE_CHARGE : J.SHAKE_PUSH);
        this.particles.sparks(contact.x, contact.y, big ? 2 : 1);
        this.particles.dust(e.defender.baseX, this.cfg.STAGE.FLOOR_Y, -e.defender.dir, big ? 8 : 4);
        const label = { counter: '카운터!', holdFail: '버티기 실패!', exposed: '빈틈!', stagger: '짝!' }[e.kind] || (big ? '짜악!!' : '짝!');
        this.popups.add(label, contact.x, contact.y - 22, { color: big ? PAL.sand : PAL.white, font: big ? 'l' : 'm' });
        cpu.observe({ type: 'result', who: side(e.attacker), action: actionOf(e.attacker), result: 'hit', frame });
        // 버티기 자세 잡다가 맞은 경우 → 맞은 쪽의 버티기는 실패
        if (e.kind === 'holdFail') cpu.observe({ type: 'result', who: side(e.defender), action: 'hold', result: 'hit', frame });
        break;
      }
      case 'clash':
        a.play('clash');
        m.hitstop = Math.max(m.hitstop, J.HITSTOP_CLASH);
        this.addShake(J.SHAKE_CLASH);
        this.particles.sparks(contact.x, contact.y, 2.5);
        this.popups.add('짝!!', contact.x, contact.y - 24, { color: PAL.sand, font: 'l' });
        cpu.observe({ type: 'result', who: 'player', action: actionOf(m.player), result: 'clash', frame });
        cpu.observe({ type: 'result', who: 'cpu', action: actionOf(m.cpu), result: 'clash', frame });
        break;
      case 'whiff': {
        a.play('whoosh', { pitch: e.charged ? 0.8 : 1 });
        m.hitstop = Math.max(m.hitstop, J.HITSTOP_WHIFF);
        this.addShake(J.SHAKE_WHIFF);
        const head = this.renderer.headPos(e.attacker);
        this.popups.add('헛손질!', head.x, head.y - 10, { color: PAL.cyan, font: 'm' });
        const fh = this.renderer.headPos(e.feinter);
        this.popups.add('페인트 성공!', fh.x, fh.y - 22, { color: tagColor(e.feinter), font: 's', life: 50 });
        this.particles.dust(e.attacker.baseX, this.cfg.STAGE.FLOOR_Y, e.attacker.dir, 6);
        cpu.observe({ type: 'result', who: side(e.attacker), action: actionOf(e.attacker), result: 'whiffed', frame });
        cpu.observe({ type: 'result', who: side(e.feinter), action: 'feint', result: 'feinted', frame });
        break;
      }
      case 'blocked': {
        a.play('hold');
        m.hitstop = Math.max(m.hitstop, J.HITSTOP_HOLD);
        this.addShake(J.SHAKE_PUSH);
        this.particles.sparks(contact.x, contact.y, 0.6);
        const hh = this.renderer.headPos(e.holder);
        this.popups.add('버텼다!', hh.x, hh.y - 10, { color: tagColor(e.holder), font: 'm' });
        cpu.observe({ type: 'result', who: side(e.attacker), action: actionOf(e.attacker), result: 'blocked', frame });
        cpu.observe({ type: 'result', who: side(e.holder), action: 'hold', result: 'blocked', frame });
        break;
      }
      case 'feintHold': {
        a.play('whoosh', { pitch: 1.2 });
        m.hitstop = Math.max(m.hitstop, J.HITSTOP_WHIFF);
        this.addShake(J.SHAKE_WHIFF);
        const hh = this.renderer.headPos(e.holder);
        this.popups.add('앗! 헛힘!', hh.x, hh.y - 10, { color: PAL.cyan, font: 'm' });
        const fh = this.renderer.headPos(e.feinter);
        this.popups.add('페인트 성공!', fh.x, fh.y - 22, { color: tagColor(e.feinter), font: 's', life: 50 });
        cpu.observe({ type: 'result', who: side(e.feinter), action: 'feint', result: 'feinted', frame });
        cpu.observe({ type: 'result', who: side(e.holder), action: 'hold', result: 'feinted', frame });
        break;
      }
      case 'stagger': {
        a.play('wobble');
        const h = this.renderer.headPos(e.who);
        for (let i = 0; i < 3; i++) this.particles.sweat(h.x, h.y + 3, i - 1);
        if (!e.who.fallen) this.popups.add('휘청~', h.x, h.y - 4, { color: PAL.white, font: 's', life: 36 });
        break;
      }
      case 'feintEmpty':
        cpu.observe({ type: 'result', who: side(e.who), action: 'feint', result: 'none', frame });
        break;
      case 'holdTired': {
        const h = this.renderer.headPos(e.who);
        this.popups.add('힘이 빠졌다!', h.x, h.y - 4, { color: PAL.silver, font: 's', life: 45 });
        break;
      }
      case 'fall': {
        a.play('thud');
        this.addShake(J.SHAKE_FALL * 0.5);
        const h = this.renderer.headPos(e.who);
        this.popups.add(e.dir > 0 ? '으아악?!' : '어어어?!', h.x, h.y - 6, { color: PAL.white, font: 'm', life: 70 });
        break;
      }
      case 'splash':
        a.play('splash');
        this.addShake(J.SHAKE_FALL);
        this.particles.splash(e.x, this.cfg.STAGE.WATER_Y);
        this.popups.add('풍덩!', e.x, this.cfg.STAGE.WATER_Y - 30, { color: PAL.cyan, font: 'l', life: 60 });
        break;
      case 'timeUp':
        a.play('count', { pitch: 0.7 });
        this.banner('시간 종료!', 90);
        break;
      case 'matchEnd':
        this.onMatchEnd(e.result);
        break;
      default:
        break;
    }
  }

  onMatchEnd(result) {
    const g = this.game;
    this.phase = 'end';
    this.endT = 0;
    this.chargers.clear();
    g.audio.stopCharge();
    g.audio.setBgmIntensity(0.2);
    const playerWon = result.winner === 'player';
    // 관중 환호: 이긴 쪽 관중이 더 크게
    g.bg.cheer(playerWon ? -1 : result.winner === 'cpu' ? 1 : 0, 1);
    g.audio.play('cheer');
    setTimeout(() => {
      if (!g.destroyed) g.audio.play(playerWon ? 'win' : 'lose');
    }, 500);
    if (playerWon) this.particles.confetti(this.game.W, 40);
    if (result.reason === 'time') {
      // '시간 종료!'를 먼저 보여준 뒤 판정 결과
      this.nextBanner = [playerWon ? '판정승!' : result.winner === 'cpu' ? '판정패…' : '무승부', 100];
    } else if (result.winner === 'draw') {
      this.banner('무승부', 120);
    } else {
      this.banner(playerWon ? '승리!' : '패배…', 120);
    }
    g.cpuController.observe({ type: 'roundEnd', winner: result.winner, frame: Math.floor(this.match.frame) });
  }

  // 라운드 마무리(점수 계산·다음 장면)는 서버가 한다
  finishRound() {
    this.done = true;
  }

  // ---------------- 그리기 ----------------
  draw(ctx) {
    const g = this.game;
    const m = this.match;
    const S = this.cfg.STAGE;
    const camX = this.camX + this.shakeX;
    const camY = this.camY + this.shakeY;
    const wP = m.stoneWobble('player');
    const wC = m.stoneWobble('cpu');
    drawWorld(ctx, g, {
      camX,
      camY,
      stones: [
        { x: S.P1_X, y: S.FLOOR_Y, wobble: wP },
        { x: S.P2_X, y: S.FLOOR_Y, wobble: wC },
      ],
      drawActors: (c) => {
        // 넘어지는 쪽을 앞에 그려서 잘 보이게
        const order = m.cpu.fallen ? [m.player, m.cpu] : [m.cpu, m.player];
        for (const f of order) this.renderer.draw(c, f, { stoneWobble: f === m.player ? wP : wC });
        this.particles.draw(c);
        for (const f of [m.player, m.cpu]) {
          if (f.state === 'charge' || f.state === 'release') {
            const h = this.renderer.headPos(f, f === m.player ? wP : wC);
            drawChargeMeter(c, h.x - 6, h.y - 4, f.charge, { t: this.t });
          }
        }
        this.popups.draw(c, drawText);
      },
    });
    this.drawHud(ctx);

    // 카운트다운 숫자
    if (this.phase === 'countdown') {
      const total = this.cfg.MATCH.COUNTDOWN * 60;
      const n = Math.ceil((total - this.countT) / 60);
      const local = this.countT % 60;
      const scale = local < 8 ? 4 : 3; // 숫자가 바뀔 때 크게 튀어나옴
      drawText(ctx, String(n), 160, 50 - (scale - 3) * 4, { font: 'l', color: PAL.sand, outline: PAL.ink, align: 'center', scale });
      drawText(ctx, '준비…', 160, 96, { font: 'm', color: PAL.white, outline: PAL.ink, align: 'center' });
    }
    // 큰 안내 문구 (시작!/시간 종료!/승리!)
    if (this.bannerT > 0 && this.bannerText) {
      const pop = this.bannerT > 0 && this.t % 4 < 2 && this.bannerText === '시작!' ? 1 : 0;
      drawText(ctx, this.bannerText, 160, 52 - pop, {
        font: 'l', color: this.bannerText.includes('패') ? PAL.silver : PAL.sand, outline: PAL.ink, shadow: PAL.red, align: 'center', scale: 2,
      });
    }
    if (g.debug) this.drawDebug(ctx);
  }

  drawHud(ctx) {
    const g = this.game;
    const m = this.match;
    const B = this.cfg.BALANCE;
    const sides = [
      { f: m.player, x: 2, name: m.player.name, color: g.assets.uiColor(m.player.lookId) },
      { f: m.cpu, x: 188, name: m.cpu.name, color: g.assets.uiColor(m.cpu.lookId) },
    ];
    for (const s of sides) {
      drawPanel(ctx, s.x, 2, 130, 29, 'dark');
      const alignRight = s.f === m.cpu;
      drawText(ctx, s.name, alignRight ? s.x + 125 : s.x + 5, 4, { font: 's', color: s.color, align: alignRight ? 'right' : 'left', outline: PAL.ink });
      // 페인트 성공 별
      const stars = Math.min(5, s.f.stats.cleanFeints);
      for (let i = 0; i < stars; i++) {
        const sx = alignRight ? s.x + 5 + i * 9 : s.x + 117 - i * 9;
        drawIcon(ctx, 'star', sx, 5, PAL.sand);
      }
      const danger = clamp((Math.abs(s.f.body.b) - 50) / 50, 0, 1);
      drawBalanceGauge(ctx, s.x + 4, 15, 122, s.f.fallen ? s.f.dir * s.f.fallDir * 100 : s.f.screenBalance, { danger, t: this.t, color: s.color });
      // 버티기 스태미나
      const st = s.f.stamina / this.cfg.ACTION.HOLD_STAMINA;
      ctx.fillStyle = PAL.charcoal;
      ctx.fillRect(s.x + 4, 27, 122, 2);
      ctx.fillStyle = st < this.cfg.ACTION.HOLD_MIN_STAMINA / this.cfg.ACTION.HOLD_STAMINA ? PAL.red : PAL.sky;
      const sw = Math.round(122 * st);
      if (alignRight) ctx.fillRect(s.x + 4 + 122 - sw, 27, sw, 2);
      else ctx.fillRect(s.x + 4, 27, sw, 2);
      if (Math.abs(s.f.body.b) > B.DANGER && !s.f.fallen && Math.floor(this.t / 6) % 2 === 0) {
        drawText(ctx, '위험!', s.x + 65, 33, { font: 's', color: PAL.red, outline: PAL.white, align: 'center' });
      }
    }
    // 타이머
    const left = this.phase === 'countdown' ? this.cfg.MATCH.TIME_LIMIT : Math.ceil(m.timeLeft);
    drawTimer(ctx, 160, 3, left, { t: this.t, warn: left <= 5 && this.phase === 'fight' });
    if (m.wobble > 0 && this.phase === 'fight' && Math.floor(this.t / 20) % 3 !== 0) {
      drawText(ctx, '받침대가 흔들린다!', 160, 33, { font: 's', color: PAL.orange, outline: PAL.ink, align: 'center' });
    }

    // 하단 조작 안내 (누르고 있는 키는 눌린 모양)
    const inp = g.input;
    const items = [
      [['A', 'KeyA'], ['D', 'KeyD'], '균형'],
      [['J', 'KeyJ'], '밀기·차지'],
      [['K', 'KeyK'], '손빼기'],
      [['L', 'KeyL'], '버티기'],
    ];
    let x = 6;
    const y = 168;
    for (const it of items) {
      for (const part of it) {
        if (Array.isArray(part)) {
          x += drawKeyCap(ctx, x, y, part[0], { pressed: inp.isDown(part[1]) }) + 1;
        } else {
          x += 2;
          x += drawText(ctx, part, x, y + 1, { font: 's', color: PAL.white, outline: PAL.ink }) + 8;
        }
      }
    }
  }

  drawDebug(ctx) {
    const cpu = this.game.cpuController;
    const d = cpu.lastDecision;
    const txt = `CPU: ${d ? (typeof d === 'string' ? d : JSON.stringify(d)) : '-'} ${cpu.pending ? '(대기)' : ''}`;
    drawText(ctx, txt, 4, 150, { font: 's', color: PAL.lime, outline: PAL.ink });
    const m = this.match;
    drawText(ctx, `P ${m.player.state} ${m.player.body.b.toFixed(0)}  C ${m.cpu.state} ${m.cpu.body.b.toFixed(0)}`, 4, 140, {
      font: 's', color: PAL.white, outline: PAL.ink,
    });
  }
}
