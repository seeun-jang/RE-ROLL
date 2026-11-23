// 게임 전체에서 쓰는 단 하나의 팔레트: Endesga 32 (순서 고정)
// 모든 그리기는 이 파일의 색만 쓴다. 반투명·그라데이션 금지.
export const PAL = [
  '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
  '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
  '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
  '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
];

// 색 역할 이름 → 실제 HEX
export const C = {
  bgDeep: PAL[25], bg: PAL[24], panel: PAL[23], panelLight: PAL[22], border: PAL[21],
  text: PAL[19], textDim: PAL[20], textMute: PAL[21],
  accent: PAL[10], accent2: PAL[11], danger: PAL[8], ok: PAL[12], warn: PAL[9],
  outline: PAL[25], shadow: PAL[6],
  waveRef: PAL[18], waveRec: PAL[10],
  meterLow: PAL[13], meterOk: PAL[12], meterHot: PAL[8], meterOff: PAL[23],
  curtain: PAL[7], curtainDark: PAL[5], floor: PAL[5], floorDark: PAL[6],
  wall: PAL[24], wallDark: PAL[25], spot: PAL[11],
  skin: PAL[30], skinDark: PAL[31], hair: PAL[6],
  gradeS: PAL[11], gradeA: PAL[12], gradeB: PAL[17], gradeC: PAL[21],
};

// 플레이어 고유색 P1~P6 (명도·색상이 서로 뚜렷이 다르게 고름)
export const PLAYER_COLORS = [PAL[8], PAL[17], PAL[12], PAL[10], PAL[28], PAL[18]];
// 같은 플레이어의 어두운 색(옷 그림자·배너 테두리)
export const PLAYER_DARK = [PAL[7], PAL[16], PAL[13], PAL[9], PAL[27], PAL[17]];
// 팔레트 스왑에 쓰는 PAL 인덱스 (PLAYER_COLORS / PLAYER_DARK와 같은 순서)
export const PLAYER_COLOR_IDX = [8, 17, 12, 10, 28, 18];
export const PLAYER_DARK_IDX = [7, 16, 13, 9, 27, 17];

// 등급 → 색
export const GRADE_COLORS = { S: C.gradeS, A: C.gradeA, B: C.gradeB, C: C.gradeC };

// 기획 요약용 색 역할 표 {hex, role}
export const PALETTE_ROLES = [
  { hex: PAL[25], role: '가장 어두운 배경·레터박스·외곽선' },
  { hex: PAL[24], role: '배경·뒷벽' },
  { hex: PAL[23], role: 'UI 패널 채움·꺼진 미터 칸' },
  { hex: PAL[22], role: '패널 하이라이트' },
  { hex: PAL[21], role: 'UI 테두리·흐린 글자·C 등급' },
  { hex: PAL[20], role: '보조 글자' },
  { hex: PAL[19], role: '본문 글자' },
  { hex: PAL[10], role: '강조·포커스 테두리·내 파형·P4' },
  { hex: PAL[11], role: '강조2·스포트라이트·S 등급' },
  { hex: PAL[8], role: '위험·과입력 미터·P1' },
  { hex: PAL[9], role: '경고' },
  { hex: PAL[12], role: '정상·적정 미터·A 등급·P3' },
  { hex: PAL[13], role: '작은 입력 미터' },
  { hex: PAL[17], role: 'B 등급·P2' },
  { hex: PAL[18], role: '원본 파형·P6' },
  { hex: PAL[28], role: 'P5' },
  { hex: PAL[7], role: '커튼·P1 어두운 색' },
  { hex: PAL[5], role: '커튼 그림자·바닥' },
  { hex: PAL[6], role: '그림자·바닥 어두운 면·머리카락' },
  { hex: PAL[30], role: '피부' },
  { hex: PAL[31], role: '피부 그림자' },
];

// HEX → [r,g,b] (캐시)
const _rgbCache = new Map();
export function hexToRgb(hex) {
  let v = _rgbCache.get(hex);
  if (v) return v;
  const h = hex.replace('#', '');
  v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  _rgbCache.set(hex, v);
  return v;
}
