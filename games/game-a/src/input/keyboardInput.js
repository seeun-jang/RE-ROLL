// =============================================================
//  키보드 입력
//    - 이동, 가드: 누르고 있는 동안 계속
//    - 펀치, 킥, 필살기: 누른 "순간" 한 번만 (꾹 누르고 있어도 연타되지 않음)
//  read()를 부르면 플레이어별 조작 값을 돌려줍니다.
// =============================================================

import { KEY_BINDINGS } from '../config.js';

const TAP_ACTIONS = ['punch', 'kick', 'special'];

// 게임 중 페이지가 스크롤되거나 브라우저 단축키가 실행되지 않게 막을 키
const BLOCK_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Period']);

export function createKeyboardInput(bindings = KEY_BINDINGS) {
  const held = new Set();     // 지금 눌려 있는 키
  const tapped = new Set();   // 지난 read() 이후 새로 눌린 키

  const onKeyDown = (e) => {
    if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return; // 꾹 누를 때 자동 반복 무시
    held.add(e.code);
    tapped.add(e.code);
  };
  const onKeyUp = (e) => held.delete(e.code);
  const onBlur = () => {
    held.clear();
    tapped.clear();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const anyHeld = (codes) => codes.some((c) => held.has(c));
  const anyTapped = (codes) => codes.some((c) => tapped.has(c));

  return {
    read() {
      const result = {};
      for (const [playerId, keys] of Object.entries(bindings)) {
        const input = {
          move: (anyHeld(keys.right) ? 1 : 0) - (anyHeld(keys.left) ? 1 : 0), // 화면 기준 -1(왼쪽) ~ 1(오른쪽)
          guard: anyHeld(keys.guard),
        };
        for (const action of TAP_ACTIONS) input[action] = anyTapped(keys[action]);
        result[playerId] = input;
      }
      tapped.clear();
      return result;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.clear();
      tapped.clear();
    },
  };
}
