// =============================================================
// 잭팟 탁구왕 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 판정·점수·진행은 세션 너머(서버 또는 시험용 진행기)에서 오고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { PingpongScreen } from './net/PingpongScreen.js';

export const meta = Object.freeze({
  id: 'pingpong',
  title: '잭팟 탁구왕',
  minPlayers: 2,
  maxPlayers: 5,
  howTo: '← 후진 · → 전진(탁구대 쪽) · Space 치기 — 톡: 드라이브, 꾹 눌렀다 떼기: 스매시, 전진+톡: 드롭, 후진+톡: 로브 · M: 소리 끄기/켜기',
});

export function mount(container, ctx) {
  const screen = new PingpongScreen(container, ctx);
  screen.init().catch((err) => console.error('[pingpong] 시작 실패', err));
  return {
    destroy() {
      screen.destroy();
    },
  };
}
