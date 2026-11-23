// =====================================================
// 잭팟 탁구왕 — 모든 수치 설정 (밸런스 조절은 여기서만)
// 옆에서 본 탁구대: 왼쪽 선수 ↔ 오른쪽 선수
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정 (그릴 때는 프레임 사이를 보간)

  MIN_PLAYERS: 2,
  MAX_PLAYERS: 5,

  TABLE: {
    LEFT: 88,       // 탁구대 왼쪽 끝 (넓혀서 크게 보이게)
    RIGHT: 232,     // 탁구대 오른쪽 끝
    Y: 120,         // 탁구대 윗면 높이 (공이 튀는 곳) — 화면 아래로 내려 경기 영역을 넓힘
    NET_X: 160,
    NET_TOP: 108,   // 네트 꼭대기
  },
  FLOOR_Y: 150,     // 선수 발 / 공이 바닥에 떨어지는 높이
  // 선수가 움직일 수 있는 범위 (탁구대에 바짝 붙으면 탁구대 위 짧은 공도 칠 수 있음)
  ZONE: { NEAR: 84, FAR: 12 },  // 왼쪽 선수 기준 x (오른쪽은 대칭)

  GAME_POINTS: 3,       // 3점 먼저 내면 승리 (경기 시간 단축)
  DEUCE_CAP: 6,         // 2:2 듀스부터 2점 차가 나야 승리 (끝없이 길어지지 않게 6점 먼저면 승리)
  SERVE_EVERY: 2,       // 2점마다 서브권 교대
  POINT_PAUSE: 64,      // 득점 후 쉬는 시간 (프레임)
  AUTO_SERVE: 240,      // 서브를 안 넣으면 4초 뒤 자동 서브

  BALL: {
    GRAVITY: 0.11,
    SIZE: 5,
  },

  PLAYER: {
    ACCEL: 0.25,        // 부드러운 출발
    MAX_SPEED: 1.9,
    FRICTION: 0.75,
    REACH_X: 18,        // 라켓이 닿는 가로 거리
    REACH_TOP: 58,      // 발 기준 이 높이까지 닿음
    REACH_LOW: 4,
    SWING: 10,          // 휘두르는 시간 (이 안에 공이 들어오면 맞음)
    CHARGE_TIME: 20,    // 이만큼 꾹 누르면 스매시 준비 완료
  },

  // 샷 종류: T = 상대 코트에 떨어질 때까지 프레임 (작을수록 빠름)
  //  depth: 상대 코트의 어디쯤 떨어지나 (0 = 네트 바로 뒤, 1 = 끝선)
  //  bounce: 튀는 힘 (작으면 낮게 깔림)
  SHOTS: {
    drive: { name: '드라이브', T: 36, depth: [0.35, 0.75], bounce: 0.6 },
    drop: { name: '드롭', T: 40, depth: [0.3, 0.5], bounce: 0.5 }, // 짧게 떨어짐 → 앞으로 바짝 붙어야 받음
    lob: { name: '로브', T: 64, depth: [0.55, 0.85], bounce: 0.5 },
    smash: { name: '스매시', T: 20, depth: [0.5, 0.9], bounce: 0.55 },
    serve: { name: '서브', T: 34, depth: [0.5, 0.85], bounce: 0.7 },
  },
  // 공이 탁구대에 튈 때 가로 속도가 줄어드는 비율 (작을수록 탁구대 근처에 머묾 → 치기 쉬움)
  TABLE_GRIP: 0.78,
  SMASH_MIN_QUALITY: 0.35, // 스매시는 타이밍이 이보다 나쁘면 네트에 걸림
  CHANCE_QUALITY: 0.3,     // 타이밍이 이보다 나쁘면 높게 뜨는 '찬스볼'

  // 개인 화면 모드: CPU 3연전
  GAUNTLET: {
    LEVELS: [0.35, 0.6, 0.85], // CPU 실력 (높을수록 빨리 따라가고 정확함)
    WIN: 100,                  // 이기면
    POINT: 10,                 // 딴 점수 1점당
    STRAIGHT: 50,              // 상대를 1점 이하로 막으면 보너스
  },

  // 토너먼트 순위별 점수 (결과 화면 표시용)
  PLACE_SCORE: [500, 300, 200, 100, 50],

  // 메인 게임 누적 점수에 넘길 순위 점수 (1등 → 5등)
  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키 3개 (왼쪽 / 치기 / 오른쪽)
//  탁구대 쪽 키 = 앞으로 (누른 채 치면 짧게 '드롭'), 반대쪽 키 = 뒤로 (누른 채 치면 높게 '로브')
const KEYMAP = [
  { left: 'KeyQ', skill: 'KeyW', right: 'KeyE', keys: ['Q', 'W', 'E'], label: 'Q W E' },
  { left: 'KeyR', skill: 'KeyT', right: 'KeyY', keys: ['R', 'T', 'Y'], label: 'R T Y' },
  { left: 'KeyU', skill: 'KeyI', right: 'KeyO', keys: ['U', 'I', 'O'], label: 'U I O' },
  { left: 'KeyZ', skill: 'KeyX', right: 'KeyC', keys: ['Z', 'X', 'C'], label: 'Z X C' },
  { left: 'ArrowLeft', skill: 'ArrowUp', right: 'ArrowRight', keys: ['<', '^', '>'], label: '← ↑ →' },
];

// 개인 화면 모드 공용 조작 (←/→ 이동, Space 치기)
const SOLO_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: [],
  down: [],
  skill: ['Space', 'Enter', 'ArrowUp'],
};
