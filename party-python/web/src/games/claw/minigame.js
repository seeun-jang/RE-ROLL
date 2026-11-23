// =============================================================
// 잭팟 인형뽑기 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 인형 · 집게 · 점수는 세션 너머(서버 또는 시험용 진행기)에서 진행하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { ClawScreen } from './net/ClawScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({
  id: 'claw',
  title: '잭팟 인형뽑기',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: '←/→(A/D): 집게 옮기기 · Space(↑/↓): 집게 내리기 (8초가 지나면 저절로 내려감) · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new ClawScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
  } catch (err) {
    console.error('[claw] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
