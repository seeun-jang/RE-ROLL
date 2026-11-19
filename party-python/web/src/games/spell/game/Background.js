// ============================================================
// 패럴랙스 배경 (스테이지 테마별 3~4 레이어)
//  - 각 레이어는 시작할 때 오프스크린 캔버스에 한 번 그려 두고 정수 픽셀로 스크롤
//  - 그라데이션 금지 → 하늘 색 변화는 디더 띠로 표현
// ============================================================
import { C } from '../data/palette.js';
import { BAYER4 } from '../core/Renderer.js';
import { CONFIG } from '../config.js';

const W = CONFIG.VIEW.WIDTH;
const H = CONFIG.VIEW.HEIGHT;
const GROUND = CONFIG.LAYOUT.GROUND_Y;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 결정적 난수 (배경이 매번 같게) */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 오프스크린 디더 채우기 */
function dither(g, x, y, w, h, color, density) {
  const level = Math.round(density * 16);
  g.fillStyle = color;
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) if (BAYER4[yy & 3][xx & 3] < level) g.fillRect(xx, yy, 1, 1);
}

/** 위→아래 색 띠 + 경계 디더 (그라데이션 대체) */
function skyBands(g, bands) {
  // bands: [{ y, color }] — y 순서대로
  for (let i = 0; i < bands.length; i++) {
    const y0 = bands[i].y;
    const y1 = i + 1 < bands.length ? bands[i + 1].y : H;
    g.fillStyle = bands[i].color;
    g.fillRect(0, y0, W * 2, y1 - y0);
    if (i + 1 < bands.length) {
      // 경계 위쪽 6줄에 다음 색을 점점 진하게
      for (let k = 0; k < 6; k++) dither(g, 0, y1 - 6 + k, W * 2, 1, bands[i + 1].color, (k + 1) / 7);
    }
  }
}

/** 실루엣 산맥 (가로로 반복 가능한 폭 W*2) */
function ridge(g, baseY, amp, color, seed, step = 4, w = W * 2) {
  const r = rng(seed);
  g.fillStyle = color;
  let h = amp * 0.5;
  const heights = [];
  for (let x = 0; x < w; x += step) {
    h += (r() - 0.5) * amp * 0.5;
    h = Math.max(amp * 0.2, Math.min(amp, h));
    heights.push(Math.round(h));
  }
  // 이음매가 자연스럽게 마지막 높이를 처음과 맞춘다
  const n = heights.length;
  for (let i = 0; i < 4; i++) heights[n - 1 - i] = Math.round(heights[n - 1 - i] + (heights[0] - heights[n - 1 - i]) * ((4 - i) / 4));
  heights.forEach((hh, i) => g.fillRect(i * step, baseY - hh, step, H - baseY + hh));
}

// ============================================================
// 테마: 마법학교 훈련장
// ============================================================
function buildTraining() {
  const sky = canvas(W * 2, H);
  let g = sky.getContext('2d');
  skyBands(g, [{ y: 0, color: C.blue }, { y: 50, color: C.cyan }, { y: 92, color: C.silver }]);

  // 구름 (먼 레이어, 천천히 흐름)
  const clouds = canvas(W * 2, H);
  g = clouds.getContext('2d');
  const rc = rng(7);
  for (let i = 0; i < 7; i++) {
    const cx = Math.floor(rc() * W * 2), cy = 10 + Math.floor(rc() * 45), cw = 24 + Math.floor(rc() * 30);
    g.fillStyle = C.white;
    g.fillRect(cx, cy, cw, 5);
    g.fillRect(cx + 4, cy - 3, cw - 10, 3);
    g.fillRect(cx + 8, cy - 5, Math.max(6, cw - 20), 2);
    g.fillStyle = C.silver;
    g.fillRect(cx + 2, cy + 5, cw - 4, 1);
  }

  // 먼 언덕 + 마법학교 성
  const hills = canvas(W * 2, H);
  g = hills.getContext('2d');
  ridge(g, 100, 22, C.forest, 3, 4);
  dither(g, 0, 92, W * 2, 6, C.pine, 0.25);
  // 학교 탑들
  const towers = [[60, 34], [84, 50], [104, 28], [400, 40], [426, 26]];
  for (const [tx, th] of towers) {
    g.fillStyle = C.slate;
    g.fillRect(tx, 98 - th, 14, th);
    g.fillStyle = C.dusk;
    g.fillRect(tx + 10, 98 - th, 4, th);
    g.fillStyle = C.plum; // 지붕
    for (let k = 0; k < 8; k++) g.fillRect(tx - 1 + k, 98 - th - 8 + k, 16 - k * 2, 1);
    g.fillStyle = C.yellow; // 창문
    g.fillRect(tx + 5, 98 - th + 8, 2, 3);
  }

  // 가까운 나무/울타리
  const near = canvas(W * 2, H);
  g = near.getContext('2d');
  const rt = rng(11);
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rt() * W * 2), s = 10 + Math.floor(rt() * 8);
    const h = s >> 1; // 모든 좌표를 정수로 (소수 좌표는 팔레트 밖 색으로 번진다)
    g.fillStyle = C.brown;
    g.fillRect(x + h - 1, GROUND - 14, 3, 14);
    g.fillStyle = C.pine;
    for (let k = 0; k < s; k++) {
      const d = Math.abs(k - h);
      g.fillRect(x + (d >> 1), GROUND - 14 - s + k, s - d, 1);
    }
    g.fillStyle = C.forest;
    g.fillRect(x + Math.floor(s / 3), GROUND - 12 - s, 2, h);
  }
  g.fillStyle = C.clay; // 울타리
  for (let x = 0; x < W * 2; x += 12) g.fillRect(x, GROUND - 9, 2, 9);
  g.fillRect(0, GROUND - 7, W * 2, 1);
  g.fillRect(0, GROUND - 4, W * 2, 1);

  // 바닥 타일 16x16
  const ground = canvas(W, H - GROUND);
  g = ground.getContext('2d');
  g.fillStyle = C.clay;
  g.fillRect(0, 0, W, H - GROUND);
  g.fillStyle = C.green;
  g.fillRect(0, 0, W, 3);
  g.fillStyle = C.forest;
  g.fillRect(0, 3, W, 1);
  const rg = rng(5);
  for (let x = 0; x < W; x += 16) {
    for (let y = 4; y < H - GROUND; y += 16) {
      g.fillStyle = C.brown;
      g.fillRect(x + Math.floor(rg() * 12), y + 3 + Math.floor(rg() * 8), 2, 1);
      g.fillStyle = C.tan;
      g.fillRect(x + Math.floor(rg() * 12), y + 2 + Math.floor(rg() * 8), 1, 1);
    }
    g.fillStyle = C.green; // 풀 끝
    g.fillRect(x + 3, 0, 1, 1);
    g.fillRect(x + 11, 0, 1, 1);
  }

  return {
    layers: [
      { img: sky, speed: 0, depth: 0 },
      { img: clouds, speed: 4, depth: 0.1 },
      { img: hills, speed: 0, depth: 0.3, drift: 2 },
      { img: near, speed: 0, depth: 0.6, drift: 5 },
    ],
    ground,
    ambient: (bg, dt) => {
      // 반짝이는 마나 입자
      if (Math.random() < dt * 6) bg.spawn({ x: Math.random() * W, y: GROUND - Math.random() * 60, vx: 3, vy: -6, life: 1.5, color: Math.random() < 0.5 ? C.white : C.yellow });
    },
    clear: C.blue,
  };
}

// ============================================================
// 테마: 불꽃 화산
// ============================================================
function buildVolcano() {
  const sky = canvas(W * 2, H);
  let g = sky.getContext('2d');
  skyBands(g, [{ y: 0, color: C.ink }, { y: 30, color: C.umber }, { y: 66, color: C.brown }, { y: 92, color: C.crimson }]);

  // 연기 구름
  const smoke = canvas(W * 2, H);
  g = smoke.getContext('2d');
  const rs = rng(21);
  for (let i = 0; i < 8; i++) {
    const cx = Math.floor(rs() * W * 2), cy = 8 + Math.floor(rs() * 40), cw = 30 + Math.floor(rs() * 30);
    dither(g, cx, cy, cw, 6, C.dusk, 0.5);
    dither(g, cx + 5, cy - 3, cw - 10, 3, C.dusk, 0.3);
  }

  // 먼 화산 (용암 줄기 포함)
  const far = canvas(W * 2, H);
  g = far.getContext('2d');
  ridge(g, 104, 18, C.night, 9, 4);
  const vx = 150; // 화산 위치
  for (let k = 0; k < 50; k++) {
    g.fillStyle = C.night;
    g.fillRect(vx - 10 - k, 50 + k, 20 + k * 2, 1);
  }
  g.fillStyle = C.ink;
  g.fillRect(vx - 9, 50, 18, 2);
  g.fillStyle = C.red; // 분화구 빛
  g.fillRect(vx - 8, 48, 16, 2);
  g.fillStyle = C.orange;
  g.fillRect(vx - 5, 47, 10, 1);
  // 흘러내리는 용암
  for (let y = 52; y < 100; y++) {
    const x = vx - 2 + Math.round(Math.sin(y * 0.25) * 3) + Math.floor((y - 52) / 6);
    g.fillStyle = C.red;
    g.fillRect(x, y, 2, 1);
    if (y % 3 === 0) { g.fillStyle = C.orange; g.fillRect(x, y, 1, 1); }
  }
  dither(g, 0, 96, W * 2, 8, C.crimson, 0.25);

  // 가까운 바위
  const near = canvas(W * 2, H);
  g = near.getContext('2d');
  ridge(g, GROUND + 1, 14, C.umber, 31, 6);
  const rr = rng(33);
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(rr() * W * 2), y = GROUND - 6 - Math.floor(rr() * 6);
    g.fillStyle = C.orange;
    g.fillRect(x, y, 2, 1);
  }

  // 현무암 바닥 + 용암 균열
  const ground = canvas(W, H - GROUND);
  g = ground.getContext('2d');
  g.fillStyle = C.dusk;
  g.fillRect(0, 0, W, H - GROUND);
  g.fillStyle = C.slate;
  g.fillRect(0, 0, W, 2);
  g.fillStyle = C.night;
  g.fillRect(0, 2, W, 1);
  const rgd = rng(41);
  for (let x = 0; x < W; x += 16) {
    g.fillStyle = C.night;
    g.fillRect(x, 3, 1, H - GROUND);
    let cx = x + 4 + Math.floor(rgd() * 8);
    for (let y = 4; y < H - GROUND; y++) {
      if (rgd() < 0.3) cx += rgd() < 0.5 ? -1 : 1;
      if (y % 2 === 0 && rgd() < 0.55) {
        g.fillStyle = rgd() < 0.25 ? C.gold : C.orange;
        g.fillRect(cx, y, 1, 1);
      }
    }
  }

  return {
    layers: [
      { img: sky, speed: 0, depth: 0 },
      { img: smoke, speed: 6, depth: 0.1 },
      { img: far, speed: 0, depth: 0.3, drift: 2 },
      { img: near, speed: 0, depth: 0.6, drift: 4 },
    ],
    ground,
    ambient: (bg, dt) => {
      // 떠오르는 불씨
      if (Math.random() < dt * 14) {
        bg.spawn({ x: Math.random() * W, y: H - 52, vx: Math.random() * 8 - 4, vy: -12 - Math.random() * 20, life: 2 + Math.random(), color: Math.random() < 0.6 ? C.orange : C.gold });
      }
    },
    clear: C.ink,
  };
}

const THEMES = { training: buildTraining, volcano: buildVolcano };

export class Background {
  constructor(theme) {
    const build = THEMES[theme] || THEMES.training;
    Object.assign(this, build());
    this.time = 0;
    this.motes = [];
  }

  spawn(m) {
    this.motes.push({ ...m, age: 0 });
  }

  update(dt) {
    this.time += dt;
    this.ambient?.(this, dt);
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.age += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.age >= m.life) this.motes.splice(i, 1);
    }
  }

  /** shake: 렌더러 흔들림 오프셋 (깊이에 비례해 적용 → 패럴랙스 느낌) */
  render(r, shake = { x: 0, y: 0 }) {
    const ctx = r.ctx;
    for (const L of this.layers) {
      // 시간에 따른 흐름(speed) + 살짝 좌우로 흔들리는 드리프트
      const drift = L.drift ? Math.sin(this.time * 0.25) * L.drift : 0;
      const ox = -Math.floor((this.time * L.speed + drift + 1000 * L.img.width) % L.img.width);
      const sx = Math.round(shake.x * L.depth);
      const sy = Math.round(shake.y * L.depth);
      ctx.drawImage(L.img, ox + sx, sy);
      if (ox + sx + L.img.width < r.W) ctx.drawImage(L.img, ox + sx + L.img.width, sy);
      if (ox + sx > 0) ctx.drawImage(L.img, ox + sx - L.img.width, sy);
    }
    for (const m of this.motes) {
      if (m.age > m.life * 0.7 && Math.floor(m.age * 10) % 2) continue;
      ctx.fillStyle = m.color;
      ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
  }

  renderGround(r, shake = { x: 0, y: 0 }) {
    const x = Math.round(shake.x), y = GROUND + Math.round(shake.y);
    // 흔들림으로 가장자리가 비지 않게 좌우로 이어 그린다
    r.ctx.drawImage(this.ground, x - this.ground.width, y);
    r.ctx.drawImage(this.ground, x, y);
    r.ctx.drawImage(this.ground, x + this.ground.width, y);
  }
}
