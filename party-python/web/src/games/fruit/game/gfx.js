// ============================================================
//  렌더링 도우미 — 모든 좌표를 정수 픽셀로 맞춰 그린다 (서브픽셀 금지)
// ============================================================
import { PALETTE, PALETTE_RGB } from '../assets/palette.js';
import { TIMING } from '../config.js';

const STEP = (Math.PI * 2) / TIMING.ROT_STEPS;

// 회전을 16단계로 끊어서 도트가 "뚝뚝" 돌아가는 레트로 느낌
export const quantizeAngle = (a) => Math.round(a / STEP) * STEP;

/** 스프라이트(캔버스)를 중심 기준으로 그린다. rot/스케일(스쿼시&스트레치) 지원 */
export function drawSprite(ctx, img, x, y, { rot = 0, sx = 1, sy = 1, alpha = 1 } = {}) {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const qa = quantizeAngle(rot);
  if (qa === 0 && sx === 1 && sy === 1 && alpha === 1) {
    ctx.drawImage(img, rx - (img.width >> 1), ry - (img.height >> 1));
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(rx, ry);
  if (qa) ctx.rotate(qa);
  if (sx !== 1 || sy !== 1) ctx.scale(Math.round(sx * 8) / 8, Math.round(sy * 8) / 8);
  ctx.drawImage(img, -(img.width >> 1), -(img.height >> 1));
  ctx.restore();
}

/** 브레젠험 직선 — size 크기의 정사각형 붓으로 찍는다 (칼 궤적용) */
export function pixelLine(ctx, x0, y0, x1, y1, size, color) {
  ctx.fillStyle = typeof color === 'number' ? PALETTE[color] : color;
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  const off = Math.floor(size / 2);
  for (let guard = 0; guard < 2000; guard++) {
    ctx.fillRect(ax - off, ay - off, size, size);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
}

/** 미드포인트 원(테두리만) — 폭발 충격파용 */
export function pixelRing(ctx, cx, cy, r, color) {
  ctx.fillStyle = PALETTE[color];
  cx = Math.round(cx);
  cy = Math.round(cy);
  r = Math.round(r);
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) {
      ctx.fillRect(cx + px, cy + py, 1, 1);
    }
    y++;
    if (err < 0) err += 2 * y + 1;
    else { x--; err += 2 * (y - x) + 1; }
  }
}

/** 4×4 베이어 행렬 — 반투명 대신 디더링 패턴으로 농도를 표현 */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// 농도 0~16 단계의 디더 패턴 캔버스를 미리 만들어 둔다 (블록 크기 px)
const patternCache = new Map();
export function ditherPattern(ctx, color, level, block = 1) {
  const key = `${color}:${level}:${block}`;
  if (!patternCache.has(key)) {
    const c = document.createElement('canvas');
    c.width = 4 * block;
    c.height = 4 * block;
    const pc = c.getContext('2d');
    pc.fillStyle = PALETTE[color];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if (BAYER4[y][x] < level) pc.fillRect(x * block, y * block, block, block);
    }
    patternCache.set(key, c);
  }
  return ctx.createPattern(patternCache.get(key), 'repeat');
}

/** 디더링으로 사각형을 채운다. amount 0~1 */
export function ditherRect(ctx, x, y, w, h, color, amount, block = 1) {
  const level = Math.max(0, Math.min(16, Math.round(amount * 16)));
  if (level === 0) return;
  if (level === 16) {
    ctx.fillStyle = PALETTE[color];
  } else {
    ctx.fillStyle = ditherPattern(ctx, color, level, block);
  }
  ctx.fillRect(x, y, w, h);
}

/**
 * 과일을 칼이 지나간 방향으로 반으로 가른다.
 * 자른 면 근처 픽셀은 과육 색으로 바꿔 "단면"이 보이게 한다.
 * flesh: { line, band, rind?, seed? } (팔레트 인덱스)
 */
export function makeHalves(src, dirX, dirY, flesh) {
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const len = Math.hypot(dirX, dirY) || 1;
  const nx = -dirY / len; // 자르는 선의 법선
  const ny = dirX / len;
  const cx = w / 2;
  const cy = h / 2;
  const opaque = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;

  const halves = [0, 1].map(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  });
  const out = halves.map((c) => c.getContext('2d').createImageData(w, h));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!opaque(x, y)) continue;
      const s = (x + 0.5 - cx) * nx + (y + 0.5 - cy) * ny;
      const side = s >= 0 ? 0 : 1;
      const dist = Math.abs(s);
      const i = (y * w + x) * 4;
      let rgb = [data[i], data[i + 1], data[i + 2]];
      const edge = !opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1);
      const nearEdge = !edge && (!opaque(x - 2, y) || !opaque(x + 2, y) || !opaque(x, y - 2) || !opaque(x, y + 2));
      if (!edge && dist < 3.2) {
        let idx = dist < 1.1 ? flesh.line : flesh.band;
        if (nearEdge && flesh.rind !== undefined) idx = flesh.rind;
        else if (flesh.seed !== undefined && dist > 1.5 && (x * 3 + y) % 5 === 0) idx = flesh.seed;
        rgb = PALETTE_RGB[idx];
      }
      const o = out[side].data;
      o[i] = rgb[0];
      o[i + 1] = rgb[1];
      o[i + 2] = rgb[2];
      o[i + 3] = 255;
    }
  }
  halves.forEach((c, k) => c.getContext('2d').putImageData(out[k], 0, 0));
  return { halves, normal: [nx, ny] };
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 점(px,py)과 선분(ax,ay)-(bx,by) 사이 거리 — 칼 vs 과일 충돌 판정 */
export function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}
