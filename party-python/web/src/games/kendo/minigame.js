// =============================================================
// 검도 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 경기 판정은 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면·입력·시작 전 연습만 다룬다.
// =============================================================
import { KendoScreen } from './net/KendoScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({ id: 'kendo', title: '검도', minPlayers: 2, maxPlayers: 5 });

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new KendoScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
    screen.init().catch((err) => console.error('[kendo] 시작 실패', err));
  } catch (err) {
    console.error('[kendo] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
