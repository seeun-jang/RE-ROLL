// =============================================================
// 무궁화 꽃이 피었습니다 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 판정·점수·진행·음성 인식은 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { MugunghwaScreen } from './net/MugunghwaScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({ id: 'mugunghwa', title: '무궁화 꽃이 피었습니다', minPlayers: 2, maxPlayers: 5 });

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new MugunghwaScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
  } catch (err) {
    console.error('[mugunghwa] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
