// =============================================================
// 하노마노 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 카드 · 차례 · 종 판정 · 순위는 세션 너머(서버 또는 시험용 진행기)에서 정하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { HanoScreen } from './net/HanoScreen.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({
  id: 'hanomano',
  title: '하노마노',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: 'Z: 내 차례에 카드 뒤집기 · Space: 같은 과일이 딱 5개면 종! (틀리면 1장씩 주고 3초 금지) · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new HanoScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
  } catch (err) {
    console.error('[hanomano] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
