// =============================================================
// palette.js — 게임 전체에서 공통으로 쓰는 제한 팔레트 (Sweetie 16)
//   - 모든 스프라이트/UI/배경은 이 16색만 사용한다.
//   - 순수 검정(#000) 대신 PAL.ink(#1a1c2c)를 외곽선/그림자로 사용.
// =============================================================

export const SWEETIE16 = [
  '#1a1c2c', // 0  ink        : 외곽선, 가장 어두운 그림자
  '#5d275d', // 1  plum       : 보라 그림자
  '#b13e53', // 2  red        : 빨강
  '#ef7d57', // 3  orange     : 주황 / 피부 그림자
  '#ffcd75', // 4  sand       : 노랑 / 피부
  '#a7f070', // 5  lime       : 연두
  '#38b764', // 6  green      : 초록
  '#257179', // 7  teal       : 청록 (물 그림자)
  '#29366f', // 8  navy       : 남색
  '#3b5dc9', // 9  blue       : 파랑
  '#41a6f6', // 10 sky        : 하늘색
  '#73eff7', // 11 cyan       : 밝은 청록 (물 하이라이트)
  '#f4f4f4', // 12 white      : 흰색
  '#94b0c2', // 13 silver     : 밝은 회색
  '#566c86', // 14 slate      : 회색
  '#333c57', // 15 charcoal   : 어두운 회색
];

// 이름으로 접근하기 위한 별칭
export const PAL = {
  ink: SWEETIE16[0],
  plum: SWEETIE16[1],
  red: SWEETIE16[2],
  orange: SWEETIE16[3],
  sand: SWEETIE16[4],
  lime: SWEETIE16[5],
  green: SWEETIE16[6],
  teal: SWEETIE16[7],
  navy: SWEETIE16[8],
  blue: SWEETIE16[9],
  sky: SWEETIE16[10],
  cyan: SWEETIE16[11],
  white: SWEETIE16[12],
  silver: SWEETIE16[13],
  slate: SWEETIE16[14],
  charcoal: SWEETIE16[15],
};
