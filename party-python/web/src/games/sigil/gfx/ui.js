// =====================================================
// UI: 3x5 비트맵 숫자, 한글 픽셀 글씨, 패널, 버튼, 카드, 디더 무늬
// (원본 js/font.js · js/ui.js · js/hud.js 를 모듈로 옮긴 것. 브라우저 객체는 함수 안에서만 만진다)
// =====================================================
import { C, PALETTE } from '../palette.js';

// ---- 3x5 비트맵 폰트 (숫자/영문 HUD 용) — 항상 픽셀이 딱 떨어짐 ----
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

// ---- 한글 픽셀 폰트 (Galmuri) ----
// 캔버스 글씨는 기본적으로 흐릿하게 그려지므로
// 알파값을 0 또는 255로 잘라서 '딱 떨어지는 픽셀'로 만든 뒤 캐시함
export const KText = {
  cache: new Map(),
  fonts: {
    // 잘 보이도록 모든 글씨를 굵은 12px 로 (얇은 1px 획은 작은 화면에서 흐려 보임)
    s: { css: 'bold 12px Galmuri11', size: 12 },
    m: { css: 'bold 12px Galmuri11', size: 12 },
    b: { css: 'bold 12px Galmuri11', size: 12 },
    // 큰 제목 (2배로 키워 쓰는 글씨)
    L: { css: '15px Galmuri14', size: 15, padTop: 3, thick: true },
    // 좁은 칸에 긴 이름을 넣을 때 쓰는 작은 글꼴
    n: { css: '10px Galmuri9', size: 10 },
  },

  // 글자 모양(마스크) 만들기
  // 브라우저·OS마다 글씨 안티앨리어싱이 달라서 12px 로 바로 그리면 획이 촘촘한 글자가 뭉개짐
  // → 4배 크기로 그린 뒤 4x4 칸마다 절반 이상 칠해졌는지로 원래 픽셀을 되살림
  _mask(str, font) {
    const key = 'mask|' + font + '|' + str;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.cache.size > 1500) this.cache.clear();   // 점수처럼 계속 바뀌는 글자가 쌓이지 않게
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
    str = String(str);
    if (!str) return;
    const img = this.get(str, color, opts.font || 'm', opts.outline || null);
    const s = opts.scale || 1;
    const w = img.width * s;
    let dx = x;
    if (opts.align === 'center') dx = x - w / 2;
    else if (opts.align === 'right') dx = x - w;
    ctx.drawImage(img, Math.round(dx), Math.round(y), img.width * s, img.height * s);
  },

  /** 너비 maxW 에 들어가게 뒤를 자른 글 (넘치면 … 을 붙인다) */
  fit(str, font, maxW) {
    str = String(str);
    if (!str || this.width(str, font) <= maxW) return str;
    let s = str;
    while (s.length > 1 && this.width(s + '…', font) > maxW) s = s.slice(0, -1);
    return s + '…';
  },

  clear() {
    this.cache.clear();
  },
};

// ---- 9-slice 픽셀 테두리 패널 ----
const PANEL_STYLES = {
  default: { out: '1', border: '9', shade: '8', fill: '2' },
  dark: { out: '1', border: '3', shade: '2', fill: 'o' },
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

// ---- 버튼 (선택/눌림 상태) ----
export class Button {
  constructor(label, x, y, w, h = 18) {
    this.label = label;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.pressT = 0;
  }

  press() {
    this.pressT = 8;
  }

  update() {
    if (this.pressT > 0) this.pressT--;
  }

  render(ctx, selected, frame) {
    const down = this.pressT > 0 ? 2 : 0; // 눌리면 2px 아래로
    if (!down) {
      ctx.fillStyle = C('1');
      ctx.fillRect(this.x + 1, this.y + this.h, this.w - 2, 2); // 버튼 두께
    }
    drawPanel(ctx, this.x, this.y + down, this.w, this.h, selected ? 'red' : 'dark');
    const col = selected ? (frame % 40 < 30 ? C('9') : C('a')) : C('j');
    KText.draw(ctx, this.label, this.x + this.w / 2, this.y + down + Math.max(1, Math.round((this.h - 13) / 2)), col, { align: 'center', font: 'b' });
  }
}

// ---- 색 있는 디더 무늬 (반투명 대신 픽셀 체크무늬) ----
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const DITHER_CACHE = new WeakMap();   // ctx → Map(key → CanvasPattern)
export const DITHER = {
  get(ctx, key, level) {
    let m = DITHER_CACHE.get(ctx);
    if (!m) {
      m = new Map();
      DITHER_CACHE.set(ctx, m);
    }
    const id = key + '|' + level;
    if (!m.has(id)) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = C(key);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) g.fillRect(x, y, 1, 1);
      m.set(id, ctx.createPattern(c, 'repeat'));
    }
    return m.get(id);
  },
};

// 캐릭터 색의 진한 짝 (카드 그림자/테두리)
const DARK_OF = { e: 'd', q: 'v', t: '8', 8: 'u', p: '4', 9: '8' };

// 둥근 모서리 카드 (모서리 2칸 깎음)
export function drawCard(ctx, x, y, w, h, fill, edge) {
  ctx.fillStyle = C('1');
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.fillStyle = C(edge);
  ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 4);
  ctx.fillStyle = C(fill);
  ctx.fillRect(x + 2, y + 1, w - 4, h - 4);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 5);
  // 윗부분 반짝
  ctx.fillStyle = C('w');
  ctx.fillRect(x + 3, y + 2, Math.max(0, w - 10), 1);
}

// 이름표: p = { color(팔레트 글자), name, face(얼굴 그림 또는 null) }
export function drawNameCard(ctx, x, y, w, p) {
  const col = p.color;
  drawCard(ctx, x, y, w, 17, col, DARK_OF[col] || '3');
  if (p.face) ctx.drawImage(p.face, x + 1, y);
  // 이름이 칸보다 길면 작은 글꼴로 (얼굴 아이콘 오른쪽 공간에 맞춤)
  const room = w - 21;
  const big = KText.width(p.name, 'b') <= room;
  const name = big ? p.name : KText.fit(p.name, 'n', room);
  KText.draw(ctx, name, x + 19 + room / 2, y + (big ? 2 : 3), C('1'), { align: 'center', font: big ? 'b' : 'n' });
}

export { PALETTE };
