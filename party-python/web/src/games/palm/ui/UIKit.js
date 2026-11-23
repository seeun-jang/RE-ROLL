// =============================================================
// UIKit.js — 픽셀 UI 부품 (9-slice 패널, 버튼, 균형 게이지, 타이머, 키캡, 아이콘, 차지 게이지)
//   - 모든 그림은 fillRect / drawImage + 정수 좌표, Sweetie 16 색만 사용.
//   - 시간 인자 t 는 "프레임 수"(1/60초) 기준 — 깜빡임/떨림 주기 계산에 사용.
//   - 캔버스(조각 이미지)는 처음 그릴 때 만들어 캐시 → Node에서 import 해도 DOM 접근 없음.
// =============================================================

import { PAL } from '../palette.js';
import { drawText, measureText } from './PixelFont.js';

// ---------------- 공통 헬퍼 ----------------
function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  return null;
}

const ri = Math.round;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// 문자열 배열(픽셀 아트) → 같은 색이 이어지는 가로 구간을 fillRect로 그린다
function blitRows(ctx, rows, colors, x, y) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      const ch = row[c];
      const col = colors[ch];
      if (!col) { c++; continue; }
      let e = c + 1;
      while (e < row.length && row[e] === ch) e++;
      ctx.fillStyle = col;
      ctx.fillRect(x + c, y + r, e - c, 1);
      c = e;
    }
  }
}

// 픽셀 아트를 캔버스로 구워서 캐시 (키: 이름|색 조합)
const spriteCache = new Map();
function getSprite(key, rows, colors) {
  let c = spriteCache.get(key);
  if (c !== undefined) return c;
  c = makeCanvas(rows[0].length, rows.length);
  if (c) {
    const cx = c.getContext('2d');
    blitRows(cx, rows, colors, 0, 0);
  }
  spriteCache.set(key, c);
  return c;
}

// 픽셀 아트 그리기: 캔버스가 있으면 drawImage, 없으면 fillRect로 직접
function drawSprite(ctx, key, rows, colors, x, y) {
  const c = getSprite(key, rows, colors);
  if (c) ctx.drawImage(c, ri(x), ri(y));
  else blitRows(ctx, rows, colors, ri(x), ri(y));
}

// 모서리 반지름 2px 둥근 사각형 실루엣 (그림자/강조 테두리용)
function fillRounded(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  if (w < 5 || h < 5) { ctx.fillRect(x, y, w, h); return; }
  ctx.fillRect(x + 2, y, w - 4, 1);
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  ctx.fillRect(x + 2, y + h - 1, w - 4, 1);
}

// 모서리 1px만 깎은 사각형 (키캡용)
function fillRounded1(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  if (w < 3 || h < 3) { ctx.fillRect(x, y, w, h); return; }
  ctx.fillRect(x + 1, y, w - 2, 1);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
}

// =============================================================
// 9-slice 패널
//   10×10 픽셀 패턴 하나를 정의하고 [모서리 4×4 | 가장자리 2px 타일 | 가운데 단색]으로 자른다.
//   o = 바깥 외곽선, b = 테두리, h = 안쪽 하이라이트(위/왼쪽), s = 안쪽 그늘(아래/오른쪽), f = 채움
// =============================================================
const PATTERN_BEVEL = [
  '..oooooo..',
  '.obbbbbbo.',
  'obhhhhhhbo',
  'obhffffsbo',
  'obhffffsbo',
  'obhffffsbo',
  'obhffffsbo',
  'obssssssbo',
  '.obbbbbbo.',
  '..oooooo..',
];
// 금색(우승) 패널: 이중 테두리가 사방으로 같다
const PATTERN_DOUBLE = [
  '..oooooo..',
  '.obbbbbbo.',
  'obhhhhhhbo',
  'obhffffhbo',
  'obhffffhbo',
  'obhffffhbo',
  'obhffffhbo',
  'obhhhhhhbo',
  '.obbbbbbo.',
  '..oooooo..',
];

const PANEL_STYLES = {
  // 흰 종이 + 남색 외곽선, 아래/오른쪽에 은색 그늘
  default: { pattern: PATTERN_BEVEL, colors: { o: PAL.navy, b: PAL.white, h: PAL.white, f: PAL.white, s: PAL.silver } },
  // 짙은 회색 채움 + 회청 테두리 (위/왼쪽 두껍게 밝음, 아래/오른쪽 어두움)
  dark: { pattern: PATTERN_BEVEL, colors: { o: PAL.ink, b: PAL.slate, h: PAL.slate, f: PAL.charcoal, s: PAL.ink } },
  // 축제 공고문 느낌: 모래색 종이 + 주황 테두리 + 흰 반사광
  paper: { pattern: PATTERN_BEVEL, colors: { o: PAL.plum, b: PAL.orange, h: PAL.white, f: PAL.sand, s: PAL.orange } },
  // 우승자용: 모래/주황 이중 테두리, 흰 채움
  gold: { pattern: PATTERN_DOUBLE, colors: { o: PAL.plum, b: PAL.sand, h: PAL.orange, f: PAL.white } },
  // (내부용) 타이머 경고: 빨강 테두리 + 자주 채움
  alert: { pattern: PATTERN_BEVEL, colors: { o: PAL.ink, b: PAL.red, h: PAL.orange, f: PAL.plum, s: PAL.red } },
};

const C = 4; // 모서리 크기
const EDGE = 2; // 가장자리 타일 폭
const STRIP = 512; // 미리 타일링해 둔 가장자리 띠 길이

const panelCache = new Map();
function getPanelSlices(style) {
  const key = PANEL_STYLES[style] ? style : 'default';
  let p = panelCache.get(key);
  if (p) return p;
  const def = PANEL_STYLES[key];
  const src = makeCanvas(10, 10);
  if (!src) return null;
  blitRows(src.getContext('2d'), def.pattern, def.colors, 0, 0);
  // 가장자리 띠를 2px 조각 반복(타일링)으로 길게 만들어 둔다 — 늘이기(스케일) 금지
  const top = makeCanvas(STRIP, C);
  const bottom = makeCanvas(STRIP, C);
  const left = makeCanvas(C, STRIP);
  const right = makeCanvas(C, STRIP);
  const tc = top.getContext('2d');
  const bc = bottom.getContext('2d');
  const lc = left.getContext('2d');
  const rc = right.getContext('2d');
  for (let i = 0; i < STRIP; i += EDGE) {
    tc.drawImage(src, C, 0, EDGE, C, i, 0, EDGE, C);
    bc.drawImage(src, C, 10 - C, EDGE, C, i, 0, EDGE, C);
    lc.drawImage(src, 0, C, C, EDGE, 0, i, C, EDGE);
    rc.drawImage(src, 10 - C, C, C, EDGE, 0, i, C, EDGE);
  }
  p = { src, top, bottom, left, right, fill: def.colors.f };
  panelCache.set(key, p);
  return p;
}

// 길이 len 만큼 띠를 이어 그림 (STRIP보다 길면 여러 번)
function drawStripH(ctx, strip, x, y, len) {
  for (let o = 0; o < len; o += STRIP) {
    const seg = Math.min(STRIP, len - o);
    ctx.drawImage(strip, 0, 0, seg, C, x + o, y, seg, C);
  }
}
function drawStripV(ctx, strip, x, y, len) {
  for (let o = 0; o < len; o += STRIP) {
    const seg = Math.min(STRIP, len - o);
    ctx.drawImage(strip, 0, 0, C, seg, x, y + o, C, seg);
  }
}

// 9-slice 픽셀 테두리 박스
export function drawPanel(ctx, x, y, w, h, style = 'default') {
  const px = ri(x), py = ri(y);
  const pw = Math.max(C * 2, ri(w));
  const ph = Math.max(C * 2, ri(h));
  const sl = getPanelSlices(style);
  if (!sl) return;
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const iw = pw - C * 2;
  const ih = ph - C * 2;
  // 가운데 단색 채움
  if (iw > 0 && ih > 0) {
    ctx.fillStyle = sl.fill;
    ctx.fillRect(px + C, py + C, iw, ih);
  }
  // 가장자리 (타일링)
  if (iw > 0) {
    drawStripH(ctx, sl.top, px + C, py, iw);
    drawStripH(ctx, sl.bottom, px + C, py + ph - C, iw);
  }
  if (ih > 0) {
    drawStripV(ctx, sl.left, px, py + C, ih);
    drawStripV(ctx, sl.right, px + pw - C, py + C, ih);
  }
  // 네 모서리
  ctx.drawImage(sl.src, 0, 0, C, C, px, py, C, C);
  ctx.drawImage(sl.src, 10 - C, 0, C, C, px + pw - C, py, C, C);
  ctx.drawImage(sl.src, 0, 10 - C, C, C, px, py + ph - C, C, C);
  ctx.drawImage(sl.src, 10 - C, 10 - C, C, C, px + pw - C, py + ph - C, C, C);
  ctx.imageSmoothingEnabled = prev;
}

// =============================================================
// 버튼
// =============================================================
const LABEL_COLORS = {
  default: PAL.ink,
  dark: PAL.white,
  paper: PAL.plum,
  gold: PAL.plum,
  alert: PAL.white,
};

// 포커스 커서 ▶ (외곽선 + 모래색)
const CURSOR_ROWS = [
  'oo...',
  'oso..',
  'osso.',
  'ossso',
  'osso.',
  'oso..',
  'oo...',
];
const CURSOR_COLORS = { o: PAL.ink, s: PAL.sand };

export class Button {
  constructor({ x, y, w, h, label, font = 'm', style = 'default' }) {
    this.x = ri(x || 0);
    this.y = ri(y || 0);
    this.w = ri(w || 64);
    this.h = ri(h || 18);
    this.label = label == null ? '' : String(label);
    this.font = font;
    this.style = style;
    // 상태 플래그 (외부에서 설정)
    this.hover = false;
    this.pressed = false;
    this.focused = false;
    this.disabled = false;
  }

  contains(px, py) {
    return px >= this.x && px < this.x + this.w && py >= this.y && py < this.y + this.h;
  }

  draw(ctx, t = 0) {
    const { x, w, h } = this;
    const dis = this.disabled;
    const pressed = this.pressed && !dis;
    const dy = pressed ? 2 : 0; // 눌리면 2px 아래로
    const y = this.y + dy;
    const ft = Math.floor(t);

    // 1) 그림자 (2px 아래 실루엣). 눌린 상태/비활성은 그림자 없음
    if (!pressed && !dis) fillRounded(ctx, x, y + 2, w, h, PAL.ink);

    // 2) 강조 테두리: 포커스 = 모래색↔흰색 깜빡임, 호버 = 흰색
    if (!dis && this.focused) {
      const ring = Math.floor(ft / 16) % 2 === 0 ? PAL.sand : PAL.white;
      fillRounded(ctx, x - 1, y - 1, w + 2, h + 2 + (pressed ? 0 : 2), ring);
      if (!pressed) fillRounded(ctx, x, y + 2, w, h, PAL.ink);
    } else if (!dis && this.hover) {
      fillRounded(ctx, x - 1, y - 1, w + 2, h + 2 + (pressed ? 0 : 2), PAL.white);
      if (!pressed) fillRounded(ctx, x, y + 2, w, h, PAL.ink);
    }

    // 3) 본체 패널
    drawPanel(ctx, x, y, w, h, dis ? 'dark' : this.style);

    // 4) 라벨 (가운데 정렬)
    const m = measureText(this.label, this.font);
    const color = dis ? PAL.slate : (LABEL_COLORS[this.style] || PAL.ink);
    const ly = y + Math.floor((h - m.h) / 2);
    drawText(ctx, this.label, x + Math.floor(w / 2), ly, { font: this.font, color, align: 'center' });

    // 5) 포커스 커서 ▶ (왼쪽에서 통통 튐)
    if (!dis && this.focused) {
      const bob = Math.floor(ft / 10) % 2;
      drawSprite(ctx, 'cursor', CURSOR_ROWS, CURSOR_COLORS, x - 8 + bob, y + Math.floor((h - 7) / 2));
    }
  }
}

// =============================================================
// 균형 게이지
//   [물방울 캡][================ 바 ================][물방울 캡]
//   전체 높이 11px (테두리 9px + 아래 눈금 2px), 마커(작은 사람)는 y-1부터.
// =============================================================
const GAUGE_H = 9;
const CAP = 7; // 양 끝 '발 떨어짐' 캡 폭 (구분선 포함)

// 구간별 색: [하이라이트, 본색, 그늘]
const ZONES = [
  { max: 30, hi: PAL.lime, main: PAL.green, lo: PAL.teal },
  { max: 55, hi: PAL.white, main: PAL.sand, lo: PAL.orange },
  { max: 80, hi: PAL.sand, main: PAL.orange, lo: PAL.red },
  { max: Infinity, hi: PAL.orange, main: PAL.red, lo: PAL.plum },
];
function zoneIndex(absV) {
  for (let i = 0; i < ZONES.length; i++) if (absV < ZONES[i].max) return i;
  return ZONES.length - 1;
}

// 물방울 아이콘 (5×5) — "여기까지 밀리면 풍덩!"
const DROP_ROWS = [
  '..b..',
  '.bbb.',
  'bbbbb',
  'bwbbb',
  '.bbb.',
];

// 마커: 작은 사람 (7×9). c = 몸 색(인자 color), s = 얼굴(피부), o = 외곽선
const FIGURE_ROWS = [
  '..ooo..',
  '.osssu.',
  '.osssu.',
  'ooooooo',
  'occccco',
  'oocccoo',
  '.occco.',
  '.ococo.',
  '.ooooo.',
];

export function drawBalanceGauge(ctx, x, y, w, screenValue, { danger = 0, t = 0, color = PAL.white } = {}) {
  const gx = ri(x), gy = ri(y);
  const gw = Math.max(CAP * 2 + 20, ri(w));
  const ft = Math.floor(t);
  const v = clamp(Number.isFinite(screenValue) ? screenValue : 0, -100, 100);
  const dz = clamp(danger || 0, 0, 1);
  const flash = dz > 0.6 && Math.floor(ft / 4) % 2 === 0; // 위험하면 테두리 깜빡

  // 1) 전체 테두리 (둥근 사각형)
  fillRounded1(ctx, gx, gy, gw, GAUGE_H, flash ? PAL.red : PAL.ink);

  // 2) 바 내부 (구간별 단색 블록 + 위 하이라이트 1줄 + 아래 그늘 1줄)
  const bx = gx + CAP;
  const bw = gw - CAP * 2;
  const by = gy + 1;
  let runStart = 0;
  let runZone = -1;
  const flushRun = (end) => {
    if (runZone < 0 || end <= runStart) return;
    const z = ZONES[runZone];
    ctx.fillStyle = z.hi;
    ctx.fillRect(bx + runStart, by, end - runStart, 1);
    ctx.fillStyle = z.main;
    ctx.fillRect(bx + runStart, by + 1, end - runStart, 5);
    ctx.fillStyle = z.lo;
    ctx.fillRect(bx + runStart, by + 6, end - runStart, 1);
  };
  for (let i = 0; i < bw; i++) {
    const val = bw > 1 ? (i / (bw - 1)) * 200 - 100 : 0;
    const zi = zoneIndex(Math.abs(val));
    if (zi !== runZone) {
      flushRun(i);
      runStart = i;
      runZone = zi;
    }
  }
  flushRun(bw);

  // 가운데(0) 점선 표시
  const centerX = bx + Math.round((bw - 1) / 2);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(centerX, by + 1, 1, 1);
  ctx.fillRect(centerX, by + 3, 1, 1);
  ctx.fillRect(centerX, by + 5, 1, 1);

  // 3) 양 끝 캡: 구분선 + 물방울. 마커가 그쪽 끝에 가까우면 빨갛게 깜빡
  const drawCap = (cx0, side) => {
    const near = side < 0 ? v < -70 : v > 70;
    const alarm = near && Math.floor(ft / 6) % 2 === 0;
    ctx.fillStyle = alarm ? PAL.red : PAL.charcoal;
    ctx.fillRect(cx0, by, CAP - 2, 7);
    drawSprite(ctx, 'drop', DROP_ROWS, { b: PAL.sky, w: PAL.white }, cx0, by + 1);
  };
  drawCap(gx + 1, -1);
  drawCap(gx + gw - CAP + 1, 1);
  // 캡과 바 사이 구분선
  ctx.fillStyle = flash ? PAL.red : PAL.ink;
  ctx.fillRect(gx + CAP - 1, by, 1, 7);
  ctx.fillRect(gx + gw - CAP, by, 1, 7);

  // 4) 눈금 (25 단위, 바 아래 2줄). 가운데/양 끝은 2px, 나머지는 1px
  for (let k = -100; k <= 100; k += 25) {
    const tx = bx + Math.round(((k + 100) / 200) * (bw - 1));
    const tall = k === 0 || k === -100 || k === 100;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(tx, gy + GAUGE_H, 1, tall ? 2 : 1);
  }

  // 5) 마커 (작은 사람). danger>0.6이면 ±1px 떨림
  let jx = 0;
  if (dz > 0.6) jx = [0, 1, 0, -1][Math.floor(ft / 2) % 4];
  const mx = bx + Math.round(((v + 100) / 200) * (bw - 1)) + jx;
  drawSprite(ctx, `fig|${color}`, FIGURE_ROWS,
    { o: PAL.ink, s: PAL.sand, u: PAL.orange, c: color }, mx - 3, gy - 1);
}

// =============================================================
// 타이머 (중앙 정렬, 2자리 초)
// =============================================================
export function drawTimer(ctx, cx, y, seconds, { t = 0, warn = false } = {}) {
  const secs = Math.max(0, Math.min(99, Math.ceil(Number.isFinite(seconds) ? seconds : 0)));
  const text = String(secs).padStart(2, '0');
  const m = measureText('00', 'l');
  const bw = Math.max(26, m.w + 12);
  const bh = Math.max(8, m.h + 8);
  const bx = ri(cx) - Math.floor(bw / 2);
  const by = ri(y);
  const blinkOn = warn && Math.floor(Math.floor(t) / 10) % 2 === 0;
  drawPanel(ctx, bx, by, bw, bh, blinkOn ? 'alert' : 'dark');
  const color = warn ? (blinkOn ? PAL.white : PAL.red) : PAL.white;
  drawText(ctx, text, bx + Math.floor(bw / 2), by + Math.floor((bh - m.h) / 2),
    { font: 'l', color, align: 'center', shadow: PAL.ink });
}

// =============================================================
// 키캡 (조작 안내용). 반환값 = 폭
// =============================================================
export function drawKeyCap(ctx, x, y, label, { pressed = false, w } = {}) {
  const text = label == null ? '' : String(label);
  const m = measureText(text, 's');
  const faceH = m.h + 4; // 윗면(외곽선 포함) 높이
  const kw = Math.max(faceH, w != null ? ri(w) : m.w + 6);
  const kx = ri(x);
  const top = ri(y) + (pressed ? 1 : 0);
  const side = pressed ? 1 : 2; // 옆면 두께
  const H = faceH + side;
  fillRounded1(ctx, kx, top, kw, H, PAL.ink);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(kx + 1, top + 1, kw - 2, faceH - 2);
  ctx.fillStyle = PAL.silver;
  ctx.fillRect(kx + 1, top + faceH - 1, kw - 2, side);
  drawText(ctx, text, kx + Math.floor(kw / 2), top + 1 + Math.floor((faceH - 2 - m.h) / 2),
    { font: 's', color: PAL.ink, align: 'center' });
  return kw;
}

// =============================================================
// 8×8 아이콘
// =============================================================
const ICONS = {
  speaker: [
    '...#....',
    '..##..#.',
    '####...#',
    '####.#.#',
    '####.#.#',
    '####...#',
    '..##..#.',
    '...#....',
  ],
  mute: [
    '...#....',
    '..##....',
    '####.#.#',
    '####..#.',
    '####..#.',
    '####.#.#',
    '..##....',
    '...#....',
  ],
  pause: [
    '........',
    '.##..##.',
    '.##..##.',
    '.##..##.',
    '.##..##.',
    '.##..##.',
    '.##..##.',
    '........',
  ],
  star: [
    '...##...',
    '...##...',
    '########',
    '.######.',
    '..####..',
    '.######.',
    '.##..##.',
    '##....##',
  ],
  crown: [
    '........',
    '#..##..#',
    '##.##.##',
    '########',
    '#.####.#',
    '########',
    '########',
    '........',
  ],
};

export function drawIcon(ctx, name, x, y, color = PAL.white) {
  const rows = ICONS[name];
  if (!rows) return;
  drawSprite(ctx, `icon|${name}|${color}`, rows, { '#': color }, x, y);
}

// =============================================================
// 차지 게이지 (머리 위, 채움 영역 12×3 at (x,y), 바깥 1px 외곽선)
//   위치별 색: 앞 4칸 모래 → 중간 4칸 주황 → 끝 4칸 빨강. 가득 차면 흰색으로 번쩍.
// =============================================================
export function drawChargeMeter(ctx, x, y, level0to1, { t = 0 } = {}) {
  const mx = ri(x), my = ri(y);
  const lv = clamp(Number.isFinite(level0to1) ? level0to1 : 0, 0, 1);
  const filled = Math.round(lv * 12);
  const full = lv >= 1;
  const flashWhite = full && Math.floor(Math.floor(t) / 3) % 2 === 0;
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(mx - 1, my - 1, 14, 5);
  ctx.fillStyle = PAL.charcoal;
  ctx.fillRect(mx, my, 12, 3);
  for (let i = 0; i < filled; i++) {
    let col = i < 4 ? PAL.sand : i < 8 ? PAL.orange : PAL.red;
    if (flashWhite) col = PAL.white;
    ctx.fillStyle = col;
    ctx.fillRect(mx + i, my, 1, 3);
  }
  // 위쪽 1줄 반사광 (채워진 부분만, 번쩍일 때는 생략)
  if (filled > 0 && !flashWhite) {
    ctx.fillStyle = PAL.white;
    ctx.fillRect(mx, my, Math.min(filled, 2), 1);
  }
}
