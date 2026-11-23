// =============================================================
// scenes/common.js — 여러 씬이 같이 쓰는 그리기 도우미
// =============================================================
import { PAL } from '../palette.js';

// 배경 전체(하늘~무대)를 그린다. drawFighters 콜백은 무대 위, 앞쪽 풀보다 뒤에 그려진다.
export function drawWorld(ctx, game, { camX = 0, camY = 0, stones, drawActors } = {}) {
  const S = game.cfg.STAGE;
  const bg = game.bg;
  const st = stones || [
    { x: S.P1_X, y: S.FLOOR_Y, wobble: 0 },
    { x: S.P2_X, y: S.FLOOR_Y, wobble: 0 },
  ];
  const cx = Math.round(camX);
  const cy = Math.round(camY);
  bg.drawSky(ctx, cx, cy);
  bg.drawFar(ctx, cx, cy);
  bg.drawCrowd(ctx, cx, cy);
  bg.drawStage(ctx, cx, cy, st);
  if (drawActors) {
    ctx.save();
    // 배경 무대 레이어는 +cam 만큼 이동하므로 캐릭터도 같은 방향으로 옮겨 발이 돌에 붙어 있게 한다
    ctx.translate(cx, cy);
    drawActors(ctx);
    ctx.restore();
  }
  bg.drawFront(ctx, cx, cy);
}

// 스프라이트 프레임을 정수배로 크게 그리기 (초상화/차례 안내용)
export function drawFrameScaled(ctx, frame, x, y, scale = 2, crop = null) {
  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.w : frame.w;
  const sh = crop ? crop.h : frame.h;
  ctx.drawImage(frame.canvas, sx, sy, sw, sh, Math.round(x), Math.round(y), sw * scale, sh * scale);
}

// 화면 전체 어둡게 (디더 없는 단색 줄무늬 — 그라데이션 금지 규칙 준수)
export function dimScreen(ctx, w, h, every = 2) {
  ctx.fillStyle = PAL.ink;
  for (let y = 0; y < h; y += every) ctx.fillRect(0, y, w, 1);
}

// 버튼 목록 입력 처리 (마우스 hover/press/click + 키보드 포커스)
export function updateButtons(buttons, input, focusIndex) {
  const p = input.pointer;
  let clicked = -1;
  let focus = focusIndex;
  buttons.forEach((b, i) => {
    if (b.disabled) return;
    b.hover = b.contains(p.x, p.y);
    if (b.hover && p.pressedNow) focus = i;
    b.pressed = b.hover && p.down;
    if (b.hover && p.clicked) clicked = i;
  });
  buttons.forEach((b, i) => {
    b.focused = i === focus;
  });
  return { clicked, focus };
}
