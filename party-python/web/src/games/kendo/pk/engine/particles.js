(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 파티클 & 떠오르는 글자
  //  - 모든 파티클은 1~2px 사각형 (불꽃, 먼지, 반짝임)
  //  - 좌표는 월드 기준, 그릴 때 카메라만큼 빼고 정수로 반올림
  // ─────────────────────────────────────────────────────────────
  class FX {
    constructor() {
      this.parts = [];
      this.texts = [];
    }

    add(p) {
      if (this.parts.length > 300) this.parts.shift();
      this.parts.push(p);
    }

    // 죽도끼리 부딪힐 때 작은 불꽃
    spark(x, y, n, colors) {
      const C = PK.COL;
      colors = colors || [C.white, C.yellow, C.gold];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 0.6 + Math.random() * 1.8;
        this.add({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6, g: 0.08, life: 10 + (Math.random() * 12 | 0), size: Math.random() < 0.3 ? 2 : 1, color: colors[i % colors.length] });
      }
    }

    // 호구에 맞았을 때 — 위로 튀는 흰 조각
    hit(x, y, dir) {
      const C = PK.COL;
      for (let i = 0; i < 8; i++) {
        this.add({ x: x, y: y, vx: dir * (0.4 + Math.random() * 1.4), vy: -0.5 - Math.random() * 1.5, g: 0.1, life: 12 + (Math.random() * 10 | 0), size: i < 3 ? 2 : 1, color: i % 2 ? C.white : C.lgrey });
      }
    }

    // 발밑 먼지
    dust(x, y, dir, n) {
      const C = PK.COL;
      n = n || 5;
      for (let i = 0; i < n; i++) {
        this.add({ x: x + (Math.random() * 6 - 3), y: y - 1, vx: -dir * (0.2 + Math.random() * 0.9), vy: -0.15 - Math.random() * 0.4, g: 0.01, life: 14 + (Math.random() * 14 | 0), size: Math.random() < 0.4 ? 2 : 1, color: i % 2 ? C.tan : C.cream });
      }
    }

    // 한판 반짝임
    sparkle(x, y, n) {
      const C = PK.COL;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 0.5 + Math.random() * 2.5;
        this.add({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.02, drag: 0.94, life: 25 + (Math.random() * 25 | 0), size: 1, twinkle: true, color: [C.gold, C.yellow, C.white][i % 3] });
      }
    }

    // 떠오르는 글자 (판정 결과 등)
    float(text, x, y, color, opt) {
      opt = opt || {};
      this.texts.push({ text: text, x: x, y: y, color: color || PK.COL.white, life: opt.life || 70, t: 0, font: opt.font || 'S', rise: opt.rise === undefined ? 0.25 : opt.rise });
      if (this.texts.length > 12) this.texts.shift();
    }

    update() {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.vy += p.g || 0;
        if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; }
        p.x += p.vx; p.y += p.vy;
        if (--p.life <= 0) this.parts.splice(i, 1);
      }
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.t++;
        if (t.t > t.life) this.texts.splice(i, 1);
      }
    }

    draw(g, camX) {
      for (let i = 0; i < this.parts.length; i++) {
        const p = this.parts[i];
        if (p.twinkle && (p.life >> 2) % 2) continue;
        g.fillStyle = p.color;
        g.fillRect(Math.round(p.x - camX), Math.round(p.y), p.size, p.size);
      }
      for (let i = 0; i < this.texts.length; i++) {
        const t = this.texts[i];
        // 끝날 무렵 깜빡이며 사라짐
        if (t.life - t.t < 14 && (t.t >> 1) % 2) continue;
        const y = t.y - Math.min(t.t, 24) * t.rise;
        PK.Font.draw(g, t.text, Math.round(t.x - camX), Math.round(y), { font: t.font, color: t.color, outline: PK.COL.outline, align: 'center' });
      }
    }
  }

  PK.FX = FX;
})(window.PK = window.PK || {});
