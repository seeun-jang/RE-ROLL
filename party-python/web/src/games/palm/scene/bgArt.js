// =============================================================
// bgArt.js — 배경(개울가 징검다리 축제) 픽셀 아트 생성기
//   - 모든 정적 그림은 "팔레트 인덱스 버퍼(Pix)"에 먼저 찍은 뒤
//     toCanvas()로 한 번에 캔버스로 굽는다 (ImageData 사용, 빠르고 정확).
//   - 색은 Sweetie 16 인덱스만 사용. 그라데이션 대신 4×4 베이어 디더링.
//   - 이 모듈은 import 시점에 DOM을 건드리지 않는다.
//     (toCanvas()를 호출할 때만 document.createElement('canvas') 사용)
// =============================================================

import { SWEETIE16 } from '../palette.js';

// 팔레트 인덱스 별칭 (palette.js의 SWEETIE16 순서와 동일)
export const C = {
  ink: 0, plum: 1, red: 2, orange: 3, sand: 4, lime: 5, green: 6, teal: 7,
  navy: 8, blue: 9, sky: 10, cyan: 11, white: 12, silver: 13, slate: 14, charcoal: 15,
};
export const T = 255; // 투명

// 인덱스 → HEX 문자열 (fillStyle용)
export const HEX = SWEETIE16.slice();

// 인덱스 → [r,g,b] (ImageData용)
const RGB = SWEETIE16.map((h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]);

// 4×4 베이어 행렬 (0..15). level(0..16)보다 작은 칸에 두 번째 색을 찍는다.
export const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
export const dith = (x, y, level) => BAYER[y & 3][x & 3] < level;

// 정수 좌표 해시 → [0,1) (정적 텍스처용 결정론적 노이즈)
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 그림자(한 단계 어두운) 색 매핑
export const SHADE = {
  [C.red]: C.plum, [C.blue]: C.navy, [C.green]: C.teal, [C.orange]: C.red,
  [C.sky]: C.blue, [C.cyan]: C.sky, [C.sand]: C.orange, [C.white]: C.silver,
  [C.lime]: C.green, [C.plum]: C.ink, [C.slate]: C.charcoal, [C.silver]: C.slate,
  [C.navy]: C.ink, [C.teal]: C.navy, [C.charcoal]: C.ink, [C.ink]: C.ink,
};

// 물속(젖은) 색 매핑 — 수면 아래 잠긴 돌 부분
export const WET = {
  [C.white]: C.cyan, [C.silver]: C.sky, [C.slate]: C.teal, [C.charcoal]: C.navy,
  [C.ink]: C.navy, [C.green]: C.teal, [C.lime]: C.green, [C.teal]: C.navy,
};

// 캔버스 생성 (호출될 때만 DOM 접근)
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) g.imageSmoothingEnabled = false;
  return c;
}

// -------------------------------------------------------------
// Pix: 팔레트 인덱스 픽셀 버퍼
// -------------------------------------------------------------
export class Pix {
  constructor(w, h) {
    this.w = w | 0;
    this.h = h | 0;
    this.d = new Uint8Array(this.w * this.h).fill(T);
  }
  set(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (c == null || c === T || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = c;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T;
    return this.d[y * this.w + x];
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  hline(x0, x1, y, c) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  vline(x, y0, y1, c) {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = y0; y <= y1; y++) this.set(x, y, c);
  }
  // 채워진 픽셀 둘레(4방향)의 빈칸을 외곽선 색으로
  outline(c) {
    const add = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== T) continue;
        if (this.get(x - 1, y) !== T || this.get(x + 1, y) !== T || this.get(x, y - 1) !== T || this.get(x, y + 1) !== T) {
          add.push(x, y);
        }
      }
    }
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], c);
    return this;
  }
  // 색 바꾸기 매핑 적용 (새 버퍼 반환)
  remap(map) {
    const p = new Pix(this.w, this.h);
    for (let i = 0; i < this.d.length; i++) {
      const v = this.d[i];
      p.d[i] = v === T ? T : (map[v] !== undefined ? map[v] : v);
    }
    return p;
  }
  // ImageData로 한 번에 캔버스로 굽기
  toCanvas() {
    const c = makeCanvas(this.w, this.h);
    const g = c.getContext('2d');
    if (!g) return c;
    const img = g.createImageData(this.w, this.h);
    const out = img.data;
    for (let i = 0; i < this.d.length; i++) {
      const v = this.d[i];
      if (v === T) continue;
      const rgb = RGB[v];
      out[i * 4] = rgb[0];
      out[i * 4 + 1] = rgb[1];
      out[i * 4 + 2] = rgb[2];
      out[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}

// =============================================================
// 1) 하늘
//   py: 캔버스 y = 화면 y + py
// =============================================================
export function buildSky(w, h, py) {
  const p = new Pix(w, h);
  for (let cy = 0; cy < h; cy++) {
    const y = cy - py;
    for (let x = 0; x < w; x++) {
      let c;
      // 위에서 아래로: 파랑 → 하늘색 → 밝은 청록 → 흰색 (계단식 디더 밴드)
      if (y < 6) c = C.blue;
      else if (y < 16) c = dith(x, y, y < 9 ? 4 : y < 12 ? 8 : 12) ? C.sky : C.blue;
      else if (y < 40) c = C.sky;
      else if (y < 54) c = dith(x, y, y < 44 ? 4 : y < 49 ? 8 : 12) ? C.cyan : C.sky;
      else if (y < 66) c = C.cyan;
      else if (y < 78) c = dith(x, y, y < 70 ? 4 : y < 74 ? 8 : 12) ? C.white : C.cyan;
      else c = C.white;
      p.set(x, cy, c);
    }
  }
  return p;
}

// 구름 하나 (둥근 혹 여러 개 + 평평한 바닥, 아래쪽 은회색 그늘)
export function buildCloud(rng, w, h) {
  const p = new Pix(w, h);
  const bumps = [];
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const r = Math.max(3, Math.round(h * (0.45 + rng() * 0.5) * (1 - Math.abs(t - 0.5) * 0.9)));
    bumps.push({ cx: Math.round(r + t * (w - 2 * r)), r });
  }
  const bottom = h - 1;
  for (let x = 0; x < w; x++) {
    let top = bottom + 1;
    for (const b of bumps) {
      const dx = x - b.cx + 0.5;
      if (Math.abs(dx) <= b.r) {
        const hgt = Math.round(Math.sqrt(b.r * b.r - dx * dx));
        top = Math.min(top, bottom - hgt + 1);
      }
    }
    top = Math.max(0, top);
    for (let y = top; y <= bottom; y++) {
      let c = C.white;
      if (y === bottom) c = C.silver;
      else if (y === bottom - 1) c = dith(x, y, 8) ? C.silver : C.white;
      p.set(x, y, c);
    }
  }
  // 바닥 양 끝 모서리 깎기 (둥글게)
  for (let x = 0; x < w; x++) {
    if (p.get(x, bottom) !== T && (p.get(x - 1, bottom) === T || p.get(x + 1, bottom) === T)) {
      if (p.get(x, bottom - 1) === T || x === 0 || x === w - 1) p.set(x, bottom, T);
    }
  }
  return p;
}

// =============================================================
// 2) 축제 장식: 삼각 깃발, 청사초롱
// =============================================================
// 삼각 깃발 5×4 (frame 1이면 끝이 바람에 1px 휨)
export function buildFlag(col, frame) {
  const p = new Pix(6, 4);
  const sh = SHADE[col];
  const rows = frame === 0
    ? [[0, 4], [1, 3], [1, 3], [2, 2]]
    : [[0, 4], [1, 3], [2, 4], [3, 3]];
  rows.forEach(([a, b], y) => {
    for (let x = a; x <= b; x++) p.set(x, y, x === b && b > a ? sh : col);
  });
  if (col !== C.white) p.set(rows[0][0], 0, col === C.sand ? C.white : col); // 윗단 그대로
  return p;
}

// 청사초롱 5×10 — 홍색 몸통 + 청색 띠 + 술
export function buildLantern(frame = 0) {
  const p = new Pix(5, 10);
  p.hline(1, 3, 0, C.charcoal); // 위 뚜껑
  // 위 청색 띠
  p.set(0, 1, C.blue); p.set(1, 1, C.sky); p.set(2, 1, C.blue); p.set(3, 1, C.blue); p.set(4, 1, C.navy);
  // 홍색 몸통 (가운데 은은한 빛)
  for (let y = 2; y <= 5; y++) {
    p.set(0, y, C.red);
    p.set(1, y, C.orange);
    p.set(2, y, y === 3 || y === 4 ? C.sand : C.orange);
    p.set(3, y, C.red);
    p.set(4, y, C.plum);
  }
  // 아래 청색 띠
  p.set(0, 6, C.blue); p.set(1, 6, C.blue); p.set(2, 6, C.blue); p.set(3, 6, C.blue); p.set(4, 6, C.navy);
  p.hline(1, 3, 7, C.charcoal); // 아래 뚜껑
  // 술 (살랑)
  const tx = frame === 0 ? 2 : 3;
  p.set(2, 8, C.sand);
  p.set(tx, 9, C.red);
  return p;
}

// 줄(현수선 근사: 포물선)의 y — anchors 간격 P, 시작 a0, 높이 ya, 처짐 sag
export function strandY(x, a0, P, ya, sag) {
  let u = ((x - a0) % P + P) % P / P; // 0..1
  const v = 2 * u - 1;
  return Math.round(ya + sag * (1 - v * v));
}

// 줄 한 가닥을 캔버스용 버퍼로 (높이 hgt, 가로 w, 캔버스 x = 화면 x + px)
export function buildStrand(w, hgt, px, a0, P, ya, sag, col) {
  const p = new Pix(w, hgt);
  let prev = null;
  for (let cx = 0; cx < w; cx++) {
    const y = strandY(cx - px, a0, P, ya, sag);
    p.set(cx, y, col);
    // 기울기가 커서 끊기면 세로로 이어줌
    if (prev !== null && Math.abs(y - prev) > 1) p.vline(cx, prev + Math.sign(y - prev), y, col);
    prev = y;
  }
  // 매듭 지점(앵커)에 작은 매듭
  for (let ax = a0 - P * 4; ax < w + P; ax += P) {
    const cx = ax + px;
    p.set(cx, ya - 1, C.charcoal);
    p.set(cx - 1, ya, C.charcoal);
    p.set(cx + 1, ya, C.charcoal);
  }
  return p;
}

// =============================================================
// 3) 먼 풍경: 산 3겹 + 앞 언덕 숲 + 한옥 기와지붕 마을 + 돌담
// =============================================================
export function buildFar(rng, w, h, px, py) {
  const p = new Pix(w, h);
  const r = () => rng() * Math.PI * 2;
  const p1 = r(), p2 = r(), p3 = r(), p4 = r(), p5 = r(), p6 = r();
  const backTop = (x) => Math.round(58 + 7 * Math.sin(x * 0.019 + p1) + 4 * Math.sin(x * 0.051 + p2) + 2 * Math.sin(x * 0.13 + p3));
  const midTop = (x) => Math.round(72 + 5 * Math.sin(x * 0.031 + p4) + 3 * Math.sin(x * 0.077 + p5));

  // 앞 언덕 숲: 둥근 나무 혹들의 합
  const bumps = [];
  for (let x = -10; x < w + 10;) {
    const rr = 4 + Math.floor(rng() * 5);
    bumps.push({ cx: x, r: rr, base: 88 + Math.round(2 * Math.sin(x * 0.05 + p6)) });
    x += rr + 2 + Math.floor(rng() * 4);
  }
  const hillTop = (x) => {
    let t = 999;
    for (const b of bumps) {
      const dx = x - b.cx;
      if (Math.abs(dx) <= b.r) t = Math.min(t, Math.round(b.base - Math.sqrt(b.r * b.r - dx * dx)));
    }
    return t === 999 ? 90 : t;
  };

  for (let cx = 0; cx < w; cx++) {
    const x = cx - px;
    const bt = backTop(x), btPrev = backTop(x - 1), btNext = backTop(x + 1);
    const mt = midTop(x), mtPrev = midTop(x - 1);
    const ht = hillTop(x);
    for (let cy = 0; cy < h; cy++) {
      const y = cy - py;
      let c = T;
      // 먼 산 (회청색, 왼쪽 비탈 밝은 테두리)
      if (y >= bt) {
        c = C.slate;
        const litSlope = bt < btPrev || (bt === btPrev && bt < btNext);
        if (y === bt && litSlope) c = C.silver;
        else if (y === bt + 1 && litSlope && dith(cx, cy, 8)) c = C.silver;
        else if (y > bt + 1 && y < bt + 5 && litSlope && dith(cx, cy, 2)) c = C.silver;
        // 산 아래쪽은 아지랑이처럼 밝게 디더 (공기 원근)
        if (y > 74 && dith(cx, cy, 4)) c = C.silver;
      }
      // 중간 산 (청록)
      if (y >= mt) {
        c = C.teal;
        const lit = mt < mtPrev;
        if (y === mt) c = lit ? C.green : C.teal;
        else if (y === mt + 1 && lit && dith(cx, cy, 8)) c = C.green;
        else if (dith(cx, cy, 1) && y < mt + 6) c = C.slate;
      }
      // 앞 언덕 숲 (초록 + 연두 하이라이트)
      if (y >= ht) {
        c = C.green;
        if (y === ht) c = C.lime;
        else if (y === ht + 1 && dith(cx, cy, 8)) c = C.lime;
        else if (y > 95) c = dith(cx, cy, 8) ? C.teal : C.green;
        else if (hash2(cx, cy, 7) < 0.06) c = C.teal;
      }
      if (c !== T) p.set(cx, cy, c);
    }
  }
  // 마을 나무(둥근) — 집들 사이
  const tree = (tx, base, rr) => {
    for (let y = -rr * 2; y <= 0; y++) {
      for (let x = -rr; x <= rr; x++) {
        const dy = y + rr;
        if (x * x + dy * dy <= rr * rr + rr * 0.6) {
          let c = C.green;
          if (x + dy < -rr * 0.5) c = dith(tx + x, base + y, 10) ? C.lime : C.green;
          else if (x - dy > rr * 0.4 || dy > rr * 0.5) c = dith(tx + x, base + y, 6) ? C.teal : C.green;
          p.set(tx + x + px, base + y - 2 + py, c);
        }
      }
    }
    p.vline(tx + px, base - 1 + py, base + 3 + py, C.plum);
  };

  // 한옥 (기와지붕: 처마 끝이 살짝 들린 곡선)
  const hanok = (cx0, ww, eaveY, rh) => {
    const halfW = Math.round(ww / 2) + 4;
    const L = cx0 - halfW, R = cx0 + halfW;
    const ridgeY = eaveY - rh + 1;
    const ridgeFrac = 0.55;
    const slopeH = rh - 4;
    // 벽 (흰 회벽 + 기둥 + 창호지 창)
    const wl = cx0 - Math.round(ww / 2) + 1, wr = cx0 + Math.round(ww / 2) - 1;
    for (let y = eaveY + 1; y <= 101; y++) {
      for (let x = wl; x <= wr; x++) {
        let c = C.white;
        if (y === eaveY + 1) c = C.silver; // 처마 그늘
        p.set(x + px, y + py, c);
      }
    }
    for (let x = wl; x <= wr; x += 6) p.vline(x + px, eaveY + 1 + py, 101 + py, C.plum);
    p.vline(wr + px, eaveY + 1 + py, 101 + py, C.plum);
    for (let x = wl + 2; x + 2 < wr; x += 6) {
      p.rect(x + px, eaveY + 3 + py, 3, 2, C.sand);
      p.set(x + 1 + px, eaveY + 3 + py, C.orange);
    }
    // 지붕
    for (let x = L; x <= R; x++) {
      const dx = Math.abs(x - cx0 + 0.5) / halfW;
      const top = ridgeY + (dx > ridgeFrac ? Math.round(((dx - ridgeFrac) / (1 - ridgeFrac)) * slopeH) : 0);
      const lift = Math.round(3.2 * Math.pow(dx, 2.6));
      const bot = eaveY - lift;
      for (let y = top; y <= bot; y++) {
        let c = (x % 3 === 0) ? C.slate : C.charcoal; // 기와골
        if (y === top) c = dx <= ridgeFrac ? (x < cx0 ? C.silver : C.slate) : C.slate; // 용마루/내림마루
        else if (y === bot) c = (x & 1) ? C.silver : C.slate; // 막새 기와 끝
        else if (y === top + 1) c = C.ink; // 마루 밑 그늘
        else if (y === bot - 1) c = C.ink; // 처마 밑 그늘선
        p.set(x + px, y + py, c);
      }
    }
    // 용마루 양 끝 치켜올림 + 처마 끝 반짝
    const rl = Math.round(cx0 - halfW * ridgeFrac), rr2 = Math.round(cx0 + halfW * ridgeFrac) - 1;
    p.set(rl + px, ridgeY - 1 + py, C.silver);
    p.set(rr2 + px, ridgeY - 1 + py, C.slate);
    p.set(L - 1 + px, eaveY - 3 + py, C.slate);
    p.set(R + 1 + px, eaveY - 3 + py, C.slate);
  };

  // 마을 배치: 집과 나무를 번갈아
  let x = -px + 2;
  let k = 0;
  while (x < w - px) {
    const ww = 20 + Math.floor(rng() * 14);
    const rh = 8 + Math.floor(rng() * 3);
    const eaveY = 92 + Math.floor(rng() * 2);
    const cx0 = x + Math.round(ww / 2) + 4;
    if (rng() < 0.55) tree(x + 1 + Math.floor(rng() * 3), 96, 4 + Math.floor(rng() * 3));
    hanok(cx0, ww, eaveY, rh);
    x = cx0 + Math.round(ww / 2) + 4 + 3 + Math.floor(rng() * 12);
    if (k % 2 === 1 && rng() < 0.7) {
      tree(x + 4, 95, 5 + Math.floor(rng() * 3));
      x += 10;
    }
    k++;
  }

  // 돌담 (기와 얹은 낮은 담장): 화면 y 97~101
  for (let cx = 0; cx < w; cx++) {
    p.set(cx, 96 + py, C.charcoal); // 담 위 기와
    p.set(cx, 97 + py, (cx % 3 === 0) ? C.ink : C.slate);
    for (let y = 98; y <= 104; y++) {
      // 엇갈린 돌 쌓기 무늬
      const row = Math.floor((y - 98) / 2);
      const off = row % 2 ? 2 : 0;
      const mortar = ((cx + off) % 5 === 0) || ((y - 98) % 2 === 1 && hash2(cx, y, 3) < 0.25);
      let c = mortar ? C.slate : C.silver;
      if (!mortar && (cx + off) % 5 === 1 && (y - 98) % 2 === 0) c = C.white;
      p.set(cx, y + py, c);
    }
  }
  return p;
}

// =============================================================
// 4) 건너편 둑 (관중이 서는 풀밭) + 오방색 깃발 장대
// =============================================================
export function buildBank(rng, w, h, px, py) {
  const p = new Pix(w, h);
  const topY = (cx) => 102 - (hash2(cx, 0, 11) < 0.18 ? 1 : 0);
  for (let cx = 0; cx < w; cx++) {
    const ty = topY(cx);
    for (let y = ty; y < h - py; y++) {
      let c = C.green;
      if (y === ty) c = C.lime;
      else if (y === ty + 1) c = dith(cx, y, 8) ? C.lime : C.green;
      else if (y > 124) c = dith(cx, y, y < 127 ? 4 : y < 130 ? 8 : 12) ? C.teal : C.green;
      else {
        const n = hash2(cx, y, 5);
        if (n < 0.05) c = C.lime;
        else if (n < 0.08) c = C.teal;
      }
      p.set(cx, y + py, c);
    }
    // 풀잎 삐침
    if (hash2(cx, 1, 13) < 0.12) p.set(cx, ty - 1 + py, C.lime);
  }
  // 작은 들꽃
  for (let i = 0; i < 34; i++) {
    const cx = Math.floor(rng() * w);
    const y = 104 + Math.floor(rng() * 22);
    const col = [C.sand, C.white, C.red, C.sky][Math.floor(rng() * 4)];
    p.set(cx, y + py, col);
    if (rng() < 0.5) p.set(cx, y + 1 + py, C.teal);
  }
  return p;
}

// 오방색 깃발 장대 (정적인 장대 + 펄럭이는 깃발은 frame별로)
//   반환 버퍼는 폭 12, 높이 54. 기준점: 장대 아래 끝 (ax=2, ay=53)
export function buildBannerPole(frame, dir = 1) {
  const p = new Pix(12, 54);
  const poleX = dir > 0 ? 2 : 9;
  // 장대 (나무: 주황 + 빨강 그늘)
  for (let y = 4; y <= 53; y++) {
    p.set(poleX, y, C.orange);
    p.set(poleX + (dir > 0 ? 1 : -1), y, C.red);
  }
  // 꼭대기 장식 (둥근 금색 + 빨간 술)
  p.set(poleX, 1, C.sand); p.set(poleX + (dir > 0 ? 1 : -1), 1, C.sand);
  p.set(poleX, 2, C.sand); p.set(poleX + (dir > 0 ? 1 : -1), 2, C.orange);
  p.set(poleX, 0, C.white);
  p.set(poleX, 3, C.red); p.set(poleX + (dir > 0 ? 1 : -1), 3, C.red);
  // 가로대
  const bx0 = dir > 0 ? poleX + 2 : poleX - 8;
  p.hline(bx0, bx0 + 6, 5, C.plum);
  // 세로 깃발: 청·적·황·백·흑(남색) 오방색 줄무늬
  const stripes = [C.blue, C.red, C.sand, C.white, C.navy];
  const fx0 = dir > 0 ? poleX + 3 : poleX - 7;
  for (let y = 6; y < 6 + 25; y++) {
    const s = stripes[Math.floor((y - 6) / 5)];
    // 아래로 갈수록 바람에 살짝 밀림
    const sway = frame === 1 && y > 18 ? (dir > 0 ? 1 : -1) * (y > 26 ? 2 : 1) : 0;
    for (let i = 0; i < 5; i++) {
      const c = i === 4 ? SHADE[s] : s;
      p.set(fx0 + i + sway, y, c);
    }
  }
  // 아래 술 (지그재그)
  const sw = frame === 1 ? (dir > 0 ? 2 : -2) : 0;
  for (let i = 0; i < 5; i++) if (i % 2 === 0) p.set(fx0 + i + sw, 31, C.red);
  for (let i = 0; i < 5; i++) if (i % 2 === 1) p.set(fx0 + i + sw, 32, C.sand);
  return p;
}

// =============================================================
// 5) 관중 한 명 (pose: 0 대기, 1 만세, 2 손 흔들기)
//   버퍼 11×20, 기준점(발 중앙 바닥) ax=5, ay=20 (마지막 줄 19는 외곽선)
// =============================================================
export const VILLAGER_W = 11;
export const VILLAGER_H = 20;
export const VILLAGER_AX = 5;

export function buildVillager(s, pose) {
  const p = new Pix(VILLAGER_W, VILLAGER_H);
  const fy = 18; // 신발 줄
  const legH = s.kid ? 2 : 3;
  const torsoH = s.kid ? 2 : 3;
  const legTop = fy - legH + 1;
  const torsoTop = legTop - torsoH;
  const face1 = torsoTop - 2, face2 = torsoTop - 1;
  const hairRow = torsoTop - 3;
  const sh = SHADE[s.shirt];

  // 다리/하의
  if (s.skirt) {
    for (let y = legTop; y < fy; y++) p.hline(y === legTop ? 4 : 3, y === legTop ? 6 : 7, y, y === fy - 1 ? SHADE[s.pants] : s.pants);
  } else {
    p.hline(4, 6, legTop, s.pants);
    for (let y = legTop + 1; y < fy; y++) { p.set(4, y, s.pants); p.set(6, y, SHADE[s.pants]); }
  }
  p.set(4, fy, s.shoe);
  p.set(6, fy, s.shoe);

  // 몸통 (오른쪽 그늘)
  for (let y = torsoTop; y < torsoTop + torsoH; y++) {
    p.set(4, y, s.shirt);
    p.set(5, y, s.shirt);
    p.set(6, y, sh);
  }
  if (s.shirt === C.white) p.set(5, torsoTop + 1, C.red); // 한복 고름
  if (s.belt != null) p.hline(4, 6, torsoTop + torsoH - 1, s.belt);

  // 팔
  const hand = s.skin;
  let lh, rh; // 손 위치 (소품용)
  if (pose === 0) {
    for (let y = torsoTop; y < torsoTop + torsoH - 1; y++) { p.set(3, y, s.shirt); p.set(7, y, sh); }
    p.set(3, torsoTop + torsoH - 1, hand);
    p.set(7, torsoTop + torsoH - 1, hand);
    lh = [3, torsoTop + torsoH - 1];
    rh = [7, torsoTop + torsoH - 1];
  } else if (pose === 1) {
    // 만세: 팔을 위로 쭉
    p.set(3, torsoTop, s.shirt); p.set(7, torsoTop, sh);
    for (let y = torsoTop - 3; y < torsoTop; y++) { p.set(3, y, s.shirt); p.set(7, y, sh); }
    p.set(3, torsoTop - 4, hand); p.set(7, torsoTop - 4, hand);
    lh = [3, torsoTop - 4];
    rh = [7, torsoTop - 4];
  } else {
    // 손 흔들기: V자로 벌림
    p.set(3, torsoTop, s.shirt); p.set(7, torsoTop, sh);
    p.set(3, torsoTop - 1, s.shirt); p.set(7, torsoTop - 1, sh);
    p.set(2, torsoTop - 2, s.shirt); p.set(8, torsoTop - 2, sh);
    p.set(2, torsoTop - 3, hand); p.set(8, torsoTop - 3, hand);
    lh = [2, torsoTop - 3];
    rh = [8, torsoTop - 3];
  }

  // 얼굴
  p.hline(4, 6, face1, s.skin);
  p.set(4, face2, s.skin); p.set(5, face2, s.skin); p.set(6, face2, s.skinSh);

  // 머리 모양
  const hc = s.hair;
  switch (s.hairStyle) {
    case 'bald':
      p.set(4, hairRow, hc); p.set(5, hairRow, s.skin); p.set(6, hairRow, hc);
      break;
    case 'long':
      p.hline(4, 6, hairRow, hc);
      p.set(3, face1, hc); p.set(7, face1, hc);
      p.set(3, face2, hc); p.set(7, face2, hc);
      break;
    case 'bun':
      p.hline(4, 6, hairRow, hc);
      p.set(5, hairRow - 1, hc);
      if (s.pin != null) p.set(6, hairRow - 1, s.pin);
      break;
    case 'topknot':
      p.hline(4, 6, hairRow, hc);
      p.set(5, hairRow - 1, hc);
      p.set(5, hairRow - 2, hc);
      break;
    case 'pigtails':
      p.hline(4, 6, hairRow, hc);
      p.set(3, face1, hc); p.set(7, face1, hc);
      break;
    case 'side':
      p.hline(4, 6, hairRow, hc);
      p.set(4, face1, hc);
      break;
    case 'hat':
      // 밀짚모자
      p.hline(3, 7, hairRow, C.sand);
      p.set(7, hairRow, C.orange);
      p.hline(4, 6, hairRow - 1, C.red);
      p.hline(4, 6, hairRow - 2, C.sand);
      break;
    default:
      p.hline(4, 6, hairRow, hc);
  }
  if (s.headband != null && s.hairStyle !== 'hat') p.hline(4, 6, hairRow, s.headband);

  // 외곽선
  p.outline(C.ink);

  // 소품 (외곽선 없이 위에 덧그림)
  if (s.prop === 'flag') {
    const [hx, hy] = rh;
    const sx = pose === 0 ? 8 : hx;
    const top = Math.max(1, hy - 6);
    p.vline(sx, top, hy - 1, C.sand);
    const fc = s.propColor;
    const fdx = pose === 2 ? 1 : 0;
    p.set(sx + 1, top, fc); p.set(sx + 2, top, fc);
    p.set(sx + 1, top + 1, SHADE[fc]); p.set(sx + 2 + fdx, top + 1, fc);
    if (pose === 0) p.set(8, hy, s.skin);
  } else if (s.prop === 'towel') {
    if (pose === 0) {
      p.set(4, torsoTop, C.white); p.set(5, torsoTop, s.propColor); p.set(6, torsoTop, C.white);
      p.set(6, torsoTop + 1, C.white);
    } else {
      const ty = lh[1];
      for (let x = lh[0] + 1; x < rh[0]; x++) p.set(x, ty, (x === 5) ? s.propColor : C.white);
      if (pose === 2) { p.set(lh[0] + 1, ty + 1, C.white); p.set(rh[0] - 1, ty - 1, C.white); }
    }
  } else if (s.prop === 'balloon') {
    const [hx, hy] = pose === 0 ? rh : rh;
    const bx = Math.min(VILLAGER_W - 2, hx + 1);
    const by = Math.max(1, hy - 7);
    const bc = s.propColor;
    p.set(bx, by - 1, bc);
    p.set(bx - 1, by, bc); p.set(bx, by, C.white); p.set(bx + 1, by, bc);
    p.set(bx, by + 1, SHADE[bc]);
    p.vline(bx, by + 2, hy - 1, C.silver);
  }
  return p;
}

// 관중 외형 무작위 생성
const SHIRTS = [C.red, C.blue, C.green, C.orange, C.sky, C.cyan, C.sand, C.white, C.lime, C.plum, C.white, C.red];
const PANTS = [C.navy, C.charcoal, C.slate, C.plum, C.navy];
const SKIRTS = [C.red, C.blue, C.plum, C.sky, C.green, C.orange];
const HAIRS = [C.ink, C.charcoal, C.plum, C.navy, C.charcoal, C.ink, C.orange];
const PROP_COLORS = [C.red, C.blue, C.sand, C.green, C.white, C.sky];

export function randomVillager(rng, { kidChance = 0.2 } = {}) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const kid = rng() < kidChance;
  const elder = !kid && rng() < 0.15;
  const female = rng() < 0.5;
  let hairStyle;
  if (elder) hairStyle = female ? 'bun' : (rng() < 0.5 ? 'bald' : 'topknot');
  else if (kid) hairStyle = female ? 'pigtails' : pick(['short', 'side', 'short']);
  else hairStyle = female ? pick(['long', 'bun', 'side', 'long']) : pick(['short', 'side', 'short', 'topknot']);
  if (!kid && rng() < 0.1) hairStyle = 'hat';
  const shirt = pick(SHIRTS);
  let prop = null;
  const pr = rng();
  if (kid) prop = pr < 0.35 ? 'balloon' : pr < 0.6 ? 'flag' : null;
  else prop = pr < 0.22 ? 'flag' : pr < 0.38 ? 'towel' : null;
  let propColor = pick(PROP_COLORS);
  if (prop === 'balloon' && propColor === C.white) propColor = C.red;
  if (prop === 'flag' && propColor === shirt) propColor = shirt === C.red ? C.blue : C.red;
  return {
    kid,
    elder,
    hair: elder ? pick([C.silver, C.white, C.silver]) : pick(HAIRS),
    hairStyle,
    pin: rng() < 0.5 ? C.sand : C.red,
    skin: C.sand,
    skinSh: C.orange,
    shirt,
    pants: female && !kid && rng() < 0.7 ? pick(SKIRTS) : pick(PANTS),
    skirt: female && (kid ? rng() < 0.5 : rng() < 0.7),
    shoe: rng() < 0.7 ? C.charcoal : C.white,
    belt: !female && rng() < 0.25 ? C.red : null,
    headband: !elder && rng() < 0.12 ? C.red : null,
    prop,
    propColor,
  };
}

// =============================================================
// 6) 무대: 앞 둑 자갈 모래톱 + 개울물 기본 밴드
// =============================================================
export function buildStageBase(rng, w, h, px, py, waterY) {
  const p = new Pix(w, h);
  // 모래톱 (화면 y 131~waterY-1)
  for (let cx = 0; cx < w; cx++) {
    const top = 131 + (hash2(cx, 2, 17) < 0.3 ? 1 : 0);
    // 둑에서 내려오는 풀 가장자리
    p.set(cx, top - 1 + py, hash2(cx, 3, 19) < 0.5 ? C.green : C.teal);
    if (hash2(cx, 4, 23) < 0.25) p.set(cx, top - 2 + py, C.lime);
    for (let y = top; y < waterY; y++) {
      let c = C.sand;
      if (y === top) c = dith(cx, y, 8) ? C.orange : C.sand; // 풀 밑 그늘
      else if (y >= waterY - 3) c = dith(cx, y, y === waterY - 1 ? 12 : 6) ? C.orange : C.sand; // 젖은 모래
      else if (hash2(cx, y, 29) < 0.025) c = C.orange;
      p.set(cx, y + py, c);
    }
  }
  // 자갈 (작은 타원: 은회색 + 아래 회색 + 흰 반짝)
  for (let i = 0; i < Math.floor(w / 7); i++) {
    const gx = Math.floor(rng() * w);
    const gy = 133 + Math.floor(rng() * (waterY - 135));
    const gw = 2 + Math.floor(rng() * 3);
    const gh = rng() < 0.4 ? 2 : 1;
    const base = rng() < 0.3 ? C.slate : C.silver;
    for (let x = 0; x < gw; x++) {
      for (let y = 0; y < gh; y++) {
        let c = base;
        if (y === gh - 1 && gh > 1) c = SHADE[base];
        if (x === 0 && y === 0 && base === C.silver) c = C.white;
        p.set(gx + x, gy + y + py, c);
      }
    }
    p.hline(gx, gx + gw - 1, gy + gh + py, C.orange); // 자갈 그림자
  }

  // 개울물: 위(얕은 곳)는 밝게, 아래로 갈수록 깊은 청록 → 남색 (디더 밴드)
  for (let cy = waterY + py; cy < h; cy++) {
    const y = cy - py;
    for (let cx = 0; cx < w; cx++) {
      let c;
      if (y === waterY) c = C.cyan;
      else if (y < waterY + 4) c = dith(cx, y, 8) ? C.cyan : C.sky;
      else if (y < waterY + 11) c = C.sky;
      else if (y < waterY + 15) c = dith(cx, y, y < waterY + 13 ? 6 : 10) ? C.teal : C.sky;
      else if (y < waterY + 24) c = C.teal;
      else if (y < waterY + 31) c = dith(cx, y, y < waterY + 27 ? 4 : 8) ? C.navy : C.teal;
      else c = dith(cx, y, 3) ? C.teal : C.navy;
      p.set(cx, cy, c);
    }
  }
  // 정적인 물결 결 (가로 줄무늬)
  for (let i = 0; i < Math.floor(w / 6); i++) {
    const y = waterY + 5 + Math.floor(rng() * 32);
    const len = 4 + Math.floor(rng() * 14);
    const x0 = Math.floor(rng() * w);
    let c;
    if (y < waterY + 11) c = C.cyan;
    else if (y < waterY + 24) c = C.sky;
    else c = C.teal;
    for (let x = x0; x < x0 + len; x++) {
      if (y >= waterY + 24 && (x & 1)) continue;
      p.set(x, y + py, c);
    }
  }
  // 수면에 비친 둑 그림자 힌트 (맨 위 몇 줄, 듬성듬성 초록)
  for (let cx = 0; cx < w; cx++) {
    if (hash2(cx, 9, 31) < 0.12) p.set(cx, waterY + 1 + py, C.green);
    if (hash2(cx, 10, 37) < 0.06) p.set(cx, waterY + 2 + py, C.sand);
  }
  return p;
}

// =============================================================
// 7) 징검돌 (폭 w, 높이 h). 0행 = 윗면 외곽선(발이 닿는 줄)
//   반환: { dry: Pix, wet: Pix } — wet는 물속 색으로 바꾼 판
// =============================================================
export function buildStone(rng, w, h, { moss = 0.5, round = 0 } = {}) {
  const p = new Pix(w, h);
  const inset = (y) => {
    // 위쪽 모서리는 둥글게, 아래는 살짝 오므림
    if (y === 0) return 2 + round;
    if (y === 1) return 1 + (round > 1 ? 1 : 0);
    if (y >= h - 2) return y === h - 1 ? 2 : 1;
    return 0;
  };
  for (let y = 0; y < h; y++) {
    const a = inset(y), b = w - 1 - inset(y);
    for (let x = a; x <= b; x++) {
      let c;
      if (x === a || x === b || y === 0 || y === h - 1) c = C.ink; // 외곽선
      else if (y <= 2) {
        // 윗면 (밝은 은회색 + 흰 반짝)
        c = C.silver;
        if (y === 1 && x <= a + 3) c = C.white;
        else if (y === 2 && x >= b - 2) c = C.slate;
      } else if (y === 3) c = dith(x, y, 8) ? C.slate : C.silver; // 앞모서리
      else {
        // 옆면 (회색, 왼쪽 밝고 오른쪽 어둡게)
        c = C.slate;
        if (x === a + 1 && y < 7) c = C.silver;
        else if (x >= b - 2) c = x === b - 1 ? C.charcoal : (dith(x, y, 8) ? C.charcoal : C.slate);
        else if (y > 7 && dith(x, y, 6)) c = C.charcoal;
        else if (hash2(x, y, 41) < 0.08) c = C.charcoal;
      }
      p.set(x, y, c);
    }
  }
  // 이끼: 윗모서리 가장자리 + 옆으로 흘러내림 (발 딛는 가운데는 비움)
  const mid0 = Math.floor(w / 2) - 2, mid1 = Math.floor(w / 2) + 1;
  for (let x = 1; x < w - 1; x++) {
    if (x >= mid0 && x <= mid1) continue;
    if (rng() < moss) {
      const top = inset(0) <= x && x <= w - 1 - inset(0) ? 0 : 1;
      if (p.get(x, top + 1) !== T) p.set(x, top + 1, C.green);
      if (rng() < 0.5 && p.get(x, top + 2) !== T) p.set(x, top + 2, rng() < 0.5 ? C.lime : C.green);
      if (rng() < 0.3 && top === 0) p.set(x, 0, C.green);
    }
  }
  // 옆면 이끼 방울
  for (let i = 0; i < Math.round(moss * 4); i++) {
    const side = rng() < 0.5;
    const x = side ? 1 : w - 2;
    const y = 3 + Math.floor(rng() * 3);
    if (p.get(x, y) !== T) p.set(x, y, C.green);
    if (p.get(x, y + 1) !== T && rng() < 0.6) p.set(x, y + 1, C.teal);
  }
  const wet = p.remap(WET);
  // 물속 아래쪽은 점점 물에 녹아들게 (체커로 비우기)
  for (let y = h - 4; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const lv = [3, 6, 10, 14][y - (h - 4)];
      if (dith(x, y, lv)) wet.d[i] = T;
    }
  }
  return { dry: p, wet };
}

// =============================================================
// 8) 앞쪽 갈대/부들/풀 덤불 (구석). sway(-2..2)만큼 끝이 휘는 판 생성
//   spec.side: -1 왼쪽 구석, 1 오른쪽 구석. 버퍼 크기 cw×ch, 바닥 = ch-1
// =============================================================
export function makeReedSpec(rng, side, cw, ch) {
  const stalks = [];
  const leaves = [];
  const tufts = [];
  const edge = (fx) => (side < 0 ? fx : cw - 1 - fx); // 구석 기준 x
  const n = 9 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const fx = 3 + Math.floor(rng() * 38);
    stalks.push({
      x: edge(fx),
      base: ch - 4 - Math.floor(rng() * 6),
      len: 26 + Math.floor(rng() * 24) - Math.floor(fx / 2),
      lean: (rng() - 0.3) * 4 * -side, // 화면 안쪽으로 살짝 기울기
      cattail: rng() < 0.45,
      col: rng() < 0.5 ? C.green : C.teal,
      flex: 0.8 + rng() * 0.6,
    });
  }
  for (let i = 0; i < 14; i++) {
    const fx = 2 + Math.floor(rng() * 40);
    leaves.push({
      x: edge(fx),
      base: ch - 3 - Math.floor(rng() * 5),
      len: 12 + Math.floor(rng() * 16),
      arc: (4 + rng() * 8) * (rng() < 0.6 ? -side : side),
      col: rng() < 0.55 ? C.lime : C.green,
      flex: 0.7 + rng() * 0.6,
    });
  }
  for (let i = 0; i < 16; i++) {
    const fx = Math.floor(rng() * 52);
    tufts.push({ x: edge(fx), base: ch - 1 - Math.floor(rng() * 4), len: 3 + Math.floor(rng() * 5), dir: rng() < 0.5 ? -1 : 1 });
  }
  return { side, cw, ch, stalks, leaves, tufts };
}

export function buildReeds(spec, sway) {
  const { side, cw, ch } = spec;
  const p = new Pix(cw, ch);
  // 바닥 둔덕 (진한 초록 흙/풀)
  for (let x = 0; x < cw; x++) {
    const fx = side < 0 ? x : cw - 1 - x;
    const top = Math.round(ch - 11 + (fx / 50) * (fx / 50) * 12);
    for (let y = Math.max(0, top); y < ch; y++) {
      let c = C.teal;
      if (y === top) c = C.green;
      else if (y === top + 1) c = dith(x, y, 8) ? C.green : C.teal;
      else if (y > top + 4) c = dith(x, y, 6) ? C.navy : C.teal;
      p.set(x, y, c);
    }
  }
  const bend = (k, len, flex) => sway * flex * Math.pow(k / Math.max(1, len), 2);
  // 줄기 + 부들 이삭
  for (const s of spec.stalks) {
    let tipX = s.x, tipY = s.base;
    for (let k = 0; k <= s.len; k++) {
      const x = Math.round(s.x + s.lean * (k / s.len) + bend(k, s.len, s.flex * 1.4));
      const y = s.base - k;
      p.set(x, y, k > s.len - 3 ? C.green : s.col);
      tipX = x; tipY = y;
    }
    if (s.cattail) {
      // 부들 이삭 (진한 자주 + 빨강 하이라이트) 2×5, 위에 뾰족한 끝
      const hx = tipX, hy = tipY + 3;
      for (let j = 0; j < 5; j++) {
        p.set(hx, hy + j, j === 0 ? C.red : C.plum);
        p.set(hx + 1, hy + j, C.plum);
      }
      p.set(hx - 1, hy + 1, C.ink);
      p.set(hx + 2, hy + 2, C.ink);
    }
  }
  // 긴 잎 (아치 모양)
  for (const l of spec.leaves) {
    let prevX = null;
    for (let k = 0; k <= l.len; k++) {
      const u = k / l.len;
      const x = Math.round(l.x + l.arc * u * u + bend(k, l.len, l.flex));
      const y = Math.round(l.base - k + Math.max(0, (u - 0.7) * 6) * (Math.abs(l.arc) > 8 ? 1 : 0));
      p.set(x, y, l.col);
      if (prevX !== null && Math.abs(x - prevX) > 1) p.set(Math.round((x + prevX) / 2), y + 1, l.col);
      if (k < l.len * 0.4) p.set(x + (l.arc > 0 ? -1 : 1), y, C.green); // 잎 밑동 두께
      prevX = x;
    }
  }
  // 짧은 풀 다발
  for (const t of spec.tufts) {
    for (let k = 0; k < t.len; k++) {
      const x = Math.round(t.x + t.dir * (k / 3) + bend(k, 8, 0.6));
      p.set(x, t.base - k, k === t.len - 1 ? C.lime : C.green);
      p.set(t.x - t.dir, t.base - Math.floor(k / 2), C.lime);
    }
  }
  return p;
}
