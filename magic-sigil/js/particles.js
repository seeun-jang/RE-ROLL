// =====================================================
// 파티클 (모두 픽셀 단위 사각형) + 떠오르는 글자 + 링
// =====================================================
class ParticleSystem {
  constructor() {
    this.parts = [];
    this.texts = [];
    this.rings = [];
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

  // 폭발: 큰 사각형 + 작은 불똥 + 링
  explode(x, y, big = false) {
    const n = big ? 40 : 14;
    this.burst(x, y, n, [C('9'), C('8'), C('5'), C('b')], big ? 2.6 : 1.6, big ? 40 : 22, 2);
    this.burst(x, y, n, [C('i'), C('j')], big ? 1.2 : 0.7, big ? 50 : 28, 1, -0.01);
    this.ring(x, y, big ? 3 : 1.6, C('9'), big ? 24 : 14);
  }

  sparkle(x, y, color = C('9')) {
    this.add(x + (Math.random() * 6 - 3), y + (Math.random() * 6 - 3), 0, -0.3, 18, color, 1);
  }

  ring(x, y, speed, color, life) {
    this.rings.push({ x, y, r: 2, speed, color, life, max: life });
  }

  // kind: 'bitmap'(영문/숫자) | 'k'(한글)
  text(x, y, str, color, opts = {}) {
    this.texts.push({
      x, y, str, color,
      life: opts.life || 50,
      max: opts.life || 50,
      kind: opts.kind || 'bitmap',
      scale: opts.scale || 1,
      vy: opts.vy === undefined ? -0.5 : opts.vy,
    });
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
    for (const t of this.texts) {
      t.y += t.vy;
      t.vy *= 0.95;
      t.life--;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const r of this.rings) {
      r.r += r.speed;
      r.life--;
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  render(ctx) {
    for (const p of this.parts) {
      // 수명이 다해 갈수록 크기가 줄어듦 (반투명 대신)
      const s = p.life < p.max * 0.3 ? Math.max(1, p.size - 1) : p.size;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    for (const r of this.rings) drawPixelRing(ctx, r.x, r.y, r.r, r.color, r.life % 4 < 2 ? 1 : 2);
    for (const t of this.texts) {
      if (t.life < 12 && t.life % 4 < 2) continue; // 사라질 때 깜빡임
      if (t.kind === 'k') KText.draw(ctx, t.str, t.x, t.y, t.color, { align: 'center', outline: C('1'), scale: t.scale });
      else BitmapFont.draw(ctx, t.str, t.x, t.y, t.color, { align: 'center', outline: C('1'), scale: t.scale });
    }
  }

  clear() {
    this.parts = [];
    this.texts = [];
    this.rings = [];
  }
}

// 점선 원 (정수 좌표, 안티앨리어싱 없음)
function drawPixelRing(ctx, cx, cy, r, color, step = 1) {
  ctx.fillStyle = color;
  const n = Math.max(12, Math.floor(r * 3));
  for (let i = 0; i < n; i += step) {
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
  }
}
