// =============================================================
//  입력 관리자
//  여러 입력 장치(키보드, 나중에는 웹캠 모션)를 하나로 합쳐서
//  게임 엔진에 항상 같은 형식으로 전달합니다.
//
//    { p1: { move, guard, punch, kick, special }, p2: { ... } }
//      move    : -1(화면 왼쪽) ~ 1(화면 오른쪽)
//      guard   : 가드 중이면 true
//      punch / kick / special : 이번 프레임에 동작했으면 true
//
//  ★ 나중에 AI 모션 인식을 붙일 때
//    read()가 위와 같은 형식을 돌려주는 입력 장치를 만들어
//    createInputManager([keyboard, motion]) 처럼 추가하면 됩니다.
//    예) 팔 뻗기 감지 → punch: true, 다리 들기 → kick: true,
//        두 손 얼굴 앞 → guard: true, 좌우 스텝 → move
//    게임 엔진 코드는 바꿀 필요가 없습니다.
// =============================================================

const EMPTY = { move: 0, guard: false, punch: false, kick: false, special: false };
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function createInputManager(sources, playerIds = ['p1', 'p2']) {
  return {
    read() {
      const merged = {};
      for (const id of playerIds) merged[id] = { ...EMPTY };

      for (const source of sources) {
        const values = source.read();
        for (const id of playerIds) {
          const v = values[id];
          if (!v) continue;
          const m = merged[id];
          m.move = clamp(m.move + (v.move ?? 0), -1, 1);
          m.guard = m.guard || Boolean(v.guard);
          m.punch = m.punch || Boolean(v.punch);
          m.kick = m.kick || Boolean(v.kick);
          m.special = m.special || Boolean(v.special);
        }
      }
      return merged;
    },
    dispose() {
      for (const source of sources) source.dispose?.();
    },
  };
}
