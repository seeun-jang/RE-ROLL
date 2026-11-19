// 3×5 비트맵 픽셀 폰트 (영문·숫자·기호) + 한글용 픽셀 폰트(Galmuri) 캐시 렌더러
// 영문 HUD 텍스트는 내장 비트맵으로 완전한 픽셀 정렬을 보장하고,
// 한글 문장은 웹폰트를 오프스크린에 그린 뒤 알파를 이진화해 번짐을 없앤다.

const G = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'], 3: ['###', '..#', '.##', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'], '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'], ':': ['...', '.#.', '...', '.#.', '...'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'], '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'], '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'], x: ['...', '#.#', '.#.', '#.#', '...'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'], '(': ['.#.', '#..', '#..', '#..', '.#.'],
  ')': ['.#.', '..#', '..#', '..#', '.#.'], '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'], "'": ['.#.', '.#.', '...', '...', '...'],
  _: ['...', '...', '...', '...', '###'], '=': ['...', '###', '...', '###', '...'],
  '#': ['#.#', '###', '#.#', '###', '#.#'], '*': ['#.#', '.#.', '###', '.#.', '#.#'],
  '"': ['#.#', '#.#', '...', '...', '...'], '~': ['...', '.#.', '#.#', '...', '...'],
  '[': ['##.', '#..', '#..', '#..', '##.'], ']': ['.##', '..#', '..#', '..#', '.##'],
};

export const FONT_W = 3, FONT_H = 5, FONT_ADV = 4;

export class PixelFont {
  constructor(colors) {
    this.colors = colors; // 팔레트 hex 배열
    this.cache = new Map();
  }

  glyph(ch, colorIdx, scale) {
    let rows = G[ch];
    if (!rows) rows = G[ch.toUpperCase()] || G['?'];
    const key = `${ch}|${colorIdx}|${scale}`;
    let c = this.cache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = FONT_W * scale; c.height = FONT_H * scale;
    const ctx = c.getContext('2d');
    ctx.fillStyle = this.colors[colorIdx] ?? colorIdx; // 인덱스가 아니면 CSS 색으로 취급
    for (let y = 0; y < FONT_H; y++) for (let x = 0; x < FONT_W; x++) {
      if (rows[y][x] === '#') ctx.fillRect(x * scale, y * scale, scale, scale);
    }
    this.cache.set(key, c);
    return c;
  }

  measure(text, scale = 1) { return Math.max(0, text.length * FONT_ADV * scale - scale); }

  // align: 'left' | 'center' | 'right', shadow: 그림자 색 인덱스 (없으면 생략)
  draw(ctx, text, x, y, { color = 19, scale = 1, align = 'left', shadow = null } = {}) {
    text = String(text);
    let cx = x | 0;
    const w = this.measure(text, scale);
    if (align === 'center') cx = (x - w / 2) | 0;
    else if (align === 'right') cx = (x - w) | 0;
    if (shadow !== null) {
      let sx = cx;
      for (const ch of text) { if (ch !== ' ') ctx.drawImage(this.glyph(ch, shadow, scale), sx + scale, (y | 0) + scale); sx += FONT_ADV * scale; }
    }
    for (const ch of text) {
      if (ch !== ' ') ctx.drawImage(this.glyph(ch, color, scale), cx, y | 0);
      cx += FONT_ADV * scale;
    }
    return w;
  }
}

// 한글 등 비트맵 폰트에 없는 문자용: 웹폰트(Galmuri) → 알파 이진화 → 캐시
export class KoFont {
  constructor(colors, family = '"Galmuri9", "Galmuri11", "DungGeunMo", "NeoDunggeunmo", sans-serif') {
    this.colors = colors;
    this.family = family;
    this.cache = new Map();
    this.scratch = document.createElement('canvas');
    this.sctx = this.scratch.getContext('2d', { willReadFrequently: true });
  }

  render(text, size, colorIdx) {
    const key = `${text}|${size}|${colorIdx}`;
    let c = this.cache.get(key);
    if (c) return c;
    const ctx = this.sctx;
    ctx.font = `${size}px ${this.family}`;
    ctx.textBaseline = 'top';
    const w = Math.ceil(ctx.measureText(text).width) + 2;
    const h = size + 4;
    this.scratch.width = Math.max(1, w); this.scratch.height = h;
    ctx.font = `${size}px ${this.family}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 0, 1);
    const img = ctx.getImageData(0, 0, w, h);
    const [r, g, b] = hex(this.colors[colorIdx] ?? '#ffffff');
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3] >= 110 ? 255 : 0; // 알파 이진화 → 픽셀 또렷
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
    }
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(img, 0, 0);
    if (this.cache.size > 400) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }

  draw(ctx, text, x, y, { color = 19, size = 9, align = 'left', shadow = null } = {}) {
    const c = this.render(text, size, color);
    let cx = x | 0;
    if (align === 'center') cx = (x - c.width / 2) | 0;
    else if (align === 'right') cx = (x - c.width) | 0;
    if (shadow !== null) ctx.drawImage(this.render(text, size, shadow), cx + 1, (y | 0) + 1);
    ctx.drawImage(c, cx, y | 0);
    return c.width;
  }
}

function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// 이름 등 임의 문자열: ASCII면 비트맵 폰트(5px), 한글 등이 섞이면 Galmuri(9px)로 그린다
export function drawName(font, ko, ctx, text, x, y, opts = {}) {
  text = String(text);
  if (/^[\x20-\x7e]*$/.test(text)) return font.draw(ctx, text, x, y, opts);
  return ko.draw(ctx, text, x, y - 2, { color: opts.color, align: opts.align, shadow: opts.shadow ?? null });
}
