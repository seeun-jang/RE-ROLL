// =============================================================
//  마법 그리기: 매직 미사일, 파이어볼, 낙뢰(예고 표시 → 번개), 메테오(그림자 → 떨어지는 운석)
//  ctx, glow는 카메라 변환이 적용된 상태 (월드 좌표)
// =============================================================

import { STAGE } from '../config.js';

const FLOOR = STAGE.floorY;

function orb(ctx, glow, x, y, r, core, edge, glowColor, glowR) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.35, core);
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (glow) {
    glow.fillStyle = glowColor;
    glow.beginPath();
    glow.arc(x, y, glowR, 0, Math.PI * 2);
    glow.fill();
  }
}

function missile(ctx, glow, p, time) {
  const y = FLOOR - p.height;
  const dir = Math.sign(p.vx);
  // 꼬리
  const tail = ctx.createLinearGradient(p.x, y, p.x - dir * 90, y);
  tail.addColorStop(0, 'rgba(200, 170, 255, 0.85)');
  tail.addColorStop(1, 'rgba(140, 100, 255, 0)');
  ctx.fillStyle = tail;
  ctx.beginPath();
  ctx.moveTo(p.x, y - 9);
  ctx.lineTo(p.x - dir * 90, y);
  ctx.lineTo(p.x, y + 9);
  ctx.fill();
  orb(ctx, glow, p.x, y, p.radius * 0.75, '#C9A8FF', 'rgba(120, 80, 255, 0.2)', 'rgba(170, 120, 255, 0.9)', 26);
  // 주위를 도는 작은 별
  for (let i = 0; i < 3; i++) {
    const a = time * 14 + i * 2.1;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * 14, y + Math.sin(a) * 9, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fireball(ctx, glow, p, time) {
  const y = FLOOR - p.height;
  const dir = Math.sign(p.vx);
  // 뒤로 흩날리는 불꽃 혀
  for (let i = 0; i < 9; i++) {
    const k = i / 9;
    const wob = Math.sin(time * 22 + i * 1.7) * 7;
    const r = p.radius * (1 - k * 0.7);
    ctx.fillStyle = `rgba(${255}, ${120 + k * 80}, ${40 + k * 40}, ${0.55 - k * 0.45})`;
    ctx.beginPath();
    ctx.arc(p.x - dir * k * 110, y + wob, r, 0, Math.PI * 2);
    ctx.fill();
  }
  orb(ctx, glow, p.x, y, p.radius, '#FFC24A', 'rgba(255, 70, 20, 0.85)', 'rgba(255, 140, 50, 0.95)', p.radius * 2.2);
  // 표면 일렁임
  ctx.strokeStyle = 'rgba(255, 245, 200, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, y, p.radius * 0.6, time * 8, time * 8 + 2.2);
  ctx.stroke();
}

function bolt(ctx, x, top, bottom, seed, width) {
  let rnd = seed;
  const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647 - 0.5);
  ctx.beginPath();
  ctx.moveTo(x, top);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    ctx.lineTo(x + r() * 50 * (i < steps ? 1 : 0), top + ((bottom - top) * i) / steps);
  }
  ctx.lineWidth = width;
  ctx.stroke();
}

function lightning(ctx, glow, s, time) {
  if (!s.done) {
    // 바닥 예고 표시 (점점 진해짐)
    const k = 1 - s.timer / s.total;
    ctx.save();
    ctx.translate(s.x, FLOOR + 4);
    ctx.scale(1, 0.24);
    ctx.strokeStyle = `rgba(200, 180, 255, ${0.3 + k * 0.6})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, s.radius * (1.4 - k * 0.4), 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(time * 3);
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, s.radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
    // 하늘에서 내려오는 가는 예고선
    ctx.strokeStyle = `rgba(220, 210, 255, ${k * 0.35})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, FLOOR - 700);
    ctx.lineTo(s.x, FLOOR);
    ctx.stroke();
    if (glow) {
      glow.fillStyle = `rgba(170, 130, 255, ${0.2 + k * 0.4})`;
      glow.beginPath();
      glow.ellipse(s.x, FLOOR, s.radius * 1.2, 14, 0, 0, Math.PI * 2);
      glow.fill();
    }
    return;
  }
  // 번개
  const a = Math.max(0, s.flash / 0.4);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const seed = Math.floor(time * 30) + 7;
  ctx.strokeStyle = '#B98CFF';
  bolt(ctx, s.x, FLOOR - 760, FLOOR, seed, 14);
  ctx.strokeStyle = '#FFFFFF';
  bolt(ctx, s.x, FLOOR - 760, FLOOR, seed, 5);
  ctx.restore();
  if (glow) {
    glow.globalAlpha = a;
    glow.strokeStyle = '#D9C2FF';
    glow.lineCap = 'round';
    bolt(glow, s.x, FLOOR - 760, FLOOR, seed, 34);
    glow.globalAlpha = 1;
  }
}

function meteor(ctx, glow, s, time) {
  const big = s.kind === 'meteor';
  if (s.done) return;
  const k = 1 - s.timer / s.total;
  // 그림자 (점점 커짐)
  ctx.save();
  ctx.translate(s.x, FLOOR + 4);
  ctx.scale(1, 0.22);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.25 + k * 0.4})`;
  ctx.beginPath();
  ctx.arc(0, 0, s.radius * (0.4 + k * 0.8), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 120, 60, ${0.3 + k * 0.6})`;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // 떨어지는 운석
  const sx = s.x + 380;
  const sy = FLOOR - 900;
  const e = k * k;
  const x = sx + (s.x - sx) * e;
  const y = sy + (FLOOR - 40 - sy) * e;
  const r = big ? 52 : 26;
  const dx = s.x - sx;
  const dy = FLOOR - 40 - sy;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const trail = ctx.createLinearGradient(x, y, x - ux * r * 6, y - uy * r * 6);
  trail.addColorStop(0, 'rgba(255, 200, 90, 0.9)');
  trail.addColorStop(1, 'rgba(255, 60, 20, 0)');
  ctx.fillStyle = trail;
  ctx.beginPath();
  ctx.moveTo(x + uy * r, y - ux * r);
  ctx.lineTo(x - ux * r * 6, y - uy * r * 6);
  ctx.lineTo(x - uy * r, y + ux * r);
  ctx.fill();
  orb(ctx, glow, x, y, r, '#FF9A3D', 'rgba(140, 30, 10, 0.95)', 'rgba(255, 140, 60, 0.95)', r * 2.4);
  ctx.fillStyle = 'rgba(60, 20, 10, 0.6)';
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + time * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawSpells(ctx, glow, match, time) {
  for (const s of match.strikes) {
    if (s.kind === 'lightning') lightning(ctx, glow, s, time);
    else meteor(ctx, glow, s, time);
  }
  for (const p of match.projectiles) {
    if (p.type === 'fireball') fireball(ctx, glow, p, time);
    else missile(ctx, glow, p, time);
  }
}
