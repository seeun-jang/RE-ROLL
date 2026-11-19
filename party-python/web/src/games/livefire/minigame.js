// =============================================================
// 실거리 사격 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 표적 · 판정 · 점수는 세션 너머(서버 또는 시험용 진행기)에서 진행하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { NetLink } from './net/NetLink.js';
import { RangeScreen } from './net/RangeScreen.js';

export const meta = Object.freeze({
  id: 'livefire',
  title: '실거리 사격',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: '방향키(또는 WASD): 조준 — 가만히 두면 흔들림이 줄어듦 · Space: 발사 (표적 20개 · 탄알 20발) · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new RangeScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
  } catch (err) {
    console.error('[livefire] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
