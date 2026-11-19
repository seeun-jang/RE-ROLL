// =============================================================
// 잭팟 볼링 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 핀 판정 · 점수는 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { BowlingScreen } from './net/BowlingScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({
  id: 'bowling',
  title: '잭팟 볼링',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: '←→ 위치 · Space 로 방향 → 힘 차례로 멈추기 · 굴러가는 동안 ←→ 스핀 (금색 잭팟 핀 +3점, 10초 안에 던지기) · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new BowlingScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
    screen.init().catch((err) => console.error('[bowling] 시작 실패', err));
  } catch (err) {
    console.error('[bowling] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
