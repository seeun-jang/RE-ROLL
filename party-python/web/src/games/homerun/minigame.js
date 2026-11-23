// =============================================================
// 잭팟 홈런 더비 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 공 순서 · 맞았는지 · 점수는 세션 너머(서버 또는 시험용 진행기)에서 정하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { HomerunScreen } from './net/HomerunScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({
  id: 'homerun',
  title: '잭팟 홈런 더비',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: '← → 로 노란 배트 막대를 공이 올 줄에 맞추고, 공이 홈 플레이트에 올 때 Space 로 스윙 (볼은 골라내기 · 금색 공은 2배) · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new HomerunScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
    screen.init().catch((err) => console.error('[homerun] 시작 실패', err));
  } catch (err) {
    console.error('[homerun] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
