// =============================================================
// Particles.js — 픽셀 사각형 파티클 (먼지, 충돌 반짝임, 땀방울, 물보라, 꽃가루)
//   + 떠오르는 글자 팝업("짝!", "헛손질!")
//   모든 파티클은 정수 좌표의 1~3px 사각형으로만 그린다.
// =============================================================
import { PAL } from '../palette.js';

export class Particles {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.list = [];
  }

  clear() {
    this.list.length = 0;
  }

  add(p) {
    if (this.list.length > 400) this.list.shift();
    this.list.push({ vx: 0, vy: 0, g: 0, drag: 1, size: 1, life: 30, age: 0, color: PAL.white, floorY: null, blink: false, ...p });
  }

  rand(a, b) {
    return a + (b - a) * this.rng();
  }

  // 손바닥 충돌 반짝임 — 십자 모양 별 + 사방으로 튀는 불티
  sparks(x, y, power = 1) {
    const n = Math.round(6 + power * 6);
    for (let i = 0; i < n; i++) {
      const a = this.rand(0, Math.PI * 2);
      const s = this.rand(0.8, 2.2) * (0.7 + power * 0.4);
      this.add({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.3, g: 0.05, drag: 0.9,
        life: this.rand(10, 20), color: i % 3 === 0 ? PAL.white : i % 3 === 1 ? PAL.sand : PAL.orange,
        size: this.rng() < 0.3 ? 2 : 1,
      });
    }
    this.add({ x, y, kind: 'star', life: 8 + power * 3, size: Math.round(3 + power * 2), color: PAL.white });
  }

  // 발밑 먼지 (뒤쪽으로 퍼짐)
  dust(x, y, dir = 0, n = 5) {
    for (let i = 0; i < n; i++) {
      this.add({
        x: x + this.rand(-3, 3), y: y - this.rand(0, 2),
        vx: dir * this.rand(0.2, 1.0) + this.rand(-0.3, 0.3), vy: -this.rand(0.1, 0.6), g: 0.01, drag: 0.94,
        life: this.rand(16, 30), color: this.rng() < 0.5 ? PAL.silver : PAL.white, size: this.rng() < 0.4 ? 2 : 1,
      });
    }
  }

  // 땀방울 — 머리 근처에서 튀어 떨어진다
  sweat(x, y, dir = 1) {
    this.add({
      x: x + this.rand(-2, 2), y, vx: dir * this.rand(0.3, 0.8), vy: -this.rand(0.6, 1.1), g: 0.08,
      life: 26, color: PAL.cyan, size: 1, kind: 'drop',
    });
  }

  // 물보라 — 개울에 풍덩
  splash(x, y, n = 26) {
    for (let i = 0; i < n; i++) {
      const s = this.rand(0.6, 2.6);
      this.add({
        x: x + this.rand(-5, 5), y, vx: this.rand(-1.2, 1.2), vy: -s, g: 0.09, drag: 0.98,
        life: this.rand(30, 50), color: i % 3 === 0 ? PAL.white : i % 3 === 1 ? PAL.cyan : PAL.sky,
        size: this.rng() < 0.35 ? 2 : 1, floorY: y + 2,
      });
    }
    // 수면 동심원
    this.add({ x, y: y + 1, kind: 'ring', life: 40, color: PAL.white, size: 2 });
    this.add({ x, y: y + 1, kind: 'ring', life: 55, color: PAL.cyan, size: 1, age: -10 });
  }

  // 차지 중 손 주변에서 빨려드는 기운
  chargeGlow(x, y, level) {
    const a = this.rand(0, Math.PI * 2);
    const r = 7 + this.rand(0, 3);
    this.add({
      x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: -Math.cos(a) * 0.5, vy: -Math.sin(a) * 0.5,
      life: 12, color: level >= 1 ? PAL.white : level > 0.5 ? PAL.orange : PAL.sand, size: 1,
    });
  }

  // 승리 축하 꽃가루 (화면 위에서 떨어짐)
  confetti(w = 320, n = 50) {
    const colors = [PAL.red, PAL.sand, PAL.lime, PAL.sky, PAL.white, PAL.orange, PAL.cyan];
    for (let i = 0; i < n; i++) {
      this.add({
        x: this.rand(0, w), y: this.rand(-40, 0), vx: this.rand(-0.4, 0.4), vy: this.rand(0.3, 0.9), g: 0.004,
        drag: 0.995, life: this.rand(120, 200), color: colors[i % colors.length], size: this.rng() < 0.5 ? 2 : 1,
        kind: 'confetti', phase: this.rand(0, 6.28),
      });
    }
  }

  update(dt = 1) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) {
        list.splice(i, 1);
        continue;
      }
      if (p.age < 0) continue;
      p.vy += p.g * dt;
      const d = Math.pow(p.drag, dt);
      p.vx *= d;
      p.vy *= d;
      if (p.kind === 'confetti') p.vx = Math.sin((p.age + p.phase * 10) * 0.08) * 0.4;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // 물보라는 수면 아래로 내려가면 사라짐
      if (p.floorY !== null && p.vy > 0 && p.y > p.floorY) p.age = p.life;
    }
  }

  draw(ctx) {
    for (const p of this.list) {
      if (p.age < 0) continue;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      const t = p.age / p.life;
      ctx.fillStyle = p.color;
      if (p.kind === 'star') {
        // 십자 반짝임 — 시간이 지나면 작아짐
        const r = Math.max(1, Math.round(p.size * (1 - t)));
        ctx.fillRect(x - r, y, r * 2 + 1, 1);
        ctx.fillRect(x, y - r, 1, r * 2 + 1);
        if (r > 2) {
          ctx.fillRect(x - 1, y - 1, 3, 3);
        }
      } else if (p.kind === 'ring') {
        // 계단식 타원 물결 (픽셀 단위)
        const rx = Math.round(3 + t * 14);
        const ry = Math.max(1, Math.round(rx / 4));
        for (let a = 0; a < 24; a++) {
          if ((a + Math.floor(p.age / 4)) % 3 === 0) continue;
          const ang = (a / 24) * Math.PI * 2;
          ctx.fillRect(Math.round(x + Math.cos(ang) * rx), Math.round(y + Math.sin(ang) * ry), p.size, 1);
        }
      } else if (p.kind === 'drop') {
        ctx.fillRect(x, y, 1, 2);
      } else {
        // 수명 끝무렵엔 깜빡이며 사라짐
        if (t > 0.75 && Math.floor(p.age / 2) % 2 === 0) continue;
        ctx.fillRect(x, y, p.size, p.size);
      }
    }
  }
}

// 떠오르는 글자 팝업
export class Popups {
  constructor() {
    this.list = [];
  }
  clear() {
    this.list.length = 0;
  }
  add(text, x, y, { color = PAL.white, outline = PAL.ink, font = 'm', life = 45, scale = 1 } = {}) {
    this.list.push({ text, x, y, color, outline, font, life, age: 0, scale });
    if (this.list.length > 8) this.list.shift();
  }
  update(dt = 1) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) this.list.splice(i, 1);
    }
  }
  // drawText 는 PixelFont 의 함수를 주입받는다
  draw(ctx, drawText) {
    for (const p of this.list) {
      // 처음엔 툭 튀어오르고 이후 천천히 떠오름
      const rise = p.age < 6 ? Math.round((6 - p.age) * -1) : Math.round((p.age - 6) * 0.25);
      if (p.age > p.life - 10 && Math.floor(p.age / 2) % 2 === 0) continue;
      drawText(ctx, p.text, Math.round(p.x), Math.round(p.y - rise), {
        font: p.font, color: p.color, outline: p.outline, align: 'center', scale: p.scale,
      });
    }
  }
}
