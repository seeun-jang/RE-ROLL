// ============================================================
//  Blade (플레이어) — 마우스/손 입력 점을 모아 칼 궤적과 "베는 선분"을 만든다
// ============================================================
import { BLADE } from '../config.js';
import { pixelLine } from './gfx.js';

export class Blade {
  constructor() {
    this.trail = []; // { x, y, t, stroke }
    this.last = null; // 직전 입력 점
  }

  reset() {
    this.trail.length = 0;
    this.last = null;
  }

  /**
   * 입력 점 하나를 추가하고, 같은 획(stroke)의 직전 점과 이어지면 선분을 돌려준다.
   * 반환: { x0, y0, x1, y1, speed } | null
   */
  add(p) {
    let seg = null;
    if (this.last && this.last.stroke === p.stroke) {
      const dt = Math.max(1 / 240, p.t - this.last.t);
      const dist = Math.hypot(p.x - this.last.x, p.y - this.last.y);
      seg = { x0: this.last.x, y0: this.last.y, x1: p.x, y1: p.y, speed: dist / dt };
    }
    this.last = p;
    this.trail.push(p);
    return seg;
  }

  update(now) {
    // 오래된 궤적 점 제거
    while (this.trail.length && now - this.trail[0].t > BLADE.TRAIL_TIME) this.trail.shift();
  }

  /** 궤적 그리기: 최근 점일수록 두껍게. gold=true 면 점수 2배 상태의 금색 칼 */
  draw(ctx, now, gold = false) {
    const edge = gold ? 4 : 11;
    const core = 12;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1];
        const b = this.trail[i];
        if (a.stroke !== b.stroke) continue;
        const life = 1 - (now - b.t) / BLADE.TRAIL_TIME;
        if (life <= 0) continue;
        const th = Math.max(1, Math.ceil(BLADE.MAX_THICKNESS * life));
        if (pass === 0) pixelLine(ctx, a.x, a.y, b.x, b.y, th, edge);
        else if (th >= 2) pixelLine(ctx, a.x, a.y, b.x, b.y, Math.max(1, th - 2), core);
      }
    }
  }
}
