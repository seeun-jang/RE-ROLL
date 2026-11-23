// =============================================================
//  게임 입력 형식 — 키보드든 웹캠 모션이든 이 형식만 지키면 됩니다.
//
//    { p1: PlayerInput, p2: PlayerInput }
//      move  : -1(화면 왼쪽) ~ 1(화면 오른쪽)   누르고 있는 동안
//      guard : true/false                       누르고 있는 동안
//      dodge : 이번 프레임에 눌렀으면 true      (한 번 누를 때 한 번)
//      attack: 〃  (공격)
//      skill : 〃  (기술)
//      super : 〃  (궁극기)
// =============================================================

export const PLAYER_IDS = ['p1', 'p2'];
export const TAP_ACTIONS = ['dodge', 'attack', 'skill', 'super'];

export const EMPTY_INPUT = Object.freeze({ move: 0, guard: false, dodge: false, attack: false, skill: false, super: false });

export function emptyInputs() {
  const result = {};
  for (const id of PLAYER_IDS) result[id] = { ...EMPTY_INPUT };
  return result;
}
