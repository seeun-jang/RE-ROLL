// ============================================================
// 픽셀 텍스트 렌더러
// 캔버스 fillText는 안티앨리어싱이 생기므로, 크게 그린 뒤 픽셀 중심을 샘플링해
// 또렷한 도트 글자(알파 0 또는 255)로 만든 후 캐시한다.
// ============================================================
import { CONFIG } from '../config.js';
import { C } from '../data/palette.js';

const FALLBACK = '"DungGeunMo", "Galmuri11", monospace';
const MAX_CACHE = 600;
const SUPERSAMPLE = 4;

export class PixelText {
  constructor() {
    this.cache = new Map();
    this._measure = document.createElement('canvas').getContext('2d');
    this.fontsReady = false;
  }

  /** Galmuri 폰트 로딩 (실패해도 대체 폰트로 계속 진행) */
  async loadFonts(timeoutMs = 1500) {
    if (!document.fonts) return false;
    const loads = Object.values(CONFIG.FONTS).map((f) => document.fonts.load(`${f.size}px "${f.family}"`, '가A'));
    const timeout = new Promise((res) => setTimeout(() => res('timeout'), timeoutMs));
    try {
      const r = await Promise.race([Promise.all(loads), timeout]);
      this.fontsReady = r !== 'timeout' && Object.values(CONFIG.FONTS).every((f) => document.fonts.check(`${f.size}px "${f.family}"`));
    } catch {
      this.fontsReady = false;
    }
    if (!this.fontsReady) console.warn('[PixelText] Galmuri 폰트를 불러오지 못해 대체 폰트를 사용합니다.');
    this.cache.clear();
    return this.fontsReady;
  }

  _font(size) {
    const f = CONFIG.FONTS[size] || CONFIG.FONTS.m;
    return { css: `${f.size}px "${f.family}", ${FALLBACK}`, px: f.size };
  }

  measure(text, size = 'm') {
    const f = this._font(size);
    this._measure.font = f.css;
    return Math.ceil(this._measure.measureText(String(text)).width);
  }

  /**
   * 글자 이미지를 만든다 (캐시)
   * 브라우저는 캔버스 글자에 안티앨리어싱을 강제하므로, 4배 크기로 그린 뒤
   * 각 픽셀 칸의 "중심"만 샘플링한다 → 픽셀 폰트의 도트가 1:1로 정확히 복원된다.
   */
  bake(text, size = 'm', color = C.white) {
    text = String(text);
    const key = `${size}|${color}|${text}`;
    let img = this.cache.get(key);
    if (img) return img;
    const f = this._font(size);
    const s = f.px;
    const K = SUPERSAMPLE;
    const bigFont = f.css.replace(`${s}px`, `${s * K}px`);
    this._measure.font = bigFont;
    const w = Math.max(1, Math.ceil(this._measure.measureText(text).width / K) + 1);
    const h = s + 3;
    const big = document.createElement('canvas');
    big.width = w * K;
    big.height = h * K;
    const bg = big.getContext('2d', { willReadFrequently: true });
    bg.font = bigFont;
    bg.textBaseline = 'alphabetic';
    bg.fillStyle = '#ffffff';
    bg.fillText(text, 0, (s - 1) * K); // 기준선을 픽셀 격자에 맞춘다
    const src = bg.getImageData(0, 0, big.width, big.height).data;

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const out = g.createImageData(w, h);
    const d = out.data;
    const hex = color.replace('#', '');
    const cr = parseInt(hex.slice(0, 2), 16), cg = parseInt(hex.slice(2, 4), 16), cb = parseInt(hex.slice(4, 6), 16);
    const half = K >> 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = src[((y * K + half) * big.width + x * K + half) * 4 + 3];
        if (a > 127) {
          const i = (y * w + x) * 4;
          d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = 255;
        }
      }
    }
    g.putImageData(out, 0, 0);
    if (this.cache.size > MAX_CACHE) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }

  /**
   * 텍스트 그리기
   * @param opts.align  'left' | 'center' | 'right'
   * @param opts.shadow 그림자 색 (1px 아래) — 없으면 null
   * @param opts.outline 외곽선 색 (상하좌우 1px)
   * @param opts.scale  정수배 확대 (타이틀)
   */
  draw(ctx, text, x, y, { size = 'm', color = C.white, align = 'left', shadow = null, outline = null, scale = 1 } = {}) {
    if (text === '' || text == null) return 0;
    const img = this.bake(text, size, color);
    const w = img.width * scale;
    let dx = Math.round(x);
    if (align === 'center') dx = Math.round(x - w / 2);
    else if (align === 'right') dx = Math.round(x - w);
    const dy = Math.round(y);
    const h = img.height * scale;
    if (outline) {
      const o = this.bake(text, size, outline);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(o, dx + ox * scale, dy + oy * scale, w, h);
    }
    if (shadow) ctx.drawImage(this.bake(text, size, shadow), dx, dy + scale, w, h);
    ctx.drawImage(img, dx, dy, w, h);
    return w;
  }

  /** 최대 폭에 맞춰 줄바꿈 (한글은 글자 단위, 공백 우선) */
  wrap(text, maxWidth, size = 'm') {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      const tokens = para.split(/(\s+)/);
      for (const tok of tokens) {
        const test = line + tok;
        if (this.measure(test, size) <= maxWidth) {
          line = test;
          continue;
        }
        if (line.trim()) lines.push(line.trimEnd());
        line = tok.trimStart();
        // 한 토큰이 너무 길면 글자 단위로 자른다
        while (this.measure(line, size) > maxWidth) {
          let cut = line.length - 1;
          while (cut > 1 && this.measure(line.slice(0, cut), size) > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }
}
