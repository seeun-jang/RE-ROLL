// =====================================================
// 글씨: 3x5 비트맵 폰트(숫자/영문) + 한글 픽셀 글씨(Galmuri)
// 원본 js/font.js · js/ui.js 의 KText 를 ES 모듈로 옮겼다.
// =====================================================
import { PALETTE } from './palette.js';

const BITMAP_GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111',
  3: '111001111001111', 4: '101101111001001', 5: '111100111001111',
  6: '111100111101111', 7: '111001001010010', 8: '111101111101111',
  9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011',
  D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111',
  J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101101111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  '!': '010010010000010', '?': '110001010000010', ':': '000010000010000',
  '.': '000000000000010', '-': '000000111000000', '+': '000010111010000',
  '/': '001001010100100', '%': '101001010100101', ',': '000000000010100',
  '<': '001010100010001', '>': '100010001010100', "'": '010010000000000',
  '^': '010111010010010',
};

export const BitmapFont = {
  measure(str, scale = 1) {
    const s = String(str);
    return Math.max(0, s.length * 4 * scale - scale);
  },

  // align: left | center | right
  draw(ctx, str, x, y, color, opts = {}) {
    const scale = opts.scale || 1;
    const s = String(str).toUpperCase();
    const w = this.measure(s, scale);
    let px = x;
    if (opts.align === 'center') px = x - w / 2;
    else if (opts.align === 'right') px = x - w;
    px = Math.round(px);
    const py = Math.round(y);
    if (opts.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        this._raw(ctx, s, px + dx * scale, py + dy * scale, opts.outline, scale);
      }
    }
    this._raw(ctx, s, px, py, color, scale);
  },

  _raw(ctx, s, x, y, color, scale) {
    ctx.fillStyle = color;
    for (let i = 0; i < s.length; i++) {
      const g = BITMAP_GLYPHS[s[i]];
      if (g) {
        for (let p = 0; p < 15; p++) {
          if (g[p] === '1') ctx.fillRect(x + (p % 3) * scale, y + ((p / 3) | 0) * scale, scale, scale);
        }
      }
      x += 4 * scale;
    }
  },
};

/** 굵은 Galmuri11 은 이 게임 폴더의 글꼴 파일을 이 이름으로 등록해 쓴다(다른 게임의 글꼴에 영향을 주지 않게) */
export const BOLD_FAMILY = 'HanoGalmuri11B';

// ---- 한글 픽셀 폰트 (Galmuri) ----
// 캔버스 글씨는 기본적으로 흐릿하게 그려지므로
// 알파값을 0 또는 255로 잘라서 '딱 떨어지는 픽셀'로 만든 뒤 캐시함
export const KText = {
  cache: new Map(),
  fonts: {
    // 잘 보이도록 기본 글씨는 굵은 12px
    s: { css: `12px ${BOLD_FAMILY}, Galmuri11`, size: 12 },
    m: { css: `12px ${BOLD_FAMILY}, Galmuri11`, size: 12 },
    b: { css: `12px ${BOLD_FAMILY}, Galmuri11`, size: 12 },
    // 큰 제목 — thick: 세로획을 1px 두껍게
    L: { css: '15px Galmuri14', size: 15, padTop: 3, thick: true },
    // 좁은 칸에 넣는 작은 글꼴
    n: { css: '10px Galmuri9', size: 10 },
  },

  // 글자 모양(마스크) 만들기
  // 브라우저·OS마다 글씨 안티앨리어싱이 달라서 12px 로 바로 그리면 획이 촘촘한 글자가 뭉개짐
  // → 4배 크기로 그린 뒤 4x4 칸마다 절반 이상 칠해졌는지로 원래 픽셀을 되살림
  _mask(str, font) {
    const key = 'mask|' + font + '|' + str;
    if (this.cache.has(key)) return this.cache.get(key);
    const f = this.fonts[font];
    const S = 4;
    const bigCss = f.css.replace(/(\d+)px/, (m, n) => n * S + 'px');
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = f.css;
    const w = Math.max(1, Math.ceil(probe.measureText(str).width) + 2);
    const padTop = f.padTop || 1;
    const h = f.size + 3 + padTop;
    const big = document.createElement('canvas');
    big.width = w * S + S;
    big.height = h * S + S;
    const bg = big.getContext('2d', { willReadFrequently: true });
    bg.font = bigCss;
    bg.textBaseline = 'top';
    bg.fillStyle = '#fff';
    bg.fillText(str, S, S * padTop);
    const src = bg.getImageData(0, 0, big.width, big.height).data;
    const cover = (x0, y0) => {
      let sum = 0;
      for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) sum += src[(y * big.width + x) * 4 + 3];
      return sum / (S * S * 255);
    };
    // 글꼴 픽셀 격자와 가장 잘 맞는 위치(0~3) 찾기
    let best = [0, 0];
    let bestScore = -1;
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        let sc = 0;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) sc += Math.abs(cover(px + x * S, py + y * S) - 0.5);
        if (sc > bestScore) {
          bestScore = sc;
          best = [px, py];
        }
      }
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const on = (x, y) => x >= 0 && cover(best[0] + x * S, best[1] + y * S) >= 0.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (on(x, y) || (f.thick && on(x - 1, y))) {
          const o = (y * w + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = img.data[o + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    this.cache.set(key, c);
    return c;
  },

  _tint(mask, color) {
    const c = document.createElement('canvas');
    c.width = mask.width;
    c.height = mask.height;
    const g = c.getContext('2d');
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  },

  // 글씨 + (선택) 1px 외곽선 → 캔버스 하나로 캐시
  get(str, color, font = 'm', outline = null) {
    const key = [str, color, font, outline].join('|');
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.cache.size > 1500) this.cache.clear();     // 시간 · 대사처럼 계속 바뀌는 글씨가 쌓이지 않게
    const mask = this._mask(str, font);
    const pad = outline ? 1 : 0;
    const c = document.createElement('canvas');
    c.width = mask.width + pad * 2;
    c.height = mask.height + pad * 2;
    const g = c.getContext('2d');
    if (outline) {
      const o = this._tint(mask, outline);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) g.drawImage(o, pad + dx, pad + dy);
    }
    g.drawImage(this._tint(mask, color), pad, pad);
    this.cache.set(key, c);
    return c;
  },

  width(str, font = 'm') {
    return this._mask(str, font).width - 2;
  },

  draw(ctx, str, x, y, color, opts = {}) {
    const img = this.get(String(str), color, opts.font || 'm', opts.outline || null);
    const s = opts.scale || 1;
    const w = img.width * s;
    let dx = x;
    if (opts.align === 'center') dx = x - w / 2;
    else if (opts.align === 'right') dx = x - w;
    ctx.drawImage(img, Math.round(dx), Math.round(y), img.width * s, img.height * s);
  },

  /** 칸 너비에 맞게 글자를 줄인다(넘치면 끝을 '..' 로) */
  fit(str, room, font = 'n') {
    let s = String(str);
    if (this.width(s, font) <= room) return s;
    while (s.length > 1 && this.width(s + '..', font) > room) s = s.slice(0, -1);
    return s + '..';
  },

  clear() {
    this.cache.clear();
  },
};

export const OUTLINE = PALETTE['1'];
