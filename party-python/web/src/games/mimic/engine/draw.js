// 픽셀 그리기 도우미: 사각형, 9-slice 박스, 디더, 선명한 비트맵 글자, 스프라이트.
// 모든 좌표는 정수로 맞추고, 색은 palette.js의 값만 쓴다.
import { C, PAL, hexToRgb } from '../palette.js';
import { FONT, TEXT_CACHE_MAX, TEXT_ALPHA_THRESHOLD } from '../config.js';

const ri = (v) => Math.round(v);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

// ── 기본 도형 ───────────────────────────────────────────
// 정수화된 fillRect
export function rect(ctx, x, y, w, h, color) {
  const iw = ri(w);
  const ih = ri(h);
  if (iw <= 0 || ih <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(ri(x), ri(y), iw, ih);
}

// 사각형 테두리(두께 t)
export function strokeRect(ctx, x, y, w, h, color, t = 1) {
  x = ri(x); y = ri(y); w = ri(w); h = ri(h);
  rect(ctx, x, y, w, t, color);
  rect(ctx, x, y + h - t, w, t, color);
  rect(ctx, x, y + t, t, h - 2 * t, color);
  rect(ctx, x + w - t, y + t, t, h - 2 * t, color);
}

// 모서리를 깎은 테두리(두께 t). 포커스 강조 테두리 등에 쓴다.
export function roundRing(ctx, x, y, w, h, color, t = 1) {
  x = ri(x); y = ri(y); w = ri(w); h = ri(h);
  rect(ctx, x + 1, y, w - 2, t, color);
  rect(ctx, x + 1, y + h - t, w - 2, t, color);
  rect(ctx, x, y + 1, t, h - 2, color);
  rect(ctx, x + w - t, y + 1, t, h - 2, color);
  if (t > 1) {
    // 두꺼운 테두리의 안쪽 모서리 채우기
    rect(ctx, x + 1, y + 1, t, t, color);
    rect(ctx, x + w - 1 - t, y + 1, t, t, color);
    rect(ctx, x + 1, y + h - 1 - t, t, t, color);
    rect(ctx, x + w - 1 - t, y + h - 1 - t, t, t, color);
  }
}

// 9-slice 픽셀 박스: 1px 어두운 외곽(모서리 깎기) + 1px 테두리 + 1px 위쪽 하이라이트 + 채움
export function frame(ctx, x, y, w, h, opts = {}) {
  const fill = opts.fill ?? C.panel;
  const border = opts.border ?? C.border;
  const shadow = opts.shadow ?? C.outline;
  const light = opts.light ?? C.panelLight;
  x = ri(x); y = ri(y); w = ri(w); h = ri(h);
  if (w < 4 || h < 4) { rect(ctx, x, y, w, h, fill); return; }
  // 바깥 외곽선 (네 모서리 픽셀은 비워 둔다)
  rect(ctx, x + 1, y, w - 2, 1, shadow);
  rect(ctx, x + 1, y + h - 1, w - 2, 1, shadow);
  rect(ctx, x, y + 1, 1, h - 2, shadow);
  rect(ctx, x + w - 1, y + 1, 1, h - 2, shadow);
  // 테두리 링
  rect(ctx, x + 1, y + 1, w - 2, h - 2, border);
  // 채움
  rect(ctx, x + 2, y + 2, w - 4, h - 4, fill);
  // 위쪽 하이라이트 1px (light가 null이면 생략)
  if (light) rect(ctx, x + 2, y + 2, w - 4, 1, light);
  // 아래쪽 안쪽 그림자 1px (선택)
  if (opts.innerShadow) rect(ctx, x + 2, y + h - 3, w - 4, 1, opts.innerShadow);
}

// ── 체커보드 디더 (반투명 대용) ─────────────────────────
// 2×2 패턴을 만들어 캔버스 원점 기준으로 정렬해 칠한다 → 화면 전체 디더도 빠르다.
const _patternCache = new WeakMap(); // ctx → Map(key → CanvasPattern)
function getDitherPattern(ctx, color, phase) {
  let m = _patternCache.get(ctx);
  if (!m) { m = new Map(); _patternCache.set(ctx, m); }
  const key = color + '|' + (phase & 1);
  let p = m.get(key);
  if (!p) {
    const c = makeCanvas(2, 2);
    const g = c.getContext('2d');
    g.fillStyle = color;
    if ((phase & 1) === 0) { g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1); } else { g.fillRect(1, 0, 1, 1); g.fillRect(0, 1, 1, 1); }
    p = ctx.createPattern(c, 'repeat');
    m.set(key, p);
  }
  return p;
}
export function dither(ctx, x, y, w, h, color, phase = 0) {
  const iw = ri(w);
  const ih = ri(h);
  if (iw <= 0 || ih <= 0) return;
  ctx.fillStyle = getDitherPattern(ctx, color, phase);
  ctx.fillRect(ri(x), ri(y), iw, ih);
}

// ── 글자 ────────────────────────────────────────────────
// fillText 결과의 알파를 0/255로 이진화한 비트맵을 캐시해서 그린다 → 반투명 픽셀 없음.
const TEXT_PAD = 2; // 글리프가 박스 밖으로 살짝 나가는 경우 대비 여백
const _textCache = new Map(); // key → {canvas, w, h} (LRU: Map 삽입 순서 이용)
let _measureCtx = null;

function fontOf(opts) {
  return FONT[opts && opts.font === 'small' ? 'small' : 'body'];
}
function multOf(opts) {
  const m = Math.round((opts && opts.mult) || 1);
  return m < 1 ? 1 : m;
}
function measureCtx() {
  if (!_measureCtx) _measureCtx = makeCanvas(4, 4).getContext('2d');
  return _measureCtx;
}
// 기준 크기(배율 1) 한 줄 폭
function lineWidth1(str, f) {
  if (!str) return 0;
  const g = measureCtx();
  g.font = f.css;
  return Math.ceil(g.measureText(str).width);
}
function toLines(str) {
  if (Array.isArray(str)) return str.flatMap((s) => String(s ?? '').split('\n'));
  return String(str ?? '').split('\n');
}
function lineGapOf(opts, mult) {
  return opts && opts.lineGap != null ? Math.round(opts.lineGap) : 2 * mult;
}

// 한 줄 비트맵 만들기 (배율 적용, 색 입힘)
function renderLine(str, f, mult, color) {
  const key = str + '|' + f.family + '|' + mult + '|' + color;
  const hit = _textCache.get(key);
  if (hit) {
    // LRU 갱신
    _textCache.delete(key);
    _textCache.set(key, hit);
    return hit;
  }
  const w1 = lineWidth1(str, f);
  const bw = w1 + TEXT_PAD * 2;
  const bh = f.lineH + TEXT_PAD * 2;
  const base = makeCanvas(bw, bh);
  const g = base.getContext('2d', { willReadFrequently: true });
  g.font = f.css;
  g.textBaseline = 'top';
  g.fillStyle = '#ffffff';
  g.fillText(str, TEXT_PAD, TEXT_PAD);
  // 알파 이진화 + 지정 색으로 칠하기
  const img = g.getImageData(0, 0, bw, bh);
  const d = img.data;
  const [r, gg, b] = hexToRgb(color);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= TEXT_ALPHA_THRESHOLD) {
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    } else {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
    }
  }
  g.putImageData(img, 0, 0);
  let canvas = base;
  if (mult > 1) {
    // 정수배 확대 (nearest-neighbor)
    canvas = makeCanvas(bw * mult, bh * mult);
    const g2 = canvas.getContext('2d');
    g2.imageSmoothingEnabled = false;
    g2.drawImage(base, 0, 0, bw * mult, bh * mult);
  }
  const entry = { canvas, w: w1 * mult, h: f.lineH * mult };
  _textCache.set(key, entry);
  // LRU 축출
  while (_textCache.size > TEXT_CACHE_MAX) {
    const first = _textCache.keys().next().value;
    _textCache.delete(first);
  }
  return entry;
}

// maxW를 넘으면 뒤를 잘라 '…'를 붙인다 (배율 1 기준 폭으로 계산)
function fitLine(str, f, mult, maxW) {
  if (!maxW || lineWidth1(str, f) * mult <= maxW) return str;
  const chars = Array.from(str);
  while (chars.length > 0) {
    chars.pop();
    const s = chars.join('') + '…';
    if (lineWidth1(s, f) * mult <= maxW) return s;
  }
  return '';
}

export function clearTextCache() {
  _textCache.clear();
}

// 글자 그리기. str은 문자열·숫자·문자열 배열(여러 줄). 그린 크기 {w,h} 반환.
// opts: {font:'body'|'small', mult, color, align:'left'|'center'|'right', shadow, outline, maxW, lineGap}
export function text(ctx, str, x, y, opts = {}) {
  const f = fontOf(opts);
  const mult = multOf(opts);
  const color = opts.color ?? C.text;
  const align = opts.align || 'left';
  const lines = toLines(str);
  const gap = lineGapOf(opts, mult);
  const lh = f.lineH * mult;
  let maxWdrawn = 0;
  let cy = ri(y);
  const bx = ri(x);
  for (let i = 0; i < lines.length; i++) {
    const line = fitLine(lines[i], f, mult, opts.maxW);
    if (line) {
      const main = renderLine(line, f, mult, color);
      let lx = bx;
      if (align === 'center') lx = bx - Math.floor(main.w / 2);
      else if (align === 'right') lx = bx - main.w;
      const ox = lx - TEXT_PAD * mult;
      const oy = cy - TEXT_PAD * mult;
      if (opts.outline) {
        // 4방향 1단위 외곽선
        const o = renderLine(line, f, mult, opts.outline);
        ctx.drawImage(o.canvas, ox - mult, oy);
        ctx.drawImage(o.canvas, ox + mult, oy);
        ctx.drawImage(o.canvas, ox, oy - mult);
        ctx.drawImage(o.canvas, ox, oy + mult);
      }
      if (opts.shadow) {
        // 오른쪽 아래로 1단위 그림자
        const s = renderLine(line, f, mult, opts.shadow);
        ctx.drawImage(s.canvas, ox + mult, oy + mult);
      }
      ctx.drawImage(main.canvas, ox, oy);
      if (main.w > maxWdrawn) maxWdrawn = main.w;
    }
    cy += lh + (i < lines.length - 1 ? gap : 0);
  }
  return { w: maxWdrawn, h: cy - ri(y) };
}

// 글자 크기 재기 (text와 같은 opts)
export function measure(str, opts = {}) {
  const f = fontOf(opts);
  const mult = multOf(opts);
  const lines = toLines(str);
  const gap = lineGapOf(opts, mult);
  let w = 0;
  for (const l of lines) {
    const line = fitLine(l, f, mult, opts.maxW);
    const lw = lineWidth1(line, f) * mult;
    if (lw > w) w = lw;
  }
  const h = lines.length * f.lineH * mult + Math.max(0, lines.length - 1) * gap;
  return { w, h };
}

// 폭 maxW 안에 들어가도록 줄 나누기 (공백 기준, 긴 단어는 글자 단위로 자름)
export function wrap(str, maxW, opts = {}) {
  const f = fontOf(opts);
  const mult = multOf(opts);
  const out = [];
  const fits = (s) => lineWidth1(s, f) * mult <= maxW;
  for (const para of toLines(str)) {
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      const cand = cur ? cur + ' ' + word : word;
      if (fits(cand)) { cur = cand; continue; }
      if (cur) out.push(cur);
      if (fits(word)) { cur = word; continue; }
      // 한 단어가 너무 길면 글자 단위로 자른다
      cur = '';
      for (const ch of Array.from(word)) {
        if (fits(cur + ch)) cur += ch;
        else { if (cur) out.push(cur); cur = ch; }
      }
    }
    out.push(cur);
  }
  return out;
}

// 폰트 로드 대기. 끝나면 이전에 대체 폰트로 만든 캐시를 비운다.
export async function loadFonts() {
  if (typeof document === 'undefined' || !document.fonts) return false;
  let ok = true;
  try {
    await Promise.all([
      document.fonts.load(FONT.body.css, '가A1'),
      document.fonts.load(FONT.small.css, '가A1'),
    ]);
    await document.fonts.ready;
    ok = document.fonts.check(FONT.body.css, '가') && document.fonts.check(FONT.small.css, '가');
  } catch (e) {
    ok = false;
    console.warn('[draw] 폰트 로드 실패, 기본 폰트로 그립니다', e);
  }
  clearTextCache();
  return ok;
}

// ── 작은 픽셀 기호 ──────────────────────────────────────
// ▶ 커서 (5px 높이 삼각형). dir: 1=오른쪽, -1=왼쪽
export function cursor(ctx, x, y, color = C.accent, dir = 1) {
  x = ri(x); y = ri(y);
  for (let i = 0; i < 3; i++) {
    const h = 5 - i * 2;
    const cx = dir > 0 ? x + i : x + 2 - i;
    rect(ctx, cx, y + i, 1, h, color);
  }
}
// ▲/▼ 삼각형 (폭 5px). dir: -1=위, 1=아래
export function arrowV(ctx, x, y, color = C.accent, dir = -1) {
  x = ri(x); y = ri(y);
  for (let i = 0; i < 3; i++) {
    const w = 5 - i * 2;
    const cy = dir > 0 ? y + i : y + 2 - i;
    rect(ctx, x + i, cy, w, 1, color);
  }
}

// ── 스프라이트 ──────────────────────────────────────────
// spr = {w, h, data: number[] | Uint8Array | number[][]}, 값 = PAL 인덱스, -1/255/null = 투명
const _sprCache = new WeakMap(); // spr → Map(key → canvas)
function sprPixel(spr, i) {
  const d = spr.data;
  if (Array.isArray(d) && Array.isArray(d[0])) {
    const row = d[Math.floor(i / spr.w)];
    return row ? row[i % spr.w] : -1;
  }
  return d[i];
}
function swapKey(swap) {
  if (!swap) return '';
  let k = '';
  for (const [a, b] of swap) k += a + '>' + b + ',';
  return k;
}
function buildSprite(spr, flip, swap) {
  const c = makeCanvas(spr.w, spr.h);
  const g = c.getContext('2d');
  const img = g.createImageData(spr.w, spr.h);
  const d = img.data;
  for (let py = 0; py < spr.h; py++) {
    for (let px = 0; px < spr.w; px++) {
      const sx = flip ? spr.w - 1 - px : px;
      let v = sprPixel(spr, py * spr.w + sx);
      if (v == null || v < 0 || v === 255) continue;
      if (swap && swap.has(v)) v = swap.get(v);
      const hex = PAL[v];
      if (!hex) continue;
      const [r, gg, b] = hexToRgb(hex);
      const o = (py * spr.w + px) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
export function sprite(ctx, spr, x, y, opts = {}) {
  if (!spr || !spr.w || !spr.h) return;
  const flip = !!opts.flip;
  const scale = Math.max(1, Math.round(opts.scale || 1));
  let m = _sprCache.get(spr);
  if (!m) { m = new Map(); _sprCache.set(spr, m); }
  const key = (flip ? 'f' : 'n') + swapKey(opts.swap);
  let c = m.get(key);
  if (!c) { c = buildSprite(spr, flip, opts.swap); m.set(key, c); }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, ri(x), ri(y), spr.w * scale, spr.h * scale);
}
