// ============================================================
// PixelText.js — 픽셀 폰트 렌더러
//
// 캔버스의 fillText 는 안티앨리어싱이 들어가 흐릿해진다.
// 그래서 글자를 따로 그린 뒤 알파값을 0/255 로 잘라(threshold)
// 완전한 도트 글자로 만들고, 결과를 캐시해서 재사용한다.
// ============================================================

import { FONTS } from '../config.js';
import { hexToRgb } from '../assets/palette.js';

const SUPER = 4; // 4배로 그려서 블록 단위로 판정

export class PixelText {
  constructor() {
    this.cache = new Map();
    this.work = document.createElement('canvas');
    this.wctx = this.work.getContext('2d', { willReadFrequently: true });
  }

  _font(name) {
    const f = FONTS[name] || FONTS.main;
    return { css: `${f.size}px ${f.family}`, size: f.size };
  }

  // 글자 폭 (픽셀)
  measure(text, font = 'main') {
    const f = this._font(font);
    this.wctx.font = f.css;
    return Math.ceil(this.wctx.measureText(String(text)).width);
  }

  lineHeight(font = 'main') {
    return this._font(font).size + 2;
  }

  // 글자를 K배 크기로 그린 뒤 K×K 블록마다 "절반 이상 칠해졌는지"로 1비트 마스크를 만든다.
  // 1배로 그리면 브라우저가 글자 위치를 소수점 픽셀에 두어 일부 획이 사라지기 때문.
  _rasterize(text, font, w, h, phase = this._phase(font)) {
    const f = FONTS[font] || FONTS.main;
    const K = SUPER;
    this.work.width = w * K;
    this.work.height = h * K;
    const c = this.wctx;
    c.font = `${f.size * K}px ${f.family}`;
    c.textBaseline = 'top';
    c.fillStyle = '#fff';
    c.fillText(text, 2 * K + phase.ox, 2 * K + phase.oy);
    const d = c.getImageData(0, 0, w * K, h * K).data;
    const mask = new Uint8Array(w * h);
    const stride = w * K;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let yy = 0; yy < K; yy++) {
        const row = (y * K + yy) * stride + x * K;
        for (let xx = 0; xx < K; xx++) sum += d[(row + xx) * 4 + 3];
      }
      mask[y * w + x] = sum > (K * K * 255) / 2 ? 1 : 0;
    }
    return mask;
  }

  // 폰트마다 픽셀 격자가 어긋난 정도(위상)가 달라서, 처음 한 번 가장 선명한 위치를 찾는다
  _phase(font) {
    this.phases ||= {};
    if (this.phases[font]) return this.phases[font];
    const f = FONTS[font] || FONTS.main;
    const K = SUPER;
    const sample = '볼때움직이P15m가';
    this.wctx.font = `${f.size}px ${f.family}`;
    const w = Math.ceil(this.wctx.measureText(sample).width) + 4, h = f.size + 6;
    let best = { ox: 0, oy: 0, amb: Infinity };
    for (let oy = 0; oy < K; oy++) for (let ox = 0; ox < K; ox++) {
      this.work.width = w * K;
      this.work.height = h * K;
      const c = this.wctx;
      c.font = `${f.size * K}px ${f.family}`;
      c.textBaseline = 'top';
      c.fillStyle = '#fff';
      c.fillText(sample, 2 * K + ox, 2 * K + oy);
      const d = c.getImageData(0, 0, w * K, h * K).data;
      let amb = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let yy = 0; yy < K; yy++) for (let xx = 0; xx < K; xx++) sum += d[(((y * K + yy) * w * K) + x * K + xx) * 4 + 3];
        const a = sum / (K * K * 255);
        if (a > 0.2 && a < 0.8) amb++;
      }
      if (amb < best.amb) best = { ox, oy, amb };
    }
    this.phases[font] = best;
    return best;
  }

  // 텍스트 → 도트 캔버스 (외곽선 선택)
  get(text, font = 'main', color = '#f4f4f4', outline = null) {
    text = String(text);
    const key = `${font}|${color}|${outline}|${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const f = this._font(font);
    const w = this.measure(text, font) + 4;
    const h = f.size + 6;
    const mask = this._rasterize(text, font, w, h);

    const pad = outline ? 1 : 0;
    const out = document.createElement('canvas');
    out.width = w + pad * 2;
    out.height = h + pad * 2;
    const octx = out.getContext('2d');
    const od = octx.createImageData(out.width, out.height);
    const [r, g, b] = hexToRgb(color);
    const oc = outline ? hexToRgb(outline) : null;
    const put = (x, y, rgb) => {
      const i = (y * out.width + x) * 4;
      od.data[i] = rgb[0]; od.data[i + 1] = rgb[1]; od.data[i + 2] = rgb[2]; od.data[i + 3] = 255;
    };
    // 외곽선: 글자 주변 8방향
    if (oc) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(x + pad + dx, y + pad + dy, oc);
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) put(x + pad, y + pad, [r, g, b]);
    }
    octx.putImageData(od, 0, 0);

    const entry = { canvas: out, w: w - 4, h: f.size, pad: 2 + pad };
    if (this.cache.size > 600) this.cache.clear(); // 캐시가 너무 커지면 비움
    this.cache.set(key, entry);
    return entry;
  }

  // 그리기: align = left | center | right, scale = 정수배 확대 (카운트다운 등 큰 글자)
  draw(ctx, text, x, y, { font = 'main', color = '#f4f4f4', outline = null, align = 'left', scale = 1 } = {}) {
    const t = this.get(text, font, color, outline);
    const s = Math.max(1, Math.round(scale));
    const w = t.w * s;
    let dx = x;
    if (align === 'center') dx = x - Math.floor(w / 2);
    else if (align === 'right') dx = x - w;
    ctx.drawImage(t.canvas, Math.round(dx - t.pad * s), Math.round(y - t.pad * s), t.canvas.width * s, t.canvas.height * s);
    return w;
  }

  clear() { this.cache.clear(); }
}
