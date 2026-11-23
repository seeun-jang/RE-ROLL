// 두 영웅(아킬레우스, 헥토르)을 캔버스에 그리는 파일입니다.
// 모두 "오른쪽을 바라보는" 모습으로 그리고, 왼쪽을 볼 때는 ctx.scale(-1, 1) 로 뒤집어요.
// (0, 0) = 발 밑 중앙, 키는 약 200px

const TAU = Math.PI * 2;
const OUTLINE = 'rgba(18,8,3,0.85)';
const SKIN = '#b77b52';
const SKIN_DARK = '#7d4a2c';

export const LOOK = {
  p1: {
    armor: ['#ffe9a8', '#c99434', '#6a4410', '#1c0e04'],
    cape: ['#a8101c', '#3a0408'],
    crest: ['#ff6a3a', '#b8141a', '#3a0406'],
    eye: '#ffb020',
    glow: '255,190,60',
    field: ['#a3161a', '#5a0608'],
    emblem: 'sun',
    spear: '#ffe9a0',
  },
  p2: {
    armor: ['#eef4ff', '#8c98b4', '#3a4460', '#0a0e18'],
    cape: ['#1a3e9e', '#060e2e'],
    crest: ['#dfeaff', '#5c8ee0', '#14306e'],
    eye: '#5ff0ff',
    glow: '90,220,255',
    field: ['#173c8f', '#081a44'],
    emblem: 'trident',
    spear: '#c8f4ff',
  },
};

const lerp = (a, b, t) => a + (b - a) * t;

function grad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

// 광택 금속: 어두움 → 밝음 → 하얀 반사 띠 → 다시 어두움
function metal(ctx, x0, y0, x1, y1, a) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, a[3]);
  g.addColorStop(0.2, a[2]);
  g.addColorStop(0.4, a[1]);
  g.addColorStop(0.48, a[0]);
  g.addColorStop(0.52, '#ffffff');
  g.addColorStop(0.58, a[0]);
  g.addColorStop(0.75, a[2]);
  g.addColorStop(1, a[3]);
  return g;
}

function paint(ctx, fill, lw = 1.6) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lw;
  ctx.stroke();
}

// ----------------------------------------------------------------------
// 자세 → 창 잡은 손 위치/각도
// ----------------------------------------------------------------------

function spearGrip(pose) {
  if (pose.victory) return { x: -2, y: -186, angle: -Math.PI / 2 + 0.12 };
  if (pose.punch) return { x: 62, y: -146, angle: -Math.PI / 2 + 0.25 }; // 창을 세워 쥔 채 주먹
  if (pose.butt) return { x: 36, y: -150, angle: Math.PI - 0.55 }; // 창을 뒤집어 창대 끝으로
  if (pose.smashDown) return { x: 44, y: -128, angle: 0.95 }; // 아래로 내려찍기
  if (pose.spin) return { x: 34, y: -142, angle: -0.05 }; // 수평으로 휘두르기
  if (pose.thrown) return { x: 46, y: -134, angle: 0.04 };
  if (pose.windup) return { x: -38, y: -166, angle: 0.02 };
  return { x: -14, y: -160, angle: 0.14 };
}

const SPEAR_FRONT = 112;
const SPEAR_BACK = 74;

// 창끝 위치 (발 기준, 오른쪽을 볼 때). 빔이 여기서 나가요
export function spearTip(pose) {
  const g = spearGrip(pose);
  const lift = pose.airborne ? 26 : 0;
  return { x: g.x + Math.cos(g.angle) * (SPEAR_FRONT + 26), y: g.y - lift + Math.sin(g.angle) * (SPEAR_FRONT + 26) };
}

/**
 * pose = {
 *   now, shield, shieldFresh, windup, thrown, airborne, victory, dizzy, divineReady,
 *   noSpear   // 창을 던져서/꽂아서 손에 없음
 *   punch, butt, smashDown, spin, bash   // 공격 기술 자세 (moves.js)
 * }
 */
// ----------------------------------------------------------------------
// 조명: 영웅을 따로 그린 뒤 아래쪽 그늘 + 빛 쪽 가장자리 테두리광(역광)을 입힘
// pose.light = 화면 기준 빛이 오는 방향 { x, y } (기본: 위)
// ----------------------------------------------------------------------

const buffers = [];
function scratch(i, w, h) {
  if (!buffers[i]) buffers[i] = document.createElement('canvas');
  const c = buffers[i];
  if (c.width < w || c.height < h) {
    c.width = Math.max(c.width, w);
    c.height = Math.max(c.height, h);
  }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.clearRect(0, 0, w, h);
  return c;
}

export function drawHero(ctx, id, pose) {
  const m = ctx.getTransform();
  const corners = [
    [-150, -310],
    [210, -310],
    [-150, 40],
    [210, 40],
  ].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const minX = Math.floor(Math.min(...corners.map((p) => p[0])));
  const minY = Math.floor(Math.min(...corners.map((p) => p[1])));
  const w = Math.ceil(Math.max(...corners.map((p) => p[0]))) - minX;
  const h = Math.ceil(Math.max(...corners.map((p) => p[1]))) - minY;
  if (!(w > 0 && h > 0) || w * h > 6e6 || typeof document === 'undefined') {
    drawHeroBase(ctx, id, pose);
    return;
  }

  const body = scratch(0, w, h);
  const b = body.getContext('2d');
  b.setTransform(m.a, m.b, m.c, m.d, m.e - minX, m.f - minY);
  drawHeroBase(b, id, pose);

  // 밤: 전체적으로 어둡게, 발 쪽은 더 깊은 그늘
  b.globalCompositeOperation = 'source-atop';
  const shade = b.createLinearGradient(0, -230, 0, 10);
  shade.addColorStop(0, 'rgba(20,6,14,0.15)');
  shade.addColorStop(0.5, 'rgba(10,4,12,0.3)');
  shade.addColorStop(1, 'rgba(4,0,4,0.65)');
  b.fillStyle = shade;
  b.fillRect(-160, -320, 380, 370);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(body, 0, 0, w, h, minX, minY, w, h);

  // 테두리광: 뒤쪽 위의 핏빛 달빛 + 옆쪽 화로 불빛
  const lights = pose.lights ?? [{ x: 0, y: -1, color: 'rgba(255,120,100,0.95)' }];
  const k = 3 * Math.hypot(m.a, m.b);
  const rim = scratch(1, w, h);
  const r = rim.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.globalCompositeOperation = 'copy';
    r.drawImage(body, 0, 0);
    r.globalCompositeOperation = 'destination-out';
    r.drawImage(body, -L.x * k, -L.y * k);
    r.globalCompositeOperation = 'source-in';
    r.fillStyle = L.color;
    r.fillRect(0, 0, w, h);
    ctx.drawImage(rim, 0, 0, w, h, minX, minY, w, h);
  }
  ctx.restore();
}

function drawHeroBase(ctx, id, pose) {
  const look = LOOK[id];
  const now = pose.now ?? 0;
  const lean = pose.thrown ? 0.1 : pose.windup ? -0.06 : pose.dizzy ? -0.14 : 0;
  const breathe = Math.sin(now * 2.6) * 1.5;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  drawLegs(ctx, look, pose);

  ctx.save();
  ctx.translate(0, -88);
  ctx.rotate(lean);
  ctx.translate(0, 88 + breathe * 0.4);

  drawCape(ctx, look, now, pose);
  drawSpearArm(ctx, id, look, pose, now, true);
  drawSkirt(ctx, look);
  drawTorso(ctx, look);
  drawHelmet(ctx, id, look, pose, now);
  drawSpearArm(ctx, id, look, pose, now, false);
  drawShield(ctx, id, look, pose, now);

  ctx.restore();
  ctx.restore();
}

// ----------------------------------------------------------------------

function limb(ctx, a, b, c, width, upper, lower) {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + 2.5;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.stroke();
  ctx.strokeStyle = upper;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.strokeStyle = lower;
  ctx.lineWidth = width - 1;
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.stroke();
}

function drawLegs(ctx, look, pose) {
  const greave = grad(ctx, 0, -50, 0, 0, [look.armor[0], look.armor[1], look.armor[2]]);
  const up = pose.airborne ? 26 : 0;
  // 뒷다리, 앞다리 (넓은 전투 자세)
  const back = pose.airborne
    ? [[-6, -92 - up], [-16, -62 - up], [-30, -34 - up]]
    : [[-6, -92], [-22, -50], [-34, -2]];
  const front = pose.airborne
    ? [[8, -92 - up], [26, -70 - up], [18, -40 - up]]
    : [[8, -92], [28, -52], [32, -2]];
  for (const [hip, knee, foot] of [back, front]) {
    limb(ctx, hip, knee, foot, 14, SKIN, greave);
    // 무릎 보호대
    ctx.beginPath();
    ctx.arc(knee[0], knee[1], 7, 0, TAU);
    paint(ctx, look.armor[1], 2);
    // 샌들
    ctx.beginPath();
    ctx.ellipse(foot[0] + 5, foot[1] + 1, 11, 4.5, 0, 0, TAU);
    paint(ctx, '#2a1408', 2);
  }
}

function drawCape(ctx, look, now, pose) {
  const wind = Math.sin(now * 4) * 8 + Math.sin(now * 7.3) * 4;
  const flare = pose.airborne ? 16 : 0;
  ctx.beginPath();
  ctx.moveTo(-14, -144);
  ctx.bezierCurveTo(-40, -120, -66 + wind, -70, -84 + wind - flare, -18);
  // 찢어진 끝자락
  const tips = 6;
  for (let i = 0; i <= tips; i++) {
    const t = i / tips;
    const x = lerp(-84 + wind - flare, -22, t);
    const y = (i % 2 ? -4 : -16) + Math.sin(now * 6 + i) * 3;
    ctx.lineTo(x, y);
  }
  ctx.bezierCurveTo(-20, -60, -12, -110, 8, -142);
  ctx.closePath();
  paint(ctx, grad(ctx, 0, -150, -60, 0, [look.cape[0], look.cape[1]]));
  // 안쪽 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(-10, -138);
  ctx.bezierCurveTo(-30, -100, -40, -60, -46, -14);
  ctx.lineTo(-30, -12);
  ctx.bezierCurveTo(-24, -60, -16, -110, -2, -140);
  ctx.closePath();
  ctx.fill();
}

function drawSkirt(ctx, look) {
  for (let i = 0; i < 7; i++) {
    const x = -20 + i * 6.6;
    ctx.beginPath();
    ctx.roundRect(x, -100, 6, 26 - Math.abs(i - 3) * 1.5, 2);
    paint(ctx, i % 2 ? '#5a1a0c' : '#3a0e06', 1.5);
  }
  ctx.beginPath();
  ctx.roundRect(-22, -104, 44, 7, 3);
  paint(ctx, look.armor[2], 1.8);
}

function drawTorso(ctx, look) {
  // 근육 흉갑 (역삼각형)
  ctx.beginPath();
  ctx.moveTo(-18, -146);
  ctx.quadraticCurveTo(4, -152, 22, -144);
  ctx.quadraticCurveTo(30, -126, 22, -110);
  ctx.lineTo(14, -100);
  ctx.lineTo(-14, -100);
  ctx.quadraticCurveTo(-24, -122, -18, -146);
  ctx.closePath();
  paint(ctx, metal(ctx, -22, -150, 26, -96, look.armor));
  ctx.strokeStyle = 'rgba(40,20,0,0.5)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  // 가슴
  ctx.moveTo(2, -142);
  ctx.quadraticCurveTo(12, -126, 24, -130);
  ctx.moveTo(2, -142);
  ctx.quadraticCurveTo(-6, -128, -16, -132);
  // 복근
  ctx.moveTo(4, -124);
  ctx.lineTo(4, -104);
  for (const y of [-118, -111]) {
    ctx.moveTo(-6, y);
    ctx.lineTo(14, y);
  }
  ctx.stroke();
  // 하이라이트
  ctx.strokeStyle = 'rgba(255,255,230,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-12, -140);
  ctx.quadraticCurveTo(-16, -128, -12, -114);
  ctx.stroke();
}

function drawHelmet(ctx, id, look, pose, now) {
  const hy = pose.airborne ? -26 : 0;
  ctx.save();
  ctx.translate(4, -164 + hy);

  // 말총 장식 (크레스트) — 바람에 흔들림
  const sway = Math.sin(now * 5) * 4;
  ctx.beginPath();
  ctx.moveTo(14, -18);
  ctx.quadraticCurveTo(0, -64, -44 + sway, -26);
  ctx.quadraticCurveTo(-56 + sway, -6, -50 + sway, 18);
  ctx.quadraticCurveTo(-30, -24, -4, -30);
  ctx.quadraticCurveTo(6, -28, 10, -16);
  ctx.closePath();
  paint(ctx, grad(ctx, 14, -60, -50, 20, look.crest));
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.4;
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    ctx.beginPath();
    ctx.moveTo(lerp(10, -40 + sway, t), lerp(-26, -30, t) - Math.sin(t * Math.PI) * 26);
    ctx.lineTo(lerp(6, -46 + sway, t), lerp(-18, 10, t) - Math.sin(t * Math.PI) * 14);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.roundRect(-6, -26, 12, 8, 2);
  paint(ctx, look.armor[2], 1.5);

  // 투구 본체 (코린트식 풀페이스)
  ctx.beginPath();
  ctx.moveTo(-18, 14);
  ctx.quadraticCurveTo(-24, -10, -14, -20);
  ctx.quadraticCurveTo(0, -30, 16, -20);
  ctx.quadraticCurveTo(24, -10, 22, 2);
  ctx.lineTo(24, 14);
  ctx.quadraticCurveTo(18, 22, 10, 20);
  ctx.lineTo(4, 14);
  ctx.lineTo(-6, 20);
  ctx.quadraticCurveTo(-16, 22, -18, 14);
  ctx.closePath();
  paint(ctx, metal(ctx, -22, -28, 26, 20, look.armor));

  // T자 눈 틈
  ctx.fillStyle = '#050202';
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(23, -6);
  ctx.lineTo(23, -1);
  ctx.lineTo(16, 0);
  ctx.lineTo(15, 16);
  ctx.lineTo(11, 16);
  ctx.lineTo(10, 0);
  ctx.lineTo(0, 1);
  ctx.closePath();
  ctx.fill();

  // 빛나는 눈
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const flicker = 0.75 + Math.sin(now * 9) * 0.15 + (pose.divineReady ? 0.3 : 0);
  const eg = ctx.createRadialGradient(15, -2.5, 0, 15, -2.5, 16);
  eg.addColorStop(0, `rgba(${look.glow},${flicker})`);
  eg.addColorStop(1, `rgba(${look.glow},0)`);
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.arc(15, -2.5, 16, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(12, -4, 7, 2.2);
  // 눈빛 잔상
  if (pose.divineReady) {
    ctx.strokeStyle = `rgba(${look.glow},0.7)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, -3);
    ctx.quadraticCurveTo(-4, -6 + Math.sin(now * 8) * 3, -26, -2);
    ctx.stroke();
  }
  ctx.restore();

  // 볼 가리개 선, 리벳, 하이라이트
  ctx.strokeStyle = 'rgba(30,15,0,0.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-10, -14);
  ctx.quadraticCurveTo(-16, 2, -10, 16);
  ctx.stroke();
  ctx.fillStyle = look.armor[3];
  for (const [rx, ry] of [[-14, -6], [-14, 6], [20, 8]]) {
    ctx.beginPath();
    ctx.arc(rx, ry, 1.6, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,240,0.7)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(2, -6, 15, Math.PI * 1.15, Math.PI * 1.5);
  ctx.stroke();
  ctx.restore();
}

function drawSpear(ctx, id, look, x, y, angle, glow, now) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (glow) {
    ctx.shadowColor = look.spear;
    ctx.shadowBlur = 22 + Math.sin(now * 14) * 8;
  }
  // 자루
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-SPEAR_BACK, 0);
  ctx.lineTo(SPEAR_FRONT, 0);
  ctx.stroke();
  ctx.strokeStyle = glow ? look.spear : '#5a3418';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // 물미
  ctx.beginPath();
  ctx.moveTo(-SPEAR_BACK - 10, 0);
  ctx.lineTo(-SPEAR_BACK, -3);
  ctx.lineTo(-SPEAR_BACK, 3);
  ctx.closePath();
  paint(ctx, look.armor[2], 1.2);
  // 잎 모양 창날
  ctx.beginPath();
  ctx.moveTo(SPEAR_FRONT - 4, 0);
  ctx.quadraticCurveTo(SPEAR_FRONT + 8, -9, SPEAR_FRONT + 30, 0);
  ctx.quadraticCurveTo(SPEAR_FRONT + 8, 9, SPEAR_FRONT - 4, 0);
  paint(ctx, glow ? '#ffffff' : grad(ctx, SPEAR_FRONT, -8, SPEAR_FRONT, 8, [look.armor[0], look.armor[2]]), 1.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SPEAR_FRONT, 0);
  ctx.lineTo(SPEAR_FRONT + 26, 0);
  ctx.stroke();
  ctx.restore();
}

// 땅(또는 몸)에 꽂힌 창. (tipX, tipY) = 박힌 끝, angle = 자루 방향
export function drawPlantedSpear(ctx, id, tipX, tipY, angle, now) {
  const look = LOOK[id];
  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.rotate(angle);
  // 창날은 박혀서 안 보이고, 자루만 비스듬히 서 있음
  ctx.translate(-(SPEAR_FRONT + 24), 0);
  drawSpear(ctx, id, look, 0, 0, 0, true, now);
  ctx.restore();
}

// back=true: 팔 뒤쪽(창) 먼저, back=false: 손과 팔뚝을 몸 위에
function drawSpearArm(ctx, id, look, pose, now, back) {
  const g = spearGrip(pose);
  const lift = pose.airborne ? 26 : 0;
  const shoulder = [-8, -140 - lift * 0.4];
  const hand = [g.x, g.y - lift];
  const elbow = [lerp(shoulder[0], hand[0], 0.5) - 14, lerp(shoulder[1], hand[1], 0.5) + 10];
  if (back) {
    if (!pose.noSpear) drawSpear(ctx, id, look, hand[0], hand[1], g.angle, pose.divineReady, now);
    return;
  }
  limb(ctx, shoulder, elbow, hand, 12, SKIN, grad(ctx, elbow[0], elbow[1], hand[0], hand[1], [look.armor[1], look.armor[2]]));
  ctx.beginPath();
  ctx.arc(hand[0], hand[1], 6, 0, TAU);
  paint(ctx, SKIN_DARK, 2);
  // 어깨 갑옷
  ctx.beginPath();
  ctx.ellipse(shoulder[0], shoulder[1] + 2, 12, 9, -0.3, 0, TAU);
  paint(ctx, metal(ctx, -20, -152, 4, -128, look.armor));
}

function drawShield(ctx, id, look, pose, now) {
  const blocking = pose.shield;
  const lift = pose.airborne ? 26 : 0;
  const cx = (blocking ? 44 : 30) + (pose.bash ? 24 : 0);
  const cy = (blocking ? -128 : -116) - lift;
  const rx = blocking ? 30 : 25;
  const ry = blocking ? 46 : 40;

  // 방패 팔
  limb(ctx, [16, -140 - lift * 0.4], [24, -122 - lift], [cx - 6, cy + 2], 12, SKIN, look.armor[2]);

  ctx.save();
  if (blocking) {
    ctx.shadowColor = `rgba(${look.glow},0.9)`;
    ctx.shadowBlur = 30;
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, -0.05, 0, TAU);
  paint(ctx, metal(ctx, cx - rx, cy - ry, cx + rx, cy + ry, look.armor), 2);
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.ellipse(cx + 1, cy, rx * 0.8, ry * 0.82, -0.05, 0, TAU);
  ctx.fillStyle = grad(ctx, cx, cy - ry, cx, cy + ry, look.field);
  ctx.fill();

  // 문장
  ctx.save();
  ctx.translate(cx + 1, cy);
  ctx.scale(rx / ry, 1);
  ctx.fillStyle = look.armor[0];
  ctx.strokeStyle = look.armor[2];
  ctx.lineWidth = 1.5;
  if (look.emblem === 'sun') {
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU + now * 0.2;
      const r = i % 2 ? ry * 0.3 : ry * 0.62;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, ry * 0.22, 0, TAU);
    ctx.fillStyle = look.field[0];
    ctx.fill();
    ctx.stroke();
  } else {
    const s = ry / 40;
    ctx.beginPath();
    ctx.rect(-2.5 * s, -12 * s, 5 * s, 36 * s);
    ctx.moveTo(-16 * s, -24 * s);
    ctx.lineTo(-12 * s, -6 * s);
    ctx.lineTo(12 * s, -6 * s);
    ctx.lineTo(16 * s, -24 * s);
    ctx.lineTo(12 * s, -10 * s);
    ctx.lineTo(-12 * s, -10 * s);
    ctx.closePath();
    ctx.moveTo(0, -30 * s);
    ctx.lineTo(4 * s, -14 * s);
    ctx.lineTo(-4 * s, -14 * s);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 테두리 반짝임
  ctx.strokeStyle = 'rgba(255,255,240,0.6)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.93, ry * 0.93, -0.05, Math.PI * 1.05, Math.PI * 1.45);
  ctx.stroke();
  ctx.restore();
}

// ----------------------------------------------------------------------
// 신의 가호: 몸에서 피어오르는 불꽃
// ----------------------------------------------------------------------

export function drawDivineAura(ctx, id, x, y, now, strength = 1) {
  const rgb = LOOK[id].glow;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const r = 110 + Math.sin(now * 6) * 8;
  const g = ctx.createRadialGradient(x, y, 10, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${0.35 * strength})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  // 불꽃 혀
  for (let i = 0; i < 9; i++) {
    const phase = (now * 1.6 + i * 0.37) % 1;
    const fx = x + Math.sin(i * 2.3 + now) * 46;
    const fy = y + 90 - phase * 200;
    const size = (1 - phase) * 18 * strength;
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, size * 2);
    fg.addColorStop(0, `rgba(255,255,255,${0.6 * (1 - phase)})`);
    fg.addColorStop(0.4, `rgba(${rgb},${0.5 * (1 - phase)})`);
    fg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(fx, fy, size, size * 2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
