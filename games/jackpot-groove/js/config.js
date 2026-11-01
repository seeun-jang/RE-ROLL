// =====================================================
// 잭팟 그루브 — 모든 수치 설정 (밸런스·판정 조절은 여기서만)
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정 (노트 위치는 오디오 시계로 그려서 프레임과 무관하게 부드러움)

  MIN_PLAYERS: 1,
  MAX_PLAYERS: 5,

  // 판정 범위 (초, ± 기준) — 넓을수록 쉬움
  JUDGE: {
    perfect: 0.045,
    great: 0.09,
    good: 0.135,
    holdEndGrace: 0.12, // 롱노트 끝나기 이만큼 전에 떼도 성공 처리
  },
  // 판정별 점수 비율 (PERFECT 100%)
  JUDGE_WEIGHT: { perfect: 1, great: 0.7, good: 0.35, miss: 0 },
  // 총점 1,000,000 = 판정 점수 900,000 + 최대 콤보 보너스 100,000
  SCORE_MAX: 1000000,
  SCORE_COMBO_PART: 100000,
  // 등급 (이 점수 이상)
  GRADES: [
    { grade: 'S', min: 950000, color: '9' },
    { grade: 'A', min: 880000, color: 'e' },
    { grade: 'B', min: 750000, color: 'h' },
    { grade: 'C', min: 600000, color: 'q' },
    { grade: 'D', min: 0, color: 'j' },
  ],

  FEVER_COMBO: 30,        // 이 콤보부터 피버 (반짝이는 연출)
  SYNC_STEP: 0.01,        // 타이틀 싱크 조절 단위 (10ms)
  SYNC_RANGE: 0.2,        // 싱크 조절 최대 ±200ms

  // 난이도: 노트가 떨어지는 시간(초) — 짧을수록 빠름
  DIFFICULTY: {
    easy: { label: '쉬움', stars: 1, approach: 1.45 },
    normal: { label: '보통', stars: 3, approach: 1.15 },
    hard: { label: '어려움', stars: 5, approach: 0.9 },
  },

  // 노트 속도 1~5 (3 = 기본): 떨어지는 시간에 곱함 — 숫자가 클수록 빠름
  SPEED_MUL: [1.35, 1.15, 1, 0.85, 0.72],

  // 자동 연주(시연 · 테스트) 실력 범위: 1 = 완벽
  BOT_SKILL: [0.6, 0.98],

  // 화면 배치 (함께 모드: 5칸 세로 레인)
  LAYOUT_TOGETHER: {
    COL_W: 64,      // 플레이어 한 칸 너비 (인원이 적으면 넓어짐, 최대 COL_MAX)
    COL_MAX: 100,
    LANE_W: 16,     // 레인 하나 너비 (인원이 적으면 넓어짐, 최대 LANE_MAX)
    LANE_MAX: 26,
    TOP: 33,        // 노트가 나타나는 높이 (위에 이름 · 콤보)
    JUDGE_Y: 112,   // 판정선
    NOTE: 'small',
  },
  // 개인 화면: 큰 레인 1개
  LAYOUT_PERSONAL: {
    X: 118,
    LANE_W: 28,
    TOP: 16,
    JUDGE_Y: 146,
    NOTE: 'big',
  },

  // 메인 게임 누적 점수에 넘길 순위 점수 (1등 → 5등)
  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키 3개 = 레인 3개 (왼쪽 / 가운데 / 오른쪽)
const KEYMAP = [
  { lanes: ['KeyQ', 'KeyW', 'KeyE'], keys: ['Q', 'W', 'E'], label: 'Q W E' },
  { lanes: ['KeyR', 'KeyT', 'KeyY'], keys: ['R', 'T', 'Y'], label: 'R T Y' },
  { lanes: ['KeyU', 'KeyI', 'KeyO'], keys: ['U', 'I', 'O'], label: 'U I O' },
  { lanes: ['KeyZ', 'KeyX', 'KeyC'], keys: ['Z', 'X', 'C'], label: 'Z X C' },
  { lanes: ['ArrowLeft', 'ArrowUp', 'ArrowRight'], keys: ['<', '^', '>'], label: '← ↑ →' },
];

// 개인 화면 모드: 방향키 ← ↑ → (또는 A S D) + 본인 키도 사용 가능
const SOLO_LANES = [
  ['ArrowLeft', 'KeyA'],
  ['ArrowUp', 'KeyS', 'ArrowDown'],
  ['ArrowRight', 'KeyD'],
];
