// =============================================================
//  공통 부위 그리기: 맨손 주먹, 맨발, 눈
// =============================================================

import { shade } from './rig.js';

/** 맨주먹 (손가락 마디가 보이는 옆모습) */
export function drawFist(ctx, limb, r, colors, { knuckle = null, glow = null } = {}) {
  const [x, y] = limb.end;
  const ang = Math.atan2(limb.end[1] - limb.mid[1], limb.end[0] - limb.mid[0]);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  // 손등 + 주먹 덩어리
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, colors.light);
  g.addColorStop(0.5, colors.base);
  g.addColorStop(1, colors.dark);
  ctx.beginPath();
  ctx.roundRect(-r * 0.9, -r * 0.95, r * 2.0, r * 1.9, r * 0.75);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colors.line;
  ctx.stroke();
  // 손가락 마디 선
  ctx.strokeStyle = shade(colors.base, -0.35);
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const yy = -r * 0.45 + i * r * 0.45;
    ctx.beginPath();
    ctx.moveTo(r * 0.55, yy);
    ctx.lineTo(r * 1.0, yy);
    ctx.stroke();
  }
  // 엄지
  ctx.beginPath();
  ctx.ellipse(r * 0.2, r * 0.62, r * 0.55, r * 0.32, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = colors.base;
  ctx.fill();
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 주먹 앞쪽 마디 (호랑이는 흰 털, 교수는 빛나는 룬)
  if (knuckle) {
    ctx.beginPath();
    ctx.roundRect(r * 0.75, -r * 0.8, r * 0.38, r * 1.5, r * 0.2);
    ctx.fillStyle = knuckle;
    ctx.fill();
  }
  ctx.restore();
  if (glow) {
    glow.ctx.save();
    glow.ctx.translate(x, y);
    glow.ctx.fillStyle = glow.color;
    glow.ctx.beginPath();
    glow.ctx.arc(0, 0, r * 1.4, 0, Math.PI * 2);
    glow.ctx.fill();
    glow.ctx.restore();
  }
}

/** 맨발 (옆모습) */
export function drawFoot(ctx, limb, len, colors, { paw = false } = {}) {
  const [x, y] = limb.end;
  // 발은 정강이 방향과 상관없이 대체로 앞을 향하되, 다리를 차올리면 함께 돌아감
  const shinAng = Math.atan2(limb.end[1] - limb.mid[1], limb.end[0] - limb.mid[0]);
  const ang = shinAng - Math.PI / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const g = ctx.createLinearGradient(0, -6, 0, 8);
  g.addColorStop(0, colors.light);
  g.addColorStop(1, colors.dark);
  ctx.beginPath();
  ctx.moveTo(-7, -6);
  ctx.quadraticCurveTo(-10, 6, -4, 7);
  ctx.lineTo(len * 0.8, 7);
  ctx.quadraticCurveTo(len + 2, 6, len, 0);
  ctx.quadraticCurveTo(len * 0.7, -5, len * 0.3, -6);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colors.line;
  ctx.stroke();
  if (paw) {
    ctx.fillStyle = shade(colors.base, -0.3);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(len * 0.62 + i * 4.5, 5, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = shade(colors.base, -0.3);
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(len * 0.72 + i * 3.5, 6);
      ctx.lineTo(len * 0.72 + i * 3.5, 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * 옆모습 눈 (아몬드형)
 * expr: fierce | shout | ouch | dizzy | happy | sad | strain | tired
 */
export function drawEye(ctx, x, y, size, expr, { iris = '#E8F25A', slit = false, liner = '#1A0E08', glowCtx = null, glowColor = null } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.strokeStyle = liner;
  ctx.fillStyle = liner;
  if (expr === 'ouch' || expr === 'strain') {
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.5);
    ctx.lineTo(size * 0.6, 0);
    ctx.lineTo(-size, size * 0.5);
    ctx.stroke();
  } else if (expr === 'dizzy') {
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 4; a += 0.25) {
      const r = (a / (Math.PI * 4)) * size;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
  } else if (expr === 'happy') {
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, size * 0.4, size * 0.8, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else {
    const open = expr === 'tired' || expr === 'sad' ? 0.45 : expr === 'shout' ? 0.85 : 0.65;
    // 흰자
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.quadraticCurveTo(0, -size * open * 1.25, size, -size * 0.1);
    ctx.quadraticCurveTo(0, size * open * 1.05, -size, 0);
    ctx.closePath();
    ctx.fillStyle = slit ? iris : '#FBF7EE';
    ctx.fill();
    ctx.save();
    ctx.clip();
    // 홍채, 동공
    if (!slit) {
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.arc(size * 0.25, 0, size * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0B0605';
    ctx.beginPath();
    if (slit) ctx.ellipse(size * 0.25, 0, size * 0.16, size * 0.6, 0, 0, Math.PI * 2);
    else ctx.arc(size * 0.3, 0, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(size * 0.42, -size * 0.2, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = liner;
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.quadraticCurveTo(0, -size * open * 1.25, size, -size * 0.1);
    ctx.stroke();
  }
  ctx.restore();
  if (glowCtx && glowColor && expr !== 'dizzy' && expr !== 'happy') {
    glowCtx.fillStyle = glowColor;
    glowCtx.beginPath();
    glowCtx.arc(x + size * 0.25, y, size * 1.1, 0, Math.PI * 2);
    glowCtx.fill();
  }
}

/** 눈썹 (표정에 따라 각도) */
export function drawBrow(ctx, x, y, w, expr, color, thick) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = thick;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (expr === 'sad' || expr === 'tired' || expr === 'strain') {
    ctx.moveTo(x - w, y - 3);
    ctx.lineTo(x + w, y + 1);
  } else if (expr === 'happy' || expr === 'dizzy') {
    ctx.moveTo(x - w, y);
    ctx.quadraticCurveTo(x, y - 5, x + w, y - 1);
  } else {
    ctx.moveTo(x - w, y - 4);
    ctx.quadraticCurveTo(x, y - 2, x + w, y + 4);
  }
  ctx.stroke();
  ctx.restore();
}
