// =============================================================
//  유령 심판 — 선수들 뒤에 떠서 따라다님
//    fight: 손을 내리치며 시작 / count: 손가락으로 카운트 / stop: 두 팔을 흔들며 경기 종료
// =============================================================

import { STAGE } from '../config.js';

export function drawReferee(ctx, glow, ref, time, count = 0) {
  const bob = Math.sin(time * 2) * 6;
  const x = ref.x;
  const y = STAGE.floorY - 330 + bob;
  const t = ref.poseTime;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(0.78, 0.78);
  ctx.globalAlpha = 0.72;

  // 팔 각도 (0 = 아래, + = 위로)
  let left = 0.35;
  let right = 0.35;
  if (ref.pose === 'fight') {
    right = 2.6 - Math.min(1, t * 4) * 2.1;
    left = 0.5;
  } else if (ref.pose === 'separate') {
    left = 1.5;
    right = 1.5;
  } else if (ref.pose === 'stop') {
    const wave = Math.sin(t * 12) * 0.5;
    left = 2.5 + wave;
    right = 2.5 - wave;
  } else if (ref.pose === 'count') {
    const beat = (t * 1.333) % 1; // 카운트 박자
    right = 1.2 + Math.max(0, 1 - beat * 3) * 1.3;
    left = 0.4;
  } else {
    left = 0.35 + Math.sin(time * 2) * 0.08;
    right = 0.35 - Math.sin(time * 2) * 0.08;
  }

  // 은은한 빛
  if (glow) {
    glow.save();
    glow.globalAlpha = 0.12;
    glow.fillStyle = '#CFC6FF';
    glow.beginPath();
    glow.ellipse(x, y + 8, 36, 46, 0, 0, Math.PI * 2);
    glow.fill();
    glow.restore();
  }

  // 몸
  ctx.beginPath();
  ctx.moveTo(-32, 0);
  ctx.bezierCurveTo(-34, -58, 34, -58, 32, 0);
  ctx.lineTo(32, 50);
  for (let i = 0; i <= 6; i++) {
    const px = 32 - (i / 6) * 64;
    const py = 50 + Math.sin(time * 6 + i * 1.3) * 5 + (i % 2 ? 9 : 0);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -50, 0, 60);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(1, 'rgba(210, 205, 245, 0.55)');
  ctx.fillStyle = g;
  ctx.fill();
  // 심판 줄무늬 셔츠
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(30, 26, 44, 0.9)';
  for (let i = -3; i <= 3; i++) ctx.fillRect(i * 12 - 3, 6, 6, 50);
  ctx.restore();

  // 팔
  for (const [side, ang] of [[-1, left], [1, right]]) {
    ctx.save();
    ctx.translate(side * 28, 8);
    ctx.rotate(-side * (Math.PI / 2 - ang) * -1 + (side < 0 ? Math.PI : 0));
    ctx.beginPath();
    ctx.ellipse(16, 0, 18, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#F4F1FF';
    ctx.fill();
    ctx.restore();
  }

  // 얼굴
  ctx.fillStyle = '#2A2140';
  for (const ex of [-10, 10]) {
    ctx.beginPath();
    ctx.ellipse(ex, -24, 4, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255, 140, 170, 0.5)';
  for (const ex of [-18, 18]) {
    ctx.beginPath();
    ctx.arc(ex, -13, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 호루라기
  ctx.fillStyle = '#C9B37A';
  ctx.beginPath();
  ctx.ellipse(4, -9, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // 카운트 숫자 (손가락 대신 빛나는 숫자)
  if (ref.pose === 'count' && count > 0) {
    ctx.font = '400 34px "Bebas Neue", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFE9A8';
    ctx.fillText(String(count), 48, -48);
  }
  ctx.restore();
}
