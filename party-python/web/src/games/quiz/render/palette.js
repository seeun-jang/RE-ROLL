// 게임 전체 고정 팔레트 — Sweetie 16 (밝고 신나는 퀴즈쇼 분위기에 맞춤)
// 스프라이트 문자열에서는 16진수 한 글자(0~f)가 팔레트 번호, '.' 은 투명.
export const PALETTE = [
  '#1a1c2c', // 0 밤하늘 남색 (외곽선 — 순수 검정 대신)
  '#5d275d', // 1 자주 (빨강팀 그림자)
  '#b13e53', // 2 빨강 (빨강팀)
  '#ef7d57', // 3 주황
  '#ffcd75', // 4 노랑 (피부, 조명)
  '#a7f070', // 5 연두 (정답)
  '#38b764', // 6 초록
  '#257179', // 7 청록
  '#29366f', // 8 남색 (파랑팀 그림자)
  '#3b5dc9', // 9 파랑 (파랑팀)
  '#41a6f6', // a 하늘
  '#73eff7', // b 민트
  '#f4f4f4', // c 흰색
  '#94b0c2', // d 밝은 회색
  '#566c86', // e 회색
  '#333c57', // f 짙은 회색
];

export const C = Object.fromEntries(PALETTE.map((hex, i) => [i.toString(16), hex]));

// 팀 색 (팔레트 번호)
export const TEAM_COLORS = [
  { main: 2, dark: 1, light: 3, name: 'red' },
  { main: 9, dark: 8, light: 10, name: 'blue' },
];

// 빨강팀 스프라이트를 파랑팀으로 바꾸는 팔레트 스왑 표
export const SWAP_TO_BLUE = { 2: 9, 1: 8 };

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const PALETTE_RGB = PALETTE.map(hexToRgb);
