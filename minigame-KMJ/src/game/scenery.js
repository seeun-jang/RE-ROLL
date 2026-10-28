// 배경: 트로이가 함락되는 밤. 핏빛 달, 불타는 도시, 거대한 석상, 열주 회랑, 젖은 돌바닥.
//
// 3D 카메라: 모든 물체가 깊이(Z)를 갖고, 카메라가 앞뒤·좌우·위아래로 움직이면 깊이에 맞게 다시 투영돼요.
// 바닥은 매 프레임 한 줄씩 원근으로 다시 그리고(모드 7), 무거운 그림은 처음에 한 번만 그려 둡니다.
// 불꽃, 연기, 안개, 번개, 재는 매 프레임 새로 그려요.

import { WIDTH, HEIGHT } from './config.js';
import { fbm, noise2, smoothstep, mix, makeCanvas, paintPixels, grainTile } from './texture.js';

const TAU = Math.PI * 2;
const M = 60; // 층 양옆 여유 (카메라가 움직여도 빈 곳이 안 보이게)
const LW = WIDTH + M * 2;

export const MOON = { x: 700, y: 128, r: 74 };
const HORIZON = 330;
const VP = { x: WIDTH / 2, y: HORIZON }; // 소실점

// ----------------------------------------------------------------------
// 3D 카메라
//   월드 좌표: X 좌우, Y 높이(바닥 = 0), Z 깊이(멀수록 큼)
//   기본 카메라(CAM0)로 봤을 때의 화면 좌표로 그림을 설계하고,
//   카메라가 움직이면 각 물체를 자기 깊이(Z)에 맞게 다시 투영해요.
// ----------------------------------------------------------------------

export const CAM0 = { x: 0, y: 170, z: -400 };
const F = 700; // 초점 거리
export const STAGE_Z = 501; // 영웅들이 서 있는 깊이 (기본 카메라로 바닥이 y=462)
const FLOOR_MAX_Z = 3500; // 바닥이 이어지는 끝 (그 너머는 도시)

// 설계 깊이 d (화면에서 바닥이 HORIZON + 210/d 에 오는 깊이) → 월드 Z
const zOfDepth = (d) => ((F * CAM0.y) / 210) * d + CAM0.z;
// 설계할 때 바닥이 화면 y 에 오는 깊이 → 월드 Z
const zOfGroundY = (y) => (F * CAM0.y) / (y - HORIZON) + CAM0.z;

/** 깊이 Z 의 평면에 기본 카메라 기준으로 그린 것을, 현재 카메라(cam)로 다시 투영하는 2D 변환 */
export function planeMatrix(Z, cam) {
  const s0 = F / (Z - CAM0.z);
  const s1 = F / Math.max(1, Z - cam.z);
  const k = s1 / s0;
  return [
    k,
    0,
    0,
    k,
    VP.x - VP.x * k + (CAM0.x - cam.x) * s1,
    HORIZON - HORIZON * k + (cam.y - CAM0.y) * s1,
  ];
}

// 깊이 Z 에 있는 물체를 현재 카메라로 그리기
function onPlane(ctx, Z, cam, draw) {
  ctx.save();
  ctx.transform(...planeMatrix(Z, cam));
  draw();
  ctx.restore();
}

// 설계 좌표의 사각형 영역만 담은 작은 그림 (화면 전체 크기 캔버스보다 메모리를 적게 씀)
function sprite(dpr, x0, y0, w, h, draw) {
  const c = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr));
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.translate(-x0, -y0);
  draw(ctx);
  return { img: c, x0, y0, w, h };
}

const blit = (ctx, s) => ctx.drawImage(s.img, s.x0, s.y0, s.w, s.h);

export function createScenery(dpr = 1) {
  const full = (draw) => sprite(dpr, -M, 0, LW, HEIGHT, draw);
  const scene = {
    sky: full(drawSky),
    city: sprite(dpr, -M, HORIZON - 170, LW, 210, drawCity),
    colossus: sprite(dpr, VP.x - 140, HORIZON - 330, 280, 352, drawColossus),
    fore: full(drawForeground),
    floorTex: paintFloorTexture(),
    moonPath: paintMoonPath(),
    fog: paintPixels(512, 128, (x, y) => {
      const n = fbm(x / 70, y / 22, 5, 77);
      const edge = Math.sin((y / 128) * Math.PI);
      return [255, 255, 255, smoothstep(0.42, 0.8, n) * edge * 255];
    }),
    props: [], // 깊이 순으로 그릴 기둥, 화로, 군대 { Z, kind, ... }
  };

  // 열주 회랑 기둥
  for (const d of COLUMN_DEPTHS) {
    for (const side of [-1, 1]) {
      const x = columnX(side, d);
      const base = floorY(d);
      const h = 560 / d;
      const w = 64 / d;
      scene.props.push({
        Z: zOfDepth(d),
        kind: 'sprite',
        sprite: sprite(dpr, x - w, base - h - 20 / d, w * 2, h + 22 / d, (c) => drawPillar(c, x, base, w, h, d, side)),
      });
      if (d === 3.6 || d === 2.3) {
        const bx = x - side * w * 2.2;
        const by = base - 70 / d;
        const s = 3 / d;
        scene.props.push({
          Z: zOfDepth(d) - 1,
          kind: 'brazier',
          x: bx,
          y: by,
          s,
          sprite: sprite(dpr, bx - 16 * s, by - 2, 32 * s, 76 * s, (c) => drawBrazierStand(c, bx, by, s)),
        });
      }
    }
  }

  // 두 군대 (줄마다 깊이가 다름, 함성 버전 따로)
  for (const id of ['p1', 'p2']) {
    for (const d of [3.8, 3.2, 2.7]) {
      const a = ARMY[id];
      const s = 4.3 / d;
      const base = floorY(d);
      const top = base - 160;
      const rect = [a.from - 60, top, a.to - a.from + 120, base - top + 4];
      scene.props.push({
        Z: zOfDepth(d),
        kind: 'army',
        id,
        calm: sprite(dpr, ...rect, (c) => drawArmyRow(c, id, false, d, s, d === 3.2)),
        cheer: sprite(dpr, ...rect, (c) => drawArmyRow(c, id, true, d, s, d === 3.2)),
      });
    }
  }
  scene.props.sort((p, q) => q.Z - p.Z);
  return scene;
}

function drawBrazierStand(ctx, x, y, s) {
  ctx.fillStyle = '#120a08';
  ctx.beginPath();
  ctx.moveTo(x - 14 * s, y);
  ctx.lineTo(x + 14 * s, y);
  ctx.lineTo(x + 8 * s, y + 10 * s);
  ctx.lineTo(x - 8 * s, y + 10 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 2 * s, y + 10 * s, 4 * s, 60 * s);
  ctx.fillRect(x - 10 * s, y + 68 * s, 20 * s, 4 * s);
}

// ======================================================================
// 하늘: 핏빛 달 + 달빛에 테두리가 물든 구름
// ======================================================================

function drawSky(ctx) {
  const sky = paintPixels(LW, HORIZON + 40, (px, y) => {
    const x = px - M;
    const t = y / HORIZON;
    let r = mix(4, 70, t * t);
    let g = mix(3, 10, t * t);
    let b = mix(12, 22, t);
    const dist = Math.hypot(x - MOON.x, y - MOON.y);

    // 달무리
    const halo = Math.exp(-Math.max(0, dist - MOON.r) / 60) * 0.7 + Math.exp(-dist / 260) * 0.25;
    r += halo * 200;
    g += halo * 40;
    b += halo * 30;

    // 구름: 달 근처는 가장자리가 붉게 빛나고 나머지는 거의 검정
    const n = fbm(x / 240 + 3, y / 50, 6, 13);
    const dens = smoothstep(0.48, 0.74, n) * smoothstep(10, 60, y) * (1 - smoothstep(260, 330, y));
    if (dens > 0) {
      const lit = Math.exp(-dist / 230);
      const edge = smoothstep(0.48, 0.56, n) * (1 - smoothstep(0.56, 0.7, n));
      r = mix(r, 14 + lit * 120 + edge * lit * 200, dens);
      g = mix(g, 6 + lit * 20 + edge * lit * 60, dens);
      b = mix(b, 12 + lit * 20 + edge * lit * 50, dens);
    }

    // 별
    if (y < 220 && noise2(x * 5.1, y * 5.1, 91) > 0.986) {
      const a = (1 - y / 220) * (1 - dens) * 0.8;
      r = mix(r, 255, a);
      g = mix(g, 230, a);
      b = mix(b, 230, a);
    }
    // 지평선 쪽 불타는 도시의 붉은 빛
    const fire = smoothstep(200, HORIZON, y) * 0.8;
    r += fire * 120;
    g += fire * 30;
    return [r, g, b];
  });
  ctx.drawImage(sky, -M, 0);

  // 달: 크레이터 질감
  const moon = paintPixels(MOON.r * 2, MOON.r * 2, (px, py) => {
    const d = Math.hypot(px - MOON.r, py - MOON.r) / MOON.r;
    if (d > 1) return [0, 0, 0, 0];
    const crater = smoothstep(0.55, 0.7, fbm(px / 18, py / 18, 5, 23)) * 0.35;
    const limb = 1 - Math.pow(d, 3) * 0.45;
    return [
      (255 - crater * 120) * limb,
      (120 - crater * 60) * limb * (0.85 + (1 - d) * 0.3),
      (90 - crater * 40) * limb,
      255 * smoothstep(1, 0.97, d),
    ];
  });
  ctx.drawImage(moon, MOON.x - MOON.r, MOON.y - MOON.r);
}

// ======================================================================
// 먼 도시: 불타는 트로이 실루엣
// ======================================================================

function drawCity(ctx) {
  const base = HORIZON + 6;
  const glow = ctx.createLinearGradient(0, HORIZON - 120, 0, base + 10);
  glow.addColorStop(0, 'rgba(255,80,20,0)');
  glow.addColorStop(1, 'rgba(255,90,30,0.55)');
  ctx.fillStyle = glow;
  ctx.fillRect(-M, HORIZON - 120, LW, 140);

  ctx.fillStyle = '#0c0406';
  ctx.beginPath();
  ctx.moveTo(-M, base + 20);
  let x = -M;
  let i = 0;
  while (x < WIDTH + M) {
    const w = 18 + noise2(i, 1, 31) * 40;
    const h = 20 + noise2(i, 2, 32) * 60 + (Math.abs(x - VP.x) < 220 ? 30 : 0);
    const kind = noise2(i, 3, 33);
    ctx.lineTo(x, base - h);
    if (kind > 0.8) {
      ctx.arc(x + w / 2, base - h, w / 2, Math.PI, 0); // 돔
    } else if (kind > 0.62) {
      ctx.lineTo(x + w / 2, base - h - w * 0.35); // 신전 지붕
    } else if (kind < 0.12) {
      // 탑
      ctx.lineTo(x + w * 0.3, base - h);
      ctx.lineTo(x + w * 0.3, base - h - 50);
      ctx.lineTo(x + w * 0.7, base - h - 50);
      ctx.lineTo(x + w * 0.7, base - h);
    }
    ctx.lineTo(x + w, base - h);
    x += w;
    i++;
  }
  ctx.lineTo(WIDTH + M, base + 20);
  ctx.closePath();
  ctx.fill();

  // 불붙은 창문
  for (let k = 0; k < 140; k++) {
    const wx = -M + noise2(k, 4, 34) * LW;
    const wy = base - 6 - noise2(k, 5, 35) * 60;
    ctx.fillStyle = `rgba(255,${120 + noise2(k, 6, 36) * 100},40,${0.4 + noise2(k, 7, 37) * 0.5})`;
    ctx.fillRect(wx, wy, 2, 3);
  }
  const haze = ctx.createLinearGradient(0, base - 40, 0, base + 20);
  haze.addColorStop(0, 'rgba(120,30,20,0)');
  haze.addColorStop(1, 'rgba(120,30,20,0.6)');
  ctx.fillStyle = haze;
  ctx.fillRect(-M, base - 40, LW, 60);
  drawFarArmies(ctx);
}

// 지평선의 대군: 수만 명의 창이 숲처럼 (가운데에서 맞부딪힘)
function drawFarArmies(ctx) {
  const y0 = HORIZON + 14;
  for (let x = -M; x < WIDTH + M; x += 2.2) {
    const k = Math.round(x * 10);
    if (Math.abs(x - VP.x) < 10) continue; // 맞부딪히는 틈
    const greek = x < VP.x;
    const row = noise2(k, 1, 71);
    const y = y0 + row * 10;
    const h = 5 + noise2(k, 2, 72) * 3;
    ctx.fillStyle = greek ? 'rgba(40,6,8,0.95)' : 'rgba(8,10,30,0.95)';
    ctx.fillRect(x, y - h, 1.8, h);
    // 창 (적을 향해 기울어짐)
    if (noise2(k, 3, 73) > 0.35) {
      const lean = greek ? 4 : -4;
      ctx.strokeStyle = 'rgba(20,10,10,0.9)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x + 0.9, y - h);
      ctx.lineTo(x + 0.9 + lean, y - h - 12);
      ctx.stroke();
      if (noise2(k, 4, 74) > 0.6) {
        ctx.fillStyle = 'rgba(255,170,90,0.8)';
        ctx.fillRect(x + 0.9 + lean - 0.5, y - h - 13, 1, 1.5);
      }
    }
  }
  // 깃발들
  for (let i = 0; i < 18; i++) {
    const x = -M + noise2(i, 5, 75) * LW;
    if (Math.abs(x - VP.x) < 30) continue;
    const greek = x < VP.x;
    ctx.fillStyle = '#100608';
    ctx.fillRect(x, y0 - 34, 1.2, 34);
    ctx.fillStyle = greek ? '#7a0c10' : '#14287a';
    ctx.beginPath();
    ctx.moveTo(x + 1, y0 - 34);
    ctx.lineTo(x + (greek ? 12 : -12), y0 - 30);
    ctx.lineTo(x + 1, y0 - 25);
    ctx.closePath();
    ctx.fill();
  }
  // 맞부딪히는 곳의 흙먼지와 불빛
  const dust = ctx.createRadialGradient(VP.x, y0, 2, VP.x, y0, 70);
  dust.addColorStop(0, 'rgba(255,150,80,0.55)');
  dust.addColorStop(1, 'rgba(120,40,20,0)');
  ctx.fillStyle = dust;
  ctx.fillRect(VP.x - 70, y0 - 70, 140, 90);
}

// ======================================================================
// 영웅 뒤의 밀집대형 (그리스 = 왼쪽 빨강, 트로이 = 오른쪽 파랑)
// raised: 함성을 지르며 창을 치켜든 모습
// ======================================================================

const ARMY = {
  p1: { from: 150, to: 450, cloak: '#4a0608', crest: '#c8141c', shield: '#7a0c10', dir: 1 },
  p2: { from: 510, to: 810, cloak: '#060c30', crest: '#2a5bd7', shield: '#14287a', dir: -1 },
};

function drawArmyRow(ctx, id, raised, d, s, flags) {
  const a = ARMY[id];
  const base = floorY(d);
  const step = 11 * s;
  let i = 0;
  for (let x = a.from; x <= a.to; x += step, i++) {
    const jitter = (noise2(i, d * 10, 81) - 0.5) * 4 * s;
    soldier(ctx, x + jitter, base, s, a, raised, i);
  }
  // 뒷줄일수록 안개
  ctx.fillStyle = `rgba(40,10,14,${(d - 2.7) * 0.35})`;
  ctx.fillRect(a.from - 60, base - 160, a.to - a.from + 120, 164);
  if (!flags) return;
  // 군기
  for (const fx of [a.from + 40, (a.from + a.to) / 2, a.to - 40]) {
    const top = base - (raised ? 150 : 132);
    ctx.fillStyle = '#0c0606';
    ctx.fillRect(fx, top, 2, base - top);
    ctx.fillStyle = a.shield;
    ctx.beginPath();
    ctx.moveTo(fx + 2, top);
    ctx.quadraticCurveTo(fx + a.dir * 18 + 2, top + 8, fx + a.dir * 30 + 2, top + 4);
    ctx.lineTo(fx + a.dir * 26 + 2, top + 26);
    ctx.quadraticCurveTo(fx + a.dir * 14 + 2, top + 30, fx + 2, top + 24);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,150,80,0.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function soldier(ctx, x, base, s, a, raised, i) {
  const bob = raised ? -3 * s * (i % 2) : 0;
  const top = base - 34 * s + bob;
  // 망토 몸통
  ctx.fillStyle = a.cloak;
  ctx.beginPath();
  ctx.moveTo(x - 6 * s, base);
  ctx.lineTo(x - 4 * s, top + 8 * s);
  ctx.lineTo(x + 4 * s, top + 8 * s);
  ctx.lineTo(x + 6 * s, base);
  ctx.closePath();
  ctx.fill();
  // 투구 + 깃
  ctx.fillStyle = '#16100c';
  ctx.beginPath();
  ctx.arc(x, top + 4 * s, 3.6 * s, 0, TAU);
  ctx.fill();
  ctx.fillStyle = a.crest;
  ctx.fillRect(x - 4 * s, top - 1.5 * s, 8 * s, 2 * s);
  // 창
  ctx.strokeStyle = '#1a120c';
  ctx.lineWidth = Math.max(0.8, 1.1 * s);
  ctx.beginPath();
  const hx = x + a.dir * 4 * s;
  const hy = top + 14 * s;
  let tx;
  let ty;
  if (raised) {
    tx = hx + a.dir * 3 * s;
    ty = hy - 46 * s;
  } else {
    tx = hx + a.dir * 34 * s;
    ty = hy - 16 * s;
  }
  ctx.moveTo(hx - (tx - hx) * 0.3, hy - (ty - hy) * 0.3);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,190,120,0.9)';
  ctx.fillRect(tx - 0.8 * s, ty - 0.8 * s, 1.6 * s, 1.6 * s);
  // 둥근 방패 (적 쪽으로)
  const sx = x + a.dir * 4 * s;
  const sy = top + 17 * s + (raised ? -3 * s : 0);
  ctx.fillStyle = a.shield;
  ctx.beginPath();
  ctx.ellipse(sx, sy, 4 * s, 7 * s, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,140,70,0.7)';
  ctx.lineWidth = 0.7 * s;
  ctx.stroke();
  // 불빛 테두리
  ctx.fillStyle = 'rgba(255,130,60,0.55)';
  ctx.fillRect(x - 3 * s, top + 0.5 * s, 6 * s, 0.8);
}

// ======================================================================
// 거대 석상: 창과 방패를 든 아테나 (달빛 역광)
// ======================================================================

// 석상 크기 (받침대 바닥 기준으로 줄임)
const COLOSSUS_SCALE = 0.62;

function colossusPath(c) {
  const cx = VP.x;
  const ground = HORIZON + 12;
  c.save();
  c.translate(cx, ground);
  c.scale(COLOSSUS_SCALE, COLOSSUS_SCALE);
  c.translate(-cx, -ground);
  c.beginPath();
  // 받침대
  c.rect(cx - 70, ground - 40, 140, 40);
  c.rect(cx - 58, ground - 52, 116, 14);
  // 다리와 옷자락
  c.moveTo(cx - 44, ground - 52);
  c.lineTo(cx - 52, ground - 150);
  c.lineTo(cx - 40, ground - 230);
  c.lineTo(cx + 40, ground - 230);
  c.lineTo(cx + 52, ground - 150);
  c.lineTo(cx + 44, ground - 52);
  c.closePath();
  // 몸통
  c.moveTo(cx - 40, ground - 230);
  c.lineTo(cx - 48, ground - 300);
  c.lineTo(cx - 30, ground - 318);
  c.lineTo(cx + 30, ground - 318);
  c.lineTo(cx + 48, ground - 300);
  c.lineTo(cx + 40, ground - 230);
  c.closePath();
  // 목과 투구 + 높은 깃
  c.rect(cx - 9, ground - 332, 18, 16);
  c.moveTo(cx - 22, ground - 330);
  c.quadraticCurveTo(cx - 26, ground - 372, cx, ground - 378);
  c.quadraticCurveTo(cx + 26, ground - 372, cx + 22, ground - 330);
  c.closePath();
  c.moveTo(cx - 4, ground - 376);
  c.quadraticCurveTo(cx - 40, ground - 420, cx - 64, ground - 380);
  c.quadraticCurveTo(cx - 30, ground - 396, cx + 4, ground - 370);
  c.closePath();
  // 오른팔 + 하늘을 찌르는 창
  c.moveTo(cx + 44, ground - 310);
  c.lineTo(cx + 80, ground - 270);
  c.lineTo(cx + 90, ground - 300);
  c.lineTo(cx + 54, ground - 320);
  c.closePath();
  c.rect(cx + 82, ground - 470, 7, 430);
  c.moveTo(cx + 85.5, ground - 500);
  c.lineTo(cx + 94, ground - 468);
  c.lineTo(cx + 77, ground - 468);
  c.closePath();
  // 왼팔 + 부서진 거대한 방패
  c.moveTo(cx - 44, ground - 310);
  c.lineTo(cx - 76, ground - 250);
  c.lineTo(cx - 60, ground - 240);
  c.closePath();
  c.moveTo(cx - 12, ground - 200);
  c.ellipse(cx - 72, ground - 200, 60, 70, 0, 0, Math.PI * 1.7);
  c.lineTo(cx - 52, ground - 262);
  c.lineTo(cx - 40, ground - 250);
  c.closePath();
  c.restore();
}

function drawColossus(ctx) {
  ctx.save();
  const stone = ctx.createLinearGradient(0, HORIZON - 480, 0, HORIZON + 12);
  stone.addColorStop(0, '#2a2026');
  stone.addColorStop(0.6, '#140c10');
  stone.addColorStop(1, '#080406');
  ctx.fillStyle = stone;
  colossusPath(ctx);
  ctx.fill('nonzero');

  // 돌 질감
  ctx.save();
  colossusPath(ctx);
  ctx.clip('nonzero');
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = ctx.createPattern(grainTile(96, 41, 0.3, 1.8), 'repeat');
  ctx.fillRect(VP.x - 160, 0, 320, HORIZON + 20);
  ctx.restore();

  // 달빛 테두리 (달이 오른쪽 위)
  rim(ctx, colossusPath, -2.5, 2.5, 'rgba(255,120,100,0.9)');
  // 받침대 아래 불빛
  const fire = ctx.createRadialGradient(VP.x, HORIZON + 10, 10, VP.x, HORIZON + 10, 160);
  fire.addColorStop(0, 'rgba(255,110,40,0.35)');
  fire.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = fire;
  ctx.fillRect(VP.x - 160, HORIZON - 150, 320, 170);
  ctx.restore();
}

// 모양(pathFn)의 빛 쪽 가장자리만 밝게
function rim(ctx, pathFn, dx, dy, color) {
  const c = makeCanvas(ctx.canvas.width, ctx.canvas.height);
  const r = c.getContext('2d');
  r.setTransform(ctx.getTransform());
  r.fillStyle = '#fff';
  pathFn(r);
  r.fill('nonzero');
  r.globalCompositeOperation = 'destination-out';
  r.translate(dx, dy);
  pathFn(r);
  r.fill('nonzero');
  r.setTransform(1, 0, 0, 1, 0, 0);
  r.globalCompositeOperation = 'source-in';
  r.fillStyle = color;
  r.fillRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(c, 0, 0);
  ctx.restore();
}

// ======================================================================
// 열주 회랑: 양쪽으로 소실점을 향해 줄지어 선 기둥
// ======================================================================

const floorY = (d) => HORIZON + 210 / d; // 깊이 d 의 바닥 높이
const COLUMN_DEPTHS = [6, 4.6, 3.6, 2.85, 2.3, 1.9];
const columnX = (side, d) => VP.x + side * (430 / d) * 1.6;

function drawPillar(ctx, x, base, w, h, d, side) {
  const fog = Math.min(0.75, (d - 1.9) / 6);
  // 원기둥 음영 (달빛은 오른쪽 위에서)
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, '#08040a');
  g.addColorStop(0.55, '#2a1e24');
  g.addColorStop(0.8, '#5a3a3e');
  g.addColorStop(0.92, '#a8605a');
  g.addColorStop(1, '#1a0e10');
  ctx.fillStyle = g;
  ctx.fillRect(x - w / 2, base - h, w, h);
  // 세로 홈
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let k = -2; k <= 2; k++) ctx.fillRect(x + (k * w) / 6 - 0.5, base - h + 10 / d, 1, h - 20 / d);
  // 머리장식, 받침
  ctx.fillStyle = '#1a1014';
  ctx.fillRect(x - w * 0.75, base - h - 14 / d, w * 1.5, 14 / d);
  ctx.fillRect(x - w * 0.7, base - 12 / d, w * 1.4, 12 / d);
  ctx.fillStyle = 'rgba(255,140,110,0.35)';
  ctx.fillRect(x - w * 0.75, base - h - 14 / d, w * 1.5, 1.5);
  // 화로 불빛이 닿는 안쪽 면
  const warm = ctx.createLinearGradient(x - (side * w) / 2, 0, x, 0);
  warm.addColorStop(0, 'rgba(255,120,40,0.35)');
  warm.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = warm;
  ctx.fillRect(x - w / 2, base - h * 0.7, w, h * 0.7);
  // 멀수록 안개
  ctx.fillStyle = `rgba(40,12,16,${fog})`;
  ctx.fillRect(x - w * 0.8, base - h - 16 / d, w * 1.6, h + 16 / d);
}

// ======================================================================
// 젖은 돌바닥: 원근 타일 + 달빛 반사 길
// ======================================================================

// 위에서 내려다본 바닥 타일 그림 (반복해서 깔림)
const TILE = 46; // 월드 단위
const TEX_SCALE = 512 / (TILE * 8); // 그림 1px = 월드 몇 단위인지의 역수

function paintFloorTexture() {
  return paintPixels(512, 512, (px, py) => {
    const wx = px / TEX_SCALE;
    const wz = py / TEX_SCALE;
    const fx = wx / TILE;
    const fz = wz / TILE;
    const gx = Math.abs(fx - Math.round(fx));
    const gz = Math.abs(fz - Math.round(fz));
    const seam = Math.max(smoothstep(0.04, 0, gx), smoothstep(0.04, 0, gz));
    const tile = noise2(Math.floor(fx) & 7, Math.floor(fz) & 7, 51);
    const grain = fbm(px / 18, py / 18, 4, 52);
    const wet = smoothstep(0.45, 0.7, fbm(px / 90, py / 90, 3, 54));
    const crack = smoothstep(0.012, 0, Math.abs(fbm(px / 40, py / 40, 4, 55) - 0.5)) * 0.8;
    const tone = tile * 0.5 + grain * 0.5;
    const shade = (1 - seam * 0.65) * (1 - crack * 0.6) * (1 - wet * 0.35);
    return [(24 + tone * 30) * shade, (15 + tone * 18) * shade, (19 + tone * 20) * shade];
  });
}

// 달빛 반사 길: 멀리는 가늘고 가까이는 넓게, 물결에 끊기는 띠
function paintMoonPath() {
  const w = 180;
  const h = 200;
  return paintPixels(w, h, (x, y) => {
    const near = y / h;
    const half = (18 + near * 70) / 90;
    const d = Math.abs(x - w / 2) / (w / 2) / half;
    const band = Math.max(0, 1 - d * d);
    const ripple = 0.6 + 0.4 * noise2(x * 0.15, y * 0.9, 57);
    const a = band * ripple * 0.32 * (1 - near * 0.35);
    return [255, 110, 90, a * 255];
  });
}

const floorPatterns = new WeakMap();

// 모드 7: 화면 아래 줄부터 한 줄씩, 그 줄이 비추는 깊이의 바닥 타일을 늘려서 그림
function drawFloor3D(ctx, scene, cam) {
  let pat = floorPatterns.get(ctx);
  if (!pat) {
    pat = ctx.createPattern(scene.floorTex, 'repeat');
    floorPatterns.set(ctx, pat);
  }
  const top = HORIZON + (F * cam.y) / (FLOOR_MAX_Z - cam.z);
  ctx.save();
  ctx.fillStyle = pat;
  for (let y = Math.floor(top); y < HEIGHT; ) {
    const step = y < top + 30 ? 1 : y < 440 ? 2 : 3;
    const D = (F * cam.y) / (y + step / 2 - HORIZON);
    const s = F / D;
    const Z = cam.z + D;
    const k = s / TEX_SCALE;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, VP.x - cam.x * s, y - Z * s]));
    ctx.fillRect(0, y, WIDTH, step);
    y += step;
  }
  ctx.restore();

  // 젖은 바닥에 비친 달빛 길 (반사는 보는 위치에 따라 달라서 화면 기준으로)
  const mx = MOON.x - cam.x * 0.03;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(scene.moonPath, mx - 90, top, 180, HEIGHT - top);
  ctx.restore();

  // 멀리는 안개, 가까이는 어둡게
  const fog = ctx.createLinearGradient(0, top, 0, top + 70);
  fog.addColorStop(0, 'rgba(70,16,20,0.95)');
  fog.addColorStop(1, 'rgba(70,16,20,0)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, top, WIDTH, 70);
  const near = ctx.createLinearGradient(0, 430, 0, HEIGHT);
  near.addColorStop(0, 'rgba(0,0,0,0)');
  near.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = near;
  ctx.fillRect(0, 430, WIDTH, HEIGHT - 430);
}

// ======================================================================
// 가장 앞: 화면 가장자리의 거대한 기둥과 사슬 (빠르게 움직여 깊이감)
// ======================================================================

function drawForeground(ctx) {
  const g = ctx.createLinearGradient(-M, 0, 30, 0);
  g.addColorStop(0, '#020102');
  g.addColorStop(0.8, '#0c0608');
  g.addColorStop(1, '#3a1416');
  ctx.fillStyle = g;
  ctx.fillRect(-M, 0, M + 30, HEIGHT);
  ctx.fillStyle = 'rgba(255,90,60,0.5)';
  ctx.fillRect(29, 0, 1.5, HEIGHT);

  // 오른쪽 위 늘어진 사슬
  ctx.strokeStyle = '#060304';
  ctx.lineWidth = 3;
  for (const [x0, len] of [
    [WIDTH - 20, 210],
    [WIDTH + 14, 150],
  ]) {
    for (let y = -10; y < len; y += 13) {
      ctx.beginPath();
      ctx.ellipse(x0 + Math.sin(y / 40) * 4, y, Math.round(y / 13) % 2 ? 2.5 : 5, 7, 0, 0, TAU);
      ctx.stroke();
    }
  }
  // 찢어진 깃발
  ctx.fillStyle = '#16060a';
  ctx.beginPath();
  ctx.moveTo(WIDTH - 70, -5);
  ctx.lineTo(WIDTH + M, -5);
  ctx.lineTo(WIDTH + M, 120);
  ctx.lineTo(WIDTH + 20, 90);
  ctx.lineTo(WIDTH, 130);
  ctx.lineTo(WIDTH - 22, 70);
  ctx.lineTo(WIDTH - 46, 100);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,90,60,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 맨 앞: 아군 병사들의 투구와 창 (관객이 군대 한가운데 있는 느낌)
  for (let i = 0; i < 26; i++) {
    const x = -M + (i / 25) * LW + (noise2(i, 1, 91) - 0.5) * 20;
    const greek = x < WIDTH / 2;
    const y = HEIGHT - 10 + noise2(i, 2, 92) * 18;
    const r = 15 + noise2(i, 3, 93) * 8;
    ctx.fillStyle = '#040203';
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI, TAU);
    ctx.lineTo(x + r, HEIGHT + 10);
    ctx.lineTo(x - r, HEIGHT + 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = greek ? '#2a0406' : '#040822';
    ctx.fillRect(x - r * 1.1, y - r - 5, r * 2.2, 5);
    if (noise2(i, 4, 94) > 0.45) {
      ctx.strokeStyle = '#040203';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x + 6 + (greek ? 18 : -18), y - 120 - noise2(i, 5, 95) * 60);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,100,60,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  }

  // 아래 모서리 돌무더기
  ctx.fillStyle = '#050203';
  for (const [x, y, r] of [
    [-20, HEIGHT, 70],
    [40, HEIGHT + 10, 40],
    [WIDTH + 10, HEIGHT, 60],
    [WIDTH - 50, HEIGHT + 14, 34],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.5, 0, Math.PI, TAU);
    ctx.fill();
  }
}

// ======================================================================
// 매 프레임: 카메라 이동, 불꽃, 연기, 안개, 재, 번개
// ======================================================================

function lightningLevel(now, final) {
  const period = final ? 3.1 : 9.7;
  const t = now % period;
  if (t > 0.5) return 0;
  // 번쩍-번쩍 두 번
  return t < 0.08 ? 1 : t < 0.16 ? 0.2 : t < 0.26 ? 0.8 : Math.max(0, 0.5 - t);
}

function drawFire(ctx, x, y, s, now, seed) {
  // 기둥과 공기를 비추는 불빛
  const r = 120 * s * (0.9 + 0.1 * Math.sin(now * 17 + seed));
  const light = ctx.createRadialGradient(x, y, 0, x, y, r);
  light.addColorStop(0, 'rgba(255,140,50,0.45)');
  light.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = light;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  // 불꽃 혀
  for (let i = 0; i < 6; i++) {
    const ph = (now * 2.4 + i * 0.17 + seed) % 1;
    const fx = x + Math.sin(now * 9 + i * 2 + seed) * 6 * s;
    const fy = y - ph * 46 * s;
    const size = (1 - ph) * 12 * s;
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, size * 2);
    g.addColorStop(0, `rgba(255,250,210,${0.9 * (1 - ph)})`);
    g.addColorStop(0.35, `rgba(255,150,40,${0.7 * (1 - ph)})`);
    g.addColorStop(1, 'rgba(200,30,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(fx, fy, size, size * 1.8, 0, 0, TAU);
    ctx.fill();
  }
}

function drawSkyBolt(ctx, seed, a) {
  let x = 120 + ((Math.sin(seed * 12.9) + 1) / 2) * 720;
  let y = 0;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(230,220,255,${a})`;
  ctx.shadowColor = '#b8a8ff';
  ctx.shadowBlur = 24;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 1; i <= 10; i++) {
    x += Math.sin(seed * 7 + i * 4.3) * 24;
    y += 30;
    ctx.lineTo(x, y);
    if (i === 4 || i === 7) {
      ctx.lineTo(x + Math.sin(seed + i) * 60, y + 50);
      ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

export const defaultCam = (now) => ({ x: Math.sin(now * 0.17) * 40, y: CAM0.y + Math.sin(now * 0.13) * 10, z: CAM0.z });

/**
 * opts: { final, dark, pulse, cam: { x, y, z } (3D 카메라), flash(0~1, 번개 강제), cheer: { p1, p2 } 함성 }
 */
export function drawBackdrop(ctx, scene, now, { final = false, dark = 0, pulse = 0, cam, flash = 0, cheer = {} } = {}) {
  const c = cam ?? defaultCam(now);
  const bolt = Math.max(lightningLevel(now, final), flash);

  // 하늘은 무한히 멀어서 거의 안 움직임
  ctx.drawImage(scene.sky.img, -M - c.x * 0.03, 0, LW, HEIGHT);
  if (bolt > 0) {
    ctx.fillStyle = `rgba(200,190,255,${bolt * 0.35})`;
    ctx.fillRect(0, 0, WIDTH, HORIZON);
    if (bolt > 0.5) drawSkyBolt(ctx, Math.floor(now / 3.1), bolt);
  }

  // 불타는 도시 + 연기
  onPlane(ctx, zOfGroundY(HORIZON + 6), c, () => {
    blit(ctx, scene.city);
    for (let i = 0; i < 7; i++) {
      const bx = 60 + i * 140;
      for (let k = 0; k < 5; k++) {
        const ph = (now * 0.05 + k / 5 + i * 0.13) % 1;
        const y = HORIZON - ph * 220;
        const x = bx + Math.sin(ph * 3 + i) * 30 + ph * 60;
        const r = 20 + ph * 90;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(30,12,14,${0.35 * (1 - ph)})`);
        g.addColorStop(1, 'rgba(30,12,14,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  });

  onPlane(ctx, 3000, c, () => drawWarSky(ctx, now, { x: 0, y: 0 }, final));
  onPlane(ctx, zOfGroundY(HORIZON + 12), c, () => blit(ctx, scene.colossus));

  drawFloor3D(ctx, scene, c);

  // 기둥, 화로, 군대를 먼 것부터
  for (const p of scene.props) {
    onPlane(ctx, p.Z, c, () => {
      if (p.kind === 'army') {
        const up = cheer[p.id];
        const jump = up ? Math.abs(Math.sin(now * 9 + p.Z)) * 3 : pulse * 1.5;
        ctx.translate(0, -jump);
        blit(ctx, up ? p.cheer : p.calm);
        return;
      }
      blit(ctx, p.sprite);
      if (p.kind === 'brazier') {
        ctx.globalCompositeOperation = 'lighter';
        drawFire(ctx, p.x, p.y, p.s, now, p.Z * 0.01);
        // 젖은 바닥에 비친 불빛
        const flick = 0.8 + 0.2 * Math.sin(now * 13 + p.Z);
        const g = ctx.createRadialGradient(p.x, p.y + 72 * p.s, 0, p.x, p.y + 72 * p.s, 140 * p.s);
        g.addColorStop(0, `rgba(255,110,40,${0.3 * flick})`);
        g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - 140 * p.s, p.y + 72 * p.s - 30 * p.s, 280 * p.s, 170 * p.s);
        ctx.fillStyle = `rgba(255,140,60,${0.14 * flick})`;
        ctx.fillRect(p.x - 3 * p.s, p.y + 74 * p.s, 6 * p.s, 120 * p.s);
      }
    });
  }

  // 바닥 안개 (두 겹이 다른 속도로)
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [speed, y, a] of [
    [14, 380, 0.07],
    [26, 440, 0.06],
  ]) {
    const x = -((((now * speed + c.x * 0.6) % 512) + 512) % 512);
    ctx.globalAlpha = a;
    for (let k = 0; k < 4; k++) ctx.drawImage(scene.fog, x + k * 512, y + (c.y - CAM0.y) * 0.3, 512, 120);
  }
  ctx.restore();

  // 떨어지는 재와 피어오르는 불티
  for (let i = 0; i < 60; i++) {
    const speed = 14 + (i % 7) * 6;
    const x = (i * 157 + Math.sin(now * 0.6 + i) * 40 - c.x * 0.5 + WIDTH * 4) % WIDTH;
    const ember = i % 4 === 0;
    const y = ember ? HEIGHT - ((now * speed * 1.4 + i * 83) % (HEIGHT + 20)) : (now * speed + i * 97) % (HEIGHT + 20);
    const a = 0.3 + 0.5 * Math.abs(Math.sin(now * 2 + i));
    ctx.fillStyle = ember ? `rgba(255,${120 + (i % 5) * 20},40,${a})` : `rgba(190,170,170,${a * 0.5})`;
    ctx.fillRect(x, y, ember ? 2.2 : 1.6, ember ? 2.2 : 1.6);
  }

  if (bolt > 0) {
    ctx.fillStyle = `rgba(180,180,255,${bolt * 0.12})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (pulse > 0) {
    ctx.fillStyle = `rgba(255,90,60,${pulse * 0.06})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (final) {
    ctx.fillStyle = `rgba(150,0,10,${0.16 + 0.06 * Math.sin(now * 6)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (dark > 0) {
    ctx.fillStyle = `rgba(5,5,20,${dark})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

// 영웅 앞을 지나가는 맨 앞 층 (아군 병사들). 영웅보다 나중에 그려야 해서 따로
export function drawForegroundLayer(ctx, scene, cam) {
  onPlane(ctx, -120, cam, () => blit(ctx, scene.fore));
}

// ======================================================================
// 하늘의 전쟁: 투석기 불덩이, 불화살 일제사격, 지평선의 충돌 불꽃
// ======================================================================

function arc(x0, y0, x1, y1, peak, t) {
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * peak];
}

function drawWarSky(ctx, now, cam, final) {
  const off = cam.x * (1 - 0.2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 투석기 불덩이
  const count = final ? 4 : 3;
  for (let k = 0; k < count; k++) {
    const period = 5.5;
    const local = (now + k * 1.9) % period;
    const n = Math.floor((now + k * 1.9) / period);
    const fromLeft = (n + k) % 2 === 0;
    const x0 = fromLeft ? -80 : WIDTH + 80;
    const x1 = 160 + noise2(n, k, 101) * 640;
    const y1 = HORIZON + 4;
    const flight = 3.2;
    if (local < flight) {
      const t = local / flight;
      // 연기 꼬리
      for (let j = 8; j >= 1; j--) {
        const tt = Math.max(0, t - j * 0.025);
        const [sx, sy] = arc(x0, 140, x1, y1, 120, tt);
        ctx.fillStyle = `rgba(255,${90 + j * 8},30,${0.08 * (9 - j) * 0.3})`;
        ctx.beginPath();
        ctx.arc(sx + off, sy, 3 + j * 1.2, 0, TAU);
        ctx.fill();
      }
      const [x, y] = arc(x0, 140, x1, y1, 120, t);
      const g = ctx.createRadialGradient(x + off, y, 0, x + off, y, 18);
      g.addColorStop(0, 'rgba(255,250,200,1)');
      g.addColorStop(0.3, 'rgba(255,150,40,0.8)');
      g.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + off - 18, y - 18, 36, 36);
    } else if (local < flight + 0.6) {
      // 도시에 떨어져 폭발
      const u = (local - flight) / 0.6;
      const r = 20 + u * 90;
      const g = ctx.createRadialGradient(x1 + off, y1, 0, x1 + off, y1, r);
      g.addColorStop(0, `rgba(255,240,180,${1 - u})`);
      g.addColorStop(0.4, `rgba(255,120,30,${0.7 * (1 - u)})`);
      g.addColorStop(1, 'rgba(255,40,10,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x1 + off - r, y1 - r, r * 2, r * 2);
    }
  }

  // 불화살 일제사격 (양쪽이 번갈아)
  const vPeriod = final ? 3.2 : 6.3;
  const vt = now % vPeriod;
  const vn = Math.floor(now / vPeriod);
  if (vt < 1.8) {
    const ltr = vn % 2 === 0;
    for (let i = 0; i < 34; i++) {
      const delay = noise2(i, vn, 111) * 0.4;
      const t = (vt - delay) / 1.3;
      if (t < 0 || t > 1) continue;
      const x0 = (ltr ? 200 : 760) + (noise2(i, 1, 112) - 0.5) * 160;
      const x1 = (ltr ? 700 : 260) + (noise2(i, 2, 113) - 0.5) * 220;
      const [x, y] = arc(x0, 360, x1, 360, 230, t);
      const [px, py] = arc(x0, 360, x1, 360, 230, Math.max(0, t - 0.035));
      ctx.strokeStyle = 'rgba(255,170,80,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px + off, py);
      ctx.lineTo(x + off, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,230,160,0.9)';
      ctx.fillRect(x + off - 1, y - 1, 2, 2);
    }
  }

  // 지평선 충돌 지점의 불꽃
  for (let i = 0; i < 14; i++) {
    const ph = (now * 1.7 + i * 0.137) % 1;
    const x = VP.x + (noise2(i, Math.floor(now * 1.7 + i * 0.137), 121) - 0.5) * 60 + cam.x * 0.85;
    const y = HORIZON + 10 - ph * 18;
    ctx.fillStyle = `rgba(255,${180 + (i % 3) * 25},90,${1 - ph})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.restore();
}
