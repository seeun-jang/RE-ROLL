// =============================================================
//  캐릭터 한 명 그리기 (student / 교수 선택, 위치·방향·크기 적용)
// =============================================================

import { computeJoints } from './rig.js';
import { drawTiger } from './tiger.js';
import { drawProfessor } from './professor.js';

export const DRAW_SCALE = 1.12;

/**
 * @param ctx   그릴 캔버스
 * @param glow  빛 번짐용 캔버스 (없으면 null)
 * @returns 화면 좌표의 주요 관절 (이펙트 위치용)
 */
export function drawFigure(ctx, glow, { x, y, facing, pose, player, expression = 'fierce', time = 0, flash = 0, fighter = null, scale = 1, spin = 0, alpha = 1 }) {
  const s = DRAW_SCALE * player.height * scale;
  const j = computeJoints(pose);
  const apply = (c) => {
    c.save();
    c.translate(x, y);
    c.scale(facing * s, s);
    // 구르기: 엉덩이를 중심으로 회전
    if (spin) {
      c.translate(j.hip[0], j.hip[1]);
      c.rotate(spin);
      c.translate(-j.hip[0], -j.hip[1]);
    }
    c.globalAlpha *= alpha;
  };
  apply(ctx);
  if (glow) apply(glow);
  if (flash > 0) ctx.filter = 'brightness(2.2) saturate(0.4)';
  if (player.kind === 'professor') drawProfessor(ctx, j, player, expression, time, glow, fighter);
  else drawTiger(ctx, j, player, expression, time);
  ctx.restore();
  if (glow) glow.restore();

  const toWorld = (p) => [x + p[0] * facing * s, y + p[1] * s];
  return {
    head: toWorld([j.neckTop[0] + j.headUp[0] * 20, j.neckTop[1] + j.headUp[1] * 20]),
    fistF: toWorld(j.armF.end),
    fistB: toWorld(j.armB.end),
    footF: toWorld(j.legF.end),
    hip: toWorld(j.hip),
    top: y - (pose.hipY + 120) * s,
  };
}
