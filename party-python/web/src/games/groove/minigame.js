// =============================================================
// 잭팟 그루브 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 곡 고르기 · 판정 · 점수는 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면 · 소리 · 입력만 다룬다.
// =============================================================
import { GrooveScreen } from './net/GrooveScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({
  id: 'groove',
  title: '잭팟 그루브',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: '← ↑ → (또는 A S D): 칩이 판정선에 닿는 순간 누르기, 꼬리 달린 칩은 끝까지 꾹 · [ ]: 소리 싱크 조절 · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new GrooveScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
    screen.init().catch((err) => console.error('[groove] 시작 실패', err));
  } catch (err) {
    console.error('[groove] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
