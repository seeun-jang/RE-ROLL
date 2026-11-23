// =============================================================
// 레이싱 그림 만들기 — 트랙 전체 그림(잔디·연석·아스팔트·출발선·나무)과 차 그림(32방향)
// 모두 코드로 그리는 픽셀 아트다. 반투명 가장자리가 생기지 않게 층마다 알파를 이진화해 찍는다.
// =============================================================

const COL = {
  grass: [62, 137, 72], grassDark: [38, 92, 66], grassLight: [99, 199, 77],
  curbRed: [228, 59, 68], curbWhite: [255, 255, 255],
  road: [58, 68, 102], roadDark: [38, 43, 68], roadLight: [90, 105, 136],
  line: [192, 203, 220], startDark: [24, 20, 37], startLight: [255, 255, 255],
  trunk: [115, 62, 57], leaf: [25, 60, 62], leafMid: [38, 92, 66], leafLight: [62, 137, 72],
  flowerA: [254, 231, 97], flowerB: [246, 117, 122], flowerC: [255, 255, 255],
};

/** 정해진 씨앗으로 늘 같은 난수를 낸다(모든 화면의 나무 위치가 같도록) */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 트랙 전체를 한 장의 캔버스로 그린다 */
export function buildWorldCanvas(world, track) {
  const W = world.W;
  const H = world.H;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const out = g.createImageData(W, H);
  const data = out.data;
  const rnd = seeded(20261118);
  const put = (i, c) => {
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  };

  // 잔디: 바탕 + 드문드문 짙고 옅은 풀
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = rnd();
      put((y * W + x) * 4, r < 0.035 ? COL.grassDark : r < 0.05 ? COL.grassLight : COL.grass);
    }
  }

  // 도로 층: 굵은 선으로 그린 뒤 알파를 이진화해 색을 찍는다
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const tg = tmp.getContext('2d', { willReadFrequently: true });
  const stroke = (width, dash) => {
    tg.clearRect(0, 0, W, H);
    tg.lineJoin = 'round';
    tg.lineCap = dash ? 'butt' : 'round';
    tg.lineWidth = width;
    tg.strokeStyle = '#fff';
    tg.setLineDash(dash || []);
    tg.beginPath();
    tg.moveTo(track.x[0], track.y[0]);
    for (let i = 1; i < track.x.length; i++) tg.lineTo(track.x[i], track.y[i]);
    tg.closePath();
    tg.stroke();
    return tg.getImageData(0, 0, W, H).data;
  };
  const layer = (mask, color) => {
    for (let i = 0; i < W * H; i++) {
      if (mask[i * 4 + 3] < 128) continue;
      put(i * 4, typeof color === 'function' ? color(i) : color);
    }
  };
  const half = track.half;
  layer(stroke(half * 2 + 6), COL.curbRed);                 // 연석(빨강)
  layer(stroke(half * 2 + 6, [9, 9]), COL.curbWhite);       // 연석(흰 줄무늬)
  layer(stroke(half * 2), () => {                           // 아스팔트 + 자잘한 얼룩
    const r = rnd();
    return r < 0.04 ? COL.roadDark : r < 0.07 ? COL.roadLight : COL.road;
  });
  layer(stroke(2, [8, 12]), COL.line);                      // 가운데 점선

  // 출발·결승선: 도로를 가로지르는 체크무늬
  const dx = track.x[1] - track.x[0];
  const dy = track.y[1] - track.y[0];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  for (let v = 0; v < 8; v += 0.5) {
    for (let u = -half; u < half; u += 0.5) {
      const x = Math.round(track.x[0] + ux * v - uy * u);
      const y = Math.round(track.y[0] + uy * v + ux * u);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const cell = (Math.floor((u + half) / 4) + Math.floor(v / 4)) % 2;
      put((y * W + x) * 4, cell ? COL.startLight : COL.startDark);
    }
  }
  g.putImageData(out, 0, 0);

  // 나무·꽃: 도로에서 떨어진 잔디에만
  const farFromRoad = (x, y, margin) => {
    for (let i = 0; i < track.x.length; i += 2) {
      if (Math.abs(track.x[i] - x) < margin && Math.abs(track.y[i] - y) < margin
        && Math.hypot(track.x[i] - x, track.y[i] - y) < margin) return false;
    }
    return true;
  };
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  for (let k = 0; k < 520; k++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * H);
    if (!farFromRoad(x, y, half + 8)) continue;
    g.fillStyle = css([COL.flowerA, COL.flowerB, COL.flowerC][Math.floor(rnd() * 3)]);
    g.fillRect(x, y, 1, 1);
  }
  const trees = [];
  for (let k = 0; k < 260; k++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * H);
    if (farFromRoad(x, y, half + 20)) trees.push([x, y]);
  }
  trees.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of trees) {
    g.fillStyle = 'rgba(24,20,37,0.35)';
    g.fillRect(x - 5, y + 3, 11, 3);                      // 그림자
    g.fillStyle = css(COL.trunk);
    g.fillRect(x - 1, y, 2, 5);
    g.fillStyle = css(COL.leaf);
    g.fillRect(x - 5, y - 8, 10, 9);
    g.fillRect(x - 4, y - 10, 8, 2);
    g.fillRect(x - 6, y - 6, 12, 5);
    g.fillStyle = css(COL.leafMid);
    g.fillRect(x - 4, y - 9, 7, 7);
    g.fillStyle = css(COL.leafLight);
    g.fillRect(x - 3, y - 8, 3, 3);
  }
  return cv;
}

/** 미니맵용 트랙 그림 */
export function buildMiniMap(world, track, w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(24,20,37,0.7)';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#8b9bb4';
  const sx = (w - 4) / world.W;
  const sy = (h - 4) / world.H;
  for (let i = 0; i < track.x.length; i++) {
    g.fillRect(Math.round(2 + track.x[i] * sx) - 1, Math.round(2 + track.y[i] * sy) - 1, 2, 2);
  }
  g.fillStyle = '#ffffff';
  g.fillRect(Math.round(2 + track.x[0] * sx) - 1, Math.round(2 + track.y[0] * sy) - 2, 2, 4);
  return { canvas: cv, sx, sy };
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const CAR_W = 16;
const CAR_H = 10;
export const CAR_DIRS = 32;
const CAR_BOX = 20;

/** 차 그림(오른쪽을 보는 위에서 본 모습)을 32방향으로 돌려 둔다 */
export function buildCarSprites(color) {
  const base = document.createElement('canvas');
  base.width = CAR_W;
  base.height = CAR_H;
  const g = base.getContext('2d');
  const O = '#181425';
  g.fillStyle = O;
  g.fillRect(1, 0, 14, 10);
  g.fillRect(0, 1, 16, 8);
  g.fillStyle = color;                       // 차체
  g.fillRect(1, 1, 14, 8);
  g.fillStyle = shade(color, 0.7);           // 아래쪽 그늘
  g.fillRect(1, 7, 14, 2);
  g.fillStyle = shade(color, 1.25);          // 위쪽 밝은 줄
  g.fillRect(2, 1, 12, 1);
  g.fillStyle = O;                           // 바퀴
  g.fillRect(2, 0, 3, 1);
  g.fillRect(11, 0, 3, 1);
  g.fillRect(2, 9, 3, 1);
  g.fillRect(11, 9, 3, 1);
  g.fillStyle = '#262b44';                   // 앞유리·뒷유리
  g.fillRect(9, 2, 3, 6);
  g.fillRect(3, 3, 2, 4);
  g.fillStyle = '#c0cbdc';
  g.fillRect(10, 2, 1, 6);
  g.fillStyle = '#fee761';                   // 전조등
  g.fillRect(15, 2, 1, 2);
  g.fillRect(15, 6, 1, 2);
  g.fillStyle = '#e43b44';                   // 후미등
  g.fillRect(0, 2, 1, 2);
  g.fillRect(0, 6, 1, 2);
  const src = g.getImageData(0, 0, CAR_W, CAR_H).data;

  const frames = [];
  for (let d = 0; d < CAR_DIRS; d++) {
    const a = (d / CAR_DIRS) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const cv = document.createElement('canvas');
    cv.width = CAR_BOX;
    cv.height = CAR_BOX;
    const cg = cv.getContext('2d');
    const img = cg.createImageData(CAR_BOX, CAR_BOX);
    for (let y = 0; y < CAR_BOX; y++) {
      for (let x = 0; x < CAR_BOX; x++) {
        // 찍을 점을 거꾸로 돌려 원본에서 가장 가까운 점을 가져온다(흐려지지 않게)
        const rx = x + 0.5 - CAR_BOX / 2;
        const ry = y + 0.5 - CAR_BOX / 2;
        const sx = Math.floor(rx * cos + ry * sin + CAR_W / 2);
        const sy = Math.floor(-rx * sin + ry * cos + CAR_H / 2);
        if (sx < 0 || sy < 0 || sx >= CAR_W || sy >= CAR_H) continue;
        const si = (sy * CAR_W + sx) * 4;
        if (src[si + 3] < 128) continue;
        const di = (y * CAR_BOX + x) * 4;
        img.data[di] = src[si];
        img.data[di + 1] = src[si + 1];
        img.data[di + 2] = src[si + 2];
        img.data[di + 3] = 255;
      }
    }
    cg.putImageData(img, 0, 0);
    frames.push(cv);
  }
  return frames;
}

export function carFrame(frames, angle) {
  const d = Math.round((angle / (Math.PI * 2)) * CAR_DIRS);
  return frames[((d % CAR_DIRS) + CAR_DIRS) % CAR_DIRS];
}

export const CAR_HALF = CAR_BOX / 2;
