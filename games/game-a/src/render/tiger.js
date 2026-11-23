// =============================================================
//  student (호랑이 킥복서) 그리기
//  무에타이 트렁크 + 팔에 묶은 붉은 끈(프라찌앗), 맨주먹, 맨발
// =============================================================

import { limbPath, shadedCapsule, shadedLimb, smoothClosed, toneOf, torsoPoint, shade, capsulePath } from './rig.js';
import { drawBrow, drawEye, drawFist, drawFoot } from './parts.js';

const RIM = 'rgba(160, 190, 255, 0.5)';

/** 팔다리 전체에 호랑이 줄무늬 (외곽선 안쪽으로 잘라서) */
function stripesOnLimb(ctx, limb, r, bulge, color, count) {
  ctx.save();
  limbPath(ctx, limb, r, bulge);
  ctx.clip();
  const segs = [[limb.origin, limb.mid, r[0], r[1]], [limb.mid, limb.end, r[1], r[2]]];
  segs.forEach(([a, b, ra, rb], si) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.7 + si * 0.3) / (count + 0.5);
      const rr = (ra + (rb - ra) * t) * 1.5;
      const cx = a[0] + dx * t;
      const cy = a[1] + dy * t;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * nx * rr - ux * 3.2, cy + side * ny * rr - uy * 3.2);
        ctx.quadraticCurveTo(cx + side * nx * rr * 0.35 + ux * 1.5, cy + side * ny * rr * 0.35 + uy * 1.5, cx + side * nx * rr * 0.1 + ux * 3, cy + side * ny * rr * 0.1 + uy * 3);
        ctx.lineTo(cx + side * nx * rr + ux * 3.2, cy + side * ny * rr + uy * 3.2);
        ctx.closePath();
        ctx.fill();
      }
    }
  });
  ctx.restore();
}

/** 팔다리에 호랑이 줄무늬 (한 마디) */
function limbStripes(ctx, a, b, ra, rb, color, count, offset = 0) {
  ctx.save();
  capsulePath(ctx, a, b, ra, rb);
  ctx.clip();
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.6 + offset) / (count + 0.4);
    const r = ra + (rb - ra) * t;
    const cx = a[0] + dx * t;
    const cy = a[1] + dy * t;
    for (const side of [-1, 1]) {
      // 가장자리에서 안쪽으로 들어가는 뾰족한 줄
      ctx.beginPath();
      ctx.moveTo(cx + side * nx * r * 1.1 - (dx / len) * 3, cy + side * ny * r * 1.1 - (dy / len) * 3);
      ctx.lineTo(cx + side * nx * r * 0.15, cy + side * ny * r * 0.15);
      ctx.lineTo(cx + side * nx * r * 1.1 + (dx / len) * 3, cy + side * ny * r * 1.1 + (dy / len) * 3);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function tail(ctx, j, p, time) {
  const base = torsoPoint(j, 6, -20);
  const wave = Math.sin(time * 2.6) * 10;
  const pts = [base, [base[0] - 34, base[1] + 18], [base[0] - 62, base[1] + 4 + wave * 0.4], [base[0] - 70 + wave * 0.5, base[1] - 30 + wave]];
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.bezierCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1], pts[3][0], pts[3][1]);
  };
  path();
  ctx.strokeStyle = shade(p.fur, -0.6);
  ctx.lineWidth = 12.5;
  ctx.stroke();
  path();
  ctx.strokeStyle = shade(p.fur, -0.12);
  ctx.lineWidth = 10;
  ctx.stroke();
  path();
  ctx.setLineDash([4, 9]);
  ctx.strokeStyle = p.stripe;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = p.stripe;
  ctx.beginPath();
  ctx.arc(pts[3][0], pts[3][1], 5.5, 0, Math.PI * 2);
  ctx.fill();
}

function arm(ctx, limb, p, bulk, far) {
  const tone = toneOf(p.fur, { light: p.furLight, dark: p.furDark, rim: RIM, far });
  const r1 = 10.5 * bulk;
  const r = [r1, 8.2 * bulk, 7 * bulk];
  const bulge = { upper: [1.5, 2.8], lower: [2.2, 0.8] };
  shadedLimb(ctx, limb, r, tone, bulge);
  stripesOnLimb(ctx, limb, r, bulge, p.stripe, 2);
  // 프라찌앗 (위팔에 묶은 끈)
  const t = 0.42;
  const bx = limb.origin[0] + (limb.mid[0] - limb.origin[0]) * t;
  const by = limb.origin[1] + (limb.mid[1] - limb.origin[1]) * t;
  const ang = Math.atan2(limb.mid[1] - limb.origin[1], limb.mid[0] - limb.origin[0]);
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(ang);
  ctx.fillStyle = far ? shade(p.band, -0.3) : p.band;
  ctx.fillRect(-3, -r1 * 1.02, 6, r1 * 2.04);
  ctx.fillStyle = p.trim;
  ctx.fillRect(-0.8, -r1 * 1.02, 1.6, r1 * 2.04);
  if (!far) {
    // 매듭 끝이 펄럭임
    ctx.fillStyle = p.band;
    ctx.beginPath();
    ctx.moveTo(0, r1);
    ctx.lineTo(-7, r1 + 9);
    ctx.lineTo(-1, r1 + 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const fistTone = toneOf(p.fur, { light: p.furLight, dark: p.furDark, far });
  drawFist(ctx, limb, 8.6 * bulk, fistTone, { knuckle: far ? shade(p.white, -0.3) : p.white });
}

function leg(ctx, limb, p, bulk, far) {
  const tone = toneOf(p.fur, { light: p.furLight, dark: p.furDark, rim: RIM, far });
  const r1 = 13 * bulk;
  const r = [r1, 9.4 * bulk, 6.6 * bulk];
  const bulge = { upper: [2, 3], lower: [3.6, 0] };
  shadedLimb(ctx, limb, r, tone, bulge);
  stripesOnLimb(ctx, limb, r, bulge, p.stripe, 3);
  drawFoot(ctx, limb, 24, toneOf(p.fur, { light: p.furLight, dark: p.furDark, far }), { paw: true });
  // 트렁크 다리 부분 (헐렁한 무에타이 트렁크)
  const t = 0.48;
  const k = [limb.origin[0] + (limb.mid[0] - limb.origin[0]) * t, limb.origin[1] + (limb.mid[1] - limb.origin[1]) * t];
  const trunk = toneOf(p.trunks, { dark: p.trunksDark, rim: RIM, far });
  shadedCapsule(ctx, limb.origin, k, r1 + 2.5, r1 + 4, trunk);
  // 밑단 금색 줄
  ctx.save();
  capsulePath(ctx, limb.origin, k, r1 + 2.5, r1 + 4);
  ctx.clip();
  ctx.strokeStyle = far ? shade(p.trim, -0.3) : p.trim;
  ctx.lineWidth = 3;
  const ang = Math.atan2(k[1] - limb.origin[1], k[0] - limb.origin[0]);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  ctx.beginPath();
  ctx.moveTo(k[0] + nx * (r1 + 6) - Math.cos(ang) * 3, k[1] + ny * (r1 + 6) - Math.sin(ang) * 3);
  ctx.lineTo(k[0] - nx * (r1 + 6) - Math.cos(ang) * 3, k[1] - ny * (r1 + 6) - Math.sin(ang) * 3);
  ctx.stroke();
  ctx.restore();
}

function torso(ctx, j, p, bulk) {
  const b = bulk;
  const pts = [
    [2, -20 * b], [24, -16 * b], [46, -19 * b], [64, -16 * b], [76, -5 * b],
    [74, 11 * b], [60, 22 * b], [44, 18 * b], [26, 15 * b], [6, 17 * b],
  ].map(([u, v]) => torsoPoint(j, u, v));
  smoothClosed(ctx, pts);
  const top = torsoPoint(j, 68, 8);
  const g = ctx.createRadialGradient(top[0], top[1], 4, top[0], top[1], 95);
  g.addColorStop(0, p.furLight);
  g.addColorStop(0.45, p.fur);
  g.addColorStop(1, p.furDark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = shade(p.fur, -0.62);
  ctx.stroke();

  ctx.save();
  ctx.clip();
  // 흰 가슴/배 털
  const belly = [[6, 6], [30, 6], [52, 10], [70, 6], [72, 30], [4, 30]].map(([u, v]) => torsoPoint(j, u, v * b));
  smoothClosed(ctx, belly);
  const wg = ctx.createLinearGradient(top[0], top[1], j.hip[0], j.hip[1]);
  wg.addColorStop(0, p.white);
  wg.addColorStop(1, p.whiteDark);
  ctx.fillStyle = wg;
  ctx.fill();
  // 근육 선 (가슴, 복근)
  ctx.strokeStyle = 'rgba(120, 70, 40, 0.35)';
  ctx.lineWidth = 1.4;
  const pec = [torsoPoint(j, 52, 8 * b), torsoPoint(j, 47, 16 * b), torsoPoint(j, 50, 22 * b)];
  ctx.beginPath();
  ctx.moveTo(pec[0][0], pec[0][1]);
  ctx.quadraticCurveTo(pec[1][0], pec[1][1], pec[2][0], pec[2][1]);
  ctx.stroke();
  for (const u of [22, 32, 41]) {
    const a = torsoPoint(j, u, 9 * b);
    const c = torsoPoint(j, u, 16 * b);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.stroke();
  }
  // 등 줄무늬
  ctx.fillStyle = p.stripe;
  for (const u of [18, 32, 46, 60]) {
    const a = torsoPoint(j, u - 3, -22 * b);
    const m = torsoPoint(j, u + 1, -6 * b);
    const c = torsoPoint(j, u + 4, -22 * b);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(m[0], m[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.fill();
  }
  // 림라이트
  const rimPts = [torsoPoint(j, 4, -21 * b), torsoPoint(j, 40, -20 * b), torsoPoint(j, 70, -14 * b)];
  ctx.strokeStyle = RIM;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(rimPts[0][0], rimPts[0][1]);
  ctx.quadraticCurveTo(rimPts[1][0], rimPts[1][1], rimPts[2][0], rimPts[2][1]);
  ctx.stroke();
  ctx.restore();
}

function trunks(ctx, j, p, bulk) {
  const b = bulk;
  const pts = [[-6, -21], [21, -20], [23, 0], [21, 19], [-6, 20], [-11, 0]].map(([u, v]) => torsoPoint(j, u, v * b));
  smoothClosed(ctx, pts);
  const g = ctx.createLinearGradient(...torsoPoint(j, 24, 0), ...torsoPoint(j, -12, 0));
  g.addColorStop(0, shade(p.trunks, 0.15));
  g.addColorStop(1, p.trunksDark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = shade(p.trunks, -0.6);
  ctx.stroke();
  // 금색 허리 밴드
  const ang = Math.atan2(j.up[0], -j.up[1]);
  const w = torsoPoint(j, 19, 0);
  ctx.save();
  ctx.translate(w[0], w[1]);
  ctx.rotate(ang);
  ctx.fillStyle = p.trim;
  ctx.beginPath();
  ctx.roundRect(-21 * b, -4, 42 * b, 8, 3);
  ctx.fill();
  ctx.fillStyle = shade(p.trim, -0.35);
  ctx.fillRect(-21 * b, 2, 42 * b, 2);
  // 옆면 글자
  ctx.font = `700 ${15 * b}px "Do Hyeon", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = p.trim;
  ctx.fillText('S', -2, 20);
  ctx.restore();
}

function head(ctx, j, p, expr) {
  const c = [j.neckTop[0] + j.headUp[0] * 20, j.neckTop[1] + j.headUp[1] * 20];
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.rotate(j.headAngle);
  const line = shade(p.fur, -0.62);

  // 볼 갈기 (흰 털, 뒤쪽 아래)
  ctx.beginPath();
  ctx.moveTo(-6, 6);
  ctx.lineTo(-30, 10);
  ctx.lineTo(-20, 14);
  ctx.lineTo(-32, 22);
  ctx.lineTo(-14, 22);
  ctx.lineTo(-20, 30);
  ctx.lineTo(4, 24);
  ctx.closePath();
  ctx.fillStyle = p.white;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = shade(p.white, -0.5);
  ctx.stroke();

  // 귀
  for (const [x, s] of [[-12, 0.85], [6, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x - 10 * s, -16);
    ctx.quadraticCurveTo(x - 9 * s, -36 * s, x + 2, -34 * s);
    ctx.quadraticCurveTo(x + 12 * s, -28 * s, x + 11 * s, -14);
    ctx.closePath();
    ctx.fillStyle = s < 1 ? p.furDark : p.fur;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x + 1, -24 * s, 4 * s, 6 * s, 0.1, 0, Math.PI * 2);
    ctx.fillStyle = p.stripe;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 1, -22 * s, 2.2 * s, 3.5 * s, 0.1, 0, Math.PI * 2);
    ctx.fillStyle = p.white;
    ctx.fill();
  }

  // 머리
  ctx.beginPath();
  ctx.ellipse(0, 0, 25, 24, 0, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(6, -10, 3, 0, 0, 30);
  g.addColorStop(0, p.furLight);
  g.addColorStop(0.55, p.fur);
  g.addColorStop(1, p.furDark);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 주둥이 (앞으로 튀어나온 흰 털)
  ctx.beginPath();
  ctx.moveTo(6, -2);
  ctx.quadraticCurveTo(30, -6, 31, 6);
  ctx.quadraticCurveTo(30, 20, 12, 20);
  ctx.quadraticCurveTo(2, 18, 2, 8);
  ctx.closePath();
  const mg = ctx.createLinearGradient(0, -4, 0, 20);
  mg.addColorStop(0, p.white);
  mg.addColorStop(1, p.whiteDark);
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.strokeStyle = shade(p.white, -0.55);
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // 줄무늬 (이마, 볼)
  ctx.fillStyle = p.stripe;
  for (const [x, y, w, h, r] of [[2, -23, 3, 10, 0.1], [-6, -21, 2.6, 9, -0.25], [10, -21, 2.6, 8, 0.4], [-20, -4, 7, 2.6, 0.2], [-19, 4, 6, 2.4, -0.1]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 코
  ctx.beginPath();
  ctx.moveTo(25, -1);
  ctx.quadraticCurveTo(33, -2, 32, 3);
  ctx.quadraticCurveTo(29, 7, 25, 4);
  ctx.closePath();
  ctx.fillStyle = '#3B1E1A';
  ctx.fill();

  // 입
  ctx.strokeStyle = '#3B1E1A';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  if (expr === 'shout' || expr === 'happy' || expr === 'strain') {
    ctx.beginPath();
    ctx.moveTo(27, 8);
    ctx.quadraticCurveTo(26, 19, 14, 17);
    ctx.quadraticCurveTo(16, 11, 27, 8);
    ctx.fillStyle = '#5A1220';
    ctx.fill();
    ctx.stroke();
    // 송곳니
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(24, 9);
    ctx.lineTo(22.5, 13);
    ctx.lineTo(21, 9.5);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(28, 5);
    ctx.lineTo(27, 10);
    ctx.quadraticCurveTo(22, 14, 16, 12);
    ctx.stroke();
  }
  // 수염
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 0.9;
  for (const dy of [-1, 3, 7]) {
    ctx.beginPath();
    ctx.moveTo(22, 6 + dy * 0.5);
    ctx.quadraticCurveTo(36, 2 + dy, 44, 4 + dy * 1.6);
    ctx.stroke();
  }

  // 눈 + 눈썹 무늬
  drawEye(ctx, 13, -6, 6.5, expr, { iris: p.eye, slit: true });
  drawBrow(ctx, 12, -15, 8, expr, p.stripe, 3.4);
  ctx.restore();
}

/** student 전체 (ctx는 발 기준점으로 이동 + 방향/키 배율이 적용된 상태) */
export function drawTiger(ctx, j, player, expr, time) {
  const p = player.palette;
  const bulk = player.bulk;
  ctx.lineJoin = 'round';
  tail(ctx, j, p, time);
  arm(ctx, j.armB, p, bulk, true);
  leg(ctx, j.legB, p, bulk, true);
  torso(ctx, j, p, bulk);
  trunks(ctx, j, p, bulk);
  leg(ctx, j.legF, p, bulk, false);
  head(ctx, j, p, expr);
  arm(ctx, j.armF, p, bulk, false);
}
