// =============================================================
//  황종철 교수 (대마법사 킥복서) 그리기
//  거구의 근육질, 빛나는 룬 문신, 긴 흰 수염, 검은 고깔모자와 검은 도복 바지, 맨주먹, 맨발
// =============================================================

import { capsulePath, limbPath, rgba, shade, shadedCapsule, shadedLimb, smoothClosed, toneOf, torsoPoint } from './rig.js';
import { drawBrow, drawEye, drawFist, drawFoot } from './parts.js';

const RIM = 'rgba(190, 150, 255, 0.5)';

/** 룬 문양 (선명한 선 + 빛 번짐 레이어) */
function rune(ctx, glow, x, y, size, rot, color, pulse) {
  const draw = (c, width, alpha) => {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.strokeStyle = rgba(color, alpha);
    c.lineWidth = width;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(0, 0, size, 0, Math.PI * 2);
    c.moveTo(0, -size * 1.5);
    c.lineTo(0, size * 1.5);
    c.moveTo(-size * 0.8, -size * 0.4);
    c.lineTo(size * 0.8, size * 0.6);
    c.moveTo(-size * 1.1, size * 0.9);
    c.lineTo(-size * 0.4, size * 1.4);
    c.stroke();
    c.restore();
  };
  draw(ctx, 1.6, 0.55 + pulse * 0.4);
  if (glow) draw(glow, 4, 0.16 + pulse * 0.2);
}

function sashTails(ctx, j, p, time, sway) {
  const base = torsoPoint(j, 12, -24);
  for (const [k, len] of [[0, 62], [1, 48]]) {
    const w = Math.sin(time * 3 + k) * 8 + sway * 2;
    ctx.beginPath();
    ctx.moveTo(base[0], base[1] - 4 + k * 6);
    ctx.quadraticCurveTo(base[0] - 26, base[1] + 12 + w * 0.3, base[0] - 34 - w, base[1] + len);
    ctx.lineTo(base[0] - 24 - w, base[1] + len + 2);
    ctx.quadraticCurveTo(base[0] - 12, base[1] + 18, base[0] + 6, base[1] + 4 + k * 6);
    ctx.closePath();
    ctx.fillStyle = k ? shade(p.sash, 0.12) : p.sash;
    ctx.fill();
    ctx.strokeStyle = p.trim;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function arm(ctx, glow, limb, p, bulk, far, pulse) {
  const tone = toneOf(p.skin, { light: p.skinLight, dark: p.skinDark, rim: RIM, far });
  const r1 = 12.5 * bulk;
  const r2 = 10 * bulk;
  const r3 = 8.4 * bulk;
  shadedLimb(ctx, limb, [r1, r2, r3], tone, { upper: [3, 4.5], lower: [3.2, 1.2] });
  const bx = limb.origin[0] + (limb.mid[0] - limb.origin[0]) * 0.45;
  const by = limb.origin[1] + (limb.mid[1] - limb.origin[1]) * 0.45;
  if (!far) {
    rune(ctx, glow, bx, by, 4.5, 0.4, p.rune, pulse);
    const fx = limb.mid[0] + (limb.end[0] - limb.mid[0]) * 0.5;
    const fy = limb.mid[1] + (limb.end[1] - limb.mid[1]) * 0.5;
    rune(ctx, glow, fx, fy, 3.2, -0.6, p.rune, pulse);
  }
  // 손목 붕대
  const wx = limb.mid[0] + (limb.end[0] - limb.mid[0]) * 0.82;
  const wy = limb.mid[1] + (limb.end[1] - limb.mid[1]) * 0.82;
  ctx.save();
  ctx.translate(wx, wy);
  ctx.rotate(Math.atan2(limb.end[1] - limb.mid[1], limb.end[0] - limb.mid[0]));
  ctx.fillStyle = far ? '#4A4458' : '#D9D3E6';
  ctx.fillRect(-4, -r3 - 0.5, 8, r3 * 2 + 1);
  ctx.restore();
  drawFist(ctx, limb, 10 * bulk, toneOf(p.skin, { light: p.skinLight, dark: p.skinDark, far }), {
    knuckle: far ? null : rgba(p.rune, 0.75),
    glow: far || !glow ? null : { ctx: glow, color: rgba(p.rune, 0.1 + pulse * 0.12) },
  });
}

function leg(ctx, limb, p, bulk, far) {
  const r1 = 14.5 * bulk;
  const r2 = 10.5 * bulk;
  const r3 = 8.2 * bulk;
  // 맨발이 바지 아래로
  drawFoot(ctx, limb, 26, toneOf(p.skin, { light: p.skinLight, dark: p.skinDark, far }));
  const tone = toneOf(p.pants, { light: p.pantsLight, dark: p.pantsDark, rim: RIM, far });
  const bulge = { upper: [2, 2.5], lower: [2.4, 0.6] };
  shadedLimb(ctx, limb, [r1, r2, r3], tone, bulge);
  // 바지 주름
  ctx.save();
  limbPath(ctx, limb, [r1, r2, r3], bulge);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1.6;
  for (const [seg, t] of [[0, 0.55], [1, 0.3], [1, 0.6]]) {
    const a0 = seg ? limb.mid : limb.origin;
    const a1 = seg ? limb.end : limb.mid;
    const x = a0[0] + (a1[0] - a0[0]) * t;
    const y = a0[1] + (a1[1] - a0[1]) * t;
    const ang = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
    ctx.beginPath();
    ctx.arc(x - Math.cos(ang) * 8, y - Math.sin(ang) * 8, 9, ang - 0.7, ang + 0.7);
    ctx.stroke();
  }
  ctx.restore();
  // 발목 끈 (보라색)
  const ax = limb.mid[0] + (limb.end[0] - limb.mid[0]) * 0.9;
  const ay = limb.mid[1] + (limb.end[1] - limb.mid[1]) * 0.9;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(Math.atan2(limb.end[1] - limb.mid[1], limb.end[0] - limb.mid[0]));
  ctx.fillStyle = far ? shade(p.trim, -0.4) : p.trim;
  ctx.fillRect(-2.5, -r3 - 1, 5, r3 * 2 + 2);
  ctx.restore();
}

function torso(ctx, glow, j, p, bulk, pulse) {
  const b = bulk;
  // 역삼각형 근육질 상체
  const pts = [
    [4, -21 * b], [26, -17 * b], [50, -24 * b], [68, -22 * b], [80, -9 * b],
    [78, 13 * b], [62, 27 * b], [45, 22 * b], [26, 17 * b], [6, 19 * b],
  ].map(([u, v]) => torsoPoint(j, u, v));
  smoothClosed(ctx, pts);
  const top = torsoPoint(j, 66, 10);
  const g = ctx.createRadialGradient(top[0], top[1], 4, top[0], top[1], 105);
  g.addColorStop(0, p.skinLight);
  g.addColorStop(0.5, p.skin);
  g.addColorStop(1, p.skinDark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = shade(p.skin, -0.6);
  ctx.stroke();
  ctx.save();
  ctx.clip();
  // 근육 선
  ctx.strokeStyle = 'rgba(110, 60, 40, 0.38)';
  ctx.lineWidth = 1.6;
  const pec = [torsoPoint(j, 56, 6 * b), torsoPoint(j, 46, 18 * b), torsoPoint(j, 50, 27 * b)];
  ctx.beginPath();
  ctx.moveTo(pec[0][0], pec[0][1]);
  ctx.quadraticCurveTo(pec[1][0], pec[1][1], pec[2][0], pec[2][1]);
  ctx.stroke();
  for (const u of [20, 29, 38]) {
    const a = torsoPoint(j, u, 9 * b);
    const c = torsoPoint(j, u + 1, 18 * b);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.stroke();
  }
  const lat = [torsoPoint(j, 66, -20 * b), torsoPoint(j, 44, -14 * b), torsoPoint(j, 26, -16 * b)];
  ctx.beginPath();
  ctx.moveTo(lat[0][0], lat[0][1]);
  ctx.quadraticCurveTo(lat[1][0], lat[1][1], lat[2][0], lat[2][1]);
  ctx.stroke();
  // 흉터
  const s1 = torsoPoint(j, 58, -4 * b);
  const s2 = torsoPoint(j, 40, 12 * b);
  ctx.strokeStyle = 'rgba(255, 220, 200, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s1[0], s1[1]);
  ctx.lineTo(s2[0], s2[1]);
  ctx.stroke();
  // 림라이트
  const rim = [torsoPoint(j, 6, -22 * b), torsoPoint(j, 46, -26 * b), torsoPoint(j, 76, -12 * b)];
  ctx.strokeStyle = RIM;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(rim[0][0], rim[0][1]);
  ctx.quadraticCurveTo(rim[1][0], rim[1][1], rim[2][0], rim[2][1]);
  ctx.stroke();
  ctx.restore();
  // 가슴, 배의 룬 문신
  const r1 = torsoPoint(j, 50, 4 * b);
  const r2 = torsoPoint(j, 28, 2 * b);
  rune(ctx, glow, r1[0], r1[1], 7, 0.2, p.rune, pulse);
  rune(ctx, glow, r2[0], r2[1], 4.5, -0.3, p.rune, pulse);
}

function sash(ctx, j, p, bulk) {
  const b = bulk;
  const pts = [[-6, -24], [16, -24], [18, 0], [16, 23], [-6, 24], [-12, 0]].map(([u, v]) => torsoPoint(j, u, v * b));
  smoothClosed(ctx, pts);
  const g = ctx.createLinearGradient(...torsoPoint(j, 18, 0), ...torsoPoint(j, -10, 0));
  g.addColorStop(0, p.pantsLight);
  g.addColorStop(1, p.pantsDark);
  ctx.fillStyle = g;
  ctx.fill();
  // 검은 허리띠 + 보라 테두리
  const ang = Math.atan2(j.up[0], -j.up[1]);
  const w = torsoPoint(j, 13, 0);
  ctx.save();
  ctx.translate(w[0], w[1]);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.roundRect(-25 * b, -6, 50 * b, 12, 3);
  ctx.fillStyle = p.sash;
  ctx.fill();
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function beard(ctx, c, ang, p, time, sway) {
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.rotate(ang * 0.6);
  const w = Math.sin(time * 2.2) * 2 + sway * 3;
  ctx.beginPath();
  ctx.moveTo(-12, -4);
  ctx.quadraticCurveTo(-20, 30, -2 + w, 62);
  ctx.quadraticCurveTo(4 + w, 78, 8 + w, 90);
  ctx.quadraticCurveTo(14 + w, 76, 20 + w, 62);
  ctx.quadraticCurveTo(38, 30, 30, -6);
  ctx.quadraticCurveTo(10, 6, -12, -4);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 22, 80);
  g.addColorStop(0, p.beard);
  g.addColorStop(1, p.beardDark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = shade(p.beard, -0.5);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 수염 결
  ctx.strokeStyle = 'rgba(140, 135, 165, 0.6)';
  ctx.lineWidth = 1;
  for (const x of [-4, 4, 12, 20]) {
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.quadraticCurveTo(x - 2, 36, x * 0.4 + 5 + w, 70);
    ctx.stroke();
  }
  // 땋은 끝의 금속 고리
  ctx.fillStyle = '#C9B37A';
  ctx.beginPath();
  ctx.roundRect(2 + w, 66, 12, 8, 2);
  ctx.fill();
  ctx.restore();
}

function head(ctx, glow, j, p, expr, time, sway, pulse) {
  const c = [j.neckTop[0] + j.headUp[0] * 19, j.neckTop[1] + j.headUp[1] * 19];
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.rotate(j.headAngle);
  const line = shade(p.skin, -0.6);

  // 뒷머리 (긴 흰 머리)
  ctx.beginPath();
  ctx.moveTo(-6, -18);
  ctx.quadraticCurveTo(-30, -14, -30, 8);
  ctx.quadraticCurveTo(-34 - sway * 2, 30, -24 - sway * 3, 42);
  ctx.quadraticCurveTo(-14, 20, -4, 8);
  ctx.closePath();
  ctx.fillStyle = p.beardDark;
  ctx.fill();

  // 머리 (조금 길쭉한 사람 얼굴)
  ctx.beginPath();
  ctx.ellipse(2, 0, 22, 25, 0, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(8, -10, 3, 2, 0, 30);
  g.addColorStop(0, p.skinLight);
  g.addColorStop(0.6, p.skin);
  g.addColorStop(1, p.skinDark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // 턱 (각진 턱)
  ctx.beginPath();
  ctx.moveTo(-6, 14);
  ctx.quadraticCurveTo(10, 30, 22, 14);
  ctx.lineTo(22, 6);
  ctx.closePath();
  ctx.fillStyle = p.skin;
  ctx.fill();
  // 귀
  ctx.beginPath();
  ctx.ellipse(-8, 2, 5, 8, 0.1, 0, Math.PI * 2);
  ctx.fillStyle = p.skinDark;
  ctx.fill();
  // 옆머리
  ctx.fillStyle = p.beard;
  ctx.beginPath();
  ctx.ellipse(-14, 4, 7, 12, 0.2, 0, Math.PI * 2);
  ctx.fill();
  // 매부리코
  ctx.beginPath();
  ctx.moveTo(18, -6);
  ctx.quadraticCurveTo(31, 4, 25, 9);
  ctx.quadraticCurveTo(21, 10, 19, 7);
  ctx.closePath();
  ctx.fillStyle = p.skin;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // 빛나는 눈 + 흉터
  const eyeX = 12;
  const eyeY = -5;
  drawEye(ctx, eyeX, eyeY, 5.2, expr, { iris: p.eye, liner: '#24152E', glowCtx: glow, glowColor: rgba(p.eye, 0.35 + pulse * 0.4) });
  ctx.strokeStyle = 'rgba(255, 225, 205, 0.8)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(eyeX - 2, eyeY - 12);
  ctx.lineTo(eyeX + 4, eyeY + 8);
  ctx.stroke();
  // 동그란 안경
  ctx.strokeStyle = '#C9B37A';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(eyeX + 1, eyeY, 7.5, 0, Math.PI * 2);
  ctx.moveTo(eyeX - 6.5, eyeY - 1);
  ctx.lineTo(-6, -2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(200, 220, 255, 0.18)';
  ctx.beginPath();
  ctx.arc(eyeX + 1, eyeY, 7, 0, Math.PI * 2);
  ctx.fill();
  // 덥수룩한 흰 눈썹
  drawBrow(ctx, 12, -15, 10, expr, p.beard, 5.5);

  // 콧수염
  ctx.fillStyle = p.beard;
  ctx.strokeStyle = shade(p.beard, -0.5);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(24, 10);
  ctx.quadraticCurveTo(14, 8, 4, 18);
  ctx.quadraticCurveTo(14, 14, 24, 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (expr === 'shout' || expr === 'strain' || expr === 'happy') {
    ctx.fillStyle = '#3A1420';
    ctx.beginPath();
    ctx.ellipse(18, 18, 5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 검은 고깔모자 (구겨지고 끝이 꺾임)
  const bend = Math.sin(time * 1.8) * 4 + sway * 10;
  ctx.save();
  ctx.translate(0, -17);
  ctx.rotate(-0.18);
  ctx.beginPath();
  ctx.moveTo(-24, 0);
  ctx.quadraticCurveTo(-16, -34, -8, -58);
  ctx.quadraticCurveTo(-14 - bend, -74, -34 - bend, -78);
  ctx.quadraticCurveTo(-18 - bend * 0.6, -66, 2, -50);
  ctx.quadraticCurveTo(14, -24, 26, 0);
  ctx.closePath();
  const hg = ctx.createLinearGradient(-20, -60, 20, 0);
  hg.addColorStop(0, p.hatLight);
  hg.addColorStop(1, p.hat);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 모자 띠 (보라)
  ctx.beginPath();
  ctx.moveTo(-23, -3);
  ctx.quadraticCurveTo(0, -12, 25, -3);
  ctx.lineTo(23, -10);
  ctx.quadraticCurveTo(0, -19, -21, -10);
  ctx.closePath();
  ctx.fillStyle = p.trim;
  ctx.fill();
  rune(ctx, glow, 1, -9, 2.8, 0, p.rune, pulse);
  // 챙
  ctx.beginPath();
  ctx.ellipse(1, 0, 40, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = p.hat;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.restore();

  ctx.restore();
  return c;
}

/** 황종철 교수 전체 */
export function drawProfessor(ctx, j, player, expr, time, glow, fighter) {
  const p = player.palette;
  const bulk = player.bulk;
  const sway = Math.max(-1, Math.min(1, -(fighter?.vx ?? 0) / 260));
  const pulse = (Math.sin(time * 3.2) + 1) / 2;
  ctx.lineJoin = 'round';
  sashTails(ctx, j, p, time, sway);
  arm(ctx, glow, j.armB, p, bulk, true, pulse);
  leg(ctx, j.legB, p, bulk, true);
  // 굵은 목
  shadedCapsule(ctx, j.shoulder, j.neckTop, 13 * bulk, 11 * bulk, toneOf(p.skin, { light: p.skinLight, dark: p.skinDark }));
  torso(ctx, glow, j, p, bulk, pulse);
  sash(ctx, j, p, bulk);
  leg(ctx, j.legF, p, bulk, false);
  const headCenter = head(ctx, glow, j, p, expr, time, sway, pulse);
  // 수염은 머리 위에 (가슴까지 늘어짐)
  const chin = [headCenter[0] + j.headUp[0] * -12 + j.fwd[0] * 6, headCenter[1] + j.headUp[1] * -12 + j.fwd[1] * 6];
  beard(ctx, chin, j.headAngle, p, time, sway);
  arm(ctx, glow, j.armF, p, bulk, false, pulse);
}
