// =============================================================
//  캔버스 그리기
//    - 배경, 링처럼 변하지 않는 것은 처음에 한 번만 그려 둠 (backLayer, ringLayer)
//    - 매 프레임: 관중(들썩임, 응원봉, 피켓, 플래시), 움직이는 조명,
//                선수, 타격 효과, 함성 글자, 꽃가루, 화면 흔들림
//  관중은 경기의 열기(match.hype)가 높을수록 더 크게 들썩이고 팔을 듭니다.
//  모든 좌표는 ARENA(1280×720) 기준입니다.
// =============================================================

import { ARENA, PLAYERS } from '../config.js';
import { drawFighter } from './drawFighter.js';

const LEFT = PLAYERS.find((p) => p.side === 'left') ?? PLAYERS[0];
const RIGHT = PLAYERS.find((p) => p.side === 'right') ?? PLAYERS[1];

// 링 모양 (원근감 있는 사다리꼴)
const RING = {
  backY: 452,
  frontY: 700,
  backLeft: ARENA.leftBound,
  backRight: ARENA.rightBound,
  frontLeft: 40,
  frontRight: 1240,
};

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function star(ctx, x, y, outer, inner, points, rotation) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i / (points * 2)) * Math.PI * 2;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

// ---------------- 관중 ----------------

const SIGN_TEXTS = ['KO!', 'FIGHT!', '★', '최고!', 'WIN!'];

function createCrowd() {
  const rand = seededRandom(11);
  const rows = [
    { y: 286, size: 13, shade: 34 },
    { y: 318, size: 15, shade: 40 },
    { y: 352, size: 17, shade: 46 },
    { y: 388, size: 19, shade: 52 },
    { y: 426, size: 22, shade: 58 },
  ];
  const people = [];
  for (const row of rows) {
    for (let x = -10; x < ARENA.width + 20; x += row.size * 2.2) {
      const px = x + (rand() - 0.5) * row.size;
      const team = px < ARENA.width / 2 ? LEFT : RIGHT;
      const r = rand();
      people.push({
        x: px,
        y: row.y + (rand() - 0.5) * 6,
        s: row.size,
        shade: row.shade + Math.round(rand() * 10),
        phase: rand() * Math.PI * 2,
        rate: 5 + rand() * 4,
        armsAt: rand() * 0.9, // 열기가 이 값을 넘으면 팔을 듦
        item: r < 0.12 ? 'stick' : r < 0.19 ? 'sign' : r < 0.27 ? 'phone' : 'none',
        team: rand() < 0.85 ? team : rand() < 0.5 ? LEFT : RIGHT,
        sign: SIGN_TEXTS[Math.floor(rand() * SIGN_TEXTS.length)],
      });
    }
  }
  return people;
}

function drawPerson(ctx, m, time, hype) {
  const excite = 0.25 + hype;
  const jump = Math.max(0, Math.sin(time * m.rate * (0.7 + hype * 0.6) + m.phase)) * (1.5 + hype * 10) * (m.s / 18);
  const x = m.x;
  const y = m.y - jump;
  const c = `rgb(${m.shade},${m.shade},${m.shade + 10})`;

  // 팔 (열기가 오르면 머리 위로 흔듦)
  const armsUp = hype > m.armsAt;
  if (armsUp) {
    const wave = Math.sin(time * 9 * excite + m.phase) * m.s * 0.45;
    ctx.strokeStyle = c;
    ctx.lineWidth = m.s * 0.42;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - m.s * 0.75, y + m.s * 1.1);
    ctx.lineTo(x - m.s * 1.15 + wave, y - m.s * 1.5);
    ctx.moveTo(x + m.s * 0.75, y + m.s * 1.1);
    ctx.lineTo(x + m.s * 1.15 + wave, y - m.s * 1.5);
    ctx.stroke();

    const hx = x + m.s * 1.15 + wave;
    const hy = y - m.s * 1.5;
    if (m.item === 'stick') {
      ctx.strokeStyle = m.team.color;
      ctx.shadowColor = m.team.color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = m.s * 0.28;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + wave * 0.6, hy - m.s * 1.3);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (m.item === 'sign') {
      const w = m.s * 3;
      const h = m.s * 1.7;
      ctx.fillStyle = m.team.color;
      ctx.fillRect(x - w / 2 + wave * 0.5, hy - h - m.s * 0.3, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.round(m.s * 0.95)}px Jua, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.sign === '★' ? m.team.name : m.sign, x + wave * 0.5, hy - h / 2 - m.s * 0.3);
    } else if (m.item === 'phone') {
      ctx.fillStyle = 'rgba(200,225,255,0.9)';
      ctx.fillRect(hx - m.s * 0.3, hy - m.s * 0.9, m.s * 0.6, m.s * 0.9);
    }
  }

  // 몸 + 머리
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(x, y + m.s * 1.7, m.s * 1.25, m.s * 1.15, 0, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, m.s * 0.72, 0, Math.PI * 2);
  ctx.fill();
  // 머리 위 조명 반사
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, m.s * 0.72, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

// ---------------- 배경 (한 번만) ----------------

function drawBackLayer(ctx) {
  ctx.fillStyle = '#050507';
  ctx.fillRect(0, 0, ARENA.width, ARENA.height);

  // 멀리 있는 관중석 (흐릿한 점)
  const rand = seededRandom(5);
  for (let i = 0; i < 520; i++) {
    const x = rand() * ARENA.width;
    const y = 150 + rand() * 140;
    const g = 16 + Math.round(rand() * 12);
    ctx.fillStyle = `rgb(${g},${g},${g + 8})`;
    ctx.beginPath();
    ctx.arc(x, y, 4 + rand() * 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 천장 조명 기둥
  for (const [x, spread] of [
    [330, 260],
    [640, 330],
    [950, 260],
  ]) {
    const g = ctx.createLinearGradient(0, 0, 0, 640);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 30, 0);
    ctx.lineTo(x + 30, 0);
    ctx.lineTo(x + spread, 640);
    ctx.lineTo(x - spread, 640);
    ctx.closePath();
    ctx.fill();
  }

  // 전광판 느낌의 상단 띠
  ctx.fillStyle = '#0d0d12';
  ctx.fillRect(0, 118, ARENA.width, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.font = '16px Jua, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = 110; x < ARENA.width; x += 330) ctx.fillText(`${LEFT.name}  VS  ${RIGHT.name}  ·  BLACK COMBAT`, x, 131);
}

function drawRingLayer(ctx) {
  const { backY, frontY, backLeft, backRight, frontLeft, frontRight } = RING;

  // 바닥 매트
  const mat = ctx.createLinearGradient(0, backY, 0, frontY);
  mat.addColorStop(0, '#16161c');
  mat.addColorStop(1, '#22222b');
  ctx.fillStyle = mat;
  ctx.beginPath();
  ctx.moveTo(backLeft, backY);
  ctx.lineTo(backRight, backY);
  ctx.lineTo(frontRight, frontY);
  ctx.lineTo(frontLeft, frontY);
  ctx.closePath();
  ctx.fill();
  const spot = ctx.createRadialGradient(640, 600, 30, 640, 600, 520);
  spot.addColorStop(0, 'rgba(255,255,255,0.13)');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spot;
  ctx.fill();

  // 매트 로고
  ctx.save();
  ctx.translate(640, 585);
  ctx.scale(1, 0.32);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(0, 0, 230, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.font = 'italic 150px Jua, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BLACK COMBAT', 0, 8);
  ctx.restore();

  // 앞쪽 에이프런
  ctx.fillStyle = '#0c0c10';
  ctx.fillRect(0, frontY, ARENA.width, ARENA.height - frontY);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.font = '15px Jua, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let x = 120; x < ARENA.width; x += 260) ctx.fillText('블랙컴뱃 · BLACK COMBAT', x, frontY + 10);

  // 로프
  const ropeHeights = [42, 84, 126];
  for (const h of ropeHeights) {
    ctx.strokeStyle = 'rgba(225,225,235,0.75)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(backLeft, backY - h);
    ctx.quadraticCurveTo(640, backY - h + 6, backRight, backY - h);
    ctx.stroke();
  }
  for (const [i, h] of ropeHeights.entries()) {
    const frontH = h * 1.35;
    ctx.lineWidth = 5;
    ctx.strokeStyle = i === 1 ? LEFT.color : 'rgba(225,225,235,0.75)';
    ctx.beginPath();
    ctx.moveTo(backLeft, backY - h);
    ctx.lineTo(frontLeft, frontY - frontH);
    ctx.stroke();
    ctx.strokeStyle = i === 1 ? RIGHT.color : 'rgba(225,225,235,0.75)';
    ctx.beginPath();
    ctx.moveTo(backRight, backY - h);
    ctx.lineTo(frontRight, frontY - frontH);
    ctx.stroke();
  }

  // 기둥 + 코너 패드 (P1 레드 코너 / P2 블루 코너)
  const post = (x, baseY, height, padColor, width) => {
    ctx.fillStyle = '#2b2b35';
    ctx.fillRect(x - width / 2, baseY - height, width, height);
    ctx.fillStyle = padColor;
    ctx.beginPath();
    ctx.roundRect(x - width / 2 - 3, baseY - height + 6, width + 6, height * 0.7, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x - width / 2, baseY - height + 10, 3, height * 0.6);
  };
  post(backLeft, backY, 150, LEFT.colorDeep, 14);
  post(backRight, backY, 150, RIGHT.colorDeep, 14);
  post(frontLeft, frontY, 200, LEFT.color, 22);
  post(frontRight, frontY, 200, RIGHT.color, 22);
}

// ---------------- 움직이는 조명, 플래시 ----------------

function drawSweepLights(ctx, time, hype) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const beams = [
    { x: 120, color: LEFT.color, speed: 0.7, offset: 0 },
    { x: 1160, color: RIGHT.color, speed: 0.8, offset: 2 },
    { x: 640, color: '#ffffff', speed: 1.1, offset: 4 },
  ];
  for (const b of beams) {
    const ang = Math.sin(time * b.speed * (0.6 + hype) + b.offset) * 0.6;
    const len = 520;
    const tipX = b.x + Math.sin(ang) * len;
    const tipY = Math.cos(ang) * len;
    const g = ctx.createLinearGradient(b.x, 0, tipX, tipY);
    g.addColorStop(0, `${b.color}${Math.round((0.12 + hype * 0.18) * 255).toString(16).padStart(2, '0')}`);
    g.addColorStop(1, `${b.color}00`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(b.x - 12, 0);
    ctx.lineTo(b.x + 12, 0);
    ctx.lineTo(tipX + Math.cos(ang) * 90, tipY - Math.sin(ang) * 90);
    ctx.lineTo(tipX - Math.cos(ang) * 90, tipY + Math.sin(ang) * 90);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawCameraFlashes(ctx, time, hype) {
  // 열기가 높을수록 플래시가 많이 터짐 (0.1초마다 위치가 바뀜)
  const rand = seededRandom(Math.floor(time * 10) + 7);
  const count = Math.round(2 + hype * 14);
  for (let i = 0; i < count; i++) {
    const x = rand() * ARENA.width;
    const y = 160 + rand() * 280;
    if (rand() < 0.4) continue;
    const r = 3 + rand() * 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    star(ctx, x, y, r * 1.6, r * 0.4, 4, 0.3);
    ctx.fill();
  }
}

// ---------------- 효과 ----------------

function drawCheers(ctx, effects) {
  for (const fx of effects) {
    if (fx.type !== 'cheer' || fx.age < 0) continue;
    const t = fx.age / fx.life;
    const pop = t < 0.12 ? 0.5 + (t / 0.12) * 0.6 : 1.1 - Math.min(0.1, (t - 0.12) * 0.2);
    ctx.save();
    ctx.globalAlpha = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
    ctx.translate(fx.x, fx.y - t * 46);
    ctx.rotate(fx.tilt);
    ctx.font = `${Math.round(fx.size * pop)}px Jua, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 6;
    ctx.strokeText(fx.text, 0, 0);
    ctx.fillStyle = '#ffd45e';
    ctx.fillText(fx.text, 0, 0);
    ctx.restore();
  }
}

function drawHitEffects(ctx, effects) {
  for (const fx of effects) {
    const t = fx.age / fx.life;
    if (fx.type === 'hit') {
      const size = (fx.big ? 1.5 : 1) * (0.6 + t * 0.9);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        ctx.beginPath();
        ctx.moveTo(fx.x + Math.cos(a) * 30 * size, fx.y + Math.sin(a) * 30 * size);
        ctx.lineTo(fx.x + Math.cos(a) * 52 * size, fx.y + Math.sin(a) * 52 * size);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffd45e';
      star(ctx, fx.x, fx.y, 34 * size, 15 * size, 8, t);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      star(ctx, fx.x, fx.y, 18 * size, 8 * size, 8, t + 0.4);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (fx.type === 'block') {
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#9fc2ff';
      ctx.lineWidth = 6;
      for (const r of [26, 42]) {
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r * (0.7 + t * 0.6), -1.1, 1.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r * (0.7 + t * 0.6), Math.PI - 1.1, Math.PI + 1.1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (fx.type === 'text') {
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : 1.1 - Math.min(0.1, (t - 0.15) * 0.3);
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.font = `${Math.round(fx.size * pop)}px Jua, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 7;
      const y = fx.y - t * 40;
      ctx.strokeText(fx.text, fx.x, y);
      ctx.fillStyle = fx.color;
      ctx.fillText(fx.text, fx.x, y);
      ctx.globalAlpha = 1;
    }
  }
}

function drawConfetti(ctx, effects) {
  for (const fx of effects) {
    if (fx.type !== 'confetti' || fx.age < 0) continue;
    const x = fx.x + fx.vx * fx.age + Math.sin(fx.age * 3 + fx.spin) * 22;
    const y = fx.y + fx.vy * fx.age;
    if (y > ARENA.height + 20) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(fx.spin + fx.spinSpeed * fx.age);
    ctx.scale(1, Math.cos(fx.age * 8 + fx.spin)); // 팔랑거림
    ctx.globalAlpha = fx.age > fx.life - 0.6 ? (fx.life - fx.age) / 0.6 : 1;
    ctx.fillStyle = fx.color;
    ctx.fillRect(-fx.w / 2, -fx.h / 2, fx.w, fx.h);
    ctx.restore();
  }
}

function drawTag(ctx, f, player) {
  if (f.state === 'ko') return;
  const x = f.x;
  const y = ARENA.floorY - 372;
  ctx.font = '18px Jua, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(player.label).width + 18;
  ctx.fillStyle = player.colorDeep;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 13, w, 26, 13);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 12);
  ctx.lineTo(x + 6, y + 12);
  ctx.lineTo(x, y + 19);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(player.label, x, y + 1);
}

// ---------------- 공개 함수 ----------------

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object[]} players  config.js의 PLAYERS
 */
export function createRenderer(canvas, players) {
  const ctx = canvas.getContext('2d');
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));
  const backLayer = document.createElement('canvas');
  const ringLayer = document.createElement('canvas');
  const crowd = createCrowd();
  let scale = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    if (width === canvas.width) return;
    scale = width / ARENA.width;
    canvas.width = width;
    canvas.height = Math.round(ARENA.height * scale);
    for (const [layer, draw] of [
      [backLayer, drawBackLayer],
      [ringLayer, drawRingLayer],
    ]) {
      layer.width = canvas.width;
      layer.height = canvas.height;
      const lctx = layer.getContext('2d');
      lctx.setTransform(scale, 0, 0, scale, 0, 0);
      draw(lctx);
    }
  }

  function draw(match, time) {
    resize();
    const hype = match.hype ?? 0.4;
    const sx = match.shake ? (Math.random() - 0.5) * match.shake : 0;
    const sy = match.shake ? (Math.random() - 0.5) * match.shake : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(backLayer, sx * scale, sy * scale);
    ctx.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);

    // 관중 + 조명 + 플래시
    for (const person of crowd) drawPerson(ctx, person, time, hype);
    drawSweepLights(ctx, time, hype);
    drawCameraFlashes(ctx, time, hype);

    // 링
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ringLayer, sx * scale, sy * scale);
    ctx.setTransform(scale, 0, 0, scale, sx * scale, sy * scale);

    drawCheers(ctx, match.effects);

    // 쓰러진 선수 먼저, 공격 중인 선수는 위에 보이게
    const ids = [...match.playerIds].sort((a, b) => {
      const order = (f) => (f.state === 'ko' ? 0 : f.state === 'attack' ? 2 : 1);
      return order(match.fighters[a]) - order(match.fighters[b]);
    });
    for (const id of ids) drawFighter(ctx, match.fighters[id], playerById[id], time, ARENA.floorY);
    drawHitEffects(ctx, match.effects);
    for (const id of ids) drawTag(ctx, match.fighters[id], playerById[id]);

    // 앞쪽 로프 한 줄 (선수 발 아래)
    ctx.strokeStyle = 'rgba(225,225,235,0.55)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(RING.frontLeft, RING.frontY - 14);
    ctx.lineTo(RING.frontRight, RING.frontY - 14);
    ctx.stroke();

    drawConfetti(ctx, match.effects);
  }

  return { draw, resize };
}
