// ============================================================
//  패럴랙스 배경 (4레이어) — 하늘 / 먼 산 / 구름 / 언덕+나무 / 앞 잔디
//  시간이 흐르면 낮 → 노을 → 밤으로 바뀐다 (반투명 오버레이 + 별)
// ============================================================
import { PALETTE } from '../assets/palette.js';
import { VIEW } from '../config.js';
import { BAYER4, lerp } from './gfx.js';

const W = VIEW.W;
const H = VIEW.H;
const LOOP = 640; // 반복되는 레이어 폭
const GROUND_Y = 164;

// 시드 고정 난수 — 매번 같은 배경이 나오도록
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

const px = (ctx, x, y, color) => {
  ctx.fillStyle = PALETTE[color];
  ctx.fillRect(x, y, 1, 1);
};

// 하늘: 색 띠 사이를 디더링으로 섞는다 (그라데이션 금지)
function renderSky() {
  const [c, ctx] = canvas(W, H);
  const bands = [
    { y: 0, color: 9 },
    { y: 46, color: 10 },
    { y: 96, color: 11 },
  ];
  const BLEND = 14;
  for (let y = 0; y < H; y++) {
    let ci = 0;
    while (ci + 1 < bands.length && y >= bands[ci + 1].y) ci++;
    const next = bands[ci + 1];
    for (let x = 0; x < W; x++) {
      let color = bands[ci].color;
      if (next && y > next.y - BLEND) {
        const k = (y - (next.y - BLEND)) / BLEND;
        if (BAYER4[y & 3][x & 3] < k * 16) color = next.color;
      }
      px(ctx, x, y, color);
    }
  }
  return c;
}

// 주기 640 으로 이어지는 능선 함수
const ridge = (x, base, parts) =>
  base + parts.reduce((s, [amp, k, ph]) => s + amp * Math.sin((Math.PI * 2 * k * x) / LOOP + ph), 0);

function renderMountains() {
  const [c, ctx] = canvas(LOOP, H);
  const parts = [[16, 2, 0.3], [8, 5, 1.2], [3, 11, 2.1]];
  for (let x = 0; x < LOOP; x++) {
    const top = Math.round(ridge(x, 98, parts));
    const slope = ridge(x + 1, 98, parts) - ridge(x - 1, 98, parts);
    for (let y = top; y < H; y++) {
      // 빛은 왼쪽에서 — 왼쪽을 향한 경사는 밝게, 오른쪽은 어둡게
      let color = slope < 0 ? 9 : 8;
      if (top < 90 && y < top + 3) color = 12; // 눈 덮인 봉우리
      else if (y === top) color = slope < 0 ? 10 : 9;
      px(ctx, x, y, color);
    }
  }
  return c;
}

function renderClouds() {
  const [c, ctx] = canvas(LOOP, 90);
  const rnd = mulberry32(7);
  for (let i = 0; i < 9; i++) {
    const cx = Math.floor((i / 9) * LOOP + rnd() * 40);
    const cy = Math.floor(12 + rnd() * 50);
    const puffs = 3 + Math.floor(rnd() * 3);
    const shapes = [];
    for (let k = 0; k < puffs; k++) {
      shapes.push({ x: cx + (k - puffs / 2) * 9 + rnd() * 4, y: cy - rnd() * 5, r: 5 + rnd() * 5 });
    }
    for (let y = cy - 16; y < cy + 10; y++) {
      for (let x = cx - 40; x < cx + 40; x++) {
        const hit = shapes.some((s) => Math.hypot(x - s.x, (y - s.y) * 1.3) < s.r);
        if (!hit || y > cy + 3) continue;
        const color = y > cy - 1 ? 13 : 12; // 구름 아래쪽은 회색 그림자
        px(ctx, ((x % LOOP) + LOOP) % LOOP, y, color);
      }
    }
  }
  return c;
}

function renderHills(assets) {
  const [c, ctx] = canvas(LOOP, H);
  const parts = [[7, 3, 0.8], [4, 7, 2.5]];
  for (let x = 0; x < LOOP; x++) {
    const top = Math.round(ridge(x, 134, parts));
    for (let y = top; y < H; y++) {
      let color = 6;
      if (y === top) color = 5;
      else if (y > top + 10) color = BAYER4[y & 3][x & 3] < (y - top - 10) ? 7 : 6;
      px(ctx, x, y, color);
    }
  }
  // 능선을 따라 나무 타일(16×16) 배치
  const tree = assets.get('tree').frames[0];
  const rnd = mulberry32(21);
  for (let x = 4; x < LOOP; x += 18 + Math.floor(rnd() * 22)) {
    const top = Math.round(ridge(x + 8, 134, parts));
    const tx = x;
    ctx.drawImage(tree, tx, top - 13);
    if (tx + 16 > LOOP) ctx.drawImage(tree, tx - LOOP, top - 13); // 이음새
  }
  return c;
}

function renderGround(assets) {
  const [c, ctx] = canvas(W + 32, H - GROUND_Y);
  const rnd = mulberry32(3);
  const grass = assets.get('grass').frames[0];
  const flower = assets.get('grassFlower').frames[0];
  for (let x = 0; x < W + 32; x += 16) {
    ctx.drawImage(rnd() < 0.3 ? flower : grass, x, 0);
  }
  return c;
}

export class Background {
  constructor(assets) {
    this.sky = renderSky();
    this.mountains = renderMountains();
    this.clouds = renderClouds();
    this.hills = renderHills(assets);
    this.ground = renderGround(assets);
    const rnd = mulberry32(99);
    this.stars = Array.from({ length: 40 }, () => [Math.floor(rnd() * W), Math.floor(rnd() * 80), rnd()]);
    this.t = 0;
    this.focus = 0; // -1~1, 커서 위치에 따라 살짝 시차 이동
  }

  update(dt, focusX = W / 2) {
    this.t += dt;
    const target = (focusX - W / 2) / (W / 2);
    this.focus += (target - this.focus) * Math.min(1, dt * 2);
  }

  layer(ctx, img, speed, depth, y = 0) {
    const off = Math.round(this.t * speed + this.focus * depth);
    const x = -(((off % LOOP) + LOOP) % LOOP);
    ctx.drawImage(img, x, y);
    ctx.drawImage(img, x + LOOP, y);
  }

  /** 배경 뒤쪽 레이어 + 낮/밤 연출. day: 0(낮) ~ 1(밤) */
  drawBack(ctx, day) {
    ctx.drawImage(this.sky, 0, 0);

    // 별 — 밤이 될수록 나타남
    const night = Math.max(0, (day - 0.7) / 0.3);
    if (night > 0) {
      for (const [sx, sy, r] of this.stars) {
        if (r > night) continue;
        const tw = Math.floor(this.t * 3 + r * 10) % 4 === 0;
        px(ctx, sx, sy, tw ? 11 : 12);
      }
    }

    // 해 — 시간이 갈수록 산 뒤로 진다
    const sunX = Math.round(lerp(64, 250, day));
    const sunY = Math.round(26 + day * day * 92);
    this.drawSun(ctx, sunX, sunY, day);

    this.layer(ctx, this.mountains, 3, 4);
    this.layer(ctx, this.clouds, 7, 8, 0);
    this.layer(ctx, this.hills, 12, 12);

    // 조명 변화: 노을(주황) → 밤(짙은 파랑) 반투명 오버레이
    const dusk = Math.max(0, Math.min(1, (day - 0.4) / 0.35)) * (1 - night);
    if (dusk > 0) {
      ctx.globalAlpha = dusk * 0.28;
      ctx.fillStyle = PALETTE[3];
      ctx.fillRect(0, 0, W, H);
    }
    if (night > 0) {
      ctx.globalAlpha = night * 0.45;
      ctx.fillStyle = PALETTE[8];
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  drawSun(ctx, cx, cy, day) {
    const core = day > 0.6 ? 3 : 4;
    for (let y = -11; y <= 11; y++) {
      for (let x = -11; x <= 11; x++) {
        const d = Math.hypot(x, y);
        if (d < 7) px(ctx, cx + x, cy + y, d < 4 && day < 0.6 ? 12 : core);
        else if (d < 10 && BAYER4[(cy + y) & 3][(cx + x) & 3] < 5) px(ctx, cx + x, cy + y, 4); // 디더 후광
      }
    }
  }

  /** 맨 앞 잔디 — 과일이 이 뒤에서 튀어 올라온다 */
  drawFront(ctx, day) {
    const x = Math.round(-16 - this.focus * 10);
    ctx.drawImage(this.ground, x, GROUND_Y);
    const night = Math.max(0, (day - 0.7) / 0.3);
    if (night > 0) {
      ctx.globalAlpha = night * 0.4;
      ctx.fillStyle = PALETTE[8];
      ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      ctx.globalAlpha = 1;
    }
  }
}
