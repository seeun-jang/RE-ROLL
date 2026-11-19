// =============================================================
// 과일자르기 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 과일 목록·점수 판정은 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { FruitScreen } from './net/FruitScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({ id: 'fruit', title: '과일자르기', minPlayers: 2, maxPlayers: 5 });

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new FruitScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
    screen.init().catch((err) => console.error('[fruit] 시작 실패', err));
  } catch (err) {
    console.error('[fruit] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
