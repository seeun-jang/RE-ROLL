// =====================================================
// 캐릭터 5종 (원본 js/characters.js). 순서는 원본 그대로 — 뒷모습 그림(BACK_LOOK)이 이 순서를 쓴다.
// id    : 대기실에서 고르는 동물 id (web/src/shared/animals.js 의 ANIMAL_ORDER 와 같은 이름)
// sprite: assets/characters/<sprite>.png 파일 이름
// color : 이름표 · 테두리 색 (팔레트 키)
// =====================================================
export const CHARACTERS = [
  { id: 'bear', name: '곰', sprite: 'bear', color: 'e' },
  { id: 'cat', name: '고양이', sprite: 'cat', color: 'q' },
  { id: 'duck', name: '오리', sprite: 'duck', color: 't' },
  { id: 'tiger', name: '호랑이', sprite: 'tiger', color: '8' },
  { id: 'shiba', name: '시바', sprite: 'shiba', color: 'p' },
];

/** 동물 id → 이 게임의 캐릭터 번호(0~4). 모르는 id 면 자리 번호로 고른다. */
export function characterIndex(animalId, fallback = 0) {
  const i = CHARACTERS.findIndex((c) => c.id === animalId);
  return i >= 0 ? i : ((fallback % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length;
}
