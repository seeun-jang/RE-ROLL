// =====================================================
// 교수님 몰래 댄스! — 교수님이 칠판에 쓰는 동안 몰래 춤추기 (5명 동시, 설정은 여기서만)
//  가운데 키 꾹 = 작은 춤 (바로 멈춤) · ←/→ 꾹 = 큰 춤 (점수 많이, 대신 멈추는 데 시간이 걸림)
//  교수님이 돌아볼 때 춤추고 있으면 딱 걸림 → 벌서기 · 3번 걸리면 복도로 쫓겨남
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  MIN_PLAYERS: 1,
  MAX_PLAYERS: 5,

  CLASS_TIME: 60 * 60,      // 수업 시간 60초

  // 춤 점수 (초당) · 큰 춤은 멈추는 데 시간이 걸림
  SMALL_RATE: 6,            // 작은 춤: 초당 6점
  BIG_RATE: 15,             // 큰 춤: 초당 15점
  BIG_RECOVER: 14,          // 큰 춤을 멈추고 자리에 앉기까지 (이동안도 춤추는 걸로 보임)
  FEVER: [1, 1.5, 2, 3],    // 교수님이 돌아봤을 때 얌전히 버티면 한 단계씩 올라감
  CAUGHT_PENALTY: 20,       // 걸리면 깎이는 점수
  PUNISH_TIME: 150,         // 벌서기 시간 (춤 못 춤)
  MAX_STRIKES: 3,           // 이만큼 걸리면 복도로 (남은 수업 동안 못 춤)

  // 교수님 (시간이 갈수록 빨라지고 교활해짐: 0 = 처음, 1 = 끝)
  TEACHER: {
    WRITE: [[100, 220], [55, 150]],   // 칠판에 쓰는 시간 [최소, 최대] (처음 → 끝)
    TELL: [[34, 52], [22, 36]],        // 돌아보기 전 낌새 (분필 멈춤 · 흠흠)
    TURN: 9,                          // 돌아보는 시간 (낌새 뒤)
    SUDDEN_TURN: 26,                  // 낌새 없이 갑자기 돌아볼 때 (천천히 돌아서 반응할 틈이 조금 있음)
    LOOK: [[60, 110], [70, 140]],     // 반 아이들을 보는 시간
    FAKE: [0.15, 0.35],               // 낌새만 주고 안 돌아볼 확률 (처음 → 끝)
    SUDDEN: [0.06, 0.2],              // 낌새 없이 갑자기 돌아볼 확률
    SEE_FROM: 0.55,                   // 돌아보는 동작의 이 지점부터 보임
  },

  END_DELAY: 170,

  // 개인 화면 모드 (나 + CPU 4명, 교수님 움직임은 seed 로 고정 → 내 점수를 그대로 비교)
  CPU_SKILL: [0.35, 0.8],

  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키 3개: ← / → = 큰 춤, 가운데 = 작은 춤 (모두 누르고 있는 동안)
const KEYMAP = [
  { left: 'KeyQ', skill: 'KeyW', right: 'KeyE', keys: ['Q', 'W', 'E'] },
  { left: 'KeyR', skill: 'KeyT', right: 'KeyY', keys: ['R', 'T', 'Y'] },
  { left: 'KeyU', skill: 'KeyI', right: 'KeyO', keys: ['U', 'I', 'O'] },
  { left: 'KeyZ', skill: 'KeyX', right: 'KeyC', keys: ['Z', 'X', 'C'] },
  { left: 'ArrowLeft', skill: 'ArrowUp', right: 'ArrowRight', keys: ['<', '^', '>'] },
];

// 개인 화면: ← / → , ↑ 또는 Space
const SOLO_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: [],
  down: [],
  skill: ['Space', 'Enter', 'ArrowUp'],
};
