// ============================================================
// Draw.js — 픽셀 그리기 도우미
// 모든 좌표는 Math.round 로 정수 픽셀에 맞춘다 (서브픽셀 렌더링 금지)
// ============================================================

import { bayer } from '../assets/sprites.js';

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// 스프라이트 그리기 (좌우 반전, 스쿼시/스트레치 지원)
export function sprite(ctx, img, x, y, { flip = false, w = img.width, h = img.height } = {}) {
  const dx = Math.round(x), dy = Math.round(y);
  w = Math.round(w); h = Math.round(h);
  if (!flip) {
    ctx.drawImage(img, dx, dy, w, h);
    return;
  }
  ctx.save();
  ctx.translate(dx + w, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();
}

// 바닥 기준(발 위치)으로 스프라이트 그리기 — 스쿼시/스트레치 시 발이 고정됨
export function spriteFeet(ctx, img, cx, footY, sx = 1, sy = 1, flip = false) {
  const w = Math.round(img.width * sx);
  const h = Math.round(img.height * sy);
  sprite(ctx, img, Math.round(cx - w / 2), Math.round(footY - h), { flip, w, h });
}

// 정수 픽셀 원 (행 단위 span 으로 채움 → 안티앨리어싱 없음)
export function disc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
  }
}

// 납작한 타원 그림자
export function shadow(ctx, cx, y, w, color) {
  ctx.fillStyle = color;
  const hw = Math.floor(w / 2);
  ctx.fillRect(Math.round(cx - hw + 1), Math.round(y), hw * 2 - 2, 1);
  ctx.fillRect(Math.round(cx - hw), Math.round(y + 1), hw * 2, 1);
  ctx.fillRect(Math.round(cx - hw + 1), Math.round(y + 2), hw * 2 - 2, 1);
}

// ------------------------------------------------------------
// 디더링 (그라데이션 대신 바이어 행렬 패턴)
// ------------------------------------------------------------
const patternCache = new Map();

// level 0~16: 0 = 비어 있음, 16 = 꽉 참
export function ditherPattern(ctx, color, level) {
  const key = `${color}|${level}`;
  if (patternCache.has(key)) return patternCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = 4; cv.height = 4;
  const c = cv.getContext('2d');
  c.fillStyle = color;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    if (bayer(x, y) < level / 16) c.fillRect(x, y, 1, 1);
  }
  const p = ctx.createPattern(cv, 'repeat');
  patternCache.set(key, p);
  return p;
}

export function ditherRect(ctx, x, y, w, h, color, amount) {
  const level = Math.max(0, Math.min(16, Math.round(amount * 16)));
  if (level === 0) return;
  ctx.fillStyle = level >= 16 ? color : ditherPattern(ctx, color, level);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// 크기 w×h 의 바이어 마스크 (팔레트 스왑을 디더링으로 섞을 때 사용)
const maskCache = new Map();
export function bayerMask(w, h, level) {
  const key = `${w}x${h}|${level}`;
  if (maskCache.has(key)) return maskCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (bayer(x, y) < level / 16) c.fillRect(x, y, 1, 1);
  }
  maskCache.set(key, cv);
  return cv;
}

// ------------------------------------------------------------
// 9-slice 박스: 12×12 원본을 4px 단위로 잘라 모서리는 그대로, 변은 늘려서 그림
// ------------------------------------------------------------
export function nineSlice(ctx, src, x, y, w, h, corner = 4) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const s = corner;
  const sw = src.width, sh = src.height;
  const mw = sw - s * 2, mh = sh - s * 2;   // 원본 가운데 크기
  const iw = Math.max(0, w - s * 2), ih = Math.max(0, h - s * 2);
  // 모서리
  ctx.drawImage(src, 0, 0, s, s, x, y, s, s);
  ctx.drawImage(src, sw - s, 0, s, s, x + w - s, y, s, s);
  ctx.drawImage(src, 0, sh - s, s, s, x, y + h - s, s, s);
  ctx.drawImage(src, sw - s, sh - s, s, s, x + w - s, y + h - s, s, s);
  // 변 (가로/세로로 늘림 — 1px 무늬라 늘려도 깨지지 않음)
  if (iw > 0) {
    ctx.drawImage(src, s, 0, mw, s, x + s, y, iw, s);
    ctx.drawImage(src, s, sh - s, mw, s, x + s, y + h - s, iw, s);
  }
  if (ih > 0) {
    ctx.drawImage(src, 0, s, s, mh, x, y + s, s, ih);
    ctx.drawImage(src, sw - s, s, s, mh, x + w - s, y + s, s, ih);
  }
  if (iw > 0 && ih > 0) ctx.drawImage(src, s, s, mw, mh, x + s, y + s, iw, ih);
}
