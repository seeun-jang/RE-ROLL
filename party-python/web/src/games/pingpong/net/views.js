// =============================================================
// 공과 선수 그리기 — 원본 js/ball.js 의 render, js/paddler.js 의 animatePaddle · render
//
// 위치 · 상태(판정)는 서버가 정하고, 여기서는 그 값을 받아 그리기만 한다.
// 라켓의 움직임 · 걷는 흔들림 · 머리 위 글씨처럼 판정과 상관없는 동작은 화면에서 만든다.
// =============================================================
import { CONFIG } from '../sim/config.js';
import { C } from './palette.js';
import { KText } from './text.js';
import { drawStanding } from './sprites.js';

/** 공: 그림자 + 꼬리 + 5x5 공 */
export class BallView {
  constructor() {
    this.x = CONFIG.WIDTH / 2;
    this.y = CONFIG.FLOOR_Y - 20;
    this.state = 'held';
    this.fast = false;
    this.chance = false;
    this.lastHitter = 0;
    this.trail = [];
  }

  /** 60분의 1초마다: 꼬리 남기기 (스매시는 길게, 보통 공은 짧게) */
  tick() {
    if (this.state !== 'flight' && this.state !== 'dead') {
      this.trail = [];
      return;
    }
    const last = this.trail[this.trail.length - 1];
    if (last && last.x === this.x && last.y === this.y) return; // 멈춰 있는 동안(타격 순간)에는 쌓지 않는다
    this.trail.push({ x: this.x, y: this.y });
    while (this.trail.length > (this.fast ? 7 : 3)) this.trail.shift();
  }

  render(ctx) {
    const x = this.x;
    const y = this.y;
    const T = CONFIG.TABLE;
    // 그림자 (탁구대 위 / 바닥) — 공이 낮을수록 크고 진하게 → 높이를 가늠할 수 있음
    const overTable = x >= T.LEFT && x <= T.RIGHT && y <= T.Y;
    const sy = overTable ? T.Y : CONFIG.FLOOR_Y;
    const h = Math.max(0, sy - y);
    const sw = Math.max(2, 7 - Math.floor(h / 10));
    ctx.fillStyle = C(overTable ? 'f' : '1');
    ctx.fillRect(Math.round(x - sw / 2), sy, sw, 2);
    // 꼬리 (스매시는 불꽃색)
    this.trail.forEach((p, i) => {
      if (i === this.trail.length - 1) return;
      ctx.fillStyle = C(this.fast ? (i % 2 ? '8' : '9') : 'k');
      const s = this.fast ? 2 + Math.floor(i / 3) : 1 + (i > 0 ? 1 : 0);
      ctx.fillRect(Math.round(p.x) - (s >> 1), Math.round(p.y) - 1 - (s >> 1), s, s);
    });
    // 공 (5x5 동그라미 + 외곽선)
    const bx = Math.round(x) - 2;
    const by = Math.round(y) - 3;
    ctx.fillStyle = C('1');
    ctx.fillRect(bx, by - 1, 5, 7);
    ctx.fillRect(bx - 1, by, 7, 5);
    ctx.fillStyle = C(this.fast ? '8' : this.chance ? '9' : 'b');
    ctx.fillRect(bx, by, 5, 5);
    ctx.fillStyle = C(this.fast ? '9' : this.chance ? 't' : 'w');
    ctx.fillRect(bx + 1, by + 1, 2, 2);
    ctx.fillStyle = C(this.fast ? 'u' : this.chance ? '8' : 'k');
    ctx.fillRect(bx + 1, by + 4, 4, 1);
    ctx.fillRect(bx + 4, by + 1, 1, 4);
  }
}

/** 선수 한 명. side = 화면에서의 자리(0 왼쪽 / 1 오른쪽) */
export class PaddlerView {
  constructor(side) {
    this.side = side;
    this.facing = side === 0 ? 1 : -1;
    this.name = '';
    this.color = C('a');
    this.spr = null;            // { frames, portrait }
    this.pts = 0;
    this.x = side === 0 ? CONFIG.HOME_X : CONFIG.WIDTH - CONFIG.HOME_X;
    this.vx = 0;
    this.state = 'ready';       // ready | charge | swing | win | lose
    this.chargeT = 0;
    this.swingT = 0;
    this.shot = 'drive';
    this.walkPhase = 0;
    this.lean = 0;
    this.paddle = { x: 10, y: -18 };  // 라켓 위치 (몸 기준, 앞쪽 +)
    this.popup = null;          // 머리 위 글씨 ('나이스!', '스매시!')
  }

  /** 60분의 1초마다: 걷는 흔들림 · 기울기 · 라켓 동작. vm = 지금 보이는 경기 상태 */
  tick(vm) {
    if (this.popup && ++this.popup.t > 40) this.popup = null;
    this.walkPhase += Math.abs(this.vx) * 0.22;
    let leanTarget = Math.max(-2, Math.min(2, this.vx * 1.2));
    if (this.state === 'swing') leanTarget = this.facing * 2;
    this.lean += (leanTarget - this.lean) * 0.3;
    this.animatePaddle(vm);
  }

  // 라켓 목표 위치 → 부드럽게 따라감
  animatePaddle(vm) {
    const P = CONFIG.PLAYER;
    let tx = 13;   // 몸 앞쪽 (얼굴을 가리지 않게)
    let ty = -12;
    let k = 0.3;
    const ball = vm.ball;
    // 공이 내 쪽으로 오면 라켓 높이를 공에 맞춤
    if (ball.state === 'flight' && ball.lastHitter !== this.side) {
      ty = Math.max(-P.REACH_TOP + 6, Math.min(-8, ball.y - CONFIG.FLOOR_Y));
    }
    if (this.state === 'charge') {
      // 뒤로 크게 젖힘
      tx = -6;
      ty = -30;
      k = 0.25;
    } else if (this.state === 'swing') {
      // 뒤 → 앞으로 휘두름
      const s = Math.min(1, this.swingT / 4);
      tx = -4 + s * 20;
      ty = ty - (this.shot === 'smash' ? 14 - s * 14 : this.shot === 'lob' ? -s * 4 : s * 6);
      k = 0.6;
    } else if (this.state === 'win') {
      tx = 4;
      ty = -48 - Math.abs(Math.sin(vm.frame / 8)) * 3;
    } else if (this.state === 'lose') {
      tx = 6;
      ty = -6;
    }
    if (vm.serverSide === this.side && this.state === 'ready') {
      if (ball.state === 'held') {
        tx = 12;
        ty = -14;
      } else if (ball.state === 'toss') {
        // 토스하는 동안 라켓을 뒤로 빼고 기다림
        tx = -7;
        ty = -12;
      }
    }
    this.paddle.x += (tx - this.paddle.x) * k;
    this.paddle.y += (ty - this.paddle.y) * k;
  }

  render(ctx, vm) {
    const fy = CONFIG.FLOOR_Y;
    const x = this.x;
    const ix = Math.round(x + this.lean);
    const f = this.facing;
    const pdx = this.paddle.x;
    const pdy = this.paddle.y;
    // 그림자
    ctx.fillStyle = C('s');
    ctx.fillRect(Math.round(x) - 12, fy - 1, 24, 2);
    // 몸
    const walking = Math.abs(this.vx) > 0.3;
    const bounce = walking ? Math.round(Math.abs(Math.sin(this.walkPhase)) * 2) : 0;
    const hop = this.state === 'win' ? Math.round(Math.abs(Math.sin(vm.frame / 8)) * 4) : 0;
    const breath = ((vm.frame / 15) | 0) % 2;
    if (this.spr) {
      const img = this.spr.frames[breath];
      ctx.save();
      if (f === -1) {
        ctx.translate(ix * 2, 0);
        ctx.scale(-1, 1);
      }
      drawStanding(ctx, img, ix, fy - bounce - hop, this.state === 'lose' ? 2 : 0);
      ctx.restore();
    }
    // 라켓 (빨간 고무 + 나무 손잡이). 스매시 준비가 되면 금색으로 깜빡인다
    const rx = Math.round(ix + f * pdx);
    const ry = Math.round(fy + pdy - hop);
    const glow = this.state === 'charge' && this.chargeT >= CONFIG.PLAYER.CHARGE_TIME && vm.frame % 6 < 3;
    ctx.fillStyle = C('1');
    ctx.fillRect(rx - 1, ry + 3, 3, 5);
    ctx.fillStyle = C('m');
    ctx.fillRect(rx, ry + 4, 1, 3);
    ctx.fillStyle = C('1');
    ctx.fillRect(rx - 4, ry - 3, 9, 7);
    ctx.fillRect(rx - 3, ry - 4, 7, 9);
    ctx.fillStyle = C(glow ? '9' : '6');
    ctx.fillRect(rx - 3, ry - 3, 7, 7);
    ctx.fillRect(rx - 2, ry - 4, 5, 1);
    ctx.fillStyle = C(glow ? 't' : '5');
    ctx.fillRect(rx - 2, ry - 2, 2, 2);
    // 머리 위 글씨
    if (this.popup) {
      const k = this.popup.t;
      if (!(k > 30 && k % 4 < 2)) KText.draw(ctx, this.popup.text, ix, fy - 62 - Math.min(4, k / 2), C(this.popup.color), { align: 'center', font: 'b', outline: C('1') });
    }
  }
}
