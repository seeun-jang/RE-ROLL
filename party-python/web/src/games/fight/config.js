// =====================================================
// 매직 파이트 나이트 — 모든 수치 (원본 js/config.js 값 그대로)
// 같은 값이 서버 server/party/games/fight/config.py 에 있다. 판정은 서버가 하고,
// 여기 값은 그림(사거리 · 체력바 · 시계)과 시험용 진행기(sim)에만 쓴다.
// =====================================================
export const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  RING: {
    FLOOR_Y: 140,     // 선수 발이 닿는 바닥 높이
    LEFT: 42,         // 로프 안쪽 경계 (넓힌 링)
    RIGHT: 278,
  },
  SCALE: 1.25,        // 선수 그림 크기 (거리 수치도 이 배율로 맞춰 둠)

  BOUT_TIME: 45 * 60,   // 한 경기 45초 (KO 가 없으면 판정)

  FIGHTER: {
    HP: 100,
    ACCEL: 0.22,
    MAX_SPEED: 1.6,
    GUARD_SPEED: 1.6,
    FRICTION: 0.8,
    DASH_SPEED: 3.8,
    DASH_WINDOW: 9,
    BODY_W: 18,
    CHARGE_TIME: 20,
    CHARGE_MOVE: 0.75,
  },

  // 펀치: startup(준비) → active(판정) → recovery(회복)
  PUNCH: {
    jab: { startup: 4, active: 4, recovery: 9, range: 47, damage: 5, push: 2.3, stun: 14, hitstop: 4 },
    power: { startup: 7, active: 5, recovery: 22, range: 52, damage: 14, push: 5, stun: 26, hitstop: 9 },
  },
  COUNTER: { SLIP_WINDOW: 8, COUNTER_TIME: 40, COUNTER_MUL: 2, ATTACKER_STAGGER: 14 },
  GUARD: { DAMAGE_MUL: 0.15, PUSH_MUL: 0.5, BREAK_POWER: true },

  // 원본 bout.js 의 상수
  INTRO_LEN: 150,   // 소개 → 라운드 → FIGHT! 까지
  COUNT_START: 40,  // KO 후 카운트 시작
  COUNT_STEP: 10,   // 카운트 한 번 간격
  KO_TAIL: 110,
  DECISION_LEN: 170,
  HURRY: 10 * 60,

  // 리그전 점수 · 진행 (서버 config.py 의 SCORE · FLOW 와 같다)
  SCORE: { WIN: 1000, KO_BONUS: 50, HP_BONUS: 1 },
  FLOW: { ROUNDS_FOR_TWO: 3, INTRO_TIME: 4.0, END_HOLD: 0.5, RESULT_TIME: 4.0, FINAL_TIME: 9.0, SAY_GAP: 3.0 },
};

// 조작: 누구나 같은 키 (원본의 플레이어별 키 배치 대신)
export const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  punch: ['Space', 'KeyZ'],
  guard: ['ArrowDown', 'KeyS', 'KeyX'],
};
// 서버로 보내는 비트
export const BITS = { left: 1, right: 2, punch: 4, guard: 8 };
