// 픽셀 파티클 — 모든 입자는 정수 좌표의 1~2px 사각형
import { PALETTE } from './palette.js';

const MAX_PARTICLES = 600;

export class Particles {
  constructor() {
    this.list = [];
  }

  _add(p) {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push({ size: 1, gravity: 0, drag: 0, life: 1, age: 0, flutter: 0, ...p });
  }

  /** 정답 꽃가루 */
  confetti(x, y, colors, count = 60) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 60 + Math.random() * 110;
      this._add({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        color: colors[i % colors.length],
        size: Math.random() < 0.4 ? 2 : 1,
        gravity: 90,
        drag: 1.6,
        flutter: 20 + Math.random() * 30,
        life: 1.6 + Math.random() * 1.2,
      });
    }
  }

  /** 위에서 쏟아지는 꽃가루 (결과 화면) */
  rain(width, colors, count = 3) {
    for (let i = 0; i < count; i++) {
      this._add({
        x: Math.random() * width, y: -2,
        vx: (Math.random() - 0.5) * 10, vy: 20 + Math.random() * 25,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() < 0.3 ? 2 : 1,
        flutter: 25, life: 7,
      });
    }
  }

  /** 버저 불꽃 */
  sparks(x, y, color = 4, count = 16) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 90;
      this._add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, color: i % 3 ? color : 12, drag: 4, life: 0.35 + Math.random() * 0.25 });
    }
  }

  /** 착지 먼지 */
  dust(x, y, count = 8) {
    for (let i = 0; i < count; i++) {
      const dir = i % 2 ? 1 : -1;
      this._add({ x: x + dir * (2 + Math.random() * 4), y, vx: dir * (15 + Math.random() * 25), vy: -5 - Math.random() * 12, color: i % 3 ? 13 : 14, drag: 3, life: 0.4 + Math.random() * 0.3 });
    }
  }

  /** 반짝임 (힌트 등장) — 십자 모양 */
  sparkle(x, y, count = 10, spread = 30) {
    for (let i = 0; i < count; i++) {
      this._add({ x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.5, vx: 0, vy: -8, color: i % 2 ? 4 : 11, cross: true, life: 0.5 + Math.random() * 0.5 });
    }
  }

  update(dt) {
    for (const p of this.list) {
      p.age += dt;
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      const wobble = p.flutter ? Math.sin(p.age * 9 + p.x) * p.flutter * dt : 0;
      p.x += p.vx * dt + wobble;
      p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.age < p.life && p.y < 200);
  }

  draw(ctx) {
    for (const p of this.list) {
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      // 수명 끝무렵엔 깜빡이며 사라짐 (반투명 대신 디더링 느낌)
      if (p.life - p.age < 0.3 && Math.floor(p.age * 20) % 2) continue;
      ctx.fillStyle = PALETTE[p.color];
      if (p.cross) {
        const big = p.age < p.life * 0.6;
        ctx.fillRect(x, y, 1, 1);
        if (big) {
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
      } else {
        ctx.fillRect(x, y, p.size, p.size);
      }
    }
  }
}
