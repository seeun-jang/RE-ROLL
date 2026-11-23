// =============================================================
//  키보드 입력 장치
//    이동, 가드: 누르고 있는 동안 / 회피, 공격, 기술, 궁극기: 누른 순간 한 번
// =============================================================

import { KEY_BINDINGS } from '../config.js';
import { TAP_ACTIONS } from './actions.js';

const BLOCK_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function createKeyboardInput(bindings = KEY_BINDINGS) {
  const held = new Set();
  const tapped = new Set();

  const onKeyDown = (e) => {
    if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
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
    name: 'keyboard',
    read() {
      const result = {};
      for (const [playerId, keys] of Object.entries(bindings)) {
        const input = {
          move: (anyHeld(keys.right) ? 1 : 0) - (anyHeld(keys.left) ? 1 : 0),
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
    },
  };
}
