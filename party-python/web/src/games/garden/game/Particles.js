// 파티클(픽셀 사각형) + 떠오르는 텍스트
export class ParticleSystem {
  constructor(maxCount = 400) { this.list = []; this.max = maxCount; }

  // 픽셀 파편 폭발
  burst(x, y, colors, count, { speed = 60, up = 60, gravity = 180, life = 0.5, size = 1, spread = Math.PI } = {}) {
    for (let i = 0; i < count; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.list.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - Math.random() * up,
        life: life * (0.6 + Math.random() * 0.6), maxLife: life,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: size + (Math.random() < 0.3 ? 1 : 0), gravity,
      });
    }
  }

  // 탄피: 작은 노란 조각이 뒤로 튀어 떨어짐
  shell(x, y) {
    this.list.push({ x, y, vx: -30 - Math.random() * 30, vy: -70 - Math.random() * 30, life: 0.5, maxLife: 0.5, color: 10, size: 1, gravity: 300 });
  }

  // 먼지(좀비 발걸음, 착지)
  dust(x, y, count = 3) {
    for (let i = 0; i < count; i++) this.list.push({ x: x + (Math.random() * 6 - 3), y, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 15, life: 0.35, maxLife: 0.35, color: 4, size: 1, gravity: 20 });
  }

  // 반짝임(코인·아이템 획득)
  sparkle(x, y, color = 11, count = 6) {
    for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2; this.list.push({ x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 0.3, maxLife: 0.3, color, size: 1, gravity: 0 }); }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.list[i] = this.list[this.list.length - 1]; this.list.pop(); continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  draw(r) {
    for (const p of this.list) r.rect(Math.round(p.x), Math.round(p.y), p.size, p.size, p.color);
  }

  clear() { this.list.length = 0; }
}

export class FloatingTexts {
  constructor(font) { this.font = font; this.list = []; }

  add(text, x, y, { color = 19, scale = 1, life = 0.8, vy = -22, ko = false } = {}) {
    this.list.push({ text, x, y, color, scale, life, maxLife: life, vy, ko });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.life -= dt; t.y += t.vy * dt; t.vy *= 0.92;
      if (t.life <= 0) this.list.splice(i, 1);
    }
  }

  draw(r, koFont) {
    for (const t of this.list) {
      if (t.life < 0.25 && Math.floor(t.life * 30) % 2 === 0) continue; // 사라지기 전 깜빡임
      if (t.ko && koFont) koFont.draw(r.ctx, t.text, t.x, t.y, { color: t.color, align: 'center', shadow: 25 });
      else this.font.draw(r.ctx, t.text, t.x, t.y, { color: t.color, scale: t.scale, align: 'center', shadow: 25 });
    }
  }

  clear() { this.list.length = 0; }
}
