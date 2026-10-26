// =============================================================
//  파이터 그리기 (사람, 옆모습, 캔버스)
//
//  1) computePose(): 상태(펀치, 킥, 가드...)에 따라 손과 발이 갈 위치를 정하고
//  2) solveJoint(): 위팔/아래팔, 허벅지/정강이의 실제 길이로 팔꿈치·무릎 위치를 계산
//     → 팔다리가 늘어나지 않고, 팔꿈치는 아래로, 무릎은 앞으로만 굽습니다.
//  3) drawFighter(): 뒤쪽 팔 → 뒤쪽 다리 → 몸통 → 앞쪽 다리 → 머리 → 앞쪽 팔 순서로 그림
//
//  좌표는 발 사이 바닥이 (0, 0)이고 위쪽이 음수입니다.
//  오른쪽을 보는 모습으로 그린 뒤, 왼쪽을 볼 때는 좌우를 뒤집습니다.
//  타이틀/결과 화면의 캐릭터 그림도 이 함수를 그대로 씁니다.
// =============================================================

import { ATTACKS } from '../config.js';

const OUTLINE = '#100c14';
const GLOVE = '#121216';

// ---- 몸 치수 (게임 좌표 px) ----
const BODY = {
  upperArm: 56,
  forearm: 54,
  thigh: 78,
  shin: 74,
  hipY: -150, // 골반 높이
  shoulderF: [12, -246], // 앞쪽 어깨
  shoulderB: [-12, -248], // 뒤쪽 어깨
  hipF: [8, -150],
  hipB: [-8, -150],
  head: [8, -294],
};

const lerp = (a, b, t) => a + (b - a) * t;
const lerpPt = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
const easeOut = (t) => 1 - (1 - t) ** 3;

// ---------------- 관절 계산 ----------------

/**
 * 두 마디(길이 a, b)로 start에서 target까지 닿게 할 때 가운데 관절 위치
 * bend: +1 / -1 로 굽는 쪽 선택
 * 닿지 않는 거리면 팔다리를 쭉 편 상태로 target 방향까지만 닿음 (늘어나지 않음)
 */
function solveJoint(start, target, a, b, bend) {
  let dx = target[0] - start[0];
  let dy = target[1] - start[1];
  let d = Math.hypot(dx, dy) || 0.0001;
  const maxReach = a + b - 0.5;
  const minReach = Math.abs(a - b) + 1;
  const clamped = Math.max(minReach, Math.min(maxReach, d));
  const ux = dx / d;
  const uy = dy / d;
  const end = [start[0] + ux * clamped, start[1] + uy * clamped];
  d = clamped;
  // 코사인 법칙으로 관절까지의 거리와 높이
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const nx = -uy * bend;
  const ny = ux * bend;
  const joint = [start[0] + ux * along + nx * h, start[1] + uy * along + ny * h];
  return { joint, end };
}

// 공격 진행도: 준비 0→1, 명중 구간 1, 회수 1→0
function attackExtension(f) {
  const a = ATTACKS[f.attack.type];
  const t = f.attack.t;
  if (t < a.startup) return { ext: easeOut(t / a.startup), phase: 'startup', k: t / a.startup };
  if (t < a.startup + a.active) return { ext: 1, phase: 'active', k: (t - a.startup) / a.active };
  const k = Math.min(1, (t - a.startup - a.active) / a.recovery);
  return { ext: 1 - easeOut(k), phase: 'recovery', k };
}

// ---------------- 자세 ----------------

// 기본 자세 (가드를 올린 파이팅 포즈)
const STANCE = {
  frontAnkle: [36, -12],
  backAnkle: [-38, -12],
  frontGlove: [54, -262],
  backGlove: [30, -270],
};

/** 상태에 따른 자세 계산 */
export function computePose(f, time) {
  const bob = Math.sin(time * 6.5) * 3; // 제자리에서 가볍게 들썩임
  const pose = {
    hipShiftX: 0, // 골반 앞뒤 이동
    hipDrop: 4 + bob, // 골반 내려감 (무릎 굽힘)
    lift: 0, // 몸 전체 띄우기 (점프)
    lean: 0.06, // 상체 기울기 (+ 앞으로)
    frontAnkle: [...STANCE.frontAnkle],
    backAnkle: [...STANCE.backAnkle],
    frontGlove: [...STANCE.frontGlove],
    backGlove: [...STANCE.backGlove],
    frontFootAngle: 0, // 발 방향 (0 = 앞)
    face: 'normal',
    rotateAll: 0,
    aura: 0,
    whoosh: 0,
    stars: false,
    sweat: f.tired > 0,
  };

  switch (f.state) {
    case 'walk': {
      const s = Math.sin(f.walkPhase);
      const c = Math.cos(f.walkPhase);
      pose.frontAnkle = [36 + s * 16, -12 - Math.max(0, c) * 9];
      pose.backAnkle = [-38 - s * 16, -12 - Math.max(0, -c) * 9];
      pose.hipDrop = 6 + Math.abs(s) * 3;
      break;
    }
    case 'guard':
    case 'block':
      pose.hipShiftX = f.state === 'block' ? -8 : -2;
      pose.hipDrop = 10;
      pose.lean = 0.02;
      pose.frontGlove = [36, -282];
      pose.backGlove = [24, -276];
      pose.face = 'fierce';
      break;
    case 'attack': {
      const { ext, phase, k } = attackExtension(f);
      pose.face = 'fierce';
      if (f.attack.type === 'punch') {
        // 앞손 스트레이트: 팔을 쭉 뻗고 상체를 앞으로
        pose.frontGlove = lerpPt(STANCE.frontGlove, [118, -258], ext);
        pose.backGlove = [26, -268];
        pose.lean = 0.06 + 0.12 * ext;
        pose.hipShiftX = 8 * ext;
      } else if (f.attack.type === 'kick') {
        // 미들 킥: 앞다리를 허리 높이로
        pose.frontAnkle = lerpPt(STANCE.frontAnkle, [128, -150], ext);
        pose.frontFootAngle = -0.2 * ext;
        pose.lean = 0.06 - 0.32 * ext;
        pose.hipShiftX = -6 * ext;
        pose.hipDrop = 4;
        pose.frontGlove = [30, -276];
        pose.backGlove = [12, -262];
        pose.whoosh = phase === 'active' ? 1 - k : 0;
      } else if (phase === 'startup') {
        // 필살기 준비: 몸을 웅크림
        pose.hipDrop = 4 + 16 * k;
        pose.lean = 0.06 + 0.12 * k;
        pose.frontGlove = [40, -248];
        pose.backGlove = [22, -252];
        pose.aura = 1;
      } else {
        // 필살기: 머리 높이 하이킥
        pose.frontAnkle = lerpPt(STANCE.frontAnkle, [116, -244], ext);
        pose.frontFootAngle = -0.5 * ext;
        pose.lean = 0.06 - 0.46 * ext;
        pose.hipShiftX = -10 * ext;
        pose.hipDrop = 2;
        pose.frontGlove = [26, -270];
        pose.backGlove = [-24, -282];
        pose.aura = phase === 'recovery' ? 1 - k : 1;
        pose.whoosh = phase === 'active' ? 1 : 0;
      }
      break;
    }
    case 'hit': {
      const k = Math.min(1, f.stateTime / 0.08);
      pose.lean = 0.06 - 0.3 * k;
      pose.hipShiftX = -12 * k;
      pose.hipDrop = 8;
      pose.frontGlove = [40, -236];
      pose.backGlove = [18, -228];
      pose.face = 'hurt';
      break;
    }
    case 'stun':
      pose.lean = Math.sin(time * 7) * 0.14;
      pose.hipShiftX = Math.sin(time * 7) * 6;
      pose.hipDrop = 12;
      pose.frontGlove = [36, -196];
      pose.backGlove = [16, -190];
      pose.face = 'dizzy';
      pose.stars = true;
      break;
    case 'ko': {
      const k = Math.min(1, f.stateTime / 0.55);
      pose.rotateAll = -(Math.PI / 2) * easeOut(k);
      pose.lift = k < 1 ? 0 : Math.abs(Math.sin(f.stateTime * 9)) * Math.max(0, 6 - f.stateTime * 6);
      pose.frontGlove = [60, -214];
      pose.backGlove = [30, -200];
      pose.face = 'ko';
      pose.stars = k >= 1;
      pose.hipDrop = 0;
      pose.lean = 0;
      break;
    }
    case 'win': {
      const hop = Math.abs(Math.sin(time * 6));
      pose.lift = hop * 14;
      pose.hipDrop = 2;
      pose.lean = -0.04;
      pose.frontGlove = [40, -352];
      pose.backGlove = [-26, -346];
      pose.face = 'happy';
      break;
    }
    case 'lose':
      pose.lean = 0.18;
      pose.hipDrop = 8;
      pose.frontGlove = [38, -196];
      pose.backGlove = [18, -190];
      pose.face = 'sad';
      break;
    default:
      break;
  }
  return pose;
}

// ---------------- 그리기 도구 ----------------

// 굵기가 a→b로 변하는 팔다리 한 마디의 모양 (extra만큼 두껍게 = 테두리용)
function segmentPath(ctx, p, q, wa, wb, extra) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d;
  const ny = dx / d;
  const ra = wa / 2 + extra;
  const rb = wb / 2 + extra;
  ctx.moveTo(p[0] + nx * ra, p[1] + ny * ra);
  ctx.lineTo(q[0] + nx * rb, q[1] + ny * rb);
  // 끝을 둥글게: 끝점 쪽은 앞으로, 시작점 쪽은 뒤로 돌아가는 반원
  ctx.arc(q[0], q[1], rb, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true);
  ctx.lineTo(p[0] - nx * ra, p[1] - ny * ra);
  ctx.arc(p[0], p[1], ra, Math.atan2(-ny, -nx), Math.atan2(ny, nx), true);
  ctx.closePath();
}

// 여러 마디를 한 번에 그리기: 테두리를 먼저 모두 그리고 색을 나중에 칠해서
// 관절(무릎, 팔꿈치)에 검은 이음매가 생기지 않게 함
//   parts: [[시작점, 끝점, 시작 굵기, 끝 굵기], ...]
function limbParts(ctx, parts, color) {
  ctx.beginPath();
  for (const [p, q, wa, wb] of parts) segmentPath(ctx, p, q, wa, wb, 2.5);
  ctx.fillStyle = OUTLINE;
  ctx.fill('nonzero');
  ctx.beginPath();
  for (const [p, q, wa, wb] of parts) segmentPath(ctx, p, q, wa, wb, 0);
  ctx.fillStyle = color;
  ctx.fill('nonzero');
}

// 마디 하나 (테두리 포함)
function segment(ctx, p, q, wa, wb, color) {
  limbParts(ctx, [[p, q, wa, wb]], color);
}

function ellipse(ctx, x, y, rx, ry, rot, fill, stroke = OUTLINE, lineWidth = 2.5) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

// 다리 하나: 허벅지(트렁크) → 무릎 → 정강이 → 발목 테이프 → 발
function drawLeg(ctx, hip, ankleTarget, footAngle, colors, isFront) {
  const { joint: knee, end: ankle } = solveJoint(hip, ankleTarget, BODY.thigh, BODY.shin, -1);
  const skin = isFront ? colors.skin : colors.skinShade;

  limbParts(ctx, [
    [hip, knee, 33, 25], // 허벅지
    [knee, ankle, 25, 17], // 정강이
  ], skin);
  // 트렁크 다리 부분 (허벅지 위쪽 절반)
  const mid = lerpPt(hip, knee, 0.5);
  segment(ctx, hip, mid, 40, 36, isFront ? colors.trunks : colors.trunksShade);

  // 발 (발목에서 발끝 방향으로)
  const shinAng = Math.atan2(ankle[1] - knee[1], ankle[0] - knee[0]);
  const standing = Math.abs(footAngle) < 0.01 && ankle[1] > -40;
  const ang = standing ? 0 : shinAng - Math.PI / 2 + footAngle; // 차는 발은 발등이 앞으로
  ctx.save();
  ctx.translate(ankle[0], ankle[1]);
  ctx.rotate(ang);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.roundRect(-11, -4, 40, 17, 8);
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.roundRect(-8.5, -1.5, 35, 12, 6);
  ctx.fill();
  ctx.restore();
  // 발목 테이프
  ctx.save();
  ctx.translate(ankle[0], ankle[1]);
  ctx.rotate(shinAng);
  ctx.fillStyle = colors.tape;
  ctx.fillRect(-12, -9, 10, 18);
  ctx.restore();
}

// 팔 하나: 위팔 → 팔꿈치 → 아래팔 → 손목 테이프 → 검은 글러브
function drawArm(ctx, shoulder, gloveTarget, colors, isFront) {
  const { joint: elbow, end: wrist } = solveJoint(shoulder, gloveTarget, BODY.upperArm, BODY.forearm, 1);
  const skin = isFront ? colors.skin : colors.skinShade;
  limbParts(ctx, [
    [shoulder, elbow, 25, 19], // 위팔
    [elbow, wrist, 19, 16], // 아래팔
  ], skin);

  const ang = Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0]);
  // 손목 테이프
  ctx.save();
  ctx.translate(wrist[0], wrist[1]);
  ctx.rotate(ang);
  ctx.fillStyle = colors.tape;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-14, -10, 12, 20, 3);
  ctx.fill();
  ctx.stroke();

  // 글러브 (검은색 + 테두리 빛 + 광택)
  const g = colors.flash ? '#ffffff' : GLOVE;
  ellipse(ctx, 10, 0, 21, 18, 0, g, '#000000', 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(10, 0, 22.5, 19.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ellipse(ctx, 4, -14, 9, 6, 0.2, g, '#000000', 2.5); // 엄지
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(12, -7, 8, 4, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(15, -8, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 몸통 (어깨 ~ 허리). 오른쪽이 가슴 쪽
function drawTorso(ctx, colors) {
  ctx.beginPath();
  ctx.moveTo(-6, -262); // 목 뒤
  ctx.quadraticCurveTo(-30, -256, -28, -232); // 등 위
  ctx.quadraticCurveTo(-30, -196, -20, -160); // 등 아래
  ctx.lineTo(18, -158); // 허리 앞
  ctx.quadraticCurveTo(30, -192, 30, -214); // 배
  ctx.quadraticCurveTo(34, -246, 12, -262); // 가슴 → 어깨
  ctx.closePath();
  ctx.fillStyle = colors.skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // 근육 음영 (가슴선, 복근)
  ctx.strokeStyle = 'rgba(80,40,20,0.28)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4, -222);
  ctx.quadraticCurveTo(18, -214, 28, -218);
  ctx.moveTo(14, -202);
  ctx.lineTo(14, -168);
  ctx.moveTo(6, -192);
  ctx.lineTo(24, -192);
  ctx.moveTo(6, -178);
  ctx.lineTo(23, -178);
  ctx.stroke();
}

function drawHair(ctx, style, hx, hy, colors) {
  ctx.fillStyle = colors.hair;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (style === 'spiky') {
    ctx.moveTo(hx - 24, hy + 4);
    ctx.lineTo(hx - 32, hy - 10);
    ctx.lineTo(hx - 24, hy - 14);
    ctx.lineTo(hx - 32, hy - 28);
    ctx.lineTo(hx - 18, hy - 28);
    ctx.lineTo(hx - 20, hy - 42);
    ctx.lineTo(hx - 6, hy - 32);
    ctx.lineTo(hx - 2, hy - 46);
    ctx.lineTo(hx + 8, hy - 32);
    ctx.lineTo(hx + 16, hy - 42);
    ctx.lineTo(hx + 18, hy - 27);
    ctx.lineTo(hx + 28, hy - 30);
    ctx.lineTo(hx + 24, hy - 16);
    ctx.quadraticCurveTo(hx, hy - 22, hx - 10, hy - 10);
    ctx.lineTo(hx - 14, hy + 4);
  } else {
    ctx.moveTo(hx - 24, hy + 6);
    ctx.quadraticCurveTo(hx - 30, hy - 26, hx - 4, hy - 31);
    ctx.quadraticCurveTo(hx + 22, hy - 32, hx + 25, hy - 14);
    ctx.quadraticCurveTo(hx + 4, hy - 20, hx - 8, hy - 12);
    ctx.lineTo(hx - 12, hy + 6);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawFace(ctx, hx, hy, pose, colors) {
  const ex1 = hx + 8;
  const ex2 = hx + 18;
  const ey = hy - 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.fillStyle = OUTLINE;
  ctx.lineWidth = 2.5;

  // 코
  ctx.beginPath();
  ctx.moveTo(hx + 22, hy - 2);
  ctx.quadraticCurveTo(hx + 28, hy + 7, hx + 21, hy + 8);
  ctx.stroke();

  const eyes = (fn) => {
    fn(ex1, ey);
    fn(ex2, ey);
  };

  switch (pose.face) {
    case 'hurt':
      eyes((x, y) => {
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 3);
        ctx.lineTo(x + 2, y);
        ctx.lineTo(x - 4, y + 3);
        ctx.stroke();
      });
      ellipse(ctx, hx + 15, hy + 15, 4, 4.5, 0, '#5a1a1a', null);
      break;
    case 'dizzy':
      eyes((x, y) => {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 1.6);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(hx + 10, hy + 15);
      ctx.quadraticCurveTo(hx + 15, hy + 11, hx + 20, hy + 15);
      ctx.stroke();
      break;
    case 'ko':
      eyes((x, y) => {
        ctx.beginPath();
        ctx.moveTo(x - 3.5, y - 3.5);
        ctx.lineTo(x + 3.5, y + 3.5);
        ctx.moveTo(x + 3.5, y - 3.5);
        ctx.lineTo(x - 3.5, y + 3.5);
        ctx.stroke();
      });
      ellipse(ctx, hx + 15, hy + 15, 4, 3, 0, '#5a1a1a', null);
      break;
    case 'happy':
      eyes((x, y) => {
        ctx.beginPath();
        ctx.arc(x, y + 2, 4, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(hx + 8, hy + 11);
      ctx.quadraticCurveTo(hx + 16, hy + 22, hx + 23, hy + 11);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
      break;
    case 'sad':
      eyes((x, y) => {
        ctx.beginPath();
        ctx.moveTo(x - 4, y + 1);
        ctx.lineTo(x + 3, y + 1);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(hx + 9, hy + 17);
      ctx.quadraticCurveTo(hx + 15, hy + 12, hx + 21, hy + 17);
      ctx.stroke();
      break;
    default:
      // 눈 + 눈썹
      eyes((x, y) => {
        ellipse(ctx, x, y, 2.8, 3.6, 0, OUTLINE, null);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x + 1, y - 1.2, 1, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (pose.face === 'fierce') {
        ctx.moveTo(ex1 - 5, ey - 9);
        ctx.lineTo(ex1 + 3, ey - 6);
        ctx.moveTo(ex2 - 3, ey - 6);
        ctx.lineTo(ex2 + 5, ey - 9);
      } else {
        ctx.moveTo(ex1 - 4, ey - 8);
        ctx.lineTo(ex1 + 3, ey - 8);
        ctx.moveTo(ex2 - 3, ey - 8);
        ctx.lineTo(ex2 + 4, ey - 8);
      }
      ctx.stroke();
      // 입 (집중할 때는 마우스피스)
      if (pose.face === 'fierce') {
        ctx.fillStyle = colors.tape;
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(hx + 9, hy + 11, 13, 6, 3);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(hx + 10, hy + 14);
        ctx.lineTo(hx + 19, hy + 13);
        ctx.stroke();
      }
  }
}

// 머리: 목 → 얼굴 → 귀 → 머리카락 → 헤드밴드(+리본) → 표정
function drawHead(ctx, pose, colors, hairStyle, time) {
  const [hx, hy] = BODY.head;
  segment(ctx, [2, -256], [4, -276], 20, 20, colors.skinShade); // 목

  // 헤드밴드 리본 (머리 뒤로 날림)
  const wave = Math.sin(time * 9) * 4;
  ctx.lineCap = 'round';
  for (const [w, c] of [
    [11, OUTLINE],
    [7, colors.tape],
  ]) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(hx - 20, hy - 14);
    ctx.quadraticCurveTo(hx - 38, hy - 20 + wave, hx - 56, hy - 8 - wave);
    ctx.moveTo(hx - 20, hy - 12);
    ctx.quadraticCurveTo(hx - 36, hy - 2 - wave, hx - 50, hy + 8 + wave);
    ctx.stroke();
  }

  // 얼굴 (턱이 앞으로 살짝 나온 옆모습)
  ctx.beginPath();
  ctx.moveTo(hx - 20, hy + 10);
  ctx.quadraticCurveTo(hx - 26, hy - 30, hx + 2, hy - 28);
  ctx.quadraticCurveTo(hx + 26, hy - 26, hx + 24, hy + 2);
  ctx.quadraticCurveTo(hx + 24, hy + 22, hx + 12, hy + 24);
  ctx.quadraticCurveTo(hx - 10, hy + 26, hx - 20, hy + 10);
  ctx.closePath();
  ctx.fillStyle = colors.skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ellipse(ctx, hx - 8, hy + 2, 5, 7, 0, colors.skinShade); // 귀
  drawHair(ctx, hairStyle, hx, hy, colors);

  // 이마 헤드밴드
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(hx - 20, hy + 10);
  ctx.quadraticCurveTo(hx - 26, hy - 30, hx + 2, hy - 28);
  ctx.quadraticCurveTo(hx + 26, hy - 26, hx + 24, hy + 2);
  ctx.lineTo(hx - 20, hy + 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = colors.tape;
  ctx.fillRect(hx - 30, hy - 19, 60, 8);
  ctx.restore();

  drawFace(ctx, hx, hy, pose, colors);
}

function drawStars(ctx, hx, hy, time) {
  for (let i = 0; i < 3; i++) {
    const a = time * 4 + (i * Math.PI * 2) / 3;
    const x = hx + Math.cos(a) * 36;
    const y = hy - 42 + Math.sin(a) * 9;
    ctx.fillStyle = '#ffd45e';
    ctx.beginPath();
    for (let j = 0; j < 10; j++) {
      const r = j % 2 === 0 ? 9 : 3.5;
      const t = (j / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * 파이터 한 명 그리기
 * @param ctx      캔버스 컨텍스트
 * @param f        파이터 상태 (x, facing, state, attack, flash ...)
 * @param player   config.js의 PLAYERS 항목
 * @param time     애니메이션용 시간(초)
 * @param floorY   바닥 높이
 */
export function drawFighter(ctx, f, player, time, floorY) {
  const pose = computePose(f, time);
  const flash = f.flash > 0;
  const colors = {
    flash,
    skin: flash ? '#ffffff' : player.skin,
    skinShade: flash ? '#f2f2f2' : player.skinShade,
    hair: flash ? '#ffffff' : player.hair,
    trunks: flash ? '#ffffff' : player.color,
    trunksShade: flash ? '#f2f2f2' : player.colorDeep,
    tape: flash ? '#ffffff' : player.color,
  };

  ctx.save();
  ctx.translate(f.x, floorY);

  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  if (pose.rotateAll) {
    const k = Math.min(1, -pose.rotateAll / (Math.PI / 2));
    ctx.ellipse(-f.facing * 140 * k, 4, 60 + 90 * k, 12, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(0, 4, 66, 12, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.scale(f.facing, 1);
  ctx.translate(0, -pose.lift);
  if (pose.rotateAll) {
    // 뒤로 쓰러짐 (발을 축으로 회전)
    ctx.translate(-10, -14);
    ctx.rotate(pose.rotateAll);
    ctx.translate(10, 14);
  }

  // 필살기 기운
  if (pose.aura > 0) {
    const g = ctx.createRadialGradient(0, -190, 20, 0, -190, 210);
    g.addColorStop(0, `${player.color}99`);
    g.addColorStop(1, `${player.color}00`);
    ctx.globalAlpha = pose.aura * (0.75 + Math.sin(time * 30) * 0.25);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -190, 210, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 발차기 잔상
  if (pose.whoosh > 0) {
    ctx.strokeStyle = `rgba(255,255,255,${0.4 * pose.whoosh})`;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(8, -150, 140, Math.PI * 0.45, Math.PI * 1.75, true);
    ctx.stroke();
  }

  // 골반 위치 (몸 전체 기준점)
  const hipX = pose.hipShiftX;
  const hipY = pose.hipDrop;
  const hipF = [BODY.hipF[0] + hipX, BODY.hipF[1] + hipY];
  const hipB = [BODY.hipB[0] + hipX, BODY.hipB[1] + hipY];

  // 상체 좌표계: 골반 중심을 축으로 lean 만큼 기울임
  const upper = (fn) => {
    ctx.save();
    ctx.translate(hipX, BODY.hipY + hipY);
    ctx.rotate(pose.lean);
    ctx.translate(0, -BODY.hipY);
    fn();
    ctx.restore();
  };

  // 1) 뒤쪽 팔
  upper(() => drawArm(ctx, BODY.shoulderB, pose.backGlove, colors, false));
  // 2) 뒤쪽 다리
  drawLeg(ctx, hipB, pose.backAnkle, 0, colors, false);
  // 3) 몸통
  upper(() => drawTorso(ctx, colors));
  // 4) 앞쪽 다리
  drawLeg(ctx, hipF, pose.frontAnkle, pose.frontFootAngle, colors, true);
  // 5) 트렁크 허리 (흰 허리띠)
  ctx.save();
  ctx.translate(hipX, BODY.hipY + hipY);
  ctx.rotate(pose.lean * 0.5);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.roundRect(-26, -16, 52, 32, 10);
  ctx.fill();
  ctx.fillStyle = colors.trunks;
  ctx.beginPath();
  ctx.roundRect(-23.5, -13.5, 47, 27, 8);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-23.5, -13.5, 47, 6);
  ctx.restore();
  // 6) 머리 + 앞쪽 팔
  upper(() => {
    drawHead(ctx, pose, colors, player.hairStyle, time);
    if (pose.sweat) {
      ellipse(ctx, BODY.head[0] - 24, BODY.head[1] - 18 + ((time * 40) % 14), 3.5, 6, 0, '#8fd3ff', OUTLINE, 1.5);
    }
    drawArm(ctx, BODY.shoulderF, pose.frontGlove, colors, true);
    if (pose.stars) drawStars(ctx, BODY.head[0], BODY.head[1], time);
  });

  ctx.restore();
}
