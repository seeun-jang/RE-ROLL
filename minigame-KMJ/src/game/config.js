// 게임 밸런스와 설정값을 한곳에 모아둔 파일입니다.
// 숫자만 바꿔도 난이도를 조절할 수 있어요.

// 팀장이 공통 규격(예: 'game-a')을 정해주면 이 값만 바꾸면 됩니다.
export const GAME_ID = 'minigame-KMJ';
export const GAME_TITLE = '트로이의 노래';
export const GAME_SUBTITLE = 'SONG OF TROY';

// 화면
export const WIDTH = 960;
export const HEIGHT = 540;
export const GROUND_Y = 462;

export const PLAYER_IDS = ['p1', 'p2'];
export const LANES = 4; // ← ↓ ↑ →
export const LANE_SYMBOLS = ['◀', '▼', '▲', '▶'];
export const LANE_COLORS = ['#ff5a5a', '#5ab4ff', '#7cf08a', '#ffd23f'];

// 노트 레인 위치 (P1 왼쪽, P2 오른쪽)
export const HIGHWAY = {
  laneWidth: 58,
  top: 70,
  judgeY: 432,
  x: { p1: 34, p2: 960 - 34 - 58 * 4 },
};

// 노트가 판정선까지 떨어지는 시간 (초). 작을수록 빠름
export const NOTE_LEAD = 1.0;

// 판정 범위 (초)
export const JUDGE = {
  perfect: 0.045,
  great: 0.09,
  good: 0.135,
};

export const SCORE = {
  perfect: 300,
  great: 200,
  good: 100,
  comboStep: 25, // 이 콤보마다 점수 배율 +0.5 (최대 x2.5) & 신의 창 발동
  maxMult: 2.5,
  divineBonus: 500,
};

// 영웅이 서 있는 곳 (가운데 무대)
export const STAGE = {
  p1: 318,
  p2: 642,
  push: 30, // 점수 차이에 따라 밀리는 최대 거리
  heroScale: 1.12,
  // 공격 기술별 돌진 거리와 타이밍은 moves.js
};

export const END_DELAY = 3.8; // 노래가 끝나고 결과 화면까지

// 승자의 마무리 일격 (노래가 끝난 뒤 몇 초에 무엇을 하는지)
export const FINISHER = {
  leapAt: 0.5, // 뛰어오르기 시작
  strikeAt: 0.78, // 창이 꽂히는 순간
  fallTime: 0.4, // 진 쪽이 쓰러지는 시간
  victoryAt: 1.5, // 승리 자세
};

export const NAME_MAX = 10; // 플레이어 이름 최대 글자 수

export const PLAYER_INFO = {
  p1: {
    label: 'P1',
    color: '#ff5a3c',
    keyLabels: ['A', 'S', 'W', 'D'],
  },
  p2: {
    label: 'P2',
    color: '#3cb4ff',
    keyLabels: ['←', '↓', '↑', '→'],
  },
};

// KeyboardEvent.code 값 (레인 순서: ← ↓ ↑ →)
export const KEYS = {
  p1: ['KeyA', 'KeyS', 'KeyW', 'KeyD'],
  p2: ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'],
};
