// =============================================================
// UI — 텍스트(Galmuri, 1비트 선명화 캐시), 9-slice 픽셀 박스, 키캡, 아이콘.
// 모든 DOM 접근(캔버스 생성·폰트 확인)은 메서드 안에서만 한다.
// DOM 이 없는 환경(Node 테스트)에서는 비트맵 폰트·fillRect 로 대체해 그린다.
// =============================================================
import { PALETTE, C, shadeOf } from '../palette.js';
import { drawBitmapText, measureBitmapText } from './PixelFont.js';

const TEXT_CACHE_LIMIT = 400;     // 텍스트 캔버스 캐시 최대 개수 (LRU 비슷하게 오래된 것부터 버림)
const MEASURE_CACHE_LIMIT = 1000; // 폭 측정 캐시 최대 개수
const ALPHA_THRESHOLD = 128;      // 알파 임계값: 이 이상이면 불투명, 미만이면 투명 (1비트 선명화)
const TEXT_PAD = 3;               // 오프스크린 텍스트 캔버스 여백 (외곽선·그림자·글리프 삐침용)
const FONT_RECHECK_MS = 250;      // 웹폰트 로딩 여부 재확인 간격 (ms)
const SLICE = 3;                  // 9-slice 조각 크기 (px)
const KEYCAP_FACE_H = 9;          // 키캡 윗면 높이 (글자 7 + 위아래 1px)
const KEYCAP_H = 13;              // 키캡 전체 높이 (외곽 1 + 윗면 9 + 립 2 + 외곽 1)
const KEYCAP_MIN_W = 9;           // 키캡 최소 폭
const DARK_LUMA = 110;            // 이 밝기 미만의 키캡 색이면 글자를 흰색으로

const P = PALETTE;

/**
 * 9-slice 박스 스타일 표.
 * fill: 면, hl: 안쪽 위/왼쪽 하이라이트 1px, shade: 안쪽 아래/오른쪽 그림자, shadeRows: 아래 그림자 두께,
 * text/textShadow: 이 박스 위에 올릴 글자 색 권장값.
 */
const BOX_STYLES = Object.freeze({
  panel: Object.freeze({ fill: P[C.YELLOW], hl: P[C.WHITE], shade: P[C.ORANGE], shadeRows: 1, text: P[C.INK], textShadow: null }),
  dark: Object.freeze({ fill: P[C.CHARCOAL], hl: P[C.SLATE], shade: P[C.NAVY], shadeRows: 1, text: P[C.WHITE], textShadow: P[C.INK] }),
  red: Object.freeze({ fill: P[C.RED], hl: P[C.ORANGE], shade: P[C.PLUM], shadeRows: 1, text: P[C.WHITE], textShadow: P[C.PLUM] }),
  blue: Object.freeze({ fill: P[C.BLUE], hl: P[C.SKY], shade: P[C.NAVY], shadeRows: 1, text: P[C.WHITE], textShadow: P[C.NAVY] }),
  gold: Object.freeze({ fill: P[C.YELLOW], hl: P[C.WHITE], shade: P[C.ORANGE], shadeRows: 2, text: P[C.INK], textShadow: null }),
  paper: Object.freeze({ fill: P[C.WHITE], hl: P[C.WHITE], shade: P[C.SILVER], shadeRows: 1, text: P[C.INK], textShadow: null }),
  // 팀 색 테두리 + 어두운 면 (하단 플레이어 패널·피버 레인용 추가 스타일)
  darkRed: Object.freeze({ fill: P[C.CHARCOAL], hl: P[C.RED], shade: P[C.PLUM], shadeRows: 1, text: P[C.WHITE], textShadow: P[C.INK] }),
  darkBlue: Object.freeze({ fill: P[C.CHARCOAL], hl: P[C.BLUE], shade: P[C.NAVY], shadeRows: 1, text: P[C.WHITE], textShadow: P[C.INK] }),
});

/** DOM(캔버스) 사용 가능 여부 — 메서드 안에서만 호출 */
function hasDom() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** 오프스크린 캔버스 생성 (메서드 안에서만 호출됨) */
function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, w | 0);
  cv.height = Math.max(1, h | 0);
  return cv;
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/** '#rgb' / '#rrggbb' → [r,g,b] (형식이 다르면 null) */
function parseHex(color) {
  if (typeof color !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 9-slice 박스를 fillRect 로 직접 그린다 (원본 조각 캔버스 생성 + 작은 박스·DOM 없는 환경 대체용).
 * 칠하는 순서 = 우선순위 낮은 것부터: 면 → 왼쪽 하이라이트 → 위 하이라이트 → 오른쪽 그림자 → 아래 그림자.
 */
function drawBoxRects(g, x, y, w, h, st) {
  if (w <= 0 || h <= 0) return;
  if (w < 3 || h < 3) {
    g.fillStyle = P[C.INK];
    g.fillRect(x, y, w, h);
    return;
  }
  const ink = P[C.INK];
  // 외곽 1px INK — 모서리 1px 깎아서 둥근 픽셀 모서리
  g.fillStyle = ink;
  g.fillRect(x + 1, y, w - 2, 1);
  g.fillRect(x + 1, y + h - 1, w - 2, 1);
  g.fillRect(x, y + 1, 1, h - 2);
  g.fillRect(x + w - 1, y + 1, 1, h - 2);
  const iw = w - 2, ih = h - 2;
  // 면
  g.fillStyle = st.fill;
  g.fillRect(x + 1, y + 1, iw, ih);
  if (iw < 2 || ih < 2) return;
  // 하이라이트 (왼쪽, 위)
  g.fillStyle = st.hl;
  g.fillRect(x + 1, y + 1, 1, ih);
  g.fillRect(x + 1, y + 1, iw, 1);
  // 그림자 (오른쪽, 아래)
  g.fillStyle = st.shade;
  g.fillRect(x + w - 2, y + 1, 1, ih);
  const rows = Math.max(1, Math.min(st.shadeRows || 1, ih - 1));
  g.fillRect(x + 1, y + h - 1 - rows, iw, rows);
}

export class UI {
  constructor(config) {
    this.config = config || {};
    this._fonts = this.config.FONTS || {};
    this._fallback = this.config.FONT_FALLBACK || 'monospace';
    this._textCache = new Map();    // key → { canvas, ox, oy, w }
    this._measureCache = new Map(); // key → 폭
    this._boxCache = new Map();     // style → 9×9 원본 캔버스
    this._rgbCache = new Map();     // 색 문자열 → [r,g,b]
    this._measureCtx = null;        // 폭 측정 전용 컨텍스트 (지연 생성)
    this._readyFamilies = new Set(); // 로딩 완료된 폰트 family
    this._requested = new Set();     // 로딩 요청을 이미 보낸 family
    this._lastFontScan = -Infinity;
  }

  // ---------------------------------------------------------
  // 폰트
  // ---------------------------------------------------------

  /** 크기 키('s'|'m'|'l'|'xl') → { family, px, css } */
  _fontSpec(size) {
    const f = this._fonts[size] || this._fonts.l || { family: 'Galmuri11', size: 12 };
    const px = Math.max(1, Math.round(f.size || 12));
    return { family: f.family, px, css: `${px}px "${f.family}", ${this._fallback}` };
  }

  /**
   * 웹폰트가 로딩되었나 (캐시 키에 넣어서, 대체 폰트로 그린 캐시가 로딩 후에 자동으로 교체되게 한다).
   * document.fonts 를 FONT_RECHECK_MS 마다 한 번만 훑는다.
   */
  _fontReady(spec) {
    if (this._readyFamilies.has(spec.family)) return true;
    if (!hasDom() || !document.fonts) return false;
    const t = nowMs();
    if (t - this._lastFontScan < FONT_RECHECK_MS) return false;
    this._lastFontScan = t;
    try {
      for (const face of document.fonts) {
        if (face.status === 'loaded') this._readyFamilies.add(String(face.family).replace(/["']/g, '').trim());
      }
      // 아직이면 로딩을 한 번 요청해 둔다 (AssetLoader 가 이미 했어도 무해)
      if (!this._readyFamilies.has(spec.family) && !this._requested.has(spec.family)) {
        this._requested.add(spec.family);
        const pr = document.fonts.load(spec.css);
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
      }
    } catch (e) {
      // 폰트 API 가 없거나 실패해도 대체 폰트로 계속 진행
    }
    return this._readyFamilies.has(spec.family);
  }

  _getMeasureCtx() {
    if (!this._measureCtx) this._measureCtx = makeCanvas(1, 1).getContext('2d');
    return this._measureCtx;
  }

  /** 아무 CSS 색 → [r,g,b] (hex 가 아니면 캔버스 fillStyle 정규화로 해석) */
  _rgb(color) {
    const key = String(color);
    const hit = this._rgbCache.get(key);
    if (hit) return hit;
    let rgb = parseHex(key);
    if (!rgb && hasDom()) {
      const ctx = this._getMeasureCtx();
      ctx.fillStyle = '#000000';
      ctx.fillStyle = key;
      const norm = String(ctx.fillStyle);
      rgb = parseHex(norm);
      if (!rgb) {
        const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(norm);
        rgb = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [244, 244, 244];
      }
    }
    if (!rgb) rgb = [244, 244, 244];
    this._rgbCache.set(key, rgb);
    return rgb;
  }

  // ---------------------------------------------------------
  // 텍스트
  // ---------------------------------------------------------

  /**
   * Galmuri 텍스트 (한글 포함). y 는 글자 윗변. align 'left'|'center'|'right'.
   * shadow/outline: 1px 색 (hex) 또는 null.
   * @returns 텍스트 폭(px)
   */
  text(g, str, x, y, { size = 'l', color = P[C.WHITE], align = 'left', shadow = null, outline = null } = {}) {
    if (str === null || str === undefined) return 0;
    const s = String(str);
    if (s.length === 0) return 0;
    // DOM 이 없으면 비트맵 폰트로 대체 (한글은 빈칸)
    if (!hasDom()) {
      return drawBitmapText(g, s, x, y, { color, align, shadow: shadow || outline || null });
    }
    const entry = this._getText(s, size, color, shadow, outline);
    let dx = Math.round(x);
    if (align === 'center') dx -= Math.floor(entry.w / 2);
    else if (align === 'right') dx -= entry.w;
    g.drawImage(entry.canvas, dx - entry.ox, Math.round(y) - entry.oy);
    return entry.w;
  }

  /** 캐시에서 텍스트 캔버스를 꺼내거나 새로 만든다 (최근 사용한 것을 맨 뒤로 옮김) */
  _getText(s, size, color, shadow, outline) {
    const spec = this._fontSpec(size);
    const ready = this._fontReady(spec) ? 1 : 0;
    const key = `${s}|${size}|${color}|${shadow || ''}|${outline || ''}|${ready}`;
    const cache = this._textCache;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const entry = this._renderText(s, spec, ready, color, shadow, outline);
    cache.set(key, entry);
    // 한도를 넘으면 가장 오래 안 쓴 것부터 버림
    while (cache.size > TEXT_CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return entry;
  }

  /**
   * 오프스크린에 글자를 그린 뒤 알파 임계값으로 1비트 마스크를 만들고,
   * 마스크(글자) / 외곽선(8방향 1px 팽창) / 그림자(오른쪽 아래 1px) 를 요청 색으로 다시 칠한다.
   */
  _renderText(s, spec, ready, color, shadow, outline) {
    const w = this._measureSpec(s, spec, ready);
    const pad = TEXT_PAD;
    const cw = Math.max(1, w + pad * 2 + 2);
    const ch = Math.ceil(spec.px * 1.5) + pad * 2;
    const cv = makeCanvas(cw, ch);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.font = spec.css;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(s, pad, pad);

    const img = ctx.getImageData(0, 0, cw, ch);
    const d = img.data;
    const n = cw * ch;
    // 1) 알파 임계값 → 글자 마스크
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3] >= ALPHA_THRESHOLD ? 1 : 0;

    // 2) 외곽선: 글자 밖이면서 8방향 이웃에 글자가 있는 픽셀
    let outer = null;
    if (outline) {
      outer = new Uint8Array(n);
      for (let py = 0; py < ch; py++) {
        for (let px = 0; px < cw; px++) {
          const i = py * cw + px;
          if (mask[i]) continue;
          let hit = 0;
          for (let oy = -1; oy <= 1 && !hit; oy++) {
            const yy = py + oy;
            if (yy < 0 || yy >= ch) continue;
            for (let ox = -1; ox <= 1; ox++) {
              const xx = px + ox;
              if (xx < 0 || xx >= cw) continue;
              if (mask[yy * cw + xx]) { hit = 1; break; }
            }
          }
          outer[i] = hit;
        }
      }
    }

    // 3) 그림자: (글자+외곽선) 모양을 오른쪽 아래로 1px 민 것 중 비어 있는 픽셀
    let shade = null;
    if (shadow) {
      shade = new Uint8Array(n);
      for (let py = 1; py < ch; py++) {
        for (let px = 1; px < cw; px++) {
          const i = py * cw + px;
          if (mask[i] || (outer && outer[i])) continue;
          const j = i - cw - 1;
          if (mask[j] || (outer && outer[j])) shade[i] = 1;
        }
      }
    }

    // 4) 색 다시 칠하기 (완전 불투명 / 완전 투명만)
    const fg = this._rgb(color);
    const oc = outline ? this._rgb(outline) : null;
    const sc = shadow ? this._rgb(shadow) : null;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      let c = null;
      if (mask[i]) c = fg;
      else if (outer && outer[i]) c = oc;
      else if (shade && shade[i]) c = sc;
      if (c) {
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
      } else {
        d[k] = 0; d[k + 1] = 0; d[k + 2] = 0; d[k + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: cv, ox: pad, oy: pad, w };
  }

  /** 측정 (폰트 사양·로딩 상태 기준 캐시) */
  _measureSpec(s, spec, ready) {
    const key = `${s}|${spec.css}|${ready}`;
    const hit = this._measureCache.get(key);
    if (hit !== undefined) return hit;
    const ctx = this._getMeasureCtx();
    ctx.font = spec.css;
    const w = Math.max(0, Math.ceil(ctx.measureText(s).width));
    this._measureCache.set(key, w);
    if (this._measureCache.size > MEASURE_CACHE_LIMIT) this._measureCache.delete(this._measureCache.keys().next().value);
    return w;
  }

  /** 텍스트 폭(px) */
  measure(str, size = 'l') {
    const s = String(str ?? '');
    if (s.length === 0) return 0;
    if (!hasDom()) return measureBitmapText(s);
    const spec = this._fontSpec(size);
    return this._measureSpec(s, spec, this._fontReady(spec) ? 1 : 0);
  }

  /** 줄 높이(px) = 폰트 크기 */
  lineHeight(size) {
    return this._fontSpec(size).px;
  }

  /** 비트맵 폰트 (PixelFont 위임) */
  bitmapText(g, str, x, y, opts) {
    return drawBitmapText(g, str, x, y, opts || {});
  }

  // ---------------------------------------------------------
  // 9-slice 박스
  // ---------------------------------------------------------

  /** 스타일 색 묶음 (내부 UI 모듈들이 글자색을 고를 때 사용) */
  styleColors(style) {
    return BOX_STYLES[style] || BOX_STYLES.panel;
  }

  /** 스타일별 9×9 원본 조각 캔버스 (1회 생성 후 캐시) */
  _boxSource(style, st) {
    let src = this._boxCache.get(style);
    if (!src) {
      src = makeCanvas(SLICE * 3, SLICE * 3);
      const ctx = src.getContext('2d');
      drawBoxRects(ctx, 0, 0, SLICE * 3, SLICE * 3, st);
      this._boxCache.set(style, src);
    }
    return src;
  }

  /**
   * 9-slice 픽셀 테두리 박스. 모서리 3×3 은 그대로, 변·가운데는 정수 크기로 늘려 그린다.
   * style: 'panel'|'dark'|'red'|'blue'|'gold'|'paper' (+ 'darkRed'|'darkBlue')
   */
  box(g, x, y, w, h, style = 'panel') {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (w <= 0 || h <= 0) return;
    const key = BOX_STYLES[style] ? style : 'panel';
    const st = BOX_STYLES[key];
    // 너무 작거나 DOM 이 없으면 직접 칠한다
    if (w < SLICE * 2 || h < SLICE * 2 || !hasDom()) {
      drawBoxRects(g, x, y, w, h, st);
      return;
    }
    const src = this._boxSource(key, st);
    g.imageSmoothingEnabled = false;
    const S = SLICE;
    const mw = w - S * 2, mh = h - S * 2;
    // 모서리 4개
    g.drawImage(src, 0, 0, S, S, x, y, S, S);
    g.drawImage(src, S * 2, 0, S, S, x + w - S, y, S, S);
    g.drawImage(src, 0, S * 2, S, S, x, y + h - S, S, S);
    g.drawImage(src, S * 2, S * 2, S, S, x + w - S, y + h - S, S, S);
    // 변 4개 (늘리기)
    if (mw > 0) {
      g.drawImage(src, S, 0, S, S, x + S, y, mw, S);
      g.drawImage(src, S, S * 2, S, S, x + S, y + h - S, mw, S);
    }
    if (mh > 0) {
      g.drawImage(src, 0, S, S, S, x, y + S, S, mh);
      g.drawImage(src, S * 2, S, S, S, x + w - S, y + S, S, mh);
    }
    // 가운데
    if (mw > 0 && mh > 0) g.drawImage(src, S, S, S, S, x + S, y + S, mw, mh);
  }

  /** 아이콘(캔버스)을 정수 좌표에 그린다 */
  icon(g, canvas, x, y) {
    if (!canvas) return;
    g.drawImage(canvas, Math.round(x), Math.round(y));
  }

  // ---------------------------------------------------------
  // 키캡
  // ---------------------------------------------------------

  /** 키캡 크기 { w, h } (그리지 않고 계산만) */
  keycapSize(label) {
    const tw = measureBitmapText(String(label ?? '?'));
    return { w: Math.max(KEYCAP_MIN_W, tw + 4), h: KEYCAP_H };
  }

  /**
   * 키캡: 밝은 윗면 + 어두운 아래 립(2px). 눌리면 윗면이 1px 내려가고 립이 1px 로 얇아진다.
   * (x, y) 는 왼쪽 위, 전체 높이는 항상 KEYCAP_H(13).
   * @returns 폭(px)
   */
  keycap(g, label, x, y, { pressed = false, color } = {}) {
    const text = String(label ?? '?');
    const tw = measureBitmapText(text);
    const w = Math.max(KEYCAP_MIN_W, tw + 4);
    x = Math.round(x); y = Math.round(y);
    const face = color || P[C.WHITE];
    const lip = shadeOf(face);
    const rgb = this._rgb(face);
    const luma = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
    const txt = luma < DARK_LUMA ? P[C.WHITE] : P[C.INK];

    const top = pressed ? 1 : 0;        // 눌리면 1px 아래로
    const lipH = pressed ? 1 : 2;       // 눌리면 립이 얇아짐
    const bottom = y + top + 1 + KEYCAP_FACE_H + lipH; // 아래 외곽선 y

    // 외곽 (모서리 1px 깎기)
    g.fillStyle = P[C.INK];
    g.fillRect(x + 1, y + top, w - 2, 1);
    g.fillRect(x + 1, bottom, w - 2, 1);
    g.fillRect(x, y + top + 1, 1, KEYCAP_FACE_H + lipH);
    g.fillRect(x + w - 1, y + top + 1, 1, KEYCAP_FACE_H + lipH);
    // 윗면
    g.fillStyle = face;
    g.fillRect(x + 1, y + top + 1, w - 2, KEYCAP_FACE_H);
    // 립 (아래 두께)
    g.fillStyle = lip;
    g.fillRect(x + 1, y + top + 1 + KEYCAP_FACE_H, w - 2, lipH);
    // 라벨 (비트맵 폰트, 가운데)
    drawBitmapText(g, text, x + 2 + Math.floor((w - 4 - tw) / 2), y + top + 2, { color: txt });
    return w;
  }

  /** 모든 캐시 비우기 (폰트 교체·설정 변경 시) */
  clearCache() {
    this._textCache.clear();
    this._measureCache.clear();
    this._boxCache.clear();
    this._rgbCache.clear();
    this._readyFamilies.clear();
    this._requested.clear();
    this._lastFontScan = -Infinity;
  }
}
