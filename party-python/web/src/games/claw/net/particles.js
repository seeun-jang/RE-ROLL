// =====================================================
// 파티클 (모두 픽셀 단위 사각형) — 원본 js/particles.js 에서 인형뽑기가 쓰는 것만
// =====================================================
export class ParticleSystem {
  constructor() {
    this.parts = [];
  }

  add(x, y, vx, vy, life, color, size = 1, gravity = 0) {
    if (this.parts.length > 900) return;
    this.parts.push({ x, y, vx, vy, life, max: life, color, size, gravity });
  }

  // 사방으로 터지는 불꽃
  burst(x, y, n, colors, speed = 1.5, life = 24, size = 1, gravity = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const c = colors[(Math.random() * colors.length) | 0];
      this.add(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), c, size, gravity);
    }
  }

  update() {
    for (const p of this.parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life--;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
  }

  render(ctx) {
    for (const p of this.parts) {
      // 수명이 다해 갈수록 크기가 줄어듦 (반투명 대신)
      const s = p.life < p.max * 0.3 ? Math.max(1, p.size - 1) : p.size;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
  }

  clear() {
    this.parts = [];
  }
}
