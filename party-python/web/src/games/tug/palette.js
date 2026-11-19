// =============================================================
// 팔레트 — Sweetie 16 (by GrafxKid, 무료 공개 팔레트)
// 게임 전체에서 이 16색만 사용한다. (외부에서 넘겨받은 플레이어 색은 예외)
// =============================================================

/** 팔레트 인덱스 → HEX */
export const PALETTE = [
  '#1a1c2c', // 0  INK      : 외곽선·가장 어두운 색 (순수 검정 대신)
  '#5d275d', // 1  PLUM     : 빨강 계열 그림자
  '#b13e53', // 2  RED      : 빨강 팀
  '#ef7d57', // 3  ORANGE   : 피부 그림자 / 노을
  '#ffcd75', // 4  YELLOW   : 피부 / 불빛 / 강조
  '#a7f070', // 5  LIME     : 밝은 잔디
  '#38b764', // 6  GREEN    : 잔디
  '#257179', // 7  TEAL     : 초록 그림자
  '#29366f', // 8  NAVY     : 파랑 계열 그림자 / 밤하늘
  '#3b5dc9', // 9  BLUE     : 파랑 팀
  '#41a6f6', // 10 SKY      : 낮 하늘
  '#73eff7', // 11 CYAN     : 밝은 하늘 / 반짝임
  '#f4f4f4', // 12 WHITE    : 하이라이트 / 구름 / 글자
  '#94b0c2', // 13 SILVER   : 회색 밝음
  '#566c86', // 14 SLATE    : 회색 중간
  '#333c57', // 15 CHARCOAL : 회색 어두움 / 바지
];

/** 이름으로 인덱스 참조 */
export const C = Object.freeze({
  INK: 0, PLUM: 1, RED: 2, ORANGE: 3, YELLOW: 4, LIME: 5, GREEN: 6, TEAL: 7,
  NAVY: 8, BLUE: 9, SKY: 10, CYAN: 11, WHITE: 12, SILVER: 13, SLATE: 14, CHARCOAL: 15,
});

/** 인덱스 → HEX 단축 함수 */
export const hex = (i) => PALETTE[i];

/** 팀 색 (빨강 = 왼쪽, 파랑 = 오른쪽) */
export const TEAM_COLORS = Object.freeze({
  left: { main: PALETTE[C.RED], shade: PALETTE[C.PLUM], light: PALETTE[C.ORANGE] },
  right: { main: PALETTE[C.BLUE], shade: PALETTE[C.NAVY], light: PALETTE[C.SKY] },
});

/** 라운드별 시간대 (라운드 수가 3보다 많으면 순환) */
export const TIME_OF_DAY = ['day', 'sunset', 'night'];

/**
 * 팔레트 스왑 표 — 배경 레이어는 '낮' 색으로 그린 뒤, 시간대별로 인덱스를 바꿔 다시 칠한다.
 * { 원래 인덱스: 바뀔 인덱스 } (없는 인덱스는 그대로)
 */
export const PALETTE_SWAPS = Object.freeze({
  day: {},
  sunset: {
    [C.SKY]: C.ORANGE, [C.CYAN]: C.YELLOW, [C.BLUE]: C.RED, [C.WHITE]: C.YELLOW,
    [C.SILVER]: C.ORANGE, [C.LIME]: C.GREEN, [C.GREEN]: C.TEAL, [C.YELLOW]: C.ORANGE,
  },
  night: {
    [C.SKY]: C.NAVY, [C.CYAN]: C.CHARCOAL, [C.BLUE]: C.INK, [C.WHITE]: C.SILVER,
    [C.SILVER]: C.SLATE, [C.SLATE]: C.CHARCOAL, [C.LIME]: C.TEAL, [C.GREEN]: C.TEAL,
    [C.TEAL]: C.NAVY, [C.ORANGE]: C.RED,
    // C.YELLOW(불빛)는 밤에도 그대로 두어 조명처럼 보이게 한다
  },
});

/** 스왑 적용한 인덱스 반환 */
export function swapIndex(index, timeOfDay) {
  const table = PALETTE_SWAPS[timeOfDay] || PALETTE_SWAPS.day;
  return Object.prototype.hasOwnProperty.call(table, index) ? table[index] : index;
}

// ---------- 색 유틸 ----------

function hexToRgb(h) {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbDist(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
}

/** 아무 HEX 색을 팔레트에서 가장 가까운 색으로 */
export function nearestPaletteColor(h) {
  const rgb = hexToRgb(h);
  let best = 0, bestD = Infinity;
  PALETTE.forEach((p, i) => {
    const d = rgbDist(rgb, hexToRgb(p));
    if (d < bestD) { bestD = d; best = i; }
  });
  return PALETTE[best];
}

/** 팔레트 색별 그림자 색 (검정 대신 채도 낮은 어두운 색) */
const SHADE_TABLE = {
  [PALETTE[C.RED]]: PALETTE[C.PLUM],
  [PALETTE[C.ORANGE]]: PALETTE[C.RED],
  [PALETTE[C.YELLOW]]: PALETTE[C.ORANGE],
  [PALETTE[C.LIME]]: PALETTE[C.GREEN],
  [PALETTE[C.GREEN]]: PALETTE[C.TEAL],
  [PALETTE[C.TEAL]]: PALETTE[C.NAVY],
  [PALETTE[C.BLUE]]: PALETTE[C.NAVY],
  [PALETTE[C.SKY]]: PALETTE[C.BLUE],
  [PALETTE[C.CYAN]]: PALETTE[C.SKY],
  [PALETTE[C.WHITE]]: PALETTE[C.SILVER],
  [PALETTE[C.SILVER]]: PALETTE[C.SLATE],
  [PALETTE[C.SLATE]]: PALETTE[C.CHARCOAL],
  [PALETTE[C.CHARCOAL]]: PALETTE[C.INK],
  [PALETTE[C.PLUM]]: PALETTE[C.INK],
  [PALETTE[C.NAVY]]: PALETTE[C.INK],
  [PALETTE[C.INK]]: PALETTE[C.INK],
};

/**
 * 그림자 색 구하기.
 * 팔레트 색이면 표에서, 외부에서 받은 임의 색이면 팔레트 최근접 색의 그림자를 쓴다.
 */
export function shadeOf(h) {
  const key = h.toLowerCase();
  if (SHADE_TABLE[key]) return SHADE_TABLE[key];
  return SHADE_TABLE[nearestPaletteColor(key)] || PALETTE[C.INK];
}
