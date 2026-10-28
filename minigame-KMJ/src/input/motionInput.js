// 3단계(웹캠 모션 인식)에서 채울 자리입니다.
// 키보드 입력과 똑같은 모양으로 값을 돌려주면 게임 코드는 수정할 필요가 없어요.
//
// 계획 (MediaPipe Pose 사용 예정):
//   - 화면 왼쪽 사람 = p1, 오른쪽 사람 = p2
//   - 레인 4개를 동작 4개로:  ← 왼손 뻗기 / ↓ 앉기 / ↑ 두 손 들기 / → 오른손 뻗기
//   - 동작이 시작된 순간 presses 에 { lane, t: clock() } 를 넣기
import { PLAYER_IDS, LANES } from '../game/config.js';

export function createMotionInput() {
  return {
    type: 'motion',
    start() {},
    stop() {},
    read() {
      const state = {};
      for (const id of PLAYER_IDS) state[id] = { presses: [], held: new Array(LANES).fill(false) };
      return state;
    },
  };
}
