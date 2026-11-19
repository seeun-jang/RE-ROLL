// ============================================================
// 픽셀 렌더러
//  - 내부 캔버스는 항상 320x180, CSS로 정수배 확대 (nearest-neighbor)
//  - 모든 그리기 좌표는 정수로 반올림 (서브픽셀 금지)
//  - 그라데이션 대신 베이어 디더 패턴 제공
// ============================================================
import { CONFIG } from '../config.js';

// 4x4 베이어 행렬 (디더링/픽셀 페이드용)
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.W = CONFIG.VIEW.WIDTH;
    this.H = CONFIG.VIEW.HEIGHT;
    canvas.width = this.W;
    canvas.height = this.H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.scale = 1;
    this._patterns = new Map();
    this._shake = { amp: 0, time: 0, x: 0, y: 0 };
  }

  /**
   * 주어진 영역에 들어가는 최대 정수배로 캔버스 표시 크기를 맞춘다.
   * 배율은 "물리 픽셀" 기준(devicePixelRatio 반영) → 125%/150% 화면에서도 도트가 균일하다.
   * @returns CSS 픽셀 기준 표시 폭
   */
  fit(availW, availH) {
    const { MIN_SCALE, MAX_SCALE } = CONFIG.VIEW;
    const dpr = window.devicePixelRatio || 1;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE * Math.ceil(dpr), Math.floor(Math.min((availW * dpr) / this.W, (availH * dpr) / this.H))));
    this.scale = s;
    const cssW = (this.W * s) / dpr;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${(this.H * s) / dpr}px`;
    return cssW;
  }

  /** 화면 좌표 → 논리 픽셀 좌표 */
  toLogical(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.floor(((clientX - r.left) / r.width) * this.W),
      y: Math.floor(((clientY - r.top) / r.height) * this.H),
    };
  }

  // ---------- 화면 흔들림 ----------
  shake(amp, time = 0.25) {
    if (amp >= this._shake.amp) {
      this._shake.amp = amp;
      this._shake.time = time;
      this._shake.total = time;
    }
  }

  updateShake(dt) {
    const s = this._shake;
    if (s.time > 0) {
      s.time -= dt;
      const k = Math.max(0, s.time / (s.total || 1));
      const a = s.amp * k;
      s.x = Math.round((Math.random() * 2 - 1) * a);
      s.y = Math.round((Math.random() * 2 - 1) * a);
      if (s.time <= 0) { s.amp = 0; s.x = 0; s.y = 0; }
    }
  }

  get shakeOffset() {
    return { x: this._shake.x, y: this._shake.y };
  }

  // ---------- 프레임 ----------
  begin(clearColor) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = clearColor;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  /** 흔들림 적용 구간 시작/끝 (월드 레이어에만 적용) */
  pushShake(depth = 1) {
    this.ctx.save();
    this.ctx.translate(Math.round(this._shake.x * depth), Math.round(this._shake.y * depth));
  }

  popShake() {
    this.ctx.restore();
  }

  // ---------- 기본 도형 ----------
  rect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  /** 1px 테두리 사각형 */
  strokeRect(x, y, w, h, color) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  /**
   * 스프라이트 그리기. (x, y)는 발 중앙(앵커) 기준.
   * sx/sy 로 스쿼시&스트레치 — 결과 크기는 정수로 맞춰 nearest-neighbor 확대
   */
  sprite(img, x, y, { anchorX = 0.5, anchorY = 1, sx = 1, sy = 1, alpha = 1 } = {}) {
    if (!img) return;
    const w = Math.max(1, Math.round(img.width * sx));
    const h = Math.max(1, Math.round(img.height * sy));
    const dx = Math.round(x - w * anchorX);
    const dy = Math.round(y - h * anchorY);
    const ctx = this.ctx;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(img, dx, dy, w, h);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  /** 정수배 확대 그리기 (타이틀 글자 등) */
  spriteScaled(img, x, y, scale) {
    if (!img) return;
    this.ctx.drawImage(img, Math.round(x), Math.round(y), img.width * scale, img.height * scale);
  }

  // ---------- 디더 ----------
  _pattern(color, level) {
    const key = `${color}|${level}`;
    let p = this._patterns.get(key);
    if (!p) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = color;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) g.fillRect(x, y, 1, 1);
      p = this.ctx.createPattern(c, 'repeat');
      this._patterns.set(key, p);
    }
    return p;
  }

  /** density 0~1 만큼 베이어 디더로 채운다 (반투명/그라데이션 대체) */
  dither(x, y, w, h, color, density) {
    const level = Math.max(0, Math.min(16, Math.round(density * 16)));
    if (level <= 0) return;
    if (level >= 16) return this.rect(x, y, w, h, color);
    this.ctx.fillStyle = this._pattern(color, level);
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  /** 픽셀 원 (채움) — 블록 단위 */
  circle(cx, cy, r, color, block = 1) {
    cx = Math.round(cx); cy = Math.round(cy);
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for (let y = -r; y <= r; y += block) {
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
      ctx.fillRect(cx - half, cy + y, half * 2 + 1, block);
    }
  }

  /** 픽셀 원 테두리 */
  ring(cx, cy, r, color) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    const ctx = this.ctx;
    ctx.fillStyle = color;
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      const pts = [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]];
      for (const [px, py] of pts) ctx.fillRect(cx + px, cy + py, 1, 1);
      y++;
      if (err < 0) err += 2 * y + 1;
      else { x--; err += 2 * (y - x) + 1; }
    }
  }
}
