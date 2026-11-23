// ============================================================
//  연출 시스템 — 파티클(과즙/불꽃/연기/반짝이), 과즙 얼룩, 점수 팝업, 충격파
//  모든 파티클은 픽셀 단위 사각형으로 그린다.
// ============================================================
import { PALETTE } from '../../assets/palette.js';
import { drawText } from '../../assets/pixelFont.js';
import { JUICE, PHYSICS } from '../../config.js';
import { BAYER4, pick, pixelRing, rand, randInt } from '../gfx.js';

export class Effects {
  constructor() {
    this.particles = [];
    this.splats = [];
    this.popups = [];
    this.rings = [];
  }

  clear() {
    this.particles.length = 0;
    this.splats.length = 0;
    this.popups.length = 0;
    this.rings.length = 0;
  }

  // ---- 생성 ----
  juice(x, y, colors, count = JUICE.PARTICLES_FRUIT, dirX = 0, dirY = 0) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(30, 110);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s + dirX * 60,
        vy: Math.sin(a) * s - 30 + dirY * 60,
        color: pick(colors),
        size: Math.random() < 0.3 ? 2 : 1,
        life: rand(0.35, 0.8),
        grav: 1,
      });
    }
  }

  sparkle(x, y, colors, count = 18) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const s = rand(50, 120);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        color: pick(colors), size: 1, life: rand(0.4, 0.9), grav: 0.15, twinkle: true,
      });
    }
  }

  explosion(x, y) {
    for (let i = 0; i < JUICE.PARTICLES_BOMB; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(40, 200);
      this.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        color: pick([12, 4, 4, 3, 3, 2]), size: randInt(1, 3), life: rand(0.25, 0.7), grav: 0.4, drag: 2.5,
      });
    }
    // 연기 — 천천히 위로
    for (let i = 0; i < 16; i++) {
      this.particles.push({
        x: x + rand(-8, 8), y: y + rand(-8, 8), vx: rand(-20, 20), vy: rand(-40, -10),
        color: pick([14, 15, 13]), size: randInt(2, 4), life: rand(0.6, 1.2), grav: -0.1, drag: 1.5,
      });
    }
    this.rings.push({ x, y, r: 4, speed: 180, life: 0.35, max: 0.35, color: 12 });
    this.rings.push({ x, y, r: 2, speed: 110, life: 0.45, max: 0.45, color: 3 });
  }

  // 화면에 튄 과즙 얼룩 — 불규칙한 픽셀 덩어리
  splat(x, y, color) {
    const pixels = [];
    const r = rand(4, 7);
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const d = Math.hypot(dx, dy * 1.2);
        if (d < r - 1 || (d < r + 1.5 && Math.random() < 0.35)) pixels.push([dx, dy]);
      }
    }
    // 흘러내리는 방울 몇 개
    for (let i = 0; i < 3; i++) {
      const sx = randInt(-4, 4);
      const len = randInt(2, 6);
      for (let k = 0; k < len; k++) pixels.push([sx, Math.round(r) + k]);
    }
    this.splats.push({ x: Math.round(x), y: Math.round(y), pixels, color, life: JUICE.SPLAT_LIFE, max: JUICE.SPLAT_LIFE });
    if (this.splats.length > 14) this.splats.shift();
  }

  popup(text, x, y, color = 12, scale = 1, life = JUICE.POPUP_LIFE) {
    this.popups.push({ text, x, y, color, scale, life, max: life });
  }

  ring(x, y, color, speed = 120, life = 0.3) {
    this.rings.push({ x, y, r: 3, speed, life, max: life, color });
  }

  // ---- 갱신 ----
  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.vy += PHYSICS.GRAVITY * p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const s of this.splats) s.life -= dt;
    this.splats = this.splats.filter((s) => s.life > 0);
    for (const p of this.popups) {
      p.life -= dt;
      p.y -= 18 * dt;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    for (const r of this.rings) {
      r.life -= dt;
      r.r += r.speed * dt;
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  // ---- 그리기 ----
  drawSplats(ctx) {
    for (const s of this.splats) {
      // 사라질 때 반투명 대신 디더링으로 점점 성기게
      const level = Math.ceil((s.life / s.max) * 16 * 1.6);
      ctx.fillStyle = PALETTE[s.color];
      for (const [dx, dy] of s.pixels) {
        const px = s.x + dx;
        const py = s.y + dy;
        if (BAYER4[py & 3][px & 3] >= level) continue;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  drawParticles(ctx, t) {
    for (const p of this.particles) {
      if (p.twinkle && Math.floor(t * 20 + p.x) % 3 === 0) continue;
      ctx.fillStyle = PALETTE[p.color];
      const s = p.life < 0.15 && p.size > 1 ? p.size - 1 : p.size;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    for (const r of this.rings) pixelRing(ctx, r.x, r.y, r.r, r.color);
  }

  drawPopups(ctx) {
    for (const p of this.popups) {
      // 마지막 0.15초는 깜빡이며 사라짐
      if (p.life < 0.15 && Math.floor(p.life * 30) % 2 === 0) continue;
      // 처음엔 크게 튀어나왔다가 원래 크기로 (팝 효과)
      const age = p.max - p.life;
      const scale = age < 0.06 && p.scale > 1 ? p.scale + 1 : p.scale;
      drawText(ctx, p.text, p.x, p.y, { color: p.color, scale, align: 'center' });
    }
  }
}
