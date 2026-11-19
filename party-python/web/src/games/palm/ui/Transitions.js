// =============================================================
// Transitions.js — 화면 전환 효과 (알파 블렌딩 없이 단색 블록만 사용)
//   - drawPixelFade : 4×4 Bayer 행렬 순서대로 4px 칸이 하나씩 채워지는 디더 페이드
//   - drawCircleWipe: 4px 블록 계단형 가장자리를 가진 원형 아이리스 (가운데로 닫힘)
//   - 좌표계는 내부 해상도 320×180 (CONFIG.SCREEN)
// =============================================================

import { CONFIG } from '../config.js';
import { PAL } from '../palette.js';

const W = CONFIG.SCREEN.W;
const H = CONFIG.SCREEN.H;
const CELL = 4; // 디더/아이리스 블록 크기(px)

// 4×4 Bayer 행렬 (0~15): 값이 작은 칸부터 먼저 채워진다
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 단계(level 1~15)별 16×16 타일 캔버스 캐시 (키: level|color)
const tileCache = new Map();
function getFadeTile(level, color) {
  const key = `${level}|${color}`;
  if (tileCache.has(key)) return tileCache.get(key);
  let tile = null;
  const size = CELL * 4;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
  } else if (typeof OffscreenCanvas !== 'undefined') {
    tile = new OffscreenCanvas(size, size);
  }
  if (tile) {
    const tc = tile.getContext('2d');
    tc.fillStyle = color;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (BAYER4[r][c] < level) tc.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }
  }
  tileCache.set(key, tile);
  return tile;
}

// 4×4 Bayer 디더로 화면을 덮는다 (0 = 투명, 1 = 완전히 덮음)
export function drawPixelFade(ctx, progress, color = PAL.ink) {
  const p = clamp01(Number.isFinite(progress) ? progress : 0);
  // 0~16 단계: 단계 수만큼의 Bayer 칸이 채워진다
  const level = Math.floor(p * 16 + 1e-6);
  if (level <= 0) return;
  if (level >= 16) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const tile = getFadeTile(level, color);
  const size = CELL * 4;
  if (tile) {
    // 16×16 타일을 정수 좌표로 반복해서 찍는다 (패턴/스케일 없이 → 블렌딩 없음)
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    for (let ty = 0; ty < H; ty += size) {
      for (let tx = 0; tx < W; tx += size) ctx.drawImage(tile, tx, ty);
    }
    ctx.imageSmoothingEnabled = prev;
    return;
  }
  // 캔버스를 만들 수 없는 환경: 칸 단위 fillRect
  ctx.fillStyle = color;
  for (let cy = 0; cy * CELL < H; cy++) {
    for (let cx = 0; cx * CELL < W; cx++) {
      if (BAYER4[cy & 3][cx & 3] < level) ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
    }
  }
}

// 원형 아이리스 와이프 (0 = 완전히 열림, 1 = 완전히 닫힘). 원 가장자리는 4px 계단.
export function drawCircleWipe(ctx, progress, cx = W / 2, cy = H / 2, color = PAL.ink) {
  const p = clamp01(Number.isFinite(progress) ? progress : 0);
  if (p <= 0) return;
  ctx.fillStyle = color;
  if (p >= 1) {
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const ccx = Math.round(cx);
  const ccy = Math.round(cy);
  // 중심에서 가장 먼 화면 모서리까지 거리 + 블록 여유 → 열린 상태에서 화면 전체가 보이도록
  const far = Math.max(
    Math.hypot(ccx, ccy), Math.hypot(W - ccx, ccy),
    Math.hypot(ccx, H - ccy), Math.hypot(W - ccx, H - ccy),
  ) + CELL * 2;
  // 닫힐수록 빠르게 줄어드는 느낌(ease-in)
  const e = p * p * (3 - 2 * p);
  const r = far * (1 - e);
  const r2 = r * r;
  const cols = Math.ceil(W / CELL);
  for (let row = 0; row * CELL < H; row++) {
    const y0 = row * CELL;
    const dy = y0 + CELL / 2 - ccy; // 블록 중심 기준 판정
    if (dy * dy >= r2) {
      ctx.fillRect(0, y0, W, CELL);
      continue;
    }
    const half = Math.sqrt(r2 - dy * dy);
    // 중심이 원 안에 들어가는 블록 범위 [i0, i1]만 열어 둔다
    const i0 = Math.max(0, Math.ceil((ccx - half - CELL / 2) / CELL));
    const i1 = Math.min(cols - 1, Math.floor((ccx + half - CELL / 2) / CELL));
    if (i1 < i0) {
      ctx.fillRect(0, y0, W, CELL);
      continue;
    }
    if (i0 > 0) ctx.fillRect(0, y0, i0 * CELL, CELL);
    const xr = (i1 + 1) * CELL;
    if (xr < W) ctx.fillRect(xr, y0, W - xr, CELL);
  }
}
