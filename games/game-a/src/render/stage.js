// =============================================================
//  무대: 마법사 성 대연회장 (케이지 없음)
//    먼 벽(스테인드글라스, 깃발, 기둥) → 빛줄기 → 떠다니는 촛불 → 학생 관중석
//    → 반질반질한 돌바닥 + 마법진 → (선수) → 앞쪽 흐릿한 기둥
//  카메라 시차(parallax): 먼 것일수록 카메라를 덜 따라 움직임
// =============================================================

import { PLAYERS, STAGE } from '../config.js';
import { shade } from './rig.js';

const W = STAGE.width;
const H = STAGE.height;
const HORIZON = 470;       // 벽과 바닥이 만나는 높이 (월드 y)
export const FLOOR_SCREEN = 612; // 바닥(발)이 화면에서 놓이는 높이
const CENTER = STAGE.worldWidth / 2;

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------------- 카메라 변환 ----------------

/** 시차 p (0=고정, 1=월드와 같이) 레이어의 변환 */
export function layerTransform(cam, p) {
  const zoom = 1 + (cam.zoom - 1) * p;
  const cx = CENTER + (cam.x - CENTER) * p;
  return { zoom, cx, toScreen: (x, y) => [(x - cx) * zoom + W / 2, (y - STAGE.floorY) * zoom + FLOOR_SCREEN] };
}

export function applyLayer(ctx, cam, p, shake = [0, 0]) {
  const t = layerTransform(cam, p);
  ctx.setTransform(t.zoom, 0, 0, t.zoom, W / 2 - t.cx * t.zoom + shake[0], FLOOR_SCREEN - STAGE.floorY * t.zoom + shake[1]);
  return t;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---------------- 먼 벽 (미리 그려 둠) ----------------
// 레이어 좌표 = 월드 좌표, x 범위 [-300, 1900]

const WALL_X0 = -300;
const WALL_W = 2200;

function gothicWindow(ctx, cx, top, w, h, hues) {
  const r = w / 2;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(cx - r, top + h);
    ctx.lineTo(cx - r, top + r * 0.8);
    ctx.quadraticCurveTo(cx - r, top - r * 0.2, cx, top - r * 0.75);
    ctx.quadraticCurveTo(cx + r, top - r * 0.2, cx + r, top + r * 0.8);
    ctx.lineTo(cx + r, top + h);
    ctx.closePath();
  };
  // 창 주변 빛
  ctx.save();
  const halo = ctx.createRadialGradient(cx, top + h * 0.4, 10, cx, top + h * 0.4, w * 1.6);
  halo.addColorStop(0, `hsla(${hues[0]}, 80%, 65%, 0.35)`);
  halo.addColorStop(1, 'hsla(260, 80%, 50%, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - w * 1.6, top - w, w * 3.2, h + w * 2);
  ctx.restore();
  // 색유리
  ctx.save();
  path();
  ctx.clip();
  const sx = cx - r;
  seed = Math.round(cx * 7);
  for (let y = top - r; y < top + h; y += 16) {
    for (let x = sx; x < cx + r; x += 14) {
      const hue = hues[Math.floor(rand() * hues.length)];
      const light = 45 + rand() * 25 + (1 - (y - top + r) / (h + r)) * 10;
      ctx.fillStyle = `hsla(${hue}, 80%, ${light}%, 0.95)`;
      ctx.fillRect(x + 1, y + 1, 12.5, 14.5);
    }
  }
  // 납 선 (창살)
  ctx.strokeStyle = 'rgba(20, 12, 30, 0.85)';
  ctx.lineWidth = 3;
  for (let x = sx + w / 4; x < cx + r; x += w / 4) {
    ctx.beginPath();
    ctx.moveTo(x, top - r);
    ctx.lineTo(x, top + h);
    ctx.stroke();
  }
  for (let y = top + h * 0.3; y < top + h; y += h * 0.3) {
    ctx.beginPath();
    ctx.moveTo(sx, y);
    ctx.lineTo(cx + r, y);
    ctx.stroke();
  }
  // 장미창 무늬
  ctx.strokeStyle = 'rgba(255, 235, 180, 0.8)';
  ctx.lineWidth = 2;
  const rc = [cx, top + r * 0.35];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(rc[0] + Math.cos(a) * r * 0.32, rc[1] + Math.sin(a) * r * 0.32, r * 0.22, r * 0.1, a, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(rc[0], rc[1], r * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 240, 190, 0.95)';
  ctx.fill();
  ctx.restore();
  // 돌 테두리
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#3B3358';
  path();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#6A5C99';
  path();
  ctx.stroke();
}

function banner(ctx, x, top, P) {
  const w = 96;
  const h = 250;
  const deep = P.kind === 'professor' ? '#0E0D12' : shade(P.color, -0.45);
  const main = P.kind === 'professor' ? '#1D1B24' : P.color;
  ctx.fillStyle = '#B8964A';
  ctx.fillRect(x - w / 2 - 10, top - 8, w + 20, 8);
  ctx.beginPath();
  ctx.moveTo(x - w / 2, top);
  ctx.lineTo(x + w / 2, top);
  ctx.lineTo(x + w / 2, top + h);
  ctx.lineTo(x, top + h - 34);
  ctx.lineTo(x - w / 2, top + h);
  ctx.closePath();
  const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, deep);
  g.addColorStop(0.5, main);
  g.addColorStop(1, deep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#C9A85A';
  ctx.lineWidth = 3;
  ctx.stroke();
  // 문장
  ctx.fillStyle = '#E8CF8A';
  const cy = top + 92;
  if (P.kind === 'professor') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? 30 : 12;
      ctx.lineTo(x + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.fill();
  } else {
    // 호랑이 발톱 자국
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(-0.35);
    for (const dx of [-14, 0, 14]) {
      ctx.beginPath();
      ctx.moveTo(dx - 4, -30);
      ctx.quadraticCurveTo(dx + 5, 0, dx - 2, 30);
      ctx.quadraticCurveTo(dx + 1, 0, dx - 4, -30);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.font = '400 22px "Do Hyeon", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(P.name, x, top + 168);
}

function buildWall() {
  const c = makeCanvas(WALL_W, H);
  const ctx = c.getContext('2d');
  ctx.translate(-WALL_X0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, HORIZON + 60);
  g.addColorStop(0, '#0B0918');
  g.addColorStop(0.5, '#1A1533');
  g.addColorStop(1, '#251D44');
  ctx.fillStyle = g;
  ctx.fillRect(WALL_X0, 0, WALL_W, H);
  // 돌 벽돌
  seed = 5;
  for (let y = 40; y < HORIZON + 60; y += 30) {
    for (let x = WALL_X0 + ((y / 30) % 2) * 36; x < WALL_X0 + WALL_W; x += 72) {
      ctx.fillStyle = `rgba(160, 140, 230, ${0.03 + rand() * 0.05})`;
      ctx.fillRect(x + 2, y + 2, 68, 26);
    }
  }
  // 창문
  gothicWindow(ctx, CENTER, 120, 190, 290, [265, 210, 320, 45]);
  gothicWindow(ctx, CENTER - 420, 150, 120, 250, [220, 190, 280]);
  gothicWindow(ctx, CENTER + 420, 150, 120, 250, [280, 320, 230]);
  gothicWindow(ctx, CENTER - 800, 170, 110, 230, [200, 260]);
  gothicWindow(ctx, CENTER + 800, 170, 110, 230, [300, 250]);
  // 기둥
  for (const x of [CENTER - 620, CENTER - 210, CENTER + 210, CENTER + 620, CENTER - 1010, CENTER + 1010]) {
    const pg = ctx.createLinearGradient(x - 34, 0, x + 34, 0);
    pg.addColorStop(0, '#120E22');
    pg.addColorStop(0.45, '#2F2652');
    pg.addColorStop(1, '#0E0B1A');
    ctx.fillStyle = pg;
    ctx.fillRect(x - 34, 0, 68, HORIZON + 60);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let k = 0; k < 4; k++) ctx.fillRect(x - 24 + k * 15, 0, 3, HORIZON + 60);
  }
  // 깃발
  banner(ctx, CENTER - 210, 70, PLAYERS[0]);
  banner(ctx, CENTER + 210, 70, PLAYERS[1]);
  // 천장 아치 그림자
  const top = ctx.createLinearGradient(0, 0, 0, 160);
  top.addColorStop(0, 'rgba(5, 3, 12, 0.9)');
  top.addColorStop(1, 'rgba(5, 3, 12, 0)');
  ctx.fillStyle = top;
  ctx.fillRect(WALL_X0, 0, WALL_W, 160);
  return c;
}

// ---------------- 관중석 (학생들) ----------------

const ANIMALS = ['cat', 'bunny', 'bear', 'owl', 'frog', 'fox', 'cat', 'bunny'];
const FUR = { cat: '#F2C48D', bunny: '#F4EEF7', bear: '#B07A55', owl: '#9C7B62', frog: '#86D07A', fox: '#F08A4B' };
const STANDS_X0 = -500;
const STANDS_W = 2600;

function buildStands() {
  const c = makeCanvas(STANDS_W, H);
  const ctx = c.getContext('2d');
  ctx.translate(-STANDS_X0, 0);
  // 계단식 나무 관중석
  for (let i = 0; i < 3; i++) {
    const y = 372 + i * 40;
    const g = ctx.createLinearGradient(0, y, 0, y + 40);
    g.addColorStop(0, '#3A2618');
    g.addColorStop(1, '#22150D');
    ctx.fillStyle = g;
    ctx.fillRect(STANDS_X0, y, STANDS_W, 40);
    ctx.fillStyle = '#5A3A24';
    ctx.fillRect(STANDS_X0, y, STANDS_W, 4);
  }
  // 난간
  ctx.fillStyle = '#2A1A10';
  ctx.fillRect(STANDS_X0, HORIZON + 2, STANDS_W, 44);
  ctx.fillStyle = '#6E4A2E';
  ctx.fillRect(STANDS_X0, HORIZON + 2, STANDS_W, 6);
  for (let x = STANDS_X0; x < STANDS_X0 + STANDS_W; x += 40) {
    ctx.fillStyle = '#1C110A';
    ctx.fillRect(x + 6, HORIZON + 10, 8, 34);
  }
  return c;
}

function makeCrowd() {
  seed = 21;
  const list = [];
  for (const [y, size, step] of [[372, 15, 40], [412, 17, 44], [452, 19, 48]]) {
    for (let x = STANDS_X0 + 20; x < STANDS_X0 + STANDS_W; x += step) {
      list.push({
        x: x + (rand() - 0.5) * 14,
        y,
        size: size + rand() * 3,
        animal: ANIMALS[Math.floor(rand() * ANIMALS.length)],
        team: x < CENTER ? (rand() < 0.8 ? 0 : 1) : rand() < 0.8 ? 1 : 0,
        hat: rand() < 0.55,
        phase: rand() * Math.PI * 2,
      });
    }
  }
  return list;
}

/** 학생 한 명을 작은 캔버스에 미리 그려 둠 (팔 내림 / 팔 듦 두 장) → 매 프레임은 붙이기만 */
function studentSprite(s, cheering) {
  const key = cheering ? 'up' : 'down';
  s.sprites ??= {};
  if (!s.sprites[key]) {
    const r = s.size;
    const w = Math.ceil(r * 3.2);
    const h = Math.ceil(r * 4.6);
    const c = makeCanvas(w, h);
    const sctx = c.getContext('2d');
    paintStudent(sctx, { ...s, x: w / 2, y: r * 2.3 }, cheering);
    s.sprites[key] = { canvas: c, ox: w / 2, oy: r * 2.3 };
  }
  return s.sprites[key];
}

function drawStudent(ctx, s, time, hype) {
  const bounce = Math.max(0, Math.sin(time * (5 + hype * 6) + s.phase)) * (2 + hype * 9);
  const cheering = hype > 0.55 && Math.sin(time * 4 + s.phase) > -0.2;
  const sp = studentSprite(s, cheering);
  ctx.drawImage(sp.canvas, s.x - sp.ox, s.y - bounce - sp.oy);
}

function paintStudent(ctx, s, cheering) {
  const hype = cheering ? 1 : 0.3;
  const time = 0;
  const x = s.x;
  const y = s.y;
  const r = s.size;
  const P = PLAYERS[s.team];
  const scarf = P.kind === 'professor' ? '#2A2733' : P.color;
  const fur = FUR[s.animal];
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#140F26';
  ctx.fillStyle = '#2B2346';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 1.25, r * 0.95, r * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = scarf;
  ctx.fillRect(x - r * 0.7, y + r * 0.7, r * 1.4, r * 0.32);
  if (cheering) {
    ctx.strokeStyle = fur;
    ctx.lineWidth = r * 0.32;
    ctx.lineCap = 'round';
    const wave = Math.sin(time * 9 + s.phase) * 4;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.7, y + r);
    ctx.lineTo(x - r * 1.05 + wave, y - r * 0.4);
    ctx.moveTo(x + r * 0.7, y + r);
    ctx.lineTo(x + r * 1.05 - wave, y - r * 0.4);
    ctx.stroke();
  }
  ctx.fillStyle = fur;
  ctx.strokeStyle = '#140F26';
  ctx.lineWidth = 2;
  if (s.animal === 'bunny') {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + side * r * 0.4, y - r * 1.1, r * 0.25, r * 0.65, side * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (s.animal === 'cat' || s.animal === 'fox') {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * r * 0.85, y - r * 0.3);
      ctx.lineTo(x + side * r * 0.65, y - r * 1.15);
      ctx.lineTo(x + side * r * 0.15, y - r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (s.animal === 'bear') {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + side * r * 0.7, y - r * 0.7, r * 0.33, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#140F26';
  if (s.animal === 'owl') {
    for (const side of [-1, 1]) {
      ctx.fillStyle = '#FFF4D6';
      ctx.beginPath();
      ctx.arc(x + side * r * 0.38, y - r * 0.05, r * 0.33, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#140F26';
      ctx.beginPath();
      ctx.arc(x + side * r * 0.38, y - r * 0.05, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#F2B33D';
    ctx.beginPath();
    ctx.moveTo(x - 3, y + r * 0.25);
    ctx.lineTo(x + 3, y + r * 0.25);
    ctx.lineTo(x, y + r * 0.5);
    ctx.fill();
  } else {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + side * r * 0.36, y - r * 0.08, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    if (hype > 0.6) ctx.ellipse(x, y + r * 0.38, r * 0.18, r * 0.2, 0, 0, Math.PI * 2);
    else ctx.ellipse(x, y + r * 0.32, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 120, 150, 0.45)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + side * r * 0.62, y + r * 0.22, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (s.hat) {
    ctx.fillStyle = '#2F2752';
    ctx.strokeStyle = '#140F26';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.95, y - r * 0.6);
    ctx.lineTo(x + r * 0.15, y - r * 2.1);
    ctx.lineTo(x + r * 0.95, y - r * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = scarf;
    ctx.fillRect(x - r * 0.75, y - r * 0.85, r * 1.5, r * 0.22);
  }
}

// ---------------- 촛불, 빛 ----------------

function makeCandles() {
  seed = 3;
  const list = [];
  for (let i = 0; i < 22; i++) {
    list.push({ x: -100 + i * 85 + (rand() - 0.5) * 50, y: 150 + rand() * 150, h: 24 + rand() * 14, phase: rand() * 10 });
  }
  return list;
}

function drawCandle(ctx, glow, c, time) {
  const y = c.y + Math.sin(time * 1.2 + c.phase) * 7;
  const flick = Math.sin(time * 17 + c.phase * 3) * 0.12 + Math.sin(time * 7 + c.phase) * 0.08;
  ctx.fillStyle = '#F4E6CC';
  ctx.beginPath();
  ctx.roundRect(c.x - 5, y, 10, c.h, 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(180, 150, 110, 0.6)';
  ctx.fillRect(c.x + 1.5, y + 2, 3, c.h - 4);
  ctx.save();
  ctx.translate(c.x, y - 2);
  ctx.scale(1 + flick, 1 - flick);
  ctx.fillStyle = '#FFB347';
  ctx.beginPath();
  ctx.moveTo(0, -15);
  ctx.quadraticCurveTo(7, -5, 0, 0);
  ctx.quadraticCurveTo(-7, -5, 0, -15);
  ctx.fill();
  ctx.fillStyle = '#FFF6C8';
  ctx.beginPath();
  ctx.ellipse(0, -4, 2, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (glow) {
    glow.fillStyle = 'rgba(255, 190, 100, 0.55)';
    glow.beginPath();
    glow.arc(c.x, y - 6, 14, 0, Math.PI * 2);
    glow.fill();
  }
}

/** 스테인드글라스에서 바닥으로 떨어지는 빛줄기 */
function godRays(ctx, cam, time) {
  const wall = layerTransform(cam, 0.3);
  const floor = layerTransform(cam, 1);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  const rays = [
    [CENTER, 260, 95, 230, 0.16],
    [CENTER - 420, 280, 60, 200, 0.11],
    [CENTER + 420, 280, 60, 280, 0.11],
  ];
  for (const [wx, wy, ww, hue, alpha] of rays) {
    const [sx, sy] = wall.toScreen(wx, wy);
    const sw = ww * wall.zoom;
    const [fx, fy] = floor.toScreen(wx + (wx - CENTER) * 0.15 + 60, STAGE.floorY + 30);
    const fw = ww * 2.6 * floor.zoom;
    const flicker = 0.85 + Math.sin(time * 0.7 + wx) * 0.15;
    const g = ctx.createLinearGradient(sx, sy, fx, fy);
    g.addColorStop(0, `hsla(${hue}, 90%, 75%, ${alpha * flicker})`);
    g.addColorStop(1, `hsla(${hue}, 90%, 70%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - sw * 0.5, sy);
    ctx.lineTo(sx + sw * 0.5, sy);
    ctx.lineTo(fx + fw * 0.5, fy);
    ctx.lineTo(fx - fw * 0.5, fy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** 빛 속 먼지 */
function motes(ctx, time) {
  seed = 99;
  for (let i = 0; i < 70; i++) {
    const bx = CENTER - 700 + rand() * 1400;
    const speed = 6 + rand() * 14;
    const y = ((rand() * 420 - time * speed) % 420 + 420) % 420 + 80;
    const x = bx + Math.sin(time * 0.6 + i) * 20;
    const tw = (Math.sin(time * 2.4 + i * 1.7) + 1) / 2;
    ctx.fillStyle = `rgba(255, 236, 190, ${0.1 + tw * 0.45})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8 + tw * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------- 바닥 ----------------

function drawFloor(ctx, cam, time, hype) {
  const t = applyLayer(ctx, cam, 1);
  const left = t.cx - W / t.zoom;
  const right = t.cx + W / t.zoom;
  const bottom = STAGE.floorY + (H - FLOOR_SCREEN) / t.zoom + 20;
  // 돌 바닥 (멀수록 어둡게)
  const g = ctx.createLinearGradient(0, HORIZON + 40, 0, bottom);
  g.addColorStop(0, '#16112A');
  g.addColorStop(0.4, '#221B3E');
  g.addColorStop(1, '#2E2550');
  ctx.fillStyle = g;
  ctx.fillRect(left, HORIZON + 40, right - left, bottom - HORIZON - 40);
  // 원근 타일 선
  ctx.strokeStyle = 'rgba(170, 150, 255, 0.07)';
  ctx.lineWidth = 1.5;
  const top = HORIZON + 40;
  for (let k = -24; k <= 24; k++) {
    const xTop = CENTER + k * 70;
    const xBot = CENTER + k * 150;
    ctx.beginPath();
    ctx.moveTo(xTop, top);
    ctx.lineTo(xBot, bottom);
    ctx.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const y = top + (bottom - top) * (i / 7) ** 1.6;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  // 마법진 (바닥에 새겨진 빛나는 원, 원근으로 납작)
  ctx.save();
  ctx.translate(CENTER, STAGE.floorY + 6);
  ctx.scale(1, 0.2);
  const pulse = 0.55 + Math.sin(time * 1.5) * 0.15 + hype * 0.25;
  ctx.strokeStyle = `rgba(190, 150, 255, ${0.35 * pulse})`;
  ctx.lineWidth = 6;
  for (const r of [560, 500, 230]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.rotate(time * 0.05);
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i * 2 / 6) * Math.PI * 2;
    if (i) ctx.lineTo(Math.cos(a) * 500, Math.sin(a) * 500);
    else ctx.moveTo(Math.cos(a) * 500, Math.sin(a) * 500);
  }
  ctx.stroke();
  ctx.fillStyle = `rgba(255, 220, 140, ${0.4 * pulse})`;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 530, Math.sin(a) * 530, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // 무대 중앙 조명 웅덩이
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(CENTER, STAGE.floorY);
  ctx.scale(1, 0.25);
  const pool = ctx.createRadialGradient(0, 0, 20, 0, 0, 700);
  pool.addColorStop(0, 'rgba(255, 220, 190, 0.22)');
  pool.addColorStop(1, 'rgba(255, 220, 190, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(-700, -700, 1400, 1400);
  ctx.restore();
}

/** 앞쪽 흐릿한 기둥 (깊이감) */
function drawForeground(ctx, cam) {
  const t = applyLayer(ctx, cam, 1.45);
  for (const x of [CENTER - 1180, CENTER + 1180, CENTER - 1900, CENTER + 1900]) {
    const g = ctx.createLinearGradient(x - 70, 0, x + 70, 0);
    g.addColorStop(0, 'rgba(4, 3, 10, 0)');
    g.addColorStop(0.3, 'rgba(4, 3, 10, 0.92)');
    g.addColorStop(0.7, 'rgba(10, 8, 22, 0.92)');
    g.addColorStop(1, 'rgba(4, 3, 10, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 70, -200, 140, H + 400);
  }
  return t;
}

// ---------------- 공개 ----------------

export function createStage() {
  const wall = buildWall();
  const stands = buildStands();
  const candles = makeCandles();
  const crowd = makeCrowd();

  return {
    /** 선수 뒤 전부 (벽, 빛, 촛불, 관중, 바닥) */
    drawBack(ctx, glow, cam, time, hype) {
      applyLayer(ctx, cam, 0.3);
      ctx.drawImage(wall, WALL_X0, 0);
      godRays(ctx, cam, time);
      // 촛불 (조금 더 가까운 층)
      const tc = applyLayer(ctx, cam, 0.45);
      if (glow) glow.setTransform(tc.zoom * 0.5, 0, 0, tc.zoom * 0.5, (W / 2 - tc.cx * tc.zoom) * 0.5, (FLOOR_SCREEN - STAGE.floorY * tc.zoom) * 0.5);
      motes(ctx, time);
      for (const c of candles) drawCandle(ctx, glow, c, time);
      // 관중석
      applyLayer(ctx, cam, 0.62);
      ctx.drawImage(stands, STANDS_X0, 0);
      for (const s of crowd) drawStudent(ctx, s, time, hype);
      // 관중은 살짝 어둡게 (선수가 돋보이게)
      ctx.fillStyle = 'rgba(12, 8, 30, 0.38)';
      ctx.fillRect(STANDS_X0, 330, STANDS_W, HORIZON - 328);
      ctx.fillStyle = '#2A1A10';
      ctx.fillRect(STANDS_X0, HORIZON + 2, STANDS_W, 44);
      ctx.fillStyle = '#6E4A2E';
      ctx.fillRect(STANDS_X0, HORIZON + 2, STANDS_W, 6);
      drawFloor(ctx, cam, time, hype);
    },
    drawFront(ctx, cam) {
      drawForeground(ctx, cam);
    },
  };
}


