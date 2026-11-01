// =============================================================
//  캐릭터 뼈대 + 입체 도형 그리기 도우미
//
//  자세(pose) — 모두 "오른쪽을 보는" 기준
//    hipY  : 엉덩이 높이        dx   : 몸 전체 앞뒤 이동
//    lean  : 상체 기울기 (+앞)  head : 고개 기울기 (+숙임)
//    aF/aB : 앞팔/뒤팔 [어깨 각도, 팔꿈치 굽힘]
//    lF/lB : 앞다리/뒷다리 [엉덩이 각도, 무릎 굽힘] 또는 { foot: [x, y] } (무릎 자동 계산)
//    twist : 몸통 비틀기 (0~1, 펀치/킥 때 어깨가 앞으로 나옴)
//  각도 기준: 0 = 몸통 아래, +π/2 = 앞, π = 위
// =============================================================

export const BONES = {
  torso: 70,
  neck: 10,
  upper: 36,
  fore: 33,
  thigh: 44,
  shin: 42,
  hipSpread: 6,
};

const NUM_KEYS = ['hipY', 'dx', 'lean', 'head', 'twist', 'reachA', 'reachL'];
const LIMB_KEYS = ['aF', 'aB', 'lF', 'lB'];
const dir = (a) => [Math.sin(a), Math.cos(a)];

function solveLeg(hip, foot, lean, len1, len2) {
  const dx = foot[0] - hip[0];
  const dy = foot[1] - hip[1];
  const d = Math.max(1, Math.min(Math.hypot(dx, dy), len1 + len2 - 0.01));
  const base = Math.atan2(dx, dy);
  const cos = (len1 * len1 + d * d - len2 * len2) / (2 * len1 * d);
  const thigh = base + Math.acos(Math.max(-1, Math.min(1, cos)));
  const knee = [hip[0] + Math.sin(thigh) * len1, hip[1] + Math.cos(thigh) * len1];
  const shin = Math.atan2(foot[0] - knee[0], foot[1] - knee[1]);
  return [thigh + lean, thigh - shin];
}

/** 발 위치(IK)로 준 다리를 각도로 바꿔 완성된 자세로 */
export function resolvePose(pose, height = 1) {
  const out = { hipY: 80, dx: 0, lean: 0, head: 0, twist: 0, reachA: 1, reachL: 1, ...pose };
  for (const key of ['lF', 'lB']) {
    const leg = out[key];
    if (leg && !Array.isArray(leg)) {
      const side = key === 'lF' ? 1 : -1;
      const hip = [out.dx + side * BONES.hipSpread, -out.hipY];
      // 발 위치는 키에 맞춰 늘려줌 (선수마다 다리 길이가 다르므로 자세는 기준 키로 작성)
      out[key] = solveLeg(hip, [out.dx + leg.foot[0], leg.foot[1]], out.lean, BONES.thigh, BONES.shin);
    }
  }
  for (const key of LIMB_KEYS) if (!out[key]) out[key] = [0.2, 0.3];
  out.height = height;
  return out;
}

export function blendPose(current, target, t) {
  if (!current) return { ...target, aF: [...target.aF], aB: [...target.aB], lF: [...target.lF], lB: [...target.lB] };
  for (const key of NUM_KEYS) current[key] += (target[key] - current[key]) * t;
  for (const key of LIMB_KEYS) {
    current[key][0] += (target[key][0] - current[key][0]) * t;
    current[key][1] += (target[key][1] - current[key][1]) * t;
  }
  return current;
}

/** 자세 → 관절 좌표 (발 기준점이 원점, y 위쪽이 음수, 기준 키) */
export function computeJoints(pose) {
  const B = BONES;
  const hip = [pose.dx, -pose.hipY];
  const up = [Math.sin(pose.lean), -Math.cos(pose.lean)];
  const fwd = [-up[1], up[0]];
  const shoulder = [hip[0] + up[0] * B.torso, hip[1] + up[1] * B.torso];
  const headAngle = pose.lean + pose.head;
  const headUp = [Math.sin(headAngle), -Math.cos(headAngle)];
  const neckTop = [shoulder[0] + up[0] * B.neck, shoulder[1] + up[1] * B.neck];

  const limb = (origin, rel, len1, len2, stretch, bend) => {
    const a1 = -pose.lean + rel[0];
    const a2 = a1 + bend * rel[1];
    const d1 = dir(a1);
    const d2 = dir(a2);
    const mid = [origin[0] + d1[0] * len1 * stretch, origin[1] + d1[1] * len1 * stretch];
    const end = [mid[0] + d2[0] * len2 * stretch, mid[1] + d2[1] * len2 * stretch];
    return { origin, mid, end, a1, a2 };
  };
  // 비틀기: 앞 어깨가 앞으로, 뒤 어깨가 뒤로 (공격할 때 몸통 회전 느낌)
  const tw = (pose.twist ?? 0) * 10;
  const sF = [shoulder[0] + fwd[0] * (4 + tw), shoulder[1] + fwd[1] * (4 + tw) + 4];
  const sB = [shoulder[0] - fwd[0] * (6 - tw), shoulder[1] - fwd[1] * (6 - tw) + 2];
  return {
    hip,
    up,
    fwd,
    shoulder,
    neckTop,
    headUp,
    headAngle,
    armF: limb(sF, pose.aF, B.upper, B.fore, pose.reachA ?? 1, 1),
    armB: limb(sB, pose.aB, B.upper, B.fore, 1, 1),
    legF: limb([hip[0] + B.hipSpread, hip[1]], pose.lF, B.thigh, B.shin, pose.reachL ?? 1, -1),
    legB: limb([hip[0] - B.hipSpread, hip[1]], pose.lB, B.thigh, B.shin, 1, -1),
  };
}

// ---------------- 색 도우미 ----------------

function parse(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 색을 어둡게(-) / 밝게(+) */
export function shade(hex, amount) {
  const [r, g, b] = parse(hex);
  const f = (c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

export function rgba(hex, alpha) {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------- 입체 도형 ----------------

/** 양 끝 굵기가 다른 캡슐 경로 */
export function capsulePath(ctx, a, b, ra, rb) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.beginPath();
  ctx.arc(a[0], a[1], ra, ang + Math.PI / 2, ang + (Math.PI * 3) / 2);
  ctx.arc(b[0], b[1], rb, ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
}

/**
 * 원통처럼 음영이 들어간 팔다리 한 마디
 * @param tone { light, base, dark, line, rim }
 */
export function shadedCapsule(ctx, a, b, ra, rb, tone) {
  capsulePath(ctx, a, b, ra, rb);
  // 빛은 위에서 → 위를 향한 쪽이 밝음
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const r = Math.max(ra, rb);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const g = ctx.createLinearGradient(mx + nx * r, my + ny * r, mx - nx * r, my - ny * r);
  g.addColorStop(0, tone.light);
  g.addColorStop(0.42, tone.base);
  g.addColorStop(1, tone.dark);
  ctx.fillStyle = g;
  ctx.fill();
  if (tone.line) {
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = tone.line;
    ctx.stroke();
  }
  // 림라이트 (아래/뒤쪽 가장자리에 스테인드글라스 빛)
  if (tone.rim) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = tone.rim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a[0] - nx * (ra - 1.5), a[1] - ny * (ra - 1.5));
    ctx.lineTo(b[0] - nx * (rb - 1.5), b[1] - ny * (rb - 1.5));
    ctx.stroke();
    ctx.restore();
  }
}

/** 팔레트 색 하나로 음영 세트 만들기 */
export function toneOf(base, { light = null, dark = null, rim = 'rgba(150, 190, 255, 0.45)', far = false } = {}) {
  const k = far ? -0.28 : 0;
  return {
    light: light ? shade(light, k) : shade(base, 0.22 + k),
    base: shade(base, k),
    dark: dark ? shade(dark, k) : shade(base, -0.38 + k),
    line: shade(base, -0.62 + k),
    rim: far ? null : rim,
  };
}

/** 몸통 좌표계 (u: 척추 방향, v: 앞쪽) → 좌표 */
export function torsoPoint(j, u, v) {
  return [j.hip[0] + j.up[0] * u + j.fwd[0] * v, j.hip[1] + j.up[1] * u + j.fwd[1] * v];
}

/** 점들을 부드러운 닫힌 곡선으로 */
export function smoothClosed(ctx, pts) {
  ctx.beginPath();
  const n = pts.length;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let m = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    m = mid(p, q);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

// ---------------- 유기적인 팔다리 (근육 굴곡이 있는 한 덩어리) ----------------

const norm = (v) => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * 팔/다리 외곽선 경로 만들기 (윗마디 + 아랫마디 + 관절을 하나로)
 * @param r       [시작 굵기, 관절 굵기, 끝 굵기]
 * @param bulge   { upper: [+쪽, -쪽], lower: [+쪽, -쪽] } 근육이 불룩한 정도
 *                (+쪽 = 팔다리를 아래로 내렸을 때 뒤쪽, -쪽 = 앞쪽)
 */
export function limbPath(ctx, limb, r, bulge = {}) {
  const a = limb.origin;
  const m = limb.mid;
  const e = limb.end;
  const d1 = norm([m[0] - a[0], m[1] - a[1]]);
  const d2 = norm([e[0] - m[0], e[1] - m[1]]);
  const n1 = [-d1[1], d1[0]];
  const n2 = [-d2[1], d2[0]];
  const nm = norm([n1[0] + n2[0], n1[1] + n2[1]]);
  const up = bulge.upper ?? [0, 0];
  const lo = bulge.lower ?? [0, 0];
  const side = (s) => {
    const k = s > 0 ? 0 : 1;
    const ru = (r[0] + r[1]) / 2 + up[k];
    const rl = (r[1] + r[2]) / 2 + lo[k];
    const pu = lerp2(a, m, 0.45);
    const pl = lerp2(m, e, 0.35);
    return [
      [a[0] + n1[0] * r[0] * s, a[1] + n1[1] * r[0] * s],
      [pu[0] + n1[0] * ru * s, pu[1] + n1[1] * ru * s],
      [m[0] + nm[0] * r[1] * s, m[1] + nm[1] * r[1] * s],
      [pl[0] + n2[0] * rl * s, pl[1] + n2[1] * rl * s],
      [e[0] + n2[0] * r[2] * s, e[1] + n2[1] * r[2] * s],
    ];
  };
  const plus = side(1);
  const minus = side(-1).reverse();
  const capEnd = [e[0] + d2[0] * r[2] * 0.9, e[1] + d2[1] * r[2] * 0.9];
  const capStart = [a[0] - d1[0] * r[0] * 0.9, a[1] - d1[1] * r[0] * 0.9];
  smoothClosed(ctx, [...plus, capEnd, ...minus, capStart]);
  return { plus, minus };
}

/** 음영이 들어간 유기적인 팔다리 */
export function shadedLimb(ctx, limb, r, tone, bulge) {
  const edges = limbPath(ctx, limb, r, bulge);
  const a = limb.origin;
  const e = limb.end;
  const d = norm([e[0] - a[0], e[1] - a[1]]);
  let n = [-d[1], d[0]];
  if (n[1] > 0) n = [-n[0], -n[1]];
  const R = Math.max(...r) * 1.3;
  const c = lerp2(a, e, 0.5);
  const g = ctx.createLinearGradient(c[0] + n[0] * R, c[1] + n[1] * R, c[0] - n[0] * R, c[1] - n[1] * R);
  g.addColorStop(0, tone.light);
  g.addColorStop(0.45, tone.base);
  g.addColorStop(1, tone.dark);
  ctx.fillStyle = g;
  ctx.fill();
  if (tone.line) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = tone.line;
    ctx.stroke();
  }
  if (tone.rim) {
    // 아래쪽(어두운 쪽) 가장자리를 따라 림라이트
    const lowSide = edges.plus[2][1] > edges.minus[2][1] ? edges.plus : [...edges.minus].reverse();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = tone.rim;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(lowSide[0][0], lowSide[0][1]);
    for (let i = 1; i < lowSide.length; i++) ctx.lineTo(lowSide[i][0], lowSide[i][1]);
    ctx.stroke();
    ctx.restore();
  }
}
