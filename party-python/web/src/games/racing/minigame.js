// =============================================================
// 레이싱 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 차의 움직임·바퀴 수·순위는 세션 너머(서버 또는 시험용 진행기)에서 정하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { NetLink } from './net/NetLink.js';
import { RaceScreen } from './net/RaceScreen.js';

export const meta = Object.freeze({ id: 'racing', title: '레이싱', minPlayers: 2, maxPlayers: 5 });

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new RaceScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
  } catch (err) {
    console.error('[racing] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
