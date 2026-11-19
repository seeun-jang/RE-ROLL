// ============================================================
// Stage.js — 해 질 녘 놀이터 운동장 맵
//
// 패럴랙스 레이어: ① 노을 하늘(+해, 구름) ② 먼 집들 ③ 놀이터 담장
// 그리고 운동장 바닥(트랙·거리 표시·출발선·결승선)과 무궁화 나무.
// 정적인 레이어는 시작할 때 오프스크린 캔버스에 한 번만 그려 둔다.
// ============================================================

import { SCREEN, TRACK, TAGGER } from '../config.js';
import { C, SKY_PHASES, CLOUD_PHASES } from '../assets/palette.js';
import { mulberry32 } from '../assets/sprites.js';
import { rect, disc, ditherRect, bayerMask, sprite } from '../engine/Draw.js';

const W = SCREEN.WIDTH;
const HY = TRACK.HORIZON_Y;
const LAYER_W = 400; // 패럴랙스용으로 화면보다 넓게

function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
}

const lerp = (a, b, t) => a + (b - a) * t;

export class Stage {
  constructor(assets, text) {
    this.assets = assets;
    this.text = text;
    this.time = 0;
    this.skies = SKY_PHASES.map(p => this._buildSky(p));
    this.skyMix = new Map();
    this.clouds = this._buildClouds();
    this._buildHouses();
    this._buildFence();
    this.ground = this._buildGround();
  }

  // ------------------------------------------------------------
  // 좌표 변환 (미터 → 화면 픽셀)
  // ------------------------------------------------------------
  distToY(d) {
    return Math.round(TRACK.START_Y - (d / TRACK.METERS) * (TRACK.START_Y - TRACK.FINISH_Y));
  }

  // 레인 중심 x — 위로 갈수록 간격이 좁아져 쿼터뷰 원근감이 생긴다
  laneX(lane, d, count = 5) {
    const y = this.distToY(d);
    const t = (y - TRACK.FINISH_Y) / (TRACK.START_Y - TRACK.FINISH_Y);
    const spacing = lerp(TRACK.LANE_SPACING_TOP, TRACK.LANE_SPACING_BOTTOM, t);
    return Math.round(TRACK.CENTER_X + (lane - (count - 1) / 2) * spacing);
  }

  _halfWidth(y) {
    const t = (y - TRACK.FINISH_Y) / (TRACK.START_Y - TRACK.FINISH_Y);
    return Math.round(lerp(TRACK.HALF_WIDTH_TOP, TRACK.HALF_WIDTH_BOTTOM, t));
  }

  // ------------------------------------------------------------
  // 레이어 굽기
  // ------------------------------------------------------------
  _buildSky(colors) {
    const [cv, c] = makeCanvas(W, HY);
    const band = HY / colors.length;
    for (let i = 0; i < colors.length; i++) {
      const y0 = Math.round(i * band), y1 = Math.round((i + 1) * band);
      rect(c, 0, y0, W, y1 - y0, colors[i]);
      // 띠 경계는 디더링으로 부드럽게 (그라데이션 금지)
      if (i < colors.length - 1) {
        ditherRect(c, 0, y1 - 4, W, 2, colors[i + 1], 0.25);
        ditherRect(c, 0, y1 - 2, W, 2, colors[i + 1], 0.5);
      }
    }
    return cv;
  }

  _buildClouds() {
    const rnd = mulberry32(77);
    const list = [];
    for (let i = 0; i < 5; i++) {
      const w = 18 + Math.floor(rnd() * 20);
      const imgs = CLOUD_PHASES.map(([light, dark]) => {
        const [cv, c] = makeCanvas(w + 2, 10);
        disc(c, Math.floor(w * 0.3), 6, 3, light);
        disc(c, Math.floor(w * 0.55), 5, 4, light);
        disc(c, Math.floor(w * 0.8), 6, 3, light);
        rect(c, 2, 6, w - 2, 3, light);
        rect(c, 2, 8, w - 2, 1, dark);
        return cv;
      });
      list.push({ x: rnd() * LAYER_W, y: 4 + Math.floor(rnd() * 22), speed: 2 + rnd() * 3, imgs });
    }
    return list;
  }

  _buildHouses() {
    const [cv, c] = makeCanvas(LAYER_W, 30);
    const rnd = mulberry32(31);
    this.windows = [];
    let x = 0;
    while (x < LAYER_W) {
      const w = 18 + Math.floor(rnd() * 20);
      const h = 9 + Math.floor(rnd() * 13);
      const top = 30 - h;
      const apt = rnd() < 0.3; // 가끔 아파트
      rect(c, x, top, w, h, C.dark);
      if (apt) {
        rect(c, x, top - 6, w, 6, C.dark);
        rect(c, x, top - 7, w, 1, C.slate);
      } else {
        // 계단식 지붕 (픽셀 삼각형)
        for (let r = 0; r < 5; r++) rect(c, x - 1 + r, top - r - 1, w + 2 - r * 2, 1, C.navy);
      }
      // 창문 (나중에 노을이 짙어지면 하나씩 불이 켜짐)
      const rows = apt ? 3 : 1;
      for (let ry = 0; ry < rows; ry++) {
        for (let wx = x + 3; wx < x + w - 4; wx += 6) {
          const wy = (apt ? top - 4 : top + 3) + ry * 5;
          if (wy > 27) continue;
          rect(c, wx, wy, 2, 2, C.navy);
          this.windows.push({ x: wx, y: wy, th: 0.25 + rnd() * 0.7 });
        }
      }
      x += w + 2 + Math.floor(rnd() * 6);
    }
    this.houses = cv;
  }

  _buildFence() {
    const [cv, c] = makeCanvas(LAYER_W, 20);
    // 놀이터 담장
    rect(c, 0, 4, LAYER_W, 12, C.slate);
    rect(c, 0, 3, LAYER_W, 2, C.silver);
    rect(c, 0, 15, LAYER_W, 1, C.dark);
    for (let x = 0; x < LAYER_W; x += 24) {
      rect(c, x, 2, 4, 14, C.dark);
      rect(c, x, 1, 4, 2, C.silver);
    }
    // 벽돌 무늬
    for (let y = 6; y < 15; y += 3) for (let x = (y % 2) * 4; x < LAYER_W; x += 8) rect(c, x, y, 1, 1, C.dark);
    // 담장 앞 덤불
    const rnd = mulberry32(5);
    for (let x = 0; x < LAYER_W; x += 6 + Math.floor(rnd() * 8)) {
      const r = 2 + Math.floor(rnd() * 3);
      disc(c, x, 17, r, C.teal);
      rect(c, x - 1, 17 - r + 1, 2, 1, C.green);
    }
    // 미끄럼틀 (왼쪽)
    rect(c, 22, 0, 2, 16, C.red);
    rect(c, 34, 0, 2, 16, C.red);
    rect(c, 22, 0, 14, 2, C.orange);
    for (let i = 0; i < 12; i++) rect(c, 36 + i * 2, i + 2, 3, 2, C.yellow);
    // 그네 (오른쪽)
    rect(c, 330, 0, 2, 16, C.navy);
    rect(c, 360, 0, 2, 16, C.navy);
    rect(c, 330, 0, 32, 2, C.blue);
    rect(c, 337, 2, 1, 9, C.silver);
    rect(c, 343, 2, 1, 9, C.silver);
    rect(c, 336, 11, 9, 2, C.red);
    rect(c, 349, 2, 1, 9, C.silver);
    rect(c, 355, 2, 1, 9, C.silver);
    rect(c, 348, 11, 9, 2, C.yellow);
    this.fence = cv;
  }

  _buildGround() {
    const H = SCREEN.HEIGHT - HY;
    const [cv, c] = makeCanvas(W, H);
    const rnd = mulberry32(2024);
    const oy = HY; // 캔버스 y 0 = 화면 y HY

    // 잔디
    rect(c, 0, 0, W, H, C.teal);
    for (let i = 0; i < 260; i++) {
      const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
      const col = rnd() < 0.7 ? C.green : C.lime;
      rect(c, x, y, 1, 1, col);
      rect(c, x - 1, y - 1, 1, 1, col);
      rect(c, x + 1, y - 1, 1, 1, col);
    }

    // 나무 그늘 (디더링 타원)
    const tcx = TAGGER.TREE_X + 16, tcy = TAGGER.TREE_Y + 64 - oy;
    for (let dy = -3; dy <= 3; dy++) {
      const hw = Math.round(18 * Math.sqrt(1 - (dy * dy) / 12));
      ditherRect(c, tcx - hw, tcy + dy, hw * 2, 1, C.ink, 0.5);
    }

    // 트랙 (사다리꼴)
    for (let sy = TRACK.TOP_Y; sy < SCREEN.HEIGHT; sy++) {
      const hw = this._halfWidth(sy);
      const y = sy - oy;
      rect(c, TRACK.CENTER_X - hw - 1, y, 1, 1, C.dark);
      rect(c, TRACK.CENTER_X - hw, y, hw * 2, 1, C.slate);
      rect(c, TRACK.CENTER_X - hw, y, 1, 1, C.silver);
      rect(c, TRACK.CENTER_X + hw - 1, y, 1, 1, C.silver);
      rect(c, TRACK.CENTER_X + hw, y, 1, 1, C.dark);
    }
    rect(c, TRACK.CENTER_X - this._halfWidth(TRACK.TOP_Y), TRACK.TOP_Y - oy, this._halfWidth(TRACK.TOP_Y) * 2, 1, C.silver);
    // 흙 알갱이
    for (let i = 0; i < 700; i++) {
      const sy = TRACK.TOP_Y + 1 + Math.floor(rnd() * (SCREEN.HEIGHT - TRACK.TOP_Y - 1));
      const hw = this._halfWidth(sy) - 2;
      const x = TRACK.CENTER_X - hw + Math.floor(rnd() * hw * 2);
      rect(c, x, sy - oy, 1, 1, rnd() < 0.6 ? C.dark : C.silver);
    }

    // 레인 구분 점선
    const count = 5;
    for (let sy = TRACK.TOP_Y + 2; sy < TRACK.START_Y; sy++) {
      if (sy % 6 > 1) continue;
      const d = (TRACK.START_Y - sy) / (TRACK.START_Y - TRACK.FINISH_Y) * TRACK.METERS;
      for (let l = 0; l < count - 1; l++) {
        const x = Math.round((this.laneX(l, d, count) + this.laneX(l + 1, d, count)) / 2);
        rect(c, x, sy - oy, 1, 1, C.dark);
      }
    }

    // 거리 표시 (5m 마다 점선 + 글씨)
    for (let m = TRACK.MARK_EVERY; m < TRACK.METERS; m += TRACK.MARK_EVERY) {
      const sy = this.distToY(m);
      const hw = this._halfWidth(sy) - 2;
      for (let x = TRACK.CENTER_X - hw; x < TRACK.CENTER_X + hw; x += 4) rect(c, x, sy - oy, 2, 1, C.silver);
      // 글씨는 트랙 안쪽 왼쪽 끝에 (왼쪽 HUD 패널에 가리지 않도록)
      this.text.draw(c, `${m}m`, TRACK.CENTER_X - hw + 1, sy - oy - 9, { font: 'tiny', color: C.white, outline: C.ink });
    }

    // 출발선 (흰 분필)
    const sy0 = TRACK.START_Y;
    const hw0 = this._halfWidth(sy0) - 1;
    rect(c, TRACK.CENTER_X - hw0, sy0 - oy + 1, hw0 * 2, 2, C.white);
    this.text.draw(c, '출발', TRACK.CENTER_X - hw0 - 3, sy0 - oy - 3, { font: 'tiny', color: C.white, outline: C.ink, align: 'right' });

    // 결승선 (체크무늬)
    const fy = TRACK.FINISH_Y;
    const hwf = this._halfWidth(fy) - 1;
    for (let x = TRACK.CENTER_X - hwf, i = 0; x < TRACK.CENTER_X + hwf; x += 2, i++) {
      rect(c, x, fy - oy - 2, 2, 2, i % 2 ? C.ink : C.white);
      rect(c, x, fy - oy, 2, 2, i % 2 ? C.white : C.ink);
    }
    this.text.draw(c, '결승', TRACK.CENTER_X - hwf - 3, fy - oy - 5, { font: 'tiny', color: C.yellow, outline: C.ink, align: 'right' });
    return cv;
  }

  // ------------------------------------------------------------
  // 갱신 & 그리기
  // ------------------------------------------------------------
  update(dt) {
    this.time += dt;
    for (const cl of this.clouds) {
      cl.x -= cl.speed * dt;
      if (cl.x < -50) cl.x += LAYER_W + 50;
    }
  }

  // 노을 단계 사이를 바이어 디더링으로 섞은 하늘 (결과는 캐시)
  _skyFor(dusk) {
    const f = Math.max(0, Math.min(1, dusk)) * (this.skies.length - 1);
    const i = Math.min(this.skies.length - 2, Math.floor(f));
    const level = Math.round((f - i) * 16);
    if (level === 0) return this.skies[i];
    if (level === 16) return this.skies[i + 1];
    const key = `${i}|${level}`;
    if (this.skyMix.has(key)) return this.skyMix.get(key);
    const [cv, c] = makeCanvas(W, HY);
    c.drawImage(this.skies[i + 1], 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(bayerMask(W, HY, level), 0, 0);
    c.globalCompositeOperation = 'destination-over';
    c.drawImage(this.skies[i], 0, 0);
    this.skyMix.set(key, cv);
    return cv;
  }

  // dusk: 0(초저녁) ~ 1(해 질 무렵), camX: 패럴랙스 카메라 흔들림
  renderBackground(ctx, dusk = 0, camX = 0) {
    ctx.drawImage(this._skyFor(dusk), 0, 0);

    // 해 — 점점 지평선 아래로
    const sunY = Math.round(lerp(26, 52, dusk));
    disc(ctx, 238 - Math.round(camX * 0.1), sunY, 9, C.orange);
    disc(ctx, 238 - Math.round(camX * 0.1), sunY, 7, C.yellow);

    // 구름 (가장 느린 레이어)
    const ci = Math.min(2, Math.round(dusk * 2));
    for (const cl of this.clouds) {
      ctx.drawImage(cl.imgs[ci], Math.round(cl.x - camX * 0.15) - 40, cl.y);
    }

    // 먼 집들
    const hx = -40 - Math.round(camX * 0.3);
    ctx.drawImage(this.houses, hx, HY - 30);
    for (const w of this.windows) {
      if (dusk > w.th) rect(ctx, hx + w.x, HY - 30 + w.y, 2, 2, C.yellow);
    }

    // 운동장 바닥 (고정) → 그 위에 담장 앞 덤불이 살짝 걸치도록 담장을 나중에 그림
    ctx.drawImage(this.ground, 0, HY);

    // 놀이터 담장
    ctx.drawImage(this.fence, -40 - Math.round(camX * 0.6), HY - 16);
  }

  renderTree(ctx) {
    sprite(ctx, this.assets.get('tree'), TAGGER.TREE_X, TAGGER.TREE_Y);
  }
}
