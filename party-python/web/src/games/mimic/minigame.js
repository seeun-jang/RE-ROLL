// =============================================================
// 소리 따라하기 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 진행·채점은 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면·소리 재생·녹음만 다룬다.
// =============================================================
import { MimicScreen } from './MimicScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({ id: 'mimic', title: '소리 따라하기', minPlayers: 2, maxPlayers: 5 });

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new MimicScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
  } catch (err) {
    console.error('[mimic] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
