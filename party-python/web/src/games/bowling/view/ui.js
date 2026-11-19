// (원본 잭팟 볼링 js/ui.js 를 ES 모듈로 옮긴 것 — 그리기 코드는 원본 그대로)
import { C } from './palette.js';

// =====================================================
// UI: 한글 픽셀 글씨, 9-slice 패널, 버튼, HUD
// =====================================================

// ---- 한글 픽셀 폰트 (Galmuri) ----
// 캔버스 글씨는 기본적으로 흐릿하게 그려지므로
// 알파값을 0 또는 255로 잘라서 '딱 떨어지는 픽셀'로 만든 뒤 캐시함
export const KText = {
  cache: new Map(),
  fonts: {
    // 잘 보이도록 모든 글씨를 굵은 12px 로 (얇은 1px 획은 작은 화면에서 흐려 보임)
    s: { css: 'bold 12px BowlingGalmuri11', size: 12 },
    m: { css: 'bold 12px BowlingGalmuri11', size: 12 },
    b: { css: 'bold 12px BowlingGalmuri11', size: 12 },
    // 큰 제목 (2배로 키워 쓰는 글씨) — 획이 촘촘한 글자도 안 뭉개지는 15px 글꼴
    // thick: 세로획을 1px 두껍게 (가로 간격은 그대로라 ㅐ·ㅍ 처럼 촘촘한 글자도 안 뭉개짐)
    L: { css: '15px Galmuri14', size: 15, padTop: 3, thick: true },
    // 좁은 칸에 긴 이름 (볼리베어 등)을 넣을 때 쓰는 작은 글꼴
    n: { css: '10px Galmuri9', size: 10 },
  },

  // 글자 모양(마스크) 만들기
  // 브라우저·OS마다 글씨 안티앨리어싱이 달라서 12px 로 바로 그리면
  // '배', '에' 처럼 획이 촘촘한 글자가 뭉개짐(■) → 4배 크기로 그린 뒤
  // 4x4 칸마다 절반 이상 칠해졌는지로 원래 픽셀을 되살림 (어느 PC에서나 같은 모양)
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
    const bg = big.getContext('2d');
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
    const img = this.get(str, color, opts.font || 'm', opts.outline || null);
    const s = opts.scale || 1;
    const w = img.width * s;
    let dx = x;
    if (opts.align === 'center') dx = x - w / 2;
    else if (opts.align === 'right') dx = x - w;
    ctx.drawImage(img, Math.round(dx), Math.round(y), img.width * s, img.height * s);
  },

  clear() {
    this.cache.clear();
  },
};

// ---- 9-slice 픽셀 테두리 패널 ----
export const PANEL_STYLES = {
  default: { out: '1', border: '9', shade: '8', fill: '2' },
  dark: { out: '1', border: '3', shade: '2', fill: 'o' },
  slot: { out: '1', border: '9', shade: '8', fill: '7' },
  felt: { out: '1', border: '9', shade: '8', fill: 'c' },
  blue: { out: '1', border: '9', shade: '8', fill: 'f' },
  red: { out: '1', border: '9', shade: '8', fill: '7' },
};

export function drawPanel(ctx, x, y, w, h, style = 'default') {
  const s = PANEL_STYLES[style] || PANEL_STYLES.default;
  x = Math.round(x);
  y = Math.round(y);
  // 바깥 외곽선 (모서리는 깎아서 둥글게)
  ctx.fillStyle = C(s.out);
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  // 금 테두리
  ctx.fillStyle = C(s.border);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // 안쪽 그림자 (아래/오른쪽)
  ctx.fillStyle = C(s.shade);
  ctx.fillRect(x + 2, y + h - 3, w - 4, 1);
  ctx.fillRect(x + w - 3, y + 2, 1, h - 4);
  // 내부
  ctx.fillStyle = C(s.fill);
  ctx.fillRect(x + 2, y + 2, w - 5, h - 5);
  // 모서리 리벳
  if (w > 20 && h > 14) {
    ctx.fillStyle = C('a');
    ctx.fillRect(x + 2, y + 2, 1, 1);
    ctx.fillRect(x + w - 4, y + 2, 1, 1);
  }
}

