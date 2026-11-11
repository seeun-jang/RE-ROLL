// =============================================================
//  쇼케이스 (타이틀, 결과 화면 배경)
//  경기 없이 무대와 두 선수를 연출용 자세로 보여줍니다.
// =============================================================

import { PLAYERS, STAGE } from '../config.js';
import { createFighter, setState } from '../engine/fighter.js';
import { createStage, FLOOR_SCREEN } from './stage.js';
import { drawFigure } from './character.js';
import { blendPose, resolvePose } from './rig.js';
import { expressionFor, poseFor } from './poses.js';

const W = STAGE.width;
const H = STAGE.height;

/**
 * @param canvas
 * @param opts { states: { p1: 'idle', p2: 'idle' }, positions: { p1: x, p2: x }, focus: x, zoom, hype }
 */
export function createShowcase(canvas, opts) {
  const ctx = canvas.getContext('2d');
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = W / 2;
  glowCanvas.height = H / 2;
  const glow = glowCanvas.getContext('2d');
  const bloomCanvas = document.createElement('canvas');
  bloomCanvas.width = W / 4;
  bloomCanvas.height = H / 4;
  const bloom = bloomCanvas.getContext('2d');
  const stage = createStage();
  const fighters = PLAYERS.map((p) => {
    const f = createFighter(p, opts.positions?.[p.id] ?? STAGE.startX[p.id], p.side === 'left' ? 1 : -1);
    setState(f, opts.states?.[p.id] ?? 'idle');
    return f;
  });
  const poses = {};
  const cam = { x: opts.focus ?? 800, zoom: opts.zoom ?? 1 };
  let time = 0;

  return {
    render(dt) {
      time += dt;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#07050F';
      ctx.fillRect(0, 0, W, H);
      glow.setTransform(1, 0, 0, 1, 0, 0);
      glow.clearRect(0, 0, W / 2, H / 2);
      // 아주 천천히 카메라가 흔들리며 다가감
      const drift = Math.sin(time * 0.25) * 18;
      const c = { x: cam.x + drift, zoom: cam.zoom + Math.sin(time * 0.2) * 0.015 };
      stage.drawBack(ctx, glow, c, time, opts.hype ?? 0.5);

      const set = (g, s) =>
        g.setTransform(c.zoom * s, 0, 0, c.zoom * s, (W / 2 - c.x * c.zoom) * s, (FLOOR_SCREEN - STAGE.floorY * c.zoom) * s);
      set(ctx, 1);
      set(glow, 0.5);
      for (const f of fighters) {
        f.stateTime = time;
        const target = resolvePose(poseFor(f, time), f.player.height);
        poses[f.id] = blendPose(poses[f.id], target, 1 - Math.exp(-12 * dt));
        const args = { x: f.x, y: STAGE.floorY, facing: f.facing, pose: poses[f.id], player: f.player, expression: expressionFor(f), time, fighter: f };
        ctx.save();
        ctx.translate(0, STAGE.floorY * 2);
        ctx.scale(1, -1);
        ctx.globalAlpha = 0.2;
        drawFigure(ctx, null, args);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      for (const f of fighters) {
        drawFigure(ctx, glow, { x: f.x, y: STAGE.floorY, facing: f.facing, pose: poses[f.id], player: f.player, expression: expressionFor(f), time, fighter: f });
      }
      stage.drawFront(ctx, c);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      bloom.clearRect(0, 0, W / 4, H / 4);
      bloom.filter = 'blur(3px)';
      bloom.drawImage(glowCanvas, 0, 0, W / 4, H / 4);
      bloom.filter = 'none';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(bloomCanvas, 0, 0, W, H);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(glowCanvas, 0, 0, W, H);
      ctx.restore();
      const v = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, H);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(4, 2, 14, 0.8)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    },
  };
}

/** 얼굴 초상화 (HUD용) — 작은 캔버스에 머리 부분만 크게 */
export function drawPortrait(canvas, player, expression = 'fierce') {
  const ctx = canvas.getContext('2d');
  const f = createFighter(player, 0, 1);
  const pose = resolvePose({ ...poseFor(f, 0), aF: [0.1, 0.2], aB: [0.05, 0.2], lean: 0.02, head: 0.05 }, player.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const s = canvas.width / 120;
  const headY = (pose.hipY + 70 + 10 + 20) * 1.12 * player.height; // 바닥에서 머리 중심까지
  const scale = 2.1 / player.height;
  ctx.save();
  ctx.scale(s, s);
  const yOffset = player.kind === 'professor' ? 76 : 62; // 교수는 모자가 커서 조금 아래로
  drawFigure(ctx, null, { x: 52, y: yOffset + headY * scale, facing: 1, pose, player, expression, time: 0, scale });
  ctx.restore();
}
