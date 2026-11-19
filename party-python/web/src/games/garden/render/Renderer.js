// 픽셀 렌더러 — 320×180 캔버스를 정수배로 확대(nearest-neighbor), 화면 흔들림, 장면 전환 와이프
export class Renderer {
  constructor(canvas, cfg, sprites) {
    this.canvas = canvas;
    this.cfg = cfg;
    this.W = cfg.base.width;
    this.H = cfg.base.height;
    this.sprites = sprites;
    canvas.width = this.W;
    canvas.height = this.H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    canvas.style.imageRendering = 'pixelated';
    canvas.style.display = 'block';
    this.scale = 1;

    // 흔들림
    this.shakeT = 0; this.shakeDur = 0; this.shakePow = 0; this.shakeX = 0; this.shakeY = 0;

    // 전환 와이프: {type:'iris'|'blocks', dir: 'out'|'in', t, dur, onMid}
    this.wipe = null;
    this.wipeOrder = null;
    this.frame = 0;
  }

  // 부모 요소 크기에 맞춰 정수배 스케일 결정 — 장치 픽셀 기준으로 계산해 125%/150% 배율에서도 픽셀이 고르다
  resize(maxW, maxH) {
    const dpr = window.devicePixelRatio || 1;
    const s = Math.max(1, Math.floor(Math.min(maxW * dpr / this.W, maxH * dpr / this.H)));
    this.scale = s / dpr;        // CSS px 기준 배율
    this.deviceScale = s;        // 장치 px 기준 정수 배율
    this.canvas.style.width = `${this.W * s / dpr}px`;
    this.canvas.style.height = `${this.H * s / dpr}px`;
    this.fitted = true;
  }

  // 브라우저 좌표 → 내부 픽셀 좌표
  toInternal(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor((clientX - r.left) / r.width * this.W),
      y: Math.floor((clientY - r.top) / r.height * this.H),
    };
  }

  shake(power, duration = 0.2) {
    if (power >= this.shakePow || this.shakeT <= 0) { this.shakePow = power; this.shakeT = duration; this.shakeDur = duration; }
  }

  update(dt) {
    this.frame++;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = this.shakePow * Math.max(0, this.shakeT / this.shakeDur);
      this.shakeX = Math.round((Math.random() * 2 - 1) * k);
      this.shakeY = Math.round((Math.random() * 2 - 1) * k);
      if (this.shakeT <= 0) { this.shakeX = 0; this.shakeY = 0; }
    }
    if (this.wipe) {
      this.wipe.t += dt;
      if (this.wipe.t >= this.wipe.dur) {
        if (this.wipe.dir === 'out') {
          const mid = this.wipe.onMid; this.wipe.onMid = null;
          if (mid) mid();
          this.wipe = { type: this.wipe.type, dir: 'in', t: 0, dur: this.wipe.dur, onDone: this.wipe.onDone };
        } else {
          const done = this.wipe.onDone;
          this.wipe = null;
          if (done) done();
        }
      }
    }
  }

  get transitioning() { return !!this.wipe; }

  // 원형 와이프(iris)로 화면을 닫았다가 onMid 실행 후 다시 연다
  startWipe(onMid, { type = 'iris', dur = 0.35, onDone = null } = {}) {
    if (this.wipe) { if (onMid) onMid(); return; }
    this.wipe = { type, dir: 'out', t: 0, dur, onMid, onDone };
    if (type === 'blocks' && !this.wipeOrder) {
      const bw = Math.ceil(this.W / 8), bh = Math.ceil(this.H / 8);
      const arr = []; for (let i = 0; i < bw * bh; i++) arr.push(i);
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      this.wipeOrder = arr;
    }
  }

  begin() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#181425';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.translate(this.shakeX, this.shakeY);
  }

  end() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.wipe) this.drawWipe(ctx);
  }

  drawWipe(ctx) {
    const w = this.wipe;
    let p = Math.min(1, w.t / w.dur);
    if (w.dir === 'in') p = 1 - p;      // p: 가려진 정도 (0 열림, 1 닫힘)
    ctx.fillStyle = '#181425';
    if (w.type === 'iris') {
      // 픽셀 계단식 원형 와이프 — 중심에서 반지름 r 밖을 검게
      const cx = this.W / 2, cy = this.H / 2;
      const maxR = Math.hypot(cx, cy) + 4;
      const r = Math.round((1 - p) * maxR / 4) * 4; // 4px 단위 계단
      if (r <= 0) { ctx.fillRect(0, 0, this.W, this.H); return; }
      for (let y = 0; y < this.H; y += 2) {
        const dy = y + 1 - cy;
        const half = Math.sqrt(Math.max(0, r * r - dy * dy));
        const x0 = Math.floor((cx - half) / 2) * 2, x1 = Math.ceil((cx + half) / 2) * 2;
        if (x0 > 0) ctx.fillRect(0, y, x0, 2);
        if (x1 < this.W) ctx.fillRect(x1, y, this.W - x1, 2);
      }
    } else {
      const bw = Math.ceil(this.W / 8);
      const n = Math.floor(p * this.wipeOrder.length);
      for (let i = 0; i < n; i++) { const b = this.wipeOrder[i]; ctx.fillRect((b % bw) * 8, Math.floor(b / bw) * 8, 8, 8); }
    }
  }

  // ---- 그리기 헬퍼 ------------------------------------------------
  rect(x, y, w, h, colorIdx) { this.ctx.fillStyle = this.sprites.css(colorIdx); this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  rectCss(x, y, w, h, css) { this.ctx.fillStyle = css; this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  px(x, y, colorIdx) { this.rect(x, y, 1, 1, colorIdx); }

  // 1px 테두리 박스 (9-slice 느낌의 픽셀 UI 창)
  box(x, y, w, h, { fill = 24, border = 20, inner = 23 } = {}) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    this.rect(x + 1, y, w - 2, h, border);
    this.rect(x, y + 1, w, h - 2, border);
    this.rect(x + 1, y + 1, w - 2, h - 2, inner);
    this.rect(x + 2, y + 2, w - 4, h - 4, fill);
  }

  sprite(img, x, y) { this.ctx.drawImage(img, x | 0, y | 0); }

  // 스프라이트 일부만 (예: 머리만 아이콘으로)
  spriteCrop(img, sx, sy, sw, sh, x, y) { this.ctx.drawImage(img, sx, sy, sw, sh, x | 0, y | 0, sw, sh); }

  spriteAlpha(img, x, y, alpha) {
    const ctx = this.ctx; const a = ctx.globalAlpha; ctx.globalAlpha = alpha; ctx.drawImage(img, x | 0, y | 0); ctx.globalAlpha = a;
  }
}
