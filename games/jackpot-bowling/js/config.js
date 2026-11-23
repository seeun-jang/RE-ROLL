// =====================================================
// 잭팟 볼링 — 5레인 동시 볼링 (설정은 여기서만)
//  위치 잡기 → 방향 멈추기 → 힘 멈추기 → 굴러가는 동안 스핀(휘기)
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  MIN_PLAYERS: 1,
  MAX_PLAYERS: 5,

  FRAMES: 3,               // 프레임 수 (타이틀에서 3 · 5 · 10 선택, 진짜 볼링은 10)
  FRAME_CHOICES: [3, 5, 10],
  JACKPOT_BONUS: 3,        // 금색 '잭팟 핀'을 쓰러뜨리면 보너스 (+3점)
  JACKPOT_CHANCE: 0.25,    // 새로 세운 핀에 금색 핀이 섞여 있을 확률

  // 레인 (레인 좌표: x = 가운데 0 기준 좌우, y = 파울 라인 0 에서 핀 쪽으로 +)
  LANE: {
    HALF: 20,              // 레인 반폭 (이보다 바깥 = 거터)
    HEAD_Y: 54,            // 1번 핀까지 거리
    PIN_GAP_X: 9,          // 핀 가로 간격
    PIN_GAP_Y: 7,          // 핀 줄 간격
    PIN_R: 2.2,
    BALL_R: 3.2,
    PIT_Y: 80,             // 이보다 멀리 가면 핀 구덩이로 사라짐
    WALL: 25,              // 핀 데크 옆벽 (핀이 튕겨 나옴)
  },

  // 던지기
  MOVE_SPEED: 0.45,        // 위치 옮기는 속도 (px/프레임)
  START_RANGE: 17,         // 출발 위치 좌우 한계
  AIM_MAX: 0.2,            // 방향 화살표가 흔들리는 최대 기울기
  AIM_SPEED: 0.045,        // 방향 화살표 흔들림 속도
  POWER_PERIOD: 70,        // 힘 게이지가 한 번 오르내리는 프레임
  SPEED_MIN: 1.0,          // 힘 0 일 때 공 속도
  SPEED_MAX: 2.5,          // 힘 100% 일 때
  SPIN_BUDGET: 0.5,        // 굴러가는 중 좌우로 휠 수 있는 총량
  SPIN_ACCEL: 0.02,        // 한 프레임에 휘는 양

  SETTLE_TIME: 50,         // 공이 들어간 뒤 핀이 멈추길 기다리는 최대 시간
  RESULT_SHOW: 70,         // 스트라이크/스페어 표시 시간
  END_DELAY: 150,          // 모두 끝나고 결과로 넘어가기까지

  // 개인 화면 모드 (나 + CPU 4명, 레인은 서로 영향 없음 → 내 점수를 그대로 비교)
  CPU_SKILL: [0.15, 0.9],  // 실력 폭을 넓혀 순위 경쟁이 살아나게

  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키 3개: ← / → = 위치 옮기기·스핀, 가운데 = 멈추기(방향 → 힘)
const KEYMAP = [
  { left: 'KeyQ', skill: 'KeyW', right: 'KeyE', keys: ['Q', 'W', 'E'], label: 'Q W E' },
  { left: 'KeyR', skill: 'KeyT', right: 'KeyY', keys: ['R', 'T', 'Y'], label: 'R T Y' },
  { left: 'KeyU', skill: 'KeyI', right: 'KeyO', keys: ['U', 'I', 'O'], label: 'U I O' },
  { left: 'KeyZ', skill: 'KeyX', right: 'KeyC', keys: ['Z', 'X', 'C'], label: 'Z X C' },
  { left: 'ArrowLeft', skill: 'ArrowUp', right: 'ArrowRight', keys: ['<', '^', '>'], label: '← ↑ →' },
];

// 개인 화면: ← / → , Space
const SOLO_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: [],
  down: [],
  skill: ['Space', 'Enter', 'ArrowUp'],
};
