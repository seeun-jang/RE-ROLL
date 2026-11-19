// =============================================================
// Background.js — "개울가 징검다리" 마을 축제 배경
//   레이어 (뒤 → 앞):
//     drawSky   : 하늘 디더 밴드, 흐르는 구름, 축제 줄깃발/청사초롱   (패럴랙스 0.1~0.2)
//     drawFar   : 먼 산 3겹, 한옥 기와지붕 마을, 돌담                    (0.3)
//     drawCrowd : 건너편 둑 + 관중 (2줄, 들썩임/환호)                    (0.6)
//     drawStage : 모래톱, 개울물(물결 8fps), 징검돌(흔들림/거품/반영)    (1.0)
//     drawFront : 수면 반짝임(1.0), 앞쪽 구석 갈대/부들/풀               (1.25)
//   - 정적인 부분은 생성자에서 오프스크린 캔버스에 한 번만 굽고,
//     매 프레임에는 정수 오프셋으로 붙이기 + 작은 움직이는 것만 그린다.
//   - 카메라 오프셋: 레이어마다 Math.round(cam * factor) 만큼 "더해서" 이동한다.
//     (camX = +3 이면 무대 레이어는 화면에서 오른쪽으로 3px)
//   - DOM 접근은 생성자 안에서 document.createElement('canvas')뿐 (import 시점엔 없음).
// =============================================================

import { CONFIG } from '../config.js';
import { createRng, clamp } from '../util.js';
import {
  C, HEX, Pix,
  buildSky, buildCloud, buildFlag, buildLantern, buildStrand, strandY,
  buildFar, buildBank, buildBannerPole,
  buildVillager, randomVillager, VILLAGER_H, VILLAGER_AX,
  buildStageBase, buildStone, makeReedSpec, buildReeds,
} from './bgArt.js';

const SCR_W = CONFIG.SCREEN.W;
const SCR_H = CONFIG.SCREEN.H;
const PX = 16; // 좌우 여유 (카메라 ±8px + 앞 레이어 1.25배 대비)
const PY = 8; // 위아래 여유
const LW = SCR_W + PX * 2; // 레이어 캔버스 폭 (W+32)
const LH = SCR_H + PY * 2; // 레이어 캔버스 높이
const WATER_Y = CONFIG.STAGE.WATER_Y;
const FLOOR_Y = CONFIG.STAGE.FLOOR_Y;
const STONE_W = CONFIG.STAGE.STONE_W;
const CENTER_X = CONFIG.STAGE.CENTER_X;
const STONE_H = 12; // 징검돌 그림 높이 (수면 아래로 잠기는 부분 포함)

// 레이어별 패럴랙스 배율
export const PARALLAX = {
  sky: 0.1, cloud: 0.12, bunting: 0.2, far: 0.3, crowd: 0.6, stage: 1, front: 1.25,
};

const off = (cam, f) => Math.round((Number.isFinite(cam) ? cam : 0) * f);

// 줄깃발/초롱 줄 설정
const FLAG_STRAND = { a0: 10, P: 80, ya: 18, sag: 11 };
const LANTERN_STRAND = { a0: 50, P: 80, ya: 15, sag: 7 };
const FLAG_COLORS = [C.red, C.sand, C.blue, C.white, C.green, C.orange, C.sky];

// 장식용 징검돌 (화면 좌표, 대결용 2개 양옆으로 3개씩)
const DECOR_STONES = [
  { x: 80, y: 138, w: 10, moss: 0.7, round: 1 },
  { x: 105, y: 137, w: 11, moss: 0.5, round: 0 },
  { x: 129, y: 137, w: 10, moss: 0.6, round: 1 },
  { x: 191, y: 137, w: 10, moss: 0.6, round: 1 },
  { x: 215, y: 137, w: 11, moss: 0.5, round: 0 },
  { x: 240, y: 138, w: 10, moss: 0.7, round: 1 },
];

export class Background {
  constructor({ rng } = {}) {
    // 주입된 rng는 시드 1개만 뽑아 쓴다 (경기용 난수열을 많이 소모하지 않도록)
    const src = typeof rng === 'function' ? rng : Math.random;
    const seed = (Math.floor(src() * 4294967296) >>> 0) || 1;
    this.rng = createRng(seed); // 런타임(환호 등)용
    const art = createRng((seed ^ 0x9e3779b9) >>> 0); // 그림 생성용

    this.t = 0; // 내부 시간 (프레임)
    this.time = 0; // 경기 경과 초 (외부 제공)
    this.tension = 0; // 0..1 (부드럽게 따라감)
    this.tensionTarget = 0;

    this._buildSky(art);
    this._buildFar(art);
    this._buildCrowd(art);
    this._buildStage(art);
    this._buildFront(art);
  }

  // -----------------------------------------------------------
  // 생성 (정적 그림 굽기)
  // -----------------------------------------------------------
  _buildSky(art) {
    this.skyCanvas = buildSky(LW, LH, PY).toCanvas();

    // 구름: 크기/높이/속도 다양하게
    const defs = [
      { w: 42, h: 12, y: 30 }, { w: 26, h: 8, y: 44 }, { w: 54, h: 14, y: 36 },
      { w: 30, h: 9, y: 54 }, { w: 22, h: 7, y: 62 }, { w: 34, h: 10, y: 48 },
    ];
    this.clouds = defs.map((d, i) => ({
      canvas: buildCloud(art, d.w, d.h).toCanvas(),
      w: d.w,
      h: d.h,
      y: d.y,
      x0: Math.floor(((i + art() * 0.6) / defs.length) * (LW + d.w)),
      speed: 0.02 + art() * 0.035 + (d.y < 40 ? 0.015 : 0), // 위쪽 구름이 조금 더 빠름
    }));

    // 줄 (처짐 -1/0/+1 세 가지 판을 미리 구움 → 살랑이는 흔들림)
    const mkStrands = (S) => [-1, 0, 1].map((d) =>
      buildStrand(LW, 48, PX, S.a0, S.P, S.ya, S.sag + d, C.charcoal).toCanvas());
    this.flagStrands = mkStrands(FLAG_STRAND);
    this.lanternStrands = mkStrands(LANTERN_STRAND);

    // 깃발 스프라이트 [색][프레임]
    this.flagSpr = {};
    for (const col of FLAG_COLORS) this.flagSpr[col] = [buildFlag(col, 0).toCanvas(), buildFlag(col, 1).toCanvas()];
    this.lanternSpr = [buildLantern(0).toCanvas(), buildLantern(1).toCanvas()];

    // 깃발 위치: 앵커 근처는 비움
    this.flags = [];
    let ci = 0;
    for (let x = -PX + 2; x < SCR_W + PX - 2; x += 7) {
      const u = ((((x - FLAG_STRAND.a0) % FLAG_STRAND.P) + FLAG_STRAND.P) % FLAG_STRAND.P);
      if (u < 5 || u > FLAG_STRAND.P - 5) continue;
      this.flags.push({ x, col: FLAG_COLORS[ci % FLAG_COLORS.length] });
      ci++;
    }
    // 초롱 위치: 줄 한 칸마다 3개
    this.lanterns = [];
    for (let a = LANTERN_STRAND.a0 - LANTERN_STRAND.P * 2; a < SCR_W + PX; a += LANTERN_STRAND.P) {
      for (const [dx, cord] of [[18, 2], [40, 3], [62, 2]]) {
        const x = a + dx;
        if (x < -PX || x > SCR_W + PX) continue;
        this.lanterns.push({ x, cord, ph: art() * Math.PI * 2 });
      }
    }
  }

  _buildFar(art) {
    this.farCanvas = buildFar(art, LW, LH, PX, PY).toCanvas();
  }

  _buildCrowd(art) {
    this.bankCanvas = buildBank(art, LW, LH, PX, PY).toCanvas();

    // 오방색 깃발 장대 (양 끝)
    this.poles = [
      { x: 26, base: 112, dir: 1, frames: [buildBannerPole(0, 1).toCanvas(), buildBannerPole(1, 1).toCanvas()], ax: 2 },
      { x: 294, base: 112, dir: -1, frames: [buildBannerPole(0, -1).toCanvas(), buildBannerPole(1, -1).toCanvas()], ax: 9 },
    ];

    // 관중 2줄 (뒷줄 y=112, 앞줄 y=120). 앞줄은 가운데(대결 자리)를 비워 시야 확보
    const people = [];
    const addRow = (footY, startX, step, kidChance, skipCenter) => {
      for (let x = startX; x < SCR_W + PX - 4; x += step) {
        const jx = x + Math.floor(art() * 5) - 2;
        if (skipCenter && Math.abs(jx - CENTER_X) < 22) continue;
        if (people.length >= 40) break;
        const spec = randomVillager(art, { kidChance });
        const frames = [0, 1, 2].map((pose) => buildVillager(spec, pose).toCanvas());
        people.push({
          x: jx,
          footY: footY + (art() < 0.3 ? 1 : 0),
          spec,
          frames,
          phase: art() * Math.PI * 2,
          bobMul: 0.7 + art() * 0.6,
          excitable: art() < 0.45,
          seed: art(),
          cheer: 0,
          cheerAge: 0,
          pow: 0,
          hopPeriod: 18,
          hopH: 3,
        });
      }
    };
    addRow(112, -PX + 6, 18, 0.12, false);
    addRow(120, -PX + 15, 18, 0.4, true);
    this.crowd = people; // 뒷줄이 먼저 → 앞줄이 위에 그려짐
  }

  _buildStage(art) {
    this.stageCanvas = buildStageBase(art, LW, LH, PX, PY, WATER_Y).toCanvas();

    const mkStone = (w, opts) => {
      const s = buildStone(art, w, STONE_H, opts);
      return { dry: s.dry.toCanvas(), wet: s.wet.toCanvas(), w, h: STONE_H };
    };
    // 대결용 돌 2개 (왼쪽/오른쪽 모양 조금 다르게)
    this.duelStones = [mkStone(STONE_W, { moss: 0.45, round: 0 }), mkStone(STONE_W, { moss: 0.45, round: 0 })];
    this.decor = DECOR_STONES.map((d, i) => ({ ...d, i: i + 2, spr: mkStone(d.w, { moss: d.moss, round: d.round }) }));

    // 물결 대시 (8fps 애니메이션)
    this.ripples = [];
    for (let i = 0; i < 54; i++) {
      const y = WATER_Y + 2 + Math.floor(art() * 35);
      const depth = y - WATER_Y;
      let col;
      if (depth < 5) col = C.white;
      else if (depth < 12) col = art() < 0.5 ? C.white : C.cyan;
      else if (depth < 24) col = C.cyan;
      else col = art() < 0.6 ? C.sky : C.cyan;
      const per = 6 + Math.floor(art() * 8);
      this.ripples.push({
        x0: Math.floor(art() * LW),
        y,
        len: 2 + Math.floor(art() * (depth < 12 ? 4 : 6)),
        gap: art() < 0.35 ? 2 + Math.floor(art() * 2) : 0, // 끊긴 이중 대시
        col,
        spd: (art() < 0.5 ? -1 : 1) * (0.3 + art() * 0.7) * (depth < 12 ? 0.6 : 1),
        per,
        on: Math.max(2, Math.floor(per * (0.45 + art() * 0.3))),
        ph: Math.floor(art() * per),
      });
    }
  }

  _buildFront(art) {
    const cw = 64, ch = 64;
    this.reedTop = SCR_H + PY - ch; // 화면 y (바닥이 캔버스 아래 끝)
    const specL = makeReedSpec(art, -1, cw, ch);
    const specR = makeReedSpec(art, 1, cw, ch);
    const frames = (spec) => [-2, -1, 0, 1, 2].map((s) => buildReeds(spec, s).toCanvas());
    this.reeds = [
      { x: -PX, frames: frames(specL), ph: 0 },
      { x: SCR_W + PX - cw, frames: frames(specR), ph: 1.7 },
    ];
    // 수면 반짝임
    this.sparkles = [];
    const spots = [[42, 158], [96, 171], [123, 151], [204, 162], [252, 150], [284, 174], [178, 176], [62, 147]];
    for (const [x, y] of spots) {
      this.sparkles.push({ x, y, per: 90 + Math.floor(art() * 80), ph: Math.floor(art() * 160) });
    }
  }

  // -----------------------------------------------------------
  // 갱신
  // -----------------------------------------------------------
  update(dt = 1, { time = 0, tension = 0 } = {}) {
    const d = Number.isFinite(dt) ? clamp(dt, 0, 10) : 1;
    this.t += d;
    this.time = Number.isFinite(time) ? time : 0;
    this.tensionTarget = clamp(Number.isFinite(tension) ? tension : 0, 0, 1);
    // 긴장도는 천천히 따라감 (갑자기 튀지 않게)
    this.tension += (this.tensionTarget - this.tension) * Math.min(1, 0.06 * d);
    for (const v of this.crowd) {
      if (v.cheer > 0) {
        v.cheer -= d;
        v.cheerAge += d;
        if (v.cheer <= 0) { v.cheer = 0; v.pow = 0; }
      }
    }
  }

  // 관중 환호: side -1 왼쪽 응원 / 1 오른쪽 / 0 전체. 약 2초 점프 + 손 흔들기
  cheer(side = 0, intensity = 1) {
    const sd = Math.sign(Number(side) || 0);
    const inten = clamp(Number.isFinite(intensity) ? intensity : 1, 0, 2);
    if (inten <= 0) return;
    for (const v of this.crowd) {
      // 응원하는 쪽 절반은 더 크게, 반대쪽은 약하게 (일부는 가만히)
      const near = sd === 0 ? 1 : (Math.sign(v.x - CENTER_X) === sd ? 1 : 0.45);
      const pow = inten * near;
      if (pow < 0.6 && this.rng() < 0.35) continue;
      const delay = Math.floor(this.rng() * 12); // 사람마다 반응 타이밍 조금씩 다르게
      const dur = Math.round(120 * (0.85 + this.rng() * 0.3));
      if (v.cheer > 0 && v.cheerAge >= 0) {
        v.cheer = Math.max(v.cheer, dur);
        v.pow = Math.max(v.pow, pow);
      } else {
        v.cheer = dur + delay;
        v.cheerAge = -delay;
        v.pow = pow;
        v.hopPeriod = 15 + Math.floor(this.rng() * 9);
        v.hopH = 2 + this.rng() * 2;
      }
    }
  }

  // 현재 관중 한 명의 포즈/높이 계산 (테스트/디버그에도 사용)
  _villagerPose(v) {
    let pose = 0;
    let dy = 0;
    const ten = this.tension;
    if (v.cheer > 0 && v.cheerAge >= 0) {
      const a = v.cheerAge;
      const fade = Math.min(1, v.cheer / 20); // 끝날 때 잦아듦
      const hop = Math.abs(Math.sin((a * Math.PI) / v.hopPeriod));
      dy = -Math.round(hop * v.hopH * Math.min(1.3, v.pow) * fade);
      if (v.pow >= 0.6) pose = Math.floor(a / 6 + v.seed * 4) % 2 ? 2 : 1;
      else pose = Math.floor(a / 10 + v.seed * 3) % 3 === 0 ? 1 : 0;
    } else {
      // 평소: 살짝 들썩 (긴장도가 오르면 더 빠르고 크게)
      const speed = 0.05 * (1 + ten * 2.2) * v.bobMul;
      const b = Math.sin(this.t * speed + v.phase);
      const amp = ten < 0.35 ? 1 : ten < 0.75 ? 2 : 3;
      const thr = 0.55 - ten * 0.4;
      if (b > thr) dy = -Math.round(1 + ((amp - 1) * (b - thr)) / (1 - thr));
      // 긴장되면 흥분한 사람들은 손을 번쩍
      if (ten > 0.55 && v.excitable && Math.sin(this.t * 0.09 + v.phase * 2) > 0.6) pose = 1;
    }
    return { pose, dy };
  }

  // -----------------------------------------------------------
  // 그리기
  // -----------------------------------------------------------
  drawSky(ctx, camX = 0, camY = 0) {
    ctx.imageSmoothingEnabled = false;
    // 하늘
    ctx.drawImage(this.skyCanvas, -PX + off(camX, PARALLAX.sky), -PY + off(camY, PARALLAX.sky));

    // 구름 (천천히 오른쪽으로 흐름, 화면 밖으로 나가면 반대편에서 다시)
    const oc = off(camX, PARALLAX.cloud), ocy = off(camY, PARALLAX.cloud);
    for (const c of this.clouds) {
      const span = LW + c.w;
      const x = Math.floor((c.x0 + this.t * c.speed) % span) - c.w - PX + oc;
      ctx.drawImage(c.canvas, x, c.y + ocy);
    }

    // 축제 줄깃발 + 청사초롱
    const ob = off(camX, PARALLAX.bunting), oby = off(camY, PARALLAX.bunting);
    const sF = clamp(Math.round(Math.sin(this.t * 0.021) * 1.3), -1, 1);
    const sL = clamp(Math.round(Math.sin(this.t * 0.017 + 1.9) * 1.3), -1, 1);

    ctx.drawImage(this.flagStrands[sF + 1], -PX + ob, oby);
    for (let i = 0; i < this.flags.length; i++) {
      const f = this.flags[i];
      const y = strandY(f.x, FLAG_STRAND.a0, FLAG_STRAND.P, FLAG_STRAND.ya, FLAG_STRAND.sag + sF) + 1;
      // 바람 물결이 줄을 따라 지나가듯 프레임이 번갈아 바뀜
      const fr = Math.floor((this.t + f.x * 1.5) / 12) % 2 === 0 ? 0 : 1;
      ctx.drawImage(this.flagSpr[f.col][fr], f.x - 2 + ob, y + oby);
    }

    ctx.drawImage(this.lanternStrands[sL + 1], -PX + ob, oby);
    ctx.fillStyle = HEX[C.charcoal];
    for (const L of this.lanterns) {
      const ys = strandY(L.x, LANTERN_STRAND.a0, LANTERN_STRAND.P, LANTERN_STRAND.ya, LANTERN_STRAND.sag + sL);
      const swing = clamp(Math.round(Math.sin(this.t * 0.035 + L.ph) * 1.4), -1, 1);
      const lx = L.x + ob, ly = ys + 1 + oby;
      // 끈: 위쪽은 줄에 고정, 아래쪽은 초롱 따라 흔들림
      ctx.fillStyle = HEX[C.charcoal];
      ctx.fillRect(lx, ly, 1, L.cord - 1);
      ctx.fillRect(lx + swing, ly + L.cord - 1, 1, 1);
      const fr = Math.floor((this.t + L.ph * 30) / 20) % 2 === 0 ? 0 : 1;
      ctx.drawImage(this.lanternSpr[fr], lx - 2 + swing, ly + L.cord);
    }
  }

  drawFar(ctx, camX = 0, camY = 0) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.farCanvas, -PX + off(camX, PARALLAX.far), -PY + off(camY, PARALLAX.far));
  }

  drawCrowd(ctx, camX = 0, camY = 0) {
    ctx.imageSmoothingEnabled = false;
    const ox = off(camX, PARALLAX.crowd), oy = off(camY, PARALLAX.crowd);
    ctx.drawImage(this.bankCanvas, -PX + ox, -PY + oy);

    // 깃발 장대 (깃발이 천천히 펄럭)
    for (let i = 0; i < this.poles.length; i++) {
      const p = this.poles[i];
      const fr = Math.floor(this.t / 22 + i * 0.5) % 2 === 0 ? 0 : 1;
      const cv = p.frames[fr];
      ctx.drawImage(cv, p.x - p.ax + ox, p.base - cv.height + 1 + oy);
    }

    // 관중
    ctx.fillStyle = HEX[C.teal];
    for (const v of this.crowd) {
      const { pose, dy } = this._villagerPose(v);
      const x = v.x - VILLAGER_AX + ox;
      const y = v.footY - (VILLAGER_H - 1) + oy + dy;
      if (dy < 0) {
        // 뛰어오르면 발밑에 작은 그림자
        ctx.fillStyle = HEX[C.teal];
        ctx.fillRect(v.x - 1 + ox, v.footY + oy, 3, 1);
      }
      ctx.drawImage(v.frames[pose], x, y);
    }
  }

  drawStage(ctx, camX = 0, camY = 0, stones = null) {
    ctx.imageSmoothingEnabled = false;
    const ox = off(camX, PARALLAX.stage), oy = off(camY, PARALLAX.stage);
    ctx.drawImage(this.stageCanvas, -PX + ox, -PY + oy);

    const step = Math.floor(this.t / 7.5); // 8fps 애니메이션 스텝
    const wy = WATER_Y + oy; // 화면상의 수면 줄

    // 물결 대시
    for (const r of this.ripples) {
      if ((step + r.ph) % r.per >= r.on) continue;
      const xx = (((Math.floor(r.x0 + step * r.spd) % LW) + LW) % LW) - PX + ox;
      ctx.fillStyle = HEX[r.col];
      ctx.fillRect(xx, r.y + oy, r.len, 1);
      if (r.gap) ctx.fillRect(xx + r.len + r.gap, r.y + oy, Math.max(1, r.len - 1), 1);
    }
    // 수면 줄 반짝임 (천천히 흐르는 흰 점선)
    ctx.fillStyle = HEX[C.white];
    for (let i = 0; i < 12; i++) {
      const xx = (((i * 31 + step * (i % 2 ? 1 : -1)) % LW) + LW) % LW - PX + ox;
      if ((step + i) % 5 < 3) ctx.fillRect(xx, wy, 2 + (i % 3), 1);
    }

    // 장식 돌 → 대결 돌 순서
    for (const d of this.decor) {
      this._drawStone(ctx, d.spr, d.x + ox, d.y + oy, 0, 0, wy, step, d.i);
    }
    const list = Array.isArray(stones) && stones.length
      ? stones
      : [{ x: CONFIG.STAGE.P1_X, y: FLOOR_Y, wobble: 0 }, { x: CONFIG.STAGE.P2_X, y: FLOOR_Y, wobble: 0 }];
    for (let i = 0; i < list.length; i++) {
      const s = list[i] || {};
      const sx = Number.isFinite(s.x) ? Math.round(s.x) : (i === 0 ? CONFIG.STAGE.P1_X : CONFIG.STAGE.P2_X);
      const sy = Number.isFinite(s.y) ? Math.round(s.y) : FLOOR_Y;
      const wob = Number.isFinite(s.wobble) ? Math.round(s.wobble) : 0;
      // 흔들릴 때 바깥쪽 절반이 1px 더 기울어 보이게
      const tilt = wob !== 0 ? Math.sign(wob) : 0;
      const tiltSide = sx < CENTER_X ? -1 : 1;
      this._drawStone(ctx, this.duelStones[i % this.duelStones.length], sx + ox, sy + oy + wob, tilt, tiltSide, wy, step, i);
    }
  }

  // 돌 하나: 물속 반영 → 돌(수면 위는 마른 판, 아래는 젖은 판) → 거품 고리
  _drawStone(ctx, spr, cx, top, tilt, tiltSide, wy, step, idx) {
    const w = spr.w;
    const left = cx - Math.floor(w / 2);
    const right = left + w - 1;

    // 반영 (돌 아래로 일렁이는 어두운 줄)
    for (let r = 0; r < 6; r++) {
      const y = wy + 4 + r;
      const shift = ((step >> 1) + r + idx) % 3 - 1;
      const a = left + 1 + (r >> 1) + shift;
      const b = right - 1 - (r >> 1) + shift;
      ctx.fillStyle = HEX[y - wy < 11 ? C.teal : C.navy];
      for (let x = a; x <= b; x++) if (((x + r + step) & 1) === 0) ctx.fillRect(x, y, 1, 1);
    }

    // 돌 본체
    if (tilt === 0) {
      this._stoneSlice(ctx, spr, 0, w, left, top, wy);
    } else {
      const half = Math.floor(w / 2);
      if (tiltSide < 0) {
        this._stoneSlice(ctx, spr, 0, half, left, top + tilt, wy);
        this._stoneSlice(ctx, spr, half, w - half, left + half, top, wy);
      } else {
        this._stoneSlice(ctx, spr, 0, half, left, top, wy);
        this._stoneSlice(ctx, spr, half, w - half, left + half, top + tilt, wy);
      }
    }

    // 거품 고리 (4프레임 순환)
    const f = (step + idx) & 3;
    ctx.fillStyle = HEX[C.white];
    if ((f & 1) === 0) {
      ctx.fillRect(left - 1, wy - 1, 1, 1);
      ctx.fillRect(right + 1, wy - 1, 1, 1);
    }
    ctx.fillRect(left - 2, wy, 2, 1);
    ctx.fillRect(right + 1, wy, 2, 1);
    ctx.fillStyle = HEX[C.cyan];
    if (f & 1) {
      ctx.fillRect(left - 3, wy, 1, 1);
      ctx.fillRect(right + 3, wy, 1, 1);
    }
    for (let x = left - 3; x <= right + 3; x++) {
      const k = (x + f) % 3;
      if (k === 0) continue;
      ctx.fillStyle = HEX[k === 1 ? C.white : C.cyan];
      ctx.fillRect(x, wy + 1, 1, 1);
    }
    ctx.fillStyle = HEX[C.cyan];
    for (let x = left - 5; x <= right + 5; x++) {
      if ((((x * 5 + f) % 7) + 7) % 7 === 0) ctx.fillRect(x, wy + 2, 1, 1);
    }
    ctx.fillRect(left - 5 + (f >> 1), wy + 1, 1, 1);
    ctx.fillRect(right + 5 - (f >> 1), wy + 1, 1, 1);
  }

  // 돌 세로 조각을 수면 기준으로 마른/젖은 판에서 나눠 그림
  _stoneSlice(ctx, spr, sx, sw, dx, dy, wy) {
    const h = spr.h;
    const dryRows = clamp(wy - dy, 0, h);
    if (sw <= 0) return;
    if (dryRows > 0) ctx.drawImage(spr.dry, sx, 0, sw, dryRows, dx, dy, sw, dryRows);
    if (h - dryRows > 0) ctx.drawImage(spr.wet, sx, dryRows, sw, h - dryRows, dx, dy + dryRows, sw, h - dryRows);
  }

  drawFront(ctx, camX = 0, camY = 0) {
    ctx.imageSmoothingEnabled = false;
    // 수면 반짝임 (물과 같은 1.0 배율)
    const sx = off(camX, PARALLAX.stage), sy = off(camY, PARALLAX.stage);
    for (const s of this.sparkles) {
      const a = Math.floor(this.t + s.ph) % s.per;
      if (a >= 16) continue;
      const x = s.x + sx, y = s.y + sy;
      ctx.fillStyle = HEX[C.white];
      ctx.fillRect(x, y, 1, 1);
      const arm = a >= 6 && a < 10 ? 2 : a >= 4 && a < 12 ? 1 : 0;
      if (arm > 0) {
        ctx.fillStyle = HEX[C.cyan];
        ctx.fillRect(x - arm, y, arm, 1);
        ctx.fillRect(x + 1, y, arm, 1);
        ctx.fillRect(x, y - arm, 1, arm);
        ctx.fillRect(x, y + 1, 1, arm);
      }
    }

    // 앞쪽 갈대 (바람에 살랑, 미리 구운 5단계 중 선택)
    const ox = off(camX, PARALLAX.front), oy = off(camY, PARALLAX.front);
    for (const r of this.reeds) {
      const gust = 0.7 + 0.3 * Math.sin(this.t * 0.011 + r.ph);
      const s = clamp(Math.round(2 * Math.sin(this.t * 0.03 + r.ph) * gust), -2, 2);
      ctx.drawImage(r.frames[s + 2], r.x + ox, this.reedTop + oy);
    }
  }

  // 편의: 모든 레이어를 순서대로 (캐릭터 없이 미리보기할 때)
  drawAll(ctx, camX = 0, camY = 0, stones = null) {
    this.drawSky(ctx, camX, camY);
    this.drawFar(ctx, camX, camY);
    this.drawCrowd(ctx, camX, camY);
    this.drawStage(ctx, camX, camY, stones);
    this.drawFront(ctx, camX, camY);
  }
}

// Pix는 디버그용으로 재노출 (다른 모듈이 픽셀 버퍼를 쓰고 싶을 때)
export { Pix };
