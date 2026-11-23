// ============================================================
// 이펙트: 픽셀 파티클, 떠오르는 숫자/문구
// 파티클은 전부 1~2px 정사각형 (픽셀 아트 규칙)
// ============================================================

export class Particles {
  constructor(max = 600) {
    this.list = [];
    this.max = max;
  }

  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: p.x, y: p.y,
      vx: p.vx || 0, vy: p.vy || 0,
      life: p.life ?? 0.5, age: 0,
      color: p.color, size: p.size || 1,
      gravity: p.gravity || 0, drag: p.drag ?? 0,
      shrink: p.shrink ?? true,
    });
  }

  /** 사방으로 터지는 파티클 */
  burst(x, y, colors, count = 12, speed = 60, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.spawn({
        x, y,
        vx: Math.cos(a) * s + (opts.vx || 0),
        vy: Math.sin(a) * s + (opts.vy || 0),
        life: (opts.life || 0.45) * (0.6 + Math.random() * 0.6),
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() < (opts.bigChance ?? 0.3) ? 2 : 1,
        gravity: opts.gravity || 0,
        drag: opts.drag ?? 2,
      });
    }
  }

  update(dt) {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.age += dt;
      if (p.age >= p.life) { l.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  render(r) {
    const ctx = r.ctx;
    for (const p of this.list) {
      const size = p.shrink && p.size > 1 && p.age > p.life * 0.6 ? 1 : p.size;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size);
    }
  }

  clear() {
    this.list.length = 0;
  }
}

/** 떠오르는 텍스트 (데미지 숫자, "효과 굉장!" 등) */
export class FloatingTexts {
  constructor() {
    this.list = [];
  }

  add(text, x, y, { color = '#ffffff', size = 'm', life = 0.9, vy = -22, outline = '#181425', delay = 0 } = {}) {
    this.list.push({ text, x, y, color, size, life, vy, outline, age: -delay });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.age += dt;
      if (f.age < 0) continue;
      f.y += f.vy * dt;
      f.vy *= Math.max(0, 1 - 3 * dt);
      if (f.age >= f.life) this.list.splice(i, 1);
    }
  }

  render(r, text) {
    for (const f of this.list) {
      if (f.age < 0) continue;
      // 사라지기 직전엔 깜빡임 (반투명 대신)
      if (f.age > f.life * 0.7 && Math.floor(f.age * 20) % 2) continue;
      text.draw(r.ctx, f.text, f.x, f.y, { size: f.size, color: f.color, align: 'center', outline: f.outline });
    }
  }

  clear() {
    this.list.length = 0;
  }
}
