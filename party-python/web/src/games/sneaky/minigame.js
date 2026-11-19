// =============================================================
// 교수님 몰래 댄스! — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 판정 · 점수 · 교수님 움직임은 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { NetLink } from './net/NetLink.js';
import { SneakyScreen } from './net/SneakyScreen.js';

export const meta = Object.freeze({
  id: 'sneaky',
  title: '교수님 몰래 댄스!',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: 'X(또는 Space) 꾹: 작은 춤 · Z(또는 ←/→) 꾹: 큰 춤 — 교수님이 돌아보기 전에 손 떼기 · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new SneakyScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
  } catch (err) {
    console.error('[sneaky] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
