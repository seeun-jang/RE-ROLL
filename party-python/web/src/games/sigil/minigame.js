// =============================================================
// 마법진 그리기 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 진행 · 채점은 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면 · 소리 · 펜 입력만 다룬다.
// 브라우저 객체(window · document · Image · AudioContext)는 mount 가 불린 뒤에만 만진다.
// =============================================================
import { HOW_TO } from './config.js';
import { NetLink } from './net/NetLink.js';
import { SigilScreen } from './net/SigilScreen.js';

export const meta = Object.freeze({ id: 'sigil', title: '마법진 그리기', minPlayers: 2, maxPlayers: 5, howTo: HOW_TO });

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  let screen = null;
  try {
    screen = new SigilScreen(container, { net, players: ctx.players, me: ctx.me, options: ctx.options || {} });
  } catch (err) {
    console.error('[sigil] 시작 실패', err);
  }
  return {
    destroy() {
      if (screen) screen.destroy();
      screen = null;
      net.dispose();
    },
  };
}
