// =============================================================
// SpriteFactory.js — 역할 문자 프레임(sprites.js) → 캔버스 프레임(SpriteSet)
//   - 룩별 팔레트 스왑, 좌우 반전(왼쪽을 바라봄), 넘어짐 회전 프레임(RotSprite 근사) 생성
//   - 모듈 최상단에서는 DOM에 접근하지 않는다 (Node에서 import해도 안전).
//     캔버스가 필요한 함수(spriteToCanvas, createFighterSprites)만 호출 시 DOM을 사용.
//   - rotSpriteRows()는 순수 함수라 Node에서도 테스트 가능.
// =============================================================
import {
  LOOKS,
  FRAMES,
  FRAME_W,
  FRAME_H,
  ANCHOR_X,
  ANCHOR_Y,
  WET_WATERLINE,
  FALL_ANGLES,
} from './sprites.js';

// 넘어짐 프레임 캔버스 크기와 회전축(발) 위치 — 0°~±90° 회전이 모두 들어가는 크기
export const FALL_W = 72;
export const FALL_H = 48;
export const FALL_AX = 36;
export const FALL_AY = 36;

// ---------------- 캔버스 유틸 ----------------
function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('[SpriteFactory] 캔버스를 만들 수 없는 환경입니다 (document/OffscreenCanvas 없음)');
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * 역할 문자 배열을 캔버스로 변환 (다른 모듈 재사용용)
 * @param {string[]} rows 같은 길이의 문자열 배열 ('.' 또는 colorMap에 없는 문자 = 투명)
 * @param {{[ch: string]: string}} colorMap 문자 → '#rrggbb'
 * @returns {HTMLCanvasElement}
 */
export function spriteToCanvas(rows, colorMap) {
  const h = rows.length;
  const w = h ? rows[0].length : 0;
  const c = makeCanvas(Math.max(1, w), Math.max(1, h));
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (!w || !h) return c;
  const img = g.createImageData(w, h);
  const d = img.data;
  const cache = {};
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.' || ch === undefined) continue;
      const hex = colorMap[ch];
      if (!hex) continue;
      const rgb = cache[ch] || (cache[ch] = hexToRgb(hex));
      const i = (y * w + x) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = 255; // 완전 불투명 (반투명 금지)
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// 좌우 반전 캔버스
function mirrorCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

// =============================================================
// RotSprite 근사 (순수 함수, 문자 격자에서 동작 → 결과도 팔레트 역할 문자만 포함)
//   1) Scale2x(EPX)를 3번 → 8배 확대 (가장자리가 매끄러운 계단)
//   2) 8배 해상도에서 최근접 이웃 회전 (회전축 = 발)
//   3) 8×8 블록마다 다운샘플: 불투명 픽셀이 임계값 이상이면 가장 많은(가중) 색, 아니면 투명
//   4) 외곽선 보정: 끊긴 외곽선을 1px 'o'로 다시 둘러줌
// =============================================================

function toGrid(rows) {
  return rows.map((r) => r.split(''));
}

// Scale2x (EPX) 한 번: w×h → 2w×2h
export function scale2x(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const out = [];
  for (let y = 0; y < h * 2; y++) out.push(new Array(w * 2));
  const at = (x, y) => grid[Math.min(h - 1, Math.max(0, y))][Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = grid[y][x];
      const A = at(x, y - 1); // 위
      const B = at(x + 1, y); // 오른쪽
      const C = at(x - 1, y); // 왼쪽
      const D = at(x, y + 1); // 아래
      let e0 = P;
      let e1 = P;
      let e2 = P;
      let e3 = P;
      if (C === A && C !== D && A !== B) e0 = A;
      if (A === B && A !== C && B !== D) e1 = B;
      if (D === C && D !== B && C !== A) e2 = C;
      if (B === D && B !== A && D !== C) e3 = D;
      out[y * 2][x * 2] = e0;
      out[y * 2][x * 2 + 1] = e1;
      out[y * 2 + 1][x * 2] = e2;
      out[y * 2 + 1][x * 2 + 1] = e3;
    }
  }
  return out;
}

// 다운샘플 투표 가중치 — 얇은 외곽선/눈이 사라지지 않도록 약간 우대
const VOTE_WEIGHT = { o: 1.5, e: 2.2, w: 1.6, M: 1.6, m: 1.4 };
const OPAQUE_THRESHOLD = 26; // 8×8=64 중 이 이상 불투명이면 칠함

/**
 * 역할 문자 프레임을 회전 (RotSprite 근사)
 * @param {string[]} rows 원본 (예: 16×32)
 * @param {number} angleDeg 시계 방향(+) 회전 각도 (화면 좌표, y 아래)
 * @param {object} o { pivotX=ANCHOR_X, pivotY=ANCHOR_Y, outW=FALL_W, outH=FALL_H, outAx=FALL_AX, outAy=FALL_AY }
 * @returns {{ rows: string[], w: number, h: number, ax: number, ay: number }}
 */
export function rotSpriteRows(rows, angleDeg, o = {}) {
  const pivotX = o.pivotX ?? ANCHOR_X;
  const pivotY = o.pivotY ?? ANCHOR_Y;
  const outW = o.outW ?? FALL_W;
  const outH = o.outH ?? FALL_H;
  const outAx = o.outAx ?? FALL_AX;
  const outAy = o.outAy ?? FALL_AY;
  const srcH = rows.length;
  const srcW = rows[0].length;
  const out = [];
  for (let y = 0; y < outH; y++) out.push(new Array(outW).fill('.'));

  // 0°는 원본을 그대로 옮김 (불필요한 변형 방지)
  if (Math.abs(angleDeg) < 0.001) {
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const tx = x - pivotX + outAx;
        const ty = y - pivotY + outAy;
        if (tx >= 0 && ty >= 0 && tx < outW && ty < outH) out[ty][tx] = rows[y][x];
      }
    }
    return { rows: out.map((r) => r.join('')), w: outW, h: outH, ax: outAx, ay: outAy };
  }

  // 1) 8배 확대 (Scale2x × 3)
  const K = 8;
  let big = toGrid(rows);
  big = scale2x(scale2x(scale2x(big)));
  const bigW = srcW * K;
  const bigH = srcH * K;

  // 2) 회전 준비 (역변환으로 원본 좌표를 찾는다)
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pxBig = pivotX * K;
  const pyBig = pivotY * K;

  // 3) 출력 픽셀(8×8 블록)마다 회전 샘플 → 투표
  const counts = new Map();
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      counts.clear();
      let opaque = 0;
      for (let sy = 0; sy < K; sy++) {
        for (let sx = 0; sx < K; sx++) {
          // 출력 8배 좌표 (회전축 기준 상대 위치)
          const dx = (ox - outAx) * K + sx + 0.5;
          const dy = (oy - outAy) * K + sy + 0.5;
          // 역회전 (시계 방향 회전의 역 = 반시계)
          const rx = dx * cos + dy * sin;
          const ry = -dx * sin + dy * cos;
          const bx = Math.floor(pxBig + rx);
          const by = Math.floor(pyBig + ry);
          if (bx < 0 || by < 0 || bx >= bigW || by >= bigH) continue;
          const ch = big[by][bx];
          if (ch === '.') continue;
          opaque++;
          counts.set(ch, (counts.get(ch) || 0) + (VOTE_WEIGHT[ch] || 1));
        }
      }
      if (opaque < OPAQUE_THRESHOLD) continue;
      let best = '.';
      let bestN = -1;
      for (const [ch, n] of counts) {
        if (n > bestN) {
          bestN = n;
          best = ch;
        }
      }
      out[oy][ox] = best;
    }
  }

  // 4) 외곽선 보정: 외곽선이 아닌 채색 픽셀과 맞닿은 투명 칸을 'o'로
  const fix = [];
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      if (out[y][x] !== '.') continue;
      const nb = [
        y > 0 ? out[y - 1][x] : '.',
        y < outH - 1 ? out[y + 1][x] : '.',
        x > 0 ? out[y][x - 1] : '.',
        x < outW - 1 ? out[y][x + 1] : '.',
      ];
      if (nb.some((c) => c !== '.' && c !== 'o' && c !== 'd' && c !== 'q' && c !== 'Q')) fix.push([x, y]);
    }
  }
  for (const [x, y] of fix) out[y][x] = 'o';

  // 5) 외톨이 외곽선 픽셀 제거 (주변에 칠해진 픽셀이 없는 'o')
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      if (out[y][x] !== 'o') continue;
      let n = 0;
      for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
          if (!xx && !yy) continue;
          const c = out[y + yy] && out[y + yy][x + xx];
          if (c && c !== '.') n++;
        }
      }
      if (n === 0) out[y][x] = '.';
    }
  }

  return { rows: out.map((r) => r.join('')), w: outW, h: outH, ax: outAx, ay: outAy };
}

// =============================================================
// SpriteSet 생성
// =============================================================
const cache = new Map();

function frameFromRows(rows, colors, ax, ay) {
  const canvas = spriteToCanvas(rows, colors);
  return { canvas, w: canvas.width, h: canvas.height, ax, ay };
}

function mirrorFrame(f) {
  return { canvas: mirrorCanvas(f.canvas), w: f.w, h: f.h, ax: f.w - f.ax, ay: f.ay };
}

/**
 * 룩 하나의 전체 스프라이트 세트 (동기, 룩별 캐시)
 * @param {string} lookId 'p1'..'p5' | 'champ' (모르는 값이면 p1)
 * @returns {{ w: number, h: number, right: object, left: object }}
 */
export function createFighterSprites(lookId) {
  const id = LOOKS[lookId] ? lookId : 'p1';
  if (cache.has(id)) return cache.get(id);
  const look = LOOKS[id];
  const src = FRAMES[id];
  const colors = look.colors;
  const right = {};

  // 기본 애니메이션 (16×32, 앵커 = 발 중심)
  for (const anim of ['idle', 'push', 'charge', 'feint', 'hold', 'stagger', 'win']) {
    right[anim] = src[anim].map((rows) => frameFromRows(rows, colors, ANCHOR_X, ANCHOR_Y));
  }
  // 물에 빠짐: ay = 수면선
  right.wet = src.wet.map((rows) => frameFromRows(rows, colors, ANCHOR_X, WET_WATERLINE));

  // 넘어짐: tumble 자세를 발 기준으로 회전
  //   fallFwd = 바라보는 방향(오른쪽)으로 = 시계 방향(+), fallBack = 반시계(-)
  const mk = (sign) =>
    FALL_ANGLES.map((deg) => {
      const r = rotSpriteRows(src.tumble, sign * deg);
      return frameFromRows(r.rows, colors, r.ax, r.ay);
    });
  right.fallFwd = mk(1);
  right.fallBack = mk(-1);

  // 왼쪽을 바라봄: 모든 프레임 좌우 반전 (ax' = w - ax)
  const left = {};
  for (const anim of Object.keys(right)) left[anim] = right[anim].map(mirrorFrame);

  const set = { w: FRAME_W, h: FRAME_H, right, left };
  cache.set(id, set);
  return set;
}

// 캐시 비우기 (개발/핫리로드용)
export function clearSpriteCache() {
  cache.clear();
}
