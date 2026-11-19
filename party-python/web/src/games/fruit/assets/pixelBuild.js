// ============================================================
//  픽셀 아트 빌더 — 스프라이트를 "2차원 배열 + 팔레트 인덱스"로 만든다.
//  격자(grid)의 값: -1 = 투명, 0~15 = 팔레트 인덱스
// ============================================================

export const T = -1; // 투명

export function makeGrid(w, h, fill = T) {
  return Array.from({ length: h }, () => new Array(w).fill(fill));
}

export function cloneGrid(g) {
  return g.map((row) => row.slice());
}

// 문자열 행 배열 → 격자. '.' = 투명, 0-9/a-f = 팔레트 인덱스
export function parseRows(rows) {
  return rows.map((row) => [...row].map((ch) => (ch === '.' ? T : parseInt(ch, 16))));
}

// 문자열 행을 기존 격자 위에 덮어 그린다. '.' 는 원래 픽셀 유지
export function overlay(grid, rows, ox, oy) {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const gy = oy + y;
      const gx = ox + x;
      if (gy < 0 || gy >= grid.length || gx < 0 || gx >= grid[0].length) return;
      grid[gy][gx] = ch === '_' ? T : parseInt(ch, 16);
    });
  });
  return grid;
}

/**
 * 타원 여러 개를 합친 모양을 셀 셰이딩으로 칠한다.
 * blobs: [{cx, cy, rx, ry}], ramp: [그림자, 기본, 밝음, 하이라이트]
 * tint(x, y, level, nx, ny): 특정 픽셀 색을 바꾸고 싶을 때 팔레트 인덱스를 반환
 */
export function blobShape(w, h, blobs, { ramp, outline = 0, tint = null } = {}) {
  const grid = makeGrid(w, h);
  const LX = -0.62;
  const LY = -0.72; // 왼쪽 위에서 오는 빛
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let best = null;
      for (const b of blobs) {
        const nx = (px - b.cx) / b.rx;
        const ny = (py - b.cy) / b.ry;
        const d = nx * nx + ny * ny;
        if (d <= 1 && (!best || d < best.d)) best = { nx, ny, d };
      }
      if (!best) continue;
      const z = Math.sqrt(Math.max(0, 1 - best.d));
      const l = LX * best.nx + LY * best.ny + 0.28 * z;
      // 그라데이션 대신 4단계 색으로 끊어서 칠함 (셀 셰이딩)
      const level = l > 0.9 ? 3 : l > 0.56 ? 2 : l < -0.28 ? 0 : 1;
      let c = ramp[level];
      if (tint) {
        const t = tint(x, y, level, best.nx, best.ny);
        if (t !== undefined && t !== null) c = t;
      }
      grid[y][x] = c;
    }
  }
  return addOutline(grid, outline);
}

// 모양 가장자리(상하좌우 중 하나라도 투명과 맞닿은 픽셀)를 외곽선 색으로
export function addOutline(grid, outline) {
  const h = grid.length;
  const w = grid[0].length;
  const src = cloneGrid(grid);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y][x] === T) continue;
      const edge =
        y === 0 || x === 0 || y === h - 1 || x === w - 1 ||
        src[y - 1][x] === T || src[y + 1][x] === T || src[y][x - 1] === T || src[y][x + 1] === T;
      if (edge) grid[y][x] = outline;
    }
  }
  return grid;
}

// 다각형 내부 판정 (별 모양 아이템용)
export function polygonMask(w, h, points) {
  const mask = makeGrid(w, h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      mask[y][x] = inside ? 1 : 0;
    }
  }
  return mask;
}

// 하이라이트를 한 칸 넓혀 "반짝" 프레임을 만든다 (대기 애니메이션 2프레임용)
export function shineFrame(grid, lightIdx, hiIdx) {
  const out = cloneGrid(grid);
  for (let y = 1; y < grid.length - 1; y++) {
    for (let x = 1; x < grid[0].length - 1; x++) {
      if (grid[y][x] !== lightIdx) continue;
      if (grid[y - 1][x] === hiIdx || grid[y][x - 1] === hiIdx || grid[y + 1][x] === hiIdx || grid[y][x + 1] === hiIdx) {
        out[y][x] = hiIdx;
      }
    }
  }
  return out;
}

// 특정 색을 다른 색으로 바꾼 사본 (팔레트 스왑)
export function swapColors(grid, map) {
  return grid.map((row) => row.map((c) => (c in map ? map[c] : c)));
}

// 격자에 1px 둘레(바깥쪽)를 추가로 칠한다 — 아이템 발광 테두리용
export function outerGlow(grid, color) {
  const h = grid.length;
  const w = grid[0].length;
  const out = cloneGrid(grid);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] !== T) continue;
      const near =
        (y > 0 && grid[y - 1][x] !== T) || (y < h - 1 && grid[y + 1][x] !== T) ||
        (x > 0 && grid[y][x - 1] !== T) || (x < w - 1 && grid[y][x + 1] !== T);
      if (near) out[y][x] = color;
    }
  }
  return out;
}
