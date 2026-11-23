// =============================================================
// PixelFont.js — 갈무리(Galmuri, OFL) 픽셀 폰트를 1비트로 또렷하게 그리는 모듈
//   - 320×180 캔버스를 CSS로 확대하므로 글자에 회색(안티앨리어싱) 픽셀이 있으면 번져 보인다.
//   - 그래서 오프스크린 캔버스에 원래 크기로 fillText → 알파 임계값으로 0/255 이진화 →
//     원하는 색으로 다시 칠한 비트맵을 캐시하고, 정수 좌표에 drawImage 한다.
//   - Node 등 DOM이 없는 환경에서 import 해도 터지지 않도록, DOM 접근은 전부 함수 안에서 지연 처리.
// =============================================================

import { CONFIG } from '../config.js';
import { PAL } from '../palette.js';

// 폰트 3종 (갈무리 권장 픽셀 크기)
export const FONTS = {
  s: { family: 'Galmuri9', size: 10 },
  m: { family: 'Galmuri11', size: 12 },
  l: { family: 'Galmuri14', size: 15 },
};

const ALPHA_THRESHOLD = 128; // (슈퍼샘플링 후) 알파 >= 128 → 255, 그 외 → 0
const PAD = 4; // 오프스크린 렌더링 여백 (글리프 삐침 대비)
const MARGIN = 2; // 외곽선/그림자용 합성 캔버스 여백
const CACHE_LIMIT = 400; // LRU 최대 항목 수
const REF_SAMPLE = '가한A1'; // 줄 높이(잉크 기준) 측정용 기준 문자열 (내림자 제외)
const OUTLINE_DIRS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

// ---------------- 작은 LRU 캐시 ----------------
class LRU {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
  }
  get(key) {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // 최근 사용으로 갱신 (Map은 삽입 순서를 유지하므로 지웠다 다시 넣는다)
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, v) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, v);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
}

const maskCache = new LRU(CACHE_LIMIT); // 키: line|font → 흰색 1비트 마스크
const drawCache = new LRU(CACHE_LIMIT); // 키: line|font|color|outline|shadow → 완성 비트맵
const metricsCache = new Map(); // 키: font → { top, h }

let fontsReady = false;
let fontEventHooked = false;
let scratch = null; // { canvas, ctx } 측정/렌더링용 재사용 캔버스

// ---------------- 환경 헬퍼 ----------------
function hasCanvas() {
  return (typeof document !== 'undefined' && typeof document.createElement === 'function') ||
    typeof OffscreenCanvas !== 'undefined';
}

function makeCanvas(w, h) {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(cw, ch);
  return null;
}

function getScratch(w, h) {
  if (!scratch) {
    const canvas = makeCanvas(64, 32);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    scratch = { canvas, ctx };
  }
  const { canvas } = scratch;
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  // 크기를 바꾸면 내용과 상태가 초기화된다 → 필요할 때만 키운다
  if (canvas.width < cw || canvas.height < ch) {
    canvas.width = Math.max(canvas.width, cw);
    canvas.height = Math.max(canvas.height, ch);
  }
  return scratch;
}

function fontSpec(font) {
  return FONTS[font] || FONTS.m;
}

// ---------------- 1비트 마스크 생성 ----------------
// 한 줄 텍스트를 흰색으로 그려 알파를 이진화하고, 잉크(실제 픽셀) 좌우 경계로 잘라낸다.
// 브라우저/OS에 따라 작은 크기의 픽셀 폰트도 세로획이 반투명하게 번져서(특히 흰 글씨) 그대로 임계값을
// 적용하면 획이 뭉개진다. 그래서 SS배 크게 그린 뒤 각 SS×SS 블록의 "중심 픽셀"만 샘플링해 1비트로 만든다.
const SS = 4;
function renderRawMask(line, spec) {
  const font = `${spec.size * SS}px "${spec.family}", "Galmuri11", "DungGeunMo", monospace`;
  let s = getScratch(8, 8);
  if (!s) return null;
  s.ctx.font = font;
  const adv = (s.ctx.measureText(line).width || 0) / SS;
  const W = Math.ceil(adv) + PAD * 2 + spec.size; // 기울어진 글리프 삐침 여유
  const H = spec.size + PAD * 2;
  s = getScratch(W * SS, H * SS);
  const { ctx } = s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W * SS, H * SS);
  ctx.font = font; // 캔버스 크기 변경 시 상태가 초기화되므로 다시 지정
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(line, PAD * SS, PAD * SS);
  const big = ctx.getImageData(0, 0, W * SS, H * SS).data;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const half = SS >> 1;
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      d[(yy * W + xx) * 4 + 3] = big[((yy * SS + half) * W * SS + xx * SS + half) * 4 + 3];
    }
  }
  let inkL = W, inkR = -1, inkT = H, inkB = -1;
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      if (d[i + 3] >= ALPHA_THRESHOLD) {
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
        if (xx < inkL) inkL = xx;
        if (xx > inkR) inkR = xx;
        if (yy < inkT) inkT = yy;
        if (yy > inkB) inkB = yy;
      } else {
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
      }
    }
  }
  return { img, W, H, adv: Math.round(adv), inkL, inkR, inkT, inkB };
}

// 폰트별 기준 잉크 상단/높이 — y 좌표를 "글자 눈에 보이는 상단"으로 맞추기 위함
function getMetrics(font) {
  const key = FONTS[font] ? font : 'm';
  const hit = metricsCache.get(key);
  if (hit) return hit;
  const spec = fontSpec(key);
  let m;
  const raw = hasCanvas() ? renderRawMask(REF_SAMPLE, spec) : null;
  if (raw && raw.inkB >= raw.inkT) {
    m = { top: raw.inkT, h: raw.inkB - raw.inkT + 1 };
  } else {
    // DOM 없음/폰트 없음: 대략적인 값
    m = { top: PAD + 1, h: spec.size - 2 };
  }
  metricsCache.set(key, m);
  return m;
}

// 대략적인 폭 추정 (캔버스가 없는 환경용): 한글/전각 = size, 그 외 = size/2
function estimateWidth(line, spec) {
  let w = 0;
  for (const ch of line) {
    const code = ch.codePointAt(0);
    w += code > 0x2e7f ? spec.size - 1 : Math.ceil(spec.size / 2);
  }
  return w;
}

// 마스크 항목: { canvas(흰색 1비트, 잉크 좌우로 잘림, 높이 H), w(잉크 폭), H }
function getMask(line, font) {
  const key = `${line}|${font}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  const spec = fontSpec(font);
  let entry;
  if (!hasCanvas()) {
    entry = { canvas: null, w: estimateWidth(line, spec), H: spec.size + PAD * 2 };
  } else {
    const raw = renderRawMask(line, spec);
    if (!raw || raw.inkR < raw.inkL) {
      // 공백만 있는 줄 등: 잉크 없음 → 진행 폭만 사용
      entry = { canvas: null, w: raw ? raw.adv : estimateWidth(line, spec), H: spec.size + PAD * 2 };
    } else {
      const w = raw.inkR - raw.inkL + 1;
      const s = getScratch(raw.W, raw.H);
      s.ctx.putImageData(raw.img, 0, 0);
      const c = makeCanvas(w, raw.H);
      const cctx = c.getContext('2d');
      cctx.imageSmoothingEnabled = false;
      cctx.drawImage(s.canvas, raw.inkL, 0, w, raw.H, 0, 0, w, raw.H);
      entry = { canvas: c, w, H: raw.H };
    }
  }
  maskCache.set(key, entry);
  return entry;
}

// 흰색 마스크를 단색으로 칠한 캔버스 (source-in 합성: 알파가 0/255라 색이 정확히 유지됨)
function tintMask(mask, color) {
  const c = makeCanvas(mask.canvas.width, mask.canvas.height);
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(mask.canvas, 0, 0);
  cx.globalCompositeOperation = 'source-in';
  cx.fillStyle = color;
  cx.fillRect(0, 0, c.width, c.height);
  cx.globalCompositeOperation = 'source-over';
  return c;
}

// 색/외곽선/그림자까지 합성한 최종 비트맵 (여백 MARGIN 포함)
function getGlyphBitmap(line, font, color, outline, shadow) {
  const key = `${line}|${font}|${color}|${outline || ''}|${shadow || ''}`;
  const hit = drawCache.get(key);
  if (hit) return hit;
  const mask = getMask(line, font);
  if (!mask.canvas) {
    const e = { canvas: null, w: mask.w };
    drawCache.set(key, e);
    return e;
  }
  const mw = mask.canvas.width;
  const mh = mask.canvas.height;
  const c = makeCanvas(mw + MARGIN * 2, mh + MARGIN * 2);
  const cx = c.getContext('2d');
  cx.imageSmoothingEnabled = false;
  // 1) 그림자 (오른쪽 아래 1px). 외곽선이 있으면 외곽선 모양 전체를 1px 밀어서 그린다.
  if (shadow) {
    const sc = tintMask(mask, shadow);
    if (outline) {
      for (const [dx, dy] of OUTLINE_DIRS) cx.drawImage(sc, MARGIN + dx + 1, MARGIN + dy + 1);
    }
    cx.drawImage(sc, MARGIN + 1, MARGIN + 1);
  }
  // 2) 8방향 1px 외곽선
  if (outline) {
    const oc = tintMask(mask, outline);
    for (const [dx, dy] of OUTLINE_DIRS) cx.drawImage(oc, MARGIN + dx, MARGIN + dy);
  }
  // 3) 본문
  cx.drawImage(tintMask(mask, color), MARGIN, MARGIN);
  const e = { canvas: c, w: mask.w };
  drawCache.set(key, e);
  return e;
}

function splitLines(text) {
  return String(text == null ? '' : text).split('\n');
}

// ---------------- 공개 API ----------------

// 갈무리 CSS를 붙이고 3종 폰트가 준비될 때까지 기다린다. 실패/타임아웃이면 false (폴백 폰트 사용).
export async function loadFonts({ cssUrl = CONFIG.FONT.CSS_URL, timeoutMs = CONFIG.FONT.LOAD_TIMEOUT_MS || 2500 } = {}) {
  if (typeof document === 'undefined' || !document.head) return false;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const remaining = () => Math.max(0, deadline - Date.now());
  const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve('timeout'), ms));

  try {
    // 늦게라도 폰트가 다 받아지면 캐시를 비워 진짜 폰트로 다시 그리게 한다
    if (!fontEventHooked && document.fonts && typeof document.fonts.addEventListener === 'function') {
      fontEventHooked = true;
      document.fonts.addEventListener('loadingdone', () => clearTextCache());
    }

    // 1) <link rel=stylesheet> 추가 (이미 있으면 재사용). cssUrl 이 없으면 페이지가 이미 폰트를 불러온 것으로 본다
    if (cssUrl) {
      let link = null;
      for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
        if (l.getAttribute('href') === cssUrl || l.href === cssUrl) { link = l; break; }
      }
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl;
        link.setAttribute('data-palm-push-font', '1');
        document.head.appendChild(link);
      }
      if (!link.sheet) {
        const linkReady = new Promise((resolve) => {
          link.addEventListener('load', () => resolve('load'), { once: true });
          link.addEventListener('error', () => resolve('error'), { once: true });
        });
        const r = await Promise.race([linkReady, timeout(remaining())]);
        if (r !== 'load' && !link.sheet) return false;
      }
    }

    // 2) 폰트 3종 실제 다운로드 대기
    if (!document.fonts || typeof document.fonts.load !== 'function') return false;
    const loads = Promise.all(Object.values(FONTS).map((spec) =>
      document.fonts.load(`${spec.size}px "${spec.family}"`, '가A1').then(
        (faces) => Array.isArray(faces) && faces.length > 0 && faces.every((f) => f.status === 'loaded'),
        () => false,
      )));
    const result = await Promise.race([loads, timeout(remaining())]);
    if (!Array.isArray(result) || !result.every(Boolean)) return false;

    fontsReady = true;
    clearTextCache(); // 폴백 폰트로 만들어진 비트맵 폐기
    return true;
  } catch (err) {
    return false;
  }
}

// 폰트가 준비됐는지 (디버그용 보조 export)
export function isFontReady() {
  return fontsReady;
}

// 텍스트를 1비트 픽셀로 그린다. y는 글자(잉크) 상단. 반환값은 (가장 긴 줄의) 폭 × scale.
export function drawText(ctx, text, x, y, {
  font = 'm', color = PAL.white, align = 'left', shadow = null, outline = null, scale = 1, lineGap = 2,
} = {}) {
  const fkey = FONTS[font] ? font : 'm';
  const sc = Math.max(1, Math.round(scale) || 1);
  const lines = splitLines(text);
  const metrics = getMetrics(fkey);
  const lineStep = metrics.h + lineGap; // 원본 픽셀 기준 줄 간격
  const ix = Math.round(x);
  const iy = Math.round(y);
  let maxW = 0;

  const canDraw = ctx && typeof ctx.drawImage === 'function' && hasCanvas();
  const prevSmooth = canDraw ? ctx.imageSmoothingEnabled : false;
  if (canDraw) ctx.imageSmoothingEnabled = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!canDraw) {
      maxW = Math.max(maxW, getMask(line, fkey).w);
      continue;
    }
    const bmp = getGlyphBitmap(line, fkey, color, outline, shadow);
    const lw = bmp.w;
    if (lw > maxW) maxW = lw;
    if (!bmp.canvas) continue;
    // 정렬: 잉크 폭 기준으로 픽셀 단위 정확하게
    let lx = ix;
    if (align === 'center') lx = ix - Math.floor((lw * sc) / 2);
    else if (align === 'right') lx = ix - lw * sc;
    const ly = iy + li * lineStep * sc;
    const dx = lx - MARGIN * sc;
    const dy = ly - (metrics.top + MARGIN) * sc;
    if (sc === 1) {
      ctx.drawImage(bmp.canvas, dx, dy);
    } else {
      ctx.drawImage(bmp.canvas, dx, dy, bmp.canvas.width * sc, bmp.canvas.height * sc);
    }
  }

  if (canDraw) ctx.imageSmoothingEnabled = prevSmooth;
  return maxW * sc;
}

// 텍스트 크기 (scale 1, lineGap 2 기준). w = 가장 긴 줄의 잉크 폭, h = 잉크 기준 전체 높이
export function measureText(text, font = 'm') {
  const fkey = FONTS[font] ? font : 'm';
  const lines = splitLines(text);
  const metrics = getMetrics(fkey);
  let w = 0;
  for (const line of lines) w = Math.max(w, getMask(line, fkey).w);
  const h = lines.length * metrics.h + (lines.length - 1) * 2;
  return { w, h };
}

// 모든 텍스트 비트맵 캐시를 비운다 (폰트 로드 완료 시 자동 호출)
export function clearTextCache() {
  maskCache.clear();
  drawCache.clear();
  metricsCache.clear();
}
