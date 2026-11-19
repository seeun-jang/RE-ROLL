// ============================================================
// Endesga 32 팔레트 — 게임 전체에서 이 32색만 사용한다.
// ============================================================

export const ENDESGA32 = Object.freeze([
  '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
  '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
  '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
  '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
]);

// 이름으로 쓰기 쉽게 별칭을 붙인다.
export const C = Object.freeze({
  brick: ENDESGA32[0], copper: ENDESGA32[1], sand: ENDESGA32[2], tan: ENDESGA32[3],
  clay: ENDESGA32[4], brown: ENDESGA32[5], umber: ENDESGA32[6], crimson: ENDESGA32[7],
  red: ENDESGA32[8], orange: ENDESGA32[9], gold: ENDESGA32[10], yellow: ENDESGA32[11],
  green: ENDESGA32[12], forest: ENDESGA32[13], pine: ENDESGA32[14], deepTeal: ENDESGA32[15],
  navy: ENDESGA32[16], blue: ENDESGA32[17], cyan: ENDESGA32[18], white: ENDESGA32[19],
  silver: ENDESGA32[20], steel: ENDESGA32[21], slate: ENDESGA32[22], dusk: ENDESGA32[23],
  night: ENDESGA32[24], ink: ENDESGA32[25], neon: ENDESGA32[26], plum: ENDESGA32[27],
  magenta: ENDESGA32[28], pink: ENDESGA32[29], skin: ENDESGA32[30], skinShade: ENDESGA32[31],
});

// 속성별 색 지정: [어두움, 기본, 밝음, 코어]
export const ELEMENT_COLORS = Object.freeze({
  fire: [C.crimson, C.red, C.orange, C.gold],
  water: [C.navy, C.blue, C.cyan, C.white],
  lightning: [C.gold, C.yellow, C.white, C.white],
  wind: [C.pine, C.forest, C.green, C.white],
  ice: [C.steel, C.cyan, C.silver, C.white],
  heal: [C.magenta, C.pink, C.skin, C.white],
  neutral: [C.dusk, C.slate, C.silver, C.white],
});

// 공용 UI 색
export const UI_COLORS = Object.freeze({
  text: C.white,
  textDim: C.steel,
  textShadow: C.ink,
  hp: C.red,
  hpBack: C.umber,
  hpLow: C.neon,
  mana: C.blue,
  manaBack: C.night,
  success: C.green,
  fail: C.steel,
  warning: C.gold,
});
