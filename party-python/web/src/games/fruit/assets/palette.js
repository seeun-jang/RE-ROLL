// Sweetie 16 팔레트 (GrafxKid) — 게임 전체에서 이 16색만 사용한다.
// 스프라이트 데이터는 이 배열의 인덱스(0~15)로 색을 지정한다.
export const PALETTE = [
  '#1a1c2c', // 0 남색 (외곽선/가장 어두운 색 — 순수 검정 대신)
  '#5d275d', // 1 자두색
  '#b13e53', // 2 빨강
  '#ef7d57', // 3 주황
  '#ffcd75', // 4 노랑
  '#a7f070', // 5 연두
  '#38b764', // 6 초록
  '#257179', // 7 청록
  '#29366f', // 8 짙은 파랑
  '#3b5dc9', // 9 파랑
  '#41a6f6', // 10 하늘
  '#73eff7', // 11 청록빛 하늘
  '#f4f4f4', // 12 흰색
  '#94b0c2', // 13 밝은 회색
  '#566c86', // 14 회색
  '#333c57', // 15 어두운 회색
];

export const C = {
  NAVY: 0, PLUM: 1, RED: 2, ORANGE: 3, YELLOW: 4, LIME: 5, GREEN: 6, TEAL: 7,
  DEEP: 8, BLUE: 9, SKY: 10, CYAN: 11, WHITE: 12, LGRAY: 13, GRAY: 14, DGRAY: 15,
};

export const col = (i) => PALETTE[i];

// RGB 값(캔버스 픽셀 조작용)
export const PALETTE_RGB = PALETTE.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);
