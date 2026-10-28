// =============================================================
//  입력 관리자 — 여러 입력 장치(키보드, 웹캠 모션)를 하나로 합칩니다.
//  웹캠 모션은 read()가 actions.js 형식을 돌려주는 장치를 만들어 목록에 넣으면 됩니다.
// =============================================================

import { PLAYER_IDS, TAP_ACTIONS, emptyInputs } from './actions.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function createInputManager(sources) {
  return {
    read() {
      const merged = emptyInputs();
      for (const source of sources) {
        const values = source.read();
        for (const id of PLAYER_IDS) {
          const v = values[id];
          if (!v) continue;
          const m = merged[id];
          m.move = clamp(m.move + (v.move ?? 0), -1, 1);
          m.guard = m.guard || Boolean(v.guard);
          for (const action of TAP_ACTIONS) m[action] = m[action] || Boolean(v[action]);
        }
      }
      return merged;
    },
    dispose() {
      for (const source of sources) source.dispose?.();
    },
  };
}
