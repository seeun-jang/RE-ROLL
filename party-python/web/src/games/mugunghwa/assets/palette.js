// ============================================================
// palette.js — Sweetie 16 팔레트 (게임 전체에서 이 16색만 사용)
// ============================================================

export const SWEETIE16 = [
  '#1a1c2c', // 0  밤하늘 남색 (외곽선)
  '#5d275d', // 1  자주
  '#b13e53', // 2  다홍
  '#ef7d57', // 3  주황
  '#ffcd75', // 4  살구/노랑
  '#a7f070', // 5  연두
  '#38b764', // 6  초록
  '#257179', // 7  청록
  '#29366f', // 8  군청
  '#3b5dc9', // 9  파랑
  '#41a6f6', // 10 하늘
  '#73eff7', // 11 민트
  '#f4f4f4', // 12 흰색
  '#94b0c2', // 13 밝은 회청
  '#566c86', // 14 회청
  '#333c57', // 15 어두운 회청
];

// 이름으로 쓰기 쉽게
export const C = {
  ink: SWEETIE16[0],
  plum: SWEETIE16[1],
  red: SWEETIE16[2],
  orange: SWEETIE16[3],
  yellow: SWEETIE16[4],
  lime: SWEETIE16[5],
  green: SWEETIE16[6],
  teal: SWEETIE16[7],
  navy: SWEETIE16[8],
  blue: SWEETIE16[9],
  sky: SWEETIE16[10],
  mint: SWEETIE16[11],
  white: SWEETIE16[12],
  silver: SWEETIE16[13],
  slate: SWEETIE16[14],
  dark: SWEETIE16[15],
};

// 노을 단계별 하늘 띠 색 (위 → 아래). 판이 진행될수록 다음 단계로 팔레트 스왑
export const SKY_PHASES = [
  [C.blue, C.sky, C.yellow, C.orange],
  [C.navy, C.plum, C.red, C.orange],
  [C.ink, C.navy, C.plum, C.red],
];

// 노을 단계별 구름 색
export const CLOUD_PHASES = [
  [C.white, C.silver],
  [C.orange, C.red],
  [C.plum, C.dark],
];

// HEX → [r,g,b]
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// 밝은 색인지 (글자색 결정용)
export function isLight(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 140;
}
