// 잘린 반쪽 조각 — 갈라지며 회전하다 떨어진다
import { PHYSICS, VIEW } from '../../config.js';
import { drawSprite } from '../gfx.js';

export class Piece {
  constructor(img, x, y, vx, vy, rot, spin) {
    this.img = img;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.rot = rot;
    this.spin = spin;
    this.alive = true;
    // 잘리는 순간 납작하게 찌그러졌다 복원 (스쿼시)
    this.sx = 1.25;
    this.sy = 0.8;
  }

  update(dt) {
    this.vy += PHYSICS.GRAVITY * 1.1 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.spin * dt;
    this.sx += (1 - this.sx) * Math.min(1, dt * 9);
    this.sy += (1 - this.sy) * Math.min(1, dt * 9);
    if (this.y > VIEW.H + PHYSICS.OFFSCREEN_MARGIN) this.alive = false;
  }

  draw(ctx) {
    drawSprite(ctx, this.img, this.x, this.y, { rot: this.rot, sx: this.sx, sy: this.sy });
  }
}
