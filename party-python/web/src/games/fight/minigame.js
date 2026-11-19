// =============================================================
// 매직 파이트 나이트 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 경기 판정은 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면 · 입력 · 소리만 다룬다.
// =============================================================
import { FightScreen } from './net/FightScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({
  id: 'fight',
  title: '매직 파이트 나이트',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: '←→ 이동(상대 쪽으로 톡톡 = 대시) · Space 펀치(톡 = 잽, 꾹 눌렀다 떼기 = 강펀치) · ↓ 가드(맞기 직전에 누르면 슥 피하고 카운터) · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new FightScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
    screen.init().catch((err) => console.error('[fight] 시작 실패', err));
  } catch (err) {
    console.error('[fight] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
