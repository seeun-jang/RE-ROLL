// ============================================================
// 주문 데이터 — 새 주문은 이 배열에 객체 하나만 추가하면 된다.
//
//  id        : 고유 ID (코드에서 참조)
//  name      : 화면 표시 이름 / short : 주문서 칸에 들어갈 짧은 이름
//  key       : 키보드 대체 입력 키
//  keywords  : 인식 키워드 (여러 표기 허용 — 띄어쓰기/영문/비슷한 발음)
//  element   : 속성 (data/elements.js)
//  type      : projectile(투사체) | strike(즉발 낙뢰) | shield(방어막) | heal(회복)
//  damage / shield / heal : 기본 수치 (위력 배율 적용 전)
//  mana      : 마나 소모 / cooldown : 재사용 대기(초)
// ============================================================

export const SPELLS = Object.freeze([
  {
    id: 'fireball',
    name: '파이어볼',
    short: '파이어볼',
    key: '1',
    element: 'fire',
    type: 'projectile',
    damage: 10,
    mana: 10,
    cooldown: 0.8,
    speed: 150,
    keywords: ['파이어볼', '파이어 볼', '화이어볼', '파이어벌', '화염구', 'fireball', 'fire ball'],
  },
  {
    id: 'aqua_shot',
    name: '아쿠아 샷',
    short: '아쿠아샷',
    key: '2',
    element: 'water',
    type: 'projectile',
    damage: 10,
    mana: 10,
    cooldown: 0.8,
    speed: 140,
    keywords: ['아쿠아 샷', '아쿠아샷', '아쿠아', '워터', '워터볼', '물대포', 'aqua shot', 'aqua', 'water'],
  },
  {
    id: 'thunder',
    name: '썬더',
    short: '썬더',
    key: '3',
    element: 'lightning',
    type: 'strike',
    damage: 14,
    mana: 16,
    cooldown: 1.6,
    delay: 0.18,          // 시전 후 낙뢰가 떨어지기까지(초) — 투사체가 아니라 요격 불가
    keywords: ['썬더', '선더', '썬다', '번개', 'thunder'],
  },
  {
    id: 'wind_cutter',
    name: '윈드 커터',
    short: '윈드커터',
    key: '4',
    element: 'wind',
    type: 'projectile',
    damage: 8,
    mana: 7,
    cooldown: 0.5,
    speed: 230,
    keywords: ['윈드 커터', '윈드커터', '윈드', '바람', '바람칼', 'wind cutter', 'wind'],
  },
  {
    id: 'ice_shield',
    name: '아이스 실드',
    short: '아이스실드',
    key: '5',
    element: 'ice',
    type: 'shield',
    shield: 30,           // 흡수량
    duration: 3.0,        // 지속(초)
    mana: 15,
    cooldown: 4.0,
    keywords: ['아이스 실드', '아이스실드', '아이스 쉴드', '아이스쉴드', '얼음 방패', '얼음방패', 'ice shield'],
  },
  {
    id: 'heal',
    name: '힐',
    short: '힐',
    key: '6',
    element: 'heal',
    type: 'heal',
    heal: 18,
    mana: 22,
    cooldown: 6.0,
    keywords: ['힐', '힐링', '치유', '회복', 'heal'],
  },
]);

export const SPELL_BY_ID = Object.freeze(Object.fromEntries(SPELLS.map((s) => [s.id, s])));
export const SPELL_BY_KEY = Object.freeze(Object.fromEntries(SPELLS.map((s) => [s.key, s])));
