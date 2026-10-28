// 키보드 입력 → 게임 입력 형식으로 바꿔주는 파일입니다.
// clock() = 지금이 노래의 몇 초인지. 키를 누른 순간의 시간을 바로 기록해서 판정이 정확해요.
import { KEYS, PLAYER_IDS, LANES } from '../game/config.js';

export function createKeyboardInput(clock) {
  const laneOf = new Map();
  for (const id of PLAYER_IDS) KEYS[id].forEach((code, lane) => laneOf.set(code, [id, lane]));

  const held = { p1: new Array(LANES).fill(false), p2: new Array(LANES).fill(false) };
  const presses = { p1: [], p2: [] };

  const onKeyDown = (e) => {
    const hit = laneOf.get(e.code);
    if (!hit) return;
    e.preventDefault(); // 방향키로 페이지가 스크롤되지 않게
    if (e.repeat) return;
    const [id, lane] = hit;
    held[id][lane] = true;
    presses[id].push({ lane, t: clock() });
  };
  const onKeyUp = (e) => {
    const hit = laneOf.get(e.code);
    if (hit) held[hit[0]][hit[1]] = false;
  };
  const onBlur = () => {
    for (const id of PLAYER_IDS) held[id].fill(false);
  };

  return {
    type: 'keyboard',
    start() {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
    },
    stop() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
    // 매 프레임 호출: 지난 프레임 이후 눌린 키 목록 + 지금 누르고 있는 키
    read() {
      const state = {};
      for (const id of PLAYER_IDS) {
        state[id] = { presses: presses[id], held: [...held[id]] };
        presses[id] = [];
      }
      return state;
    },
  };
}
