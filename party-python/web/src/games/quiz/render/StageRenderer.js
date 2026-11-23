// =============================================================
// 무대 렌더러 — 320×180 캔버스에 배경(패럴랙스)·캐릭터·파티클·연출을 그린다.
// 모든 좌표는 정수 픽셀로 반올림해서 그린다 (서브픽셀 금지).
// (원본은 빨강/파랑 2팀. 여기서는 참가자 2~5명이 사회자 양옆 단상에 동물 캐릭터로 선다)
// =============================================================
import { FX, SCREEN } from '../config.js';
import { assets } from './assets.js';
import { PALETTE, PALETTE_RGB } from './palette.js';
import { Particles } from './Particles.js';

const W = SCREEN.ART_W;
const H = SCREEN.ART_H;
const FLOOR_Y = 132;
const FEET_Y = 116; // 단상 윗면 = 캐릭터 발 위치
const PODIUM_W = 34;
/** 한쪽에 서는 인원수별 단상 가운데 x (왼쪽 기준. 오른쪽은 좌우 대칭) */
const SIDE_SLOTS = { 0: [], 1: [66], 2: [40, 98], 3: [28, 68, 108] };

/** 참가자 수에 따른 단상 가운데 x 목록 — 사회자(가운데)를 비우고 왼쪽부터 채운다 */
export function slotCenters(n) {
  const left = Math.ceil(n / 2);
  const right = n - left;
  return [...SIDE_SLOTS[left], ...SIDE_SLOTS[right].map((x) => W - x).reverse()];
}

/** '#rrggbb' 를 밝게(+)/어둡게(-) */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
const HOST_POS = { x: 144, y: 86 };
const DESK = { x: 128, y: 112, w: 64, h: 22 };

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// 애니메이션: [자세 번호(0 기본, 1 숨쉬기, 2·3 움츠림), 길이(1/10초 틱), 위로 뜨는 px]
const ANIMS = {
  idle: [[0, 6, 0], [1, 6, 0]],
  buzz: [[0, 2, 2], [0, 2, 4], [0, 2, 2], [1, 2, 0]],
  cheer: [[0, 2, 0], [0, 2, 1]],
  sad: [[2, 5, 0], [3, 5, 0]],
};

// 같은 화면에서 늘 같은 모양이 나오도록 고정 시드 난수
function makeRng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return [cv, ctx];
}

const rect = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = typeof color === 'string' ? color : PALETTE[color];
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/**
 * 가로 구간을 한 줄씩 직접 칠한 삼각형 (캔버스 path 의 안티앨리어싱 회피).
 * density(0~16)를 주면 베이어 디더로 일부 픽셀만 칠한다 → 반투명 없이 팔레트 색만으로 "빛" 표현.
 */
function pixelTriangle(ctx, color, ax, ay, bx, by, cx, cy, density = 16) {
  ctx.fillStyle = PALETTE[color];
  const minY = Math.round(Math.min(ay, by, cy));
  const maxY = Math.round(Math.max(ay, by, cy));
  const edges = [
    [ax, ay, bx, by],
    [bx, by, cx, cy],
    [cx, cy, ax, ay],
  ];
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (const [x1, y1, x2, y2] of edges) {
      if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (xs.length >= 2) {
      const l = Math.round(Math.min(...xs));
      const r = Math.round(Math.max(...xs));
      if (density >= 16) ctx.fillRect(l, y, r - l + 1, 1);
      else {
        const row = BAYER[((y % 4) + 4) % 4];
        for (let x = l; x <= r; x++) if (row[((x % 4) + 4) % 4] < density) ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

// ---------------------------------------------------------------
class Actor {
  constructor(player, cx) {
    this.id = player.id;
    this.animal = player.animal; // 동물 id
    this.color = player.color;   // 대표 색 '#rrggbb'
    this.cx = cx;
    this.anim = 'idle';
    this.frame = 0;
    this.acc = 0;
    this.jumpY = 0;
    this.vy = 0;
    this.squash = { sx: 1, sy: 1, t: 0 };
    this.marker = null; // 'bang' | 'crown' | 'lock' | null
    this.loopJump = false;
  }

  setAnim(name, { jump = false, loopJump = false } = {}) {
    if (this.anim !== name) {
      this.anim = name;
      this.frame = 0;
      this.acc = 0;
    }
    this.loopJump = loopJump;
    if (jump) this.jump();
    if (name === 'buzz') this.stretch(0.85, 1.15, 0.12);
  }

  jump(v = 95) {
    if (this.jumpY > 0) return;
    this.vy = v;
    this.stretch(0.85, 1.2, 0.1);
  }

  stretch(sx, sy, t) {
    this.squash = { sx, sy, t };
  }

  update(dt, particles) {
    // 프레임 진행 (FX.ANIM_FPS 기준)
    const seq = ANIMS[this.anim];
    this.acc += dt * FX.ANIM_FPS;
    while (this.acc >= seq[this.frame][1]) {
      this.acc -= seq[this.frame][1];
      this.frame = (this.frame + 1) % seq.length;
    }
    // 점프 물리
    if (this.jumpY > 0 || this.vy > 0) {
      this.vy -= 380 * dt;
      this.jumpY += this.vy * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.vy = 0;
        this.stretch(1.25, 0.78, 0.12); // 착지 스쿼시
        particles.dust(this.cx, FEET_Y);
        if (this.loopJump) setTimeout(() => this.loopJump && this.jump(80), 250);
      }
    }
    if (this.squash.t > 0) {
      this.squash.t -= dt;
      if (this.squash.t <= 0) this.squash = { sx: 1, sy: 1, t: 0 };
    }
  }

  draw(ctx, t) {
    const [pose, , lift] = ANIMS[this.anim][this.frame];
    const img = assets.get(`animal.${this.animal}.${pose}`);
    const dw = Math.round(img.width * this.squash.sx);
    const dh = Math.round(img.height * this.squash.sy);
    const x = Math.round(this.cx - dw / 2);
    const y = Math.round(FEET_Y - this.jumpY - lift - dh);
    // 그림자
    const sw = Math.max(6, 14 - Math.round(this.jumpY / 4));
    rect(ctx, 0, this.cx - sw / 2, FEET_Y - 1, sw, 2);
    ctx.drawImage(img, x, y, dw, dh);
    // 머리 위 표시
    if (this.marker) {
      const bob = Math.round(Math.sin(t * 8) * 1.5);
      const icon = assets.get(`icon.${this.marker}`);
      ctx.drawImage(icon, Math.round(this.cx - 4), y - 11 + bob);
    }
  }
}

// ---------------------------------------------------------------
export class StageRenderer {
  /**
   * @param {HTMLCanvasElement} canvasEl 320×180 캔버스
   * @param {HTMLElement} shakeEl 화면 흔들림을 적용할 요소 (캔버스+UI 감싸는 div)
   * @param {{id:string, animal:string, color:string}[]} players 참가자(자리 순서)
   */
  constructor(canvasEl, shakeEl, players) {
    this.cv = canvasEl;
    this.cv.width = W;
    this.cv.height = H;
    this.ctx = canvasEl.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.shakeEl = shakeEl;
    this.particles = new Particles();
    this.cx = slotCenters(players.length);
    this.actors = players.map((p, i) => new Actor(p, this.cx[i]));
    this.mode = 'play';
    this.time = 0;
    this.beat = 0;
    this.skyLevel = 0;
    this.shake = 0;
    this.freezeUntil = 0;
    this.host = { face: 'happy', until: 0, talkUntil: 0 };
    this.stamps = [];
    this.spot = { target: null, until: 0 };
    this.resultWinners = null;
    this._build();
  }

  // ---------- 배경 미리 그리기 ----------
  _build() {
    const rnd = makeRng(20261031);
    // 하늘 3종 (진행에 따라 팔레트 교체: 노을 → 밤 → 깊은 밤)
    const SKIES = [
      [[0, 8], [60, 1], [110, 3], [132, 4]],
      [[0, 0], [50, 8], [105, 1], [132, 2]],
      [[0, 0], [70, 0], [110, 8], [132, 1]],
    ];
    this.skies = SKIES.map((stops) => {
      const [cv, ctx] = canvas(W, FLOOR_Y);
      const img = ctx.createImageData(W, FLOOR_Y);
      for (let y = 0; y < FLOOR_Y; y++) {
        let i = 0;
        while (i < stops.length - 2 && y >= stops[i + 1][0]) i++;
        const [y0, c0] = stops[i];
        const [y1, c1] = stops[i + 1];
        const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
        for (let x = 0; x < W; x++) {
          const c = BAYER[y % 4][x % 4] < t * 16 ? c1 : c0;
          const [r, g, b] = PALETTE_RGB[c];
          const o = (y * W + x) * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return cv;
    });

    this.stars = Array.from({ length: 46 }, () => ({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * 70), p: rnd() * 6 }));

    // 도시 실루엣 2겹 (가로 640 → 반복 스크롤)
    const city = (h, body, win, winChance, minH, maxH) => {
      const [cv, ctx] = canvas(640, h);
      let x = 0;
      while (x < 640) {
        const bw = 12 + Math.floor(rnd() * 22);
        const bh = minH + Math.floor(rnd() * (maxH - minH));
        rect(ctx, body, x, h - bh, bw, bh);
        if (rnd() < 0.3) rect(ctx, body, x + Math.floor(bw / 2) - 1, h - bh - 5, 2, 5); // 안테나
        for (let wy = h - bh + 3; wy < h - 3; wy += 4) {
          for (let wx = x + 2; wx < x + bw - 2; wx += 4) {
            if (rnd() < winChance) rect(ctx, win, wx, wy, 2, 2);
          }
        }
        x += bw + Math.floor(rnd() * 3);
      }
      return cv;
    };
    this.cityFar = city(62, 8, 7, 0.18, 18, 58);
    this.cityNear = city(44, 15, 4, 0.28, 12, 40);

    // 트러스(무대 조명 틀)
    {
      const [cv, ctx] = canvas(W, 10);
      rect(ctx, 0, 0, 0, W, 8);
      rect(ctx, 14, 0, 1, W, 1);
      rect(ctx, 14, 0, 6, W, 1);
      for (let x = 0; x < W; x += 8) {
        rect(ctx, 14, x, 2, 1, 4);
        rect(ctx, 15, x + 2, 3, 4, 2);
      }
      this.truss = cv;
    }

    // 무대 바닥
    {
      const [cv, ctx] = canvas(W, H - FLOOR_Y);
      for (let ty = 0; ty < H - FLOOR_Y; ty += 16) {
        for (let tx = 0; tx < W; tx += 16) {
          rect(ctx, (tx + ty) / 16 % 2 ? 15 : 8, tx, ty, 16, 16);
          rect(ctx, 14, tx, ty, 16, 1);
          rect(ctx, 14, tx, ty, 1, 16);
        }
      }
      rect(ctx, 13, 0, 0, W, 2);
      rect(ctx, 0, 0, 2, W, 1);
      this.floor = cv;
    }

    // 단상 (참가자 캐릭터 색)
    this.podiums = this.actors.map((a) => {
      const main = a.color;
      const dark = shade(main, -0.22);
      const light = shade(main, 0.18);
      const [cv, ctx] = canvas(PODIUM_W, 40);
      rect(ctx, 0, 0, 0, PODIUM_W, 40);
      rect(ctx, 12, 1, 1, PODIUM_W - 2, 2);
      rect(ctx, 13, 1, 3, PODIUM_W - 2, 2);
      rect(ctx, main, 1, 5, PODIUM_W - 2, 34);
      for (let x = 4; x < PODIUM_W - 4; x += 6) rect(ctx, dark, x, 8, 2, 28);
      rect(ctx, light, 1, 5, PODIUM_W - 2, 1);
      rect(ctx, dark, 1, 36, PODIUM_W - 2, 3);
      return cv;
    });

    // 사회자 책상
    {
      const [cv, ctx] = canvas(DESK.w, DESK.h);
      rect(ctx, 0, 0, 0, DESK.w, DESK.h);
      rect(ctx, 13, 1, 1, DESK.w - 2, 3);
      rect(ctx, 4, 1, 4, DESK.w - 2, DESK.h - 5);
      rect(ctx, 3, 1, DESK.h - 4, DESK.w - 2, 3);
      for (let x = 6; x < DESK.w - 4; x += 10) {
        rect(ctx, 12, x, 9, 2, 2);
        rect(ctx, 12, x + 1, 8, 1, 4);
        rect(ctx, 12, x - 1, 10, 4, 1);
      }
      this.desk = cv;
    }

    // O / X 도장
    this.stampO = this._ring(18, 5, 5, 6);
    this.stampX = this._cross(36, 6, 2, 1);
  }

  _ring(r, thick, color, shade) {
    const size = r * 2 + 4;
    const [cv, ctx] = canvas(size, size);
    const c = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
        if (d <= r + 1 && d >= r - thick - 1) rect(ctx, 0, x, y, 1, 1);
        if (d <= r && d >= r - thick) rect(ctx, d > r - 1.5 ? shade : color, x, y, 1, 1);
      }
    }
    return cv;
  }

  _cross(size, thick, color, shade) {
    const [cv, ctx] = canvas(size + 4, size + 4);
    for (let y = 0; y < size + 4; y++) {
      for (let x = 0; x < size + 4; x++) {
        const a = Math.abs(x - y);
        const b = Math.abs(x + y - (size + 3));
        if (a <= thick + 1 || b <= thick + 1) rect(ctx, 0, x, y, 1, 1);
        if (a <= thick || b <= thick) rect(ctx, a === thick || b === thick ? shade : color, x, y, 1, 1);
      }
    }
    return cv;
  }

  // ---------- 상태 제어 (GameController 가 호출) ----------
  setMode(mode) {
    this.mode = mode;
    if (mode !== 'play' && mode !== 'result') this.skyLevel = 0; // 타이틀·설정은 늘 노을 하늘
    this.particles.list.length = 0; // 이전 장면의 꽃가루 정리
    this.shake = 0;
    this._rainAcc = 0;
    this.stamps = [];
    this.spot = { target: null, until: 0 };
    this.resultWinners = null;
    this.actors.forEach((a) => {
      a.setAnim('idle');
      a.marker = null;
      a.loopJump = false;
    });
    this.host.face = 'neutral';
  }

  setSkyLevel(level) {
    this.skyLevel = Math.max(0, Math.min(this.skies.length - 1, level));
  }

  setHost(face, seconds = 1.5, talk = false) {
    this.host.face = face;
    this.host.until = this.time + seconds;
    if (talk) this.host.talkUntil = this.time + seconds;
  }

  setActor(p, anim, opts) {
    this.actors[p].setAnim(anim, opts);
  }

  setMarker(p, marker) {
    this.actors[p].marker = marker;
  }

  focus(p, seconds = 10) {
    this.spot = { target: p, until: this.time + seconds };
  }

  freeze(ms = FX.HIT_STOP_MS) {
    this.freezeUntil = performance.now() + ms;
  }

  addShake(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  // ---------- 연출 묶음 ----------
  fxIntro() {
    this.actors.forEach((a, i) => {
      a.setAnim('idle');
      a.marker = null;
      a.loopJump = false;
    });
    this.spot = { target: null, until: 0 };
    this.setHost('talk', 1.8, true);
  }

  fxBuzz(p) {
    this.freeze();
    this.addShake(FX.SHAKE_BUZZ);
    this.setActor(p, 'buzz');
    this.setMarker(p, 'bang');
    this.particles.sparks(this.cx[p], FEET_Y - 34, 4, 18);
    this.focus(p, 30);
    this.setHost('surprised', 0.8);
  }

  fxCorrect(p) {
    this.freeze(60);
    this.setActor(p, 'cheer', { jump: true, loopJump: true });
    this.setMarker(p, 'star');
    this.actors.forEach((a, i) => {
      if (i !== p && a.marker !== 'lock') a.marker = null;
    });
    this.stamps.push({ img: this.stampO, x: this.cx[p], y: 78, t: 0 });
    this.particles.confetti(this.cx[p], FEET_Y - 30, [2, 9, 4, 12, 5], 70);
    this.setHost('happy', 2.5);
    this.focus(p, 3);
  }

  fxWrong(p) {
    this.addShake(FX.SHAKE_WRONG);
    this.setActor(p, 'sad');
    this.setMarker(p, 'lock');
    this.stamps.push({ img: this.stampX, x: this.cx[p], y: 78, t: 0 });
    this.setHost('sad', 1.2);
    this.spot = { target: null, until: 0 };
  }

  fxReopen() {
    this.actors.forEach((a) => {
      if (a.marker === 'bang') a.marker = null;
      if (a.anim === 'buzz') a.setAnim('idle');
    });
  }

  /** 답을 다시 말하게 될 때(다시 듣는 중) */
  fxRetry(p) {
    this.addShake(1);
    this.actors[p].stretch(1.15, 0.88, 0.12);
  }

  fxTimeUp() {
    this.addShake(2);
    this.actors.forEach((a) => a.setAnim('sad'));
    this.setHost('surprised', 2);
    this.spot = { target: null, until: 0 };
  }

  fxHint() {
    this.particles.sparkle(W / 2, 70, 14, 120);
    this.setHost('talk', 0.8, true);
  }

  /** 최종 결과 — winners: 1위인 참가자 번호들 */
  fxResult(winners) {
    this.mode = 'result';
    this.resultWinners = winners;
    this.actors.forEach((a, i) => {
      if (winners.includes(i)) {
        a.setAnim('cheer', { jump: true, loopJump: true });
        a.marker = 'crown';
      } else {
        a.setAnim('idle');
        a.marker = null;
      }
    });
    if (winners.length === 1) this.focus(winners[0], 999);
    this.setHost('happy', 999);
  }

  /** 화면을 닫을 때 — 반복 점프 예약을 멈춘다 */
  dispose() {
    this.actors.forEach((a) => {
      a.loopJump = false;
    });
  }

  // ---------- 루프 ----------
  update(dt, beat = 0) {
    this.time += dt;
    this.beat = beat;
    const frozen = performance.now() < this.freezeUntil;
    if (!frozen) {
      this.actors.forEach((a) => a.update(dt, this.particles));
      this.particles.update(dt);
      this.stamps.forEach((s) => (s.t += dt));
      this.stamps = this.stamps.filter((s) => s.t < 1.4);
      if (this.mode === 'result') {
        // 주사율과 상관없이 초당 36개
        const colors = [2, 9, 4, 12, 5];
        this._rainAcc = (this._rainAcc || 0) + dt * 36;
        while (this._rainAcc >= 1) {
          this._rainAcc--;
          this.particles.rain(W, colors, 1);
        }
      }
    }
    if (this.host.until && this.time > this.host.until) {
      this.host.face = 'neutral';
      this.host.until = 0;
    }
    // 화면 흔들림 (정수 픽셀)
    this.shake *= Math.pow(FX.SHAKE_DECAY, dt * 60); // 60fps 기준 감쇠를 시간 기준으로
    if (this.shake < 0.3) this.shake = 0;
    const ox = this.shake ? Math.round((Math.random() * 2 - 1) * this.shake) : 0;
    const oy = this.shake ? Math.round((Math.random() * 2 - 1) * this.shake) : 0;
    this.offset = { x: ox, y: oy };
    if (this.shakeEl) {
      const k = SCREEN.UI_W / SCREEN.ART_W;
      this.shakeEl.style.transform = ox || oy ? `translate(${ox * k}px, ${oy * k}px)` : '';
    }
  }

  draw() {
    const ctx = this.ctx;
    const t = this.time;
    ctx.clearRect(0, 0, W, H);

    // 1) 하늘
    ctx.drawImage(this.skies[this.skyLevel], 0, 0);
    // 2) 별 + 달
    if (this.skyLevel > 0 || this.mode !== 'play') {
      for (const s of this.stars) {
        const phase = Math.floor(t * 2 + s.p) % 6;
        if (phase === 0) continue;
        rect(ctx, phase < 3 ? 12 : 13, s.x, s.y, 1, 1);
      }
    }
    this._moon(ctx, 262, 30);
    // 3) 도시 패럴랙스 (먼 쪽은 느리게)
    const farX = -Math.floor((t * 3) % 640);
    const nearX = -Math.floor((t * 7) % 640);
    ctx.drawImage(this.cityFar, farX, FLOOR_Y - 62);
    ctx.drawImage(this.cityFar, farX + 640, FLOOR_Y - 62);
    ctx.drawImage(this.cityNear, nearX, FLOOR_Y - 44);
    ctx.drawImage(this.cityNear, nearX + 640, FLOOR_Y - 44);
    // 4) 조명 빔 (반투명 오버레이)
    this._spotlights(ctx, t);
    // 5) 트러스 + 전구
    ctx.drawImage(this.truss, 0, 0);
    const bulbColors = [2, 4, 9, 6, 3, 10];
    for (let x = 6, i = 0; x < W; x += 20, i++) {
      const on = (i + this.beat) % 3 !== 0;
      rect(ctx, 0, x - 1, 8, 4, 4);
      rect(ctx, on ? bulbColors[i % bulbColors.length] : 15, x, 9, 2, 2);
    }
    // 6) 바닥 + 무대 앞 전구 띠
    ctx.drawImage(this.floor, 0, FLOOR_Y);
    for (let x = 2, i = 0; x < W; x += 8, i++) {
      rect(ctx, (i + Math.floor(t * 6)) % 4 === 0 ? 12 : 4, x, FLOOR_Y + 3, 2, 1);
    }
    // 7) 사회자 + 책상
    this._host(ctx, t);
    ctx.drawImage(this.desk, DESK.x, DESK.y);
    // 8) 단상 + 캐릭터
    this.podiums.forEach((cv, i) => ctx.drawImage(cv, Math.round(this.cx[i] - PODIUM_W / 2), FEET_Y));
    this.actors.forEach((a) => a.draw(ctx, t));
    // 9) O/X 도장
    for (const s of this.stamps) {
      const pop = s.t < 0.12 ? 1.6 - s.t * 5 : 1; // 쾅! 하고 커졌다 줄어듦
      if (s.t > 1.1 && Math.floor(s.t * 20) % 2) continue;
      const w = Math.round(s.img.width * pop);
      const h = Math.round(s.img.height * pop);
      ctx.drawImage(s.img, Math.round(s.x - w / 2), Math.round(s.y - h / 2), w, h);
    }
    // 10) 파티클
    this.particles.draw(ctx);
    // 11) 앞줄 관객 (박자에 맞춰 들썩)
    this._crowd(ctx);
  }

  _moon(ctx, x, y) {
    if (this.skyLevel === 0 && this.mode === 'play') return;
    rect(ctx, 13, x - 6, y - 8, 12, 16);
    rect(ctx, 13, x - 8, y - 6, 16, 12);
    rect(ctx, 12, x - 5, y - 7, 10, 13);
    rect(ctx, 12, x - 7, y - 5, 13, 9);
    rect(ctx, 13, x + 1, y - 3, 3, 3);
    rect(ctx, 13, x - 4, y + 2, 2, 2);
  }

  _spotlights(ctx, t) {
    // 반투명 대신 디더(일부 픽셀만 칠하기)로 빛을 표현해 팔레트 밖 색이 생기지 않게 한다
    const sources = [60, W - 60];
    const focused = this.spot.target !== null && this.time < this.spot.until;
    sources.forEach((sx, i) => {
      // 정수 픽셀로 움직여야 디더 무늬가 떨리지 않는다
      const tx = focused ? this.cx[this.spot.target] : Math.round(W / 2 + Math.sin(t * 0.7 + i * 2.2) * 120);
      pixelTriangle(ctx, i ? 11 : 4, sx, 8, tx - 22, FEET_Y + 4, tx + 22, FEET_Y + 4, 2);
    });
    if (focused) {
      // 주인공 바닥 원형 조명
      const cx = this.cx[this.spot.target];
      pixelTriangle(ctx, 4, cx - 20, FEET_Y - 1, cx + 20, FEET_Y - 1, cx, FEET_Y - 5, 6);
      pixelTriangle(ctx, 4, cx - 20, FEET_Y, cx + 20, FEET_Y, cx, FEET_Y + 3, 6);
    }
  }

  _host(ctx, t) {
    let face = this.host.face;
    if (this.time < this.host.talkUntil) face = Math.floor(t * 8) % 2 ? 'talk' : 'neutral';
    const bob = Math.floor(t * 2) % 2;
    ctx.drawImage(assets.get(`host.${face}`), HOST_POS.x, HOST_POS.y + bob);
  }

  _crowd(ctx) {
    const y0 = H - 10;
    for (let i = 0, x = -4; x < W; i++, x += 9) {
      const hop = (i + this.beat) % 4 === 0 ? 2 : (i * 7 + this.beat) % 5 === 0 ? 1 : 0;
      const img = assets.get(`crowd.${i % 3}`);
      ctx.drawImage(img, x, y0 - hop + (i % 2) * 2);
      // 응원봉 (가끔)
      if (i % 5 === 2) {
        rect(ctx, 0, x + 7, y0 - 6 - hop, 1, 6);
        rect(ctx, i % 2 ? 2 : 9, x + 7, y0 - 8 - hop, 1, 3);
      }
    }
    rect(ctx, 0, 0, H - 2, W, 2);
  }
}
