// =====================================================
// 하노마노 — 5인 반응속도 카드게임 (설정은 여기서만)
//  차례대로 카드를 뒤집다가, 펼쳐진 카드 중 같은 과일이 '딱 5개'가 되면 종!
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  MIN_PLAYERS: 2,
  MAX_PLAYERS: 5,

  TIME_LIMIT: 150 * 60,     // 제한 시간 2분 30초 → 카드가 많은 순서로 순위
  TARGET: 5,                // 같은 과일이 정확히 이 개수일 때 종
  // 카드 구성: 과일마다 1개×4장, 2개×3장, 3개×3장, 4개×2장, 5개×1장 = 13장 × 4종 = 52장
  CARD_COUNTS: { 1: 4, 2: 3, 3: 3, 4: 2, 5: 1 },
  RULES_TIME: 900,          // 시작 전 규칙 설명 화면 (아무 키나 누르면 바로 시작, 15초 뒤 자동)
  FRUITS: [
    { id: 'cherry', name: '체리', color: '6' },
    { id: 'lemon', name: '레몬', color: '9' },
    { id: 'lime', name: '라임', color: 'd' },
    { id: 'grape', name: '포도', color: 'q' },
  ],

  TURN_TIME: [180, 90],     // 내 차례에 안 뒤집으면 자동으로 뒤집는 시간 (처음 3초 → 끝날 즈음 1.5초)
  WRONG_LOCK: 180,          // 틀리게 치면 3초 동안 종을 못 침
  COLLECT_PAUSE: 70,        // 맞혔을 때 카드 모으는 연출 시간
  WRONG_PAUSE: 50,

  // 개인 화면 모드 (나 + CPU 4명)
  CPU_REACTION: [26, 48],   // CPU 가 종을 치기까지 걸리는 프레임 (최소~최대, 0.43~0.8초)
  CPU_MISTAKE: 0.02,        // CPU 가 헷갈려서 틀리게 칠 확률 (아슬아슬한 순간)

  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키 3개: 양쪽 키 = 카드 뒤집기(내 차례), 가운데 = 종 치기
const KEYMAP = [
  { left: 'KeyQ', skill: 'KeyW', right: 'KeyE', keys: ['Q', 'W', 'E'], label: 'Q W E' },
  { left: 'KeyR', skill: 'KeyT', right: 'KeyY', keys: ['R', 'T', 'Y'], label: 'R T Y' },
  { left: 'KeyU', skill: 'KeyI', right: 'KeyO', keys: ['U', 'I', 'O'], label: 'U I O' },
  { left: 'KeyZ', skill: 'KeyX', right: 'KeyC', keys: ['Z', 'X', 'C'], label: 'Z X C' },
  { left: 'ArrowLeft', skill: 'ArrowUp', right: 'ArrowRight', keys: ['<', '^', '>'], label: '← ↑ →' },
];

// 개인 화면: ←/→ 뒤집기, Space 종
const SOLO_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: [],
  down: [],
  skill: ['Space', 'Enter', 'ArrowUp'],
};
