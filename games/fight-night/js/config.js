// =====================================================
// 매직 파이트 나이트 — 모든 수치 설정 (밸런스 조절은 여기서만)
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  MIN_PLAYERS: 2,
  MAX_PLAYERS: 5,

  RING: {
    FLOOR_Y: 140,     // 선수 발이 닿는 바닥 높이
    LEFT: 42,         // 로프 안쪽 경계 (넓힌 링)
    RIGHT: 278,
  },
  SCALE: 1.25,        // 선수 그림 크기 (거리 수치도 이 배율로 맞춰 둠)

  BOUT_TIME: 45 * 60,   // 한 경기 45초 (KO 가 없으면 판정)

  FIGHTER: {
    HP: 100,
    ACCEL: 0.22,        // 걸음 가속 (부드러운 출발)
    MAX_SPEED: 1.6,
    GUARD_SPEED: 1.6,   // 가드하며 뒷걸음 (앞걸음과 같은 속도)
    FRICTION: 0.8,      // 키를 떼면 미끄러지듯 멈춤
    DASH_SPEED: 3.8,    // 앞키 두 번 = 대시
    DASH_WINDOW: 9,     // 두 번 누르는 간격 (짧게: 실수로 대시가 나가지 않게)
    BODY_W: 18,         // 몸통 반폭 (서로 겹치지 않게)
    CHARGE_TIME: 20,    // 이만큼 누르고 있다 떼면 강펀치
    CHARGE_MOVE: 0.75,  // 강펀치 모으는 동안 걷는 속도 비율
  },

  // 펀치: startup(준비) → active(판정) → recovery(회복)
  PUNCH: {
    jab: { startup: 4, active: 4, recovery: 9, range: 47, damage: 5, push: 2.3, stun: 14, hitstop: 4 },
    power: { startup: 7, active: 5, recovery: 22, range: 52, damage: 14, push: 5, stun: 26, hitstop: 9 },
  },
  // 슥빡 카운터: 펀치가 닿기 직전(SLIP_WINDOW 프레임 안)에 가드를 시작하면 슥 피함
  //  → COUNTER_TIME 안에 펀치를 맞히면 피해 COUNTER_MUL 배 '빡!'
  COUNTER: {
    SLIP_WINDOW: 8,
    COUNTER_TIME: 40,
    COUNTER_MUL: 2,
    ATTACKER_STAGGER: 14, // 헛친 상대가 비틀거리는 시간 (카운터 칠 틈)
  },
  GUARD: {
    DAMAGE_MUL: 0.15,   // 가드하면 피해 15%
    PUSH_MUL: 0.5,
    BREAK_POWER: true,  // 강펀치는 가드를 뚫고 비틀거리게 함 (피해는 줄어듦)
  },

  // 개인 화면 모드: CPU 3연전
  GAUNTLET: {
    LEVELS: [0.35, 0.55, 0.75],  // CPU 실력 (높을수록 잘 막고 잘 때림)
    WIN: 100,                    // 이기면
    KO_BONUS: 50,                // KO 로 이기면 추가
    HP_BONUS: 1,                 // 남은 체력 1당
  },

  // 토너먼트 순위별 점수 (결과 화면 표시용)
  PLACE_SCORE: [500, 300, 200, 100, 50],

  // 메인 게임 누적 점수에 넘길 순위 점수 (1등 → 5등)
  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키보드 배치 (왼쪽 / 펀치 / 오른쪽 / 가드)
// 상대 쪽 키 = 앞으로 (두 번 누르면 대시) · 반대쪽 키 = 뒤로 · 가드 키(펀치 키 아래) = 가드
const KEYMAP = [
  { left: 'KeyQ', skill: 'KeyW', right: 'KeyE', down: 'KeyS', keys: ['Q', 'W', 'E', 'S'], label: 'Q W E S' },
  { left: 'KeyR', skill: 'KeyT', right: 'KeyY', down: 'KeyG', keys: ['R', 'T', 'Y', 'G'], label: 'R T Y G' },
  { left: 'KeyU', skill: 'KeyI', right: 'KeyO', down: 'KeyK', keys: ['U', 'I', 'O', 'K'], label: 'U I O K' },
  { left: 'KeyZ', skill: 'KeyX', right: 'KeyC', down: 'KeyV', keys: ['Z', 'X', 'C', 'V'], label: 'Z X C V' },
  { left: 'ArrowLeft', skill: 'ArrowUp', right: 'ArrowRight', down: 'ArrowDown', keys: ['<', '^', '>', 'v'], label: '← ↑ → ↓' },
];

// 개인 화면 모드 공용 조작 (←/→ 이동·가드, Space 펀치)
const SOLO_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: [],
  down: ['ArrowDown', 'KeyS'],
  skill: ['Space', 'Enter', 'ArrowUp'],
};
