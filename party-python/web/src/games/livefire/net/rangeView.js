// =============================================================
// 사격장 그림 (사로 한 칸 = 64 × 96) — 원본 js/range-view.js 를 ES 모듈로 옮긴 것.
//  하늘 · 먼 산 · 풀밭 · 거리별 흙둑(250m · 200m · 100m) · 표적 · 모래주머니 사대
//  조준: K2 가늠자(뒤쪽 동그란 구멍) + 가늠쇠(앞쪽 기둥) — 가늠쇠 끝이 조준점
// D = 거리별 표적 값 { y, w, h } (서버가 options.config.DISTANCES 로 준다)
// =============================================================
import { BitmapFont, C, DITHER, PALETTE } from './gfx.js';

export const RANGE = { COL_W: 64, VIEW_Y: 33, VIEW_H: 96 };

// 표적 스프라이트 (상반신 인형 표적, 거리별 크기) → { '100': 캔버스, '100hit': 캔버스, ... }
export function buildTargetSprites(distances) {
  const out = {};
  for (const [d, D] of Object.entries(distances)) {
    out[d] = buildTarget(D.w, D.h, false);
    out[d + 'hit'] = buildTarget(D.w, D.h, true);
  }
  return out;
}

// 사람 모양 실루엣: 둥근 머리 · 목 · 넓은 어깨 · 몸통 (밝은 테두리로 풀밭에서 잘 보이게)
function buildTarget(w, h, flash) {
  const c = document.createElement('canvas');
  c.width = w + 2;
  c.height = h + 1;
  const g = c.getContext('2d');
  const headR = Math.max(1.5, w * 0.27);
  const headH = Math.round(headR * 2);
  const neck = headH;
  const shoulder = neck + 1;
  const cx = w / 2;
  // 줄마다 반폭
  const half = (y) => {
    if (y < headH) {
      const dy = y + 0.5 - headR;
      return Math.sqrt(Math.max(0, headR * headR - dy * dy));
    }
    if (y < shoulder) return Math.max(1, headR * 0.6);
    const sl = Math.max(2, Math.round(h * 0.15)); // 둥근 어깨 (점점 넓어짐)
    if (y < shoulder + sl) return headR * 1.1 + (w / 2 - headR * 1.1) * ((y - shoulder + 1) / sl);
    return w / 2;
  };
  const row = (y, grow, col) => {
    const hw = half(y);
    if (hw <= 0.3) return;
    const x0 = Math.round(cx - hw) - grow;
    const x1 = Math.round(cx + hw) + grow;
    g.fillStyle = col;
    g.fillRect(x0 + 1, y, Math.max(1, x1 - x0), 1);
  };
  const edge = flash ? PALETTE.b : PALETTE.k;
  const body = flash ? PALETTE.b : PALETTE.s;
  const shade = flash ? PALETTE.k : PALETTE.r;
  for (let y = 0; y < h; y++) row(y, 1, edge);
  g.fillStyle = edge;
  for (let y = 0; y < h; y++) row(Math.max(0, y - 1), 0, edge);
  for (let y = 1; y < h; y++) row(y, 0, body);
  if (!flash) {
    g.fillStyle = shade;
    for (let y = 1; y < h; y++) {
      const hw = half(y);
      if (hw > 1) g.fillRect(Math.round(cx - hw) + 1, y, 1, 1);
    }
    if (w >= 9) {
      g.fillStyle = PALETTE.n;
      g.fillRect(Math.round(cx), shoulder + Math.round((h - shoulder) / 3), 2, 2);
    }
  }
  return c;
}

// ---- 배경 (사로 칸 하나) ----
export function drawRangeBg(ctx, x0, frame, seed = x0) {
  const W = RANGE.COL_W;
  const y0 = RANGE.VIEW_Y;
  // 하늘 (위로 갈수록 진하게)
  ctx.fillStyle = C('g');
  ctx.fillRect(x0, y0, W, 18);
  ctx.fillStyle = C('h');
  ctx.fillRect(x0, y0 + 7, W, 11);
  ctx.fillStyle = DITHER.get(ctx, 'h', 8);
  ctx.fillRect(x0, y0 + 3, W, 4);
  // 구름 (천천히 흐름)
  for (let i = 0; i < 3; i++) {
    const cx = ((i * 97 + frame * 0.05 + seed) % 360) - 20 - (seed % 64);
    if (cx < -12 || cx > W) continue;
    ctx.fillStyle = C('b');
    ctx.fillRect(x0 + Math.round(cx), y0 + 3 + i * 3, 10, 2);
    ctx.fillRect(x0 + Math.round(cx) + 2, y0 + 2 + i * 3, 5, 1);
  }
  // 먼 산 (울퉁불퉁)
  ctx.fillStyle = C('c');
  for (let x = 0; x < W; x++) {
    const gx = seed + x;
    const h = 5 + Math.round(Math.sin(gx * 0.09) * 2 + Math.sin(gx * 0.23) * 1.5);
    ctx.fillRect(x0 + x, y0 + 18 - h, 1, h);
  }
  // 풀밭 (멀리는 어둡게, 가까이는 밝게)
  ctx.fillStyle = C('c');
  ctx.fillRect(x0, y0 + 18, W, 8);
  ctx.fillStyle = C('d');
  ctx.fillRect(x0, y0 + 26, W, 58);
  ctx.fillStyle = DITHER.get(ctx, 'c', 4);
  ctx.fillRect(x0, y0 + 26, W, 16);
  ctx.fillStyle = DITHER.get(ctx, 'e', 2);
  ctx.fillRect(x0, y0 + 54, W, 30);
}

// 거리별 흙둑 (표적이 이 뒤에서 올라옴) — 표적을 그린 다음에 그려서 아래를 가림
export function drawBerm(ctx, x0, dist, D, sign = true) {
  const y = RANGE.VIEW_Y + D.y;
  const thick = dist === 100 ? 5 : dist === 200 ? 3 : 2;
  ctx.fillStyle = C('l');
  ctx.fillRect(x0, y, RANGE.COL_W, thick);
  ctx.fillStyle = C('m');
  ctx.fillRect(x0, y, RANGE.COL_W, 1);
  if (!sign) return;
  // 거리 표지판 (왼쪽 기둥)
  const sx = x0 + 1;
  ctx.fillStyle = C('1');
  ctx.fillRect(sx, y - 9, 15, 9);
  ctx.fillStyle = C('a');
  ctx.fillRect(sx + 1, y - 8, 13, 7);
  BitmapFont.draw(ctx, String(dist), sx + 2, y - 7, C('1'));
}

// 사대 (모래주머니) — 맨 앞
export function drawSandbags(ctx, x0) {
  const y = RANGE.VIEW_Y + 84;
  ctx.fillStyle = C('1');
  ctx.fillRect(x0, y, RANGE.COL_W, 12);
  for (let row = 0; row < 2; row++) {
    for (let i = -1; i < 6; i++) {
      const bx = x0 + i * 12 + (row ? 6 : 0);
      ctx.fillStyle = C('m');
      ctx.fillRect(bx + 1, y + row * 6 + 1, 10, 5);
      ctx.fillStyle = C('n');
      ctx.fillRect(bx + 2, y + row * 6 + 1, 8, 1);
      ctx.fillStyle = C('r');
      ctx.fillRect(bx + 1, y + row * 6 + 5, 10, 1);
    }
  }
}

// 표적 (rise 0~1, flash 맞은 순간 하얗게, falling 맞아서 뒤로 넘어가는 중)
export function drawTarget(ctx, sprites, x0, tg, D, rise, flash, falling) {
  if (rise <= 0) return;
  const img = sprites[tg.dist + (flash ? 'hit' : '')];
  if (!img) return;
  const bx = Math.round(x0 + RANGE.COL_W / 2 + tg.x - D.w / 2) - 1;
  const by = RANGE.VIEW_Y + D.y;
  const h = Math.max(1, Math.round(img.height * rise));
  if (falling) ctx.drawImage(img, 0, 0, img.width, img.height, bx, by - h, img.width, h); // 뒤로 넘어감: 납작해짐
  else ctx.drawImage(img, 0, 0, img.width, h, bx, by - h, img.width, h);
}

// 소총: 가늠쇠(기둥) + 가늠자(동그란 구멍). (ax, ay) = 사로 칸 좌표의 조준점
export function drawRifle(ctx, x0, ax, ay, flash) {
  const cx = Math.round(x0 + RANGE.COL_W / 2 + ax);
  const cy = Math.round(RANGE.VIEW_Y + ay);
  // 가늠쇠 받침 (짧게만 — 아래 표적이 가려지지 않게)
  ctx.fillStyle = C('1');
  ctx.fillRect(cx - 4, cy + 5, 9, 2);
  ctx.fillRect(cx - 2, cy + 7, 5, 4);
  ctx.fillStyle = C('i');
  ctx.fillRect(cx - 3, cy + 5, 7, 1);
  // 가늠쇠 (가운데 기둥 + 양쪽 보호 귀)
  ctx.fillStyle = C('1');
  ctx.fillRect(cx, cy, 1, 5); // 가늠쇠 끝 = 조준점
  ctx.fillRect(cx - 3, cy + 1, 1, 4);
  ctx.fillRect(cx + 3, cy + 1, 1, 4);
  ctx.fillRect(cx - 3, cy + 4, 7, 1);
  // 총구 불꽃
  if (flash > 0) {
    ctx.fillStyle = C(flash > 3 ? 'b' : '9');
    ctx.fillRect(cx - 2, cy - 4, 5, 3);
    ctx.fillRect(cx - 1, cy - 6, 3, 2);
    ctx.fillStyle = C('8');
    ctx.fillRect(cx - 3, cy - 2, 7, 1);
  }
  // 가늠자 (작고 얇게, 한 칸 건너 찍어서 뒤 표적이 비쳐 보이게)
  const R = 4;
  ctx.fillStyle = C('1');
  for (let dy = -R - 1; dy <= R + 1; dy++) {
    for (let dx = -R - 1; dx <= R + 1; dx++) {
      const d = Math.hypot(dx, dy);
      if (d < R - 0.5 || d > R + 0.6) continue;
      if ((dx + dy) & 1) continue;
      ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }
}

// 탄알 아이콘 (탄알집에 남은 수)
export function drawAmmo(ctx, x, y, left, max) {
  for (let i = 0; i < max; i++) {
    const bx = x + i * 3;
    ctx.fillStyle = C('1');
    ctx.fillRect(bx, y, 3, 6);
    if (i < left) {
      ctx.fillStyle = C('8');
      ctx.fillRect(bx, y + 2, 2, 4);
      ctx.fillStyle = C('u');
      ctx.fillRect(bx, y + 1, 2, 1);
      ctx.fillStyle = C('t');
      ctx.fillRect(bx, y + 2, 1, 2);
    } else {
      ctx.fillStyle = C('2');
      ctx.fillRect(bx, y + 2, 2, 4);
    }
  }
}

// 결과 배경: 얼룩무늬 (천천히 흐름). (x0, y0, W, H) 영역만 칠한다
export function drawCamo(ctx, frame, x0 = 0, y0 = 0, W = 320, H = 180) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, W, H);
  ctx.clip();
  ctx.fillStyle = C('o');
  ctx.fillRect(x0, y0, W, H);
  const cols = ['c', '2', 's'];
  for (let i = 0; i < 40; i++) {
    const x = ((i * 53 + frame * 0.15) % (320 + 40)) - 20;
    const y = (i * 37) % 180;
    ctx.fillStyle = DITHER.get(ctx, cols[i % 3], 8);
    ctx.fillRect(Math.round(x), y, 18 + (i % 4) * 6, 8 + (i % 3) * 4);
  }
  ctx.restore();
}

// 엎드려 쏴 (옆모습): 눕힌 캐릭터 + 앞으로 뻗은 총 — 다른 사람 사로 아래 칸
export function drawProne(ctx, cx, by, img, flash) {
  if (!img) return;
  const x = Math.round(cx - img.width / 2 - 6);
  const y = by - img.height + 2;
  // 깔개
  ctx.fillStyle = C('s');
  ctx.fillRect(x - 2, by - 1, img.width + 22, 3);
  ctx.drawImage(img, x, y);
  // 소총 (머리 앞으로 뻗음)
  const gx = x + img.width - 3;
  const gy = y + Math.round(img.height * 0.45);
  ctx.fillStyle = C('1');
  ctx.fillRect(gx, gy, 16, 3);
  ctx.fillRect(gx + 2, gy + 3, 3, 3); // 탄알집
  ctx.fillRect(gx + 15, gy - 1, 1, 1); // 가늠쇠
  ctx.fillStyle = C('i');
  ctx.fillRect(gx + 1, gy, 14, 1);
  // 모래주머니 (총 받침)
  ctx.fillStyle = C('m');
  ctx.fillRect(gx + 8, gy + 3, 7, 3);
  ctx.fillStyle = C('r');
  ctx.fillRect(gx + 8, gy + 5, 7, 1);
  if (flash > 0) {
    ctx.fillStyle = C(flash > 3 ? 'b' : '9');
    ctx.fillRect(gx + 16, gy - 1, 3, 5);
    ctx.fillRect(gx + 19, gy, 2, 3);
  }
}
