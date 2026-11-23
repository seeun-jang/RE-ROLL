// =====================================================
// 잭팟 인형뽑기 — 5대 동시 인형뽑기 (설정은 여기서만)
//  ←→ 집게 옮기기 · 가운데 키 = 집게 내리기 → 자동으로 집고 → 올리고 → 배출구로 → 놓기
//  코인 8개, 뽑은 인형 점수 합계로 순위
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  MIN_PLAYERS: 1,
  MAX_PLAYERS: 5,

  COINS: 8,                 // 한 사람 코인 (= 도전 횟수)
  MOVE_TIME: 8 * 60,        // 집게 옮기는 제한 시간 (지나면 자동으로 내려감)

  // 기계 안 (유리 안쪽 좌표: 가로 0~58, 세로 0~86, 아래가 바닥)
  BOX: {
    W: 58,
    H: 86,
    HOLE_W: 15,             // 왼쪽 배출구 폭
    WALL_TOP: 52,           // 배출구 칸막이 윗부분 높이 (인형이 커져서 칸막이도 높게 → 그냥 굴러 들어가지 않게)
    RAIL_Y: 6,              // 집게가 매달린 높이 (맨 위)
    HOME_X: 7,              // 집게 대기 자리 (배출구 위)
    MAX_X: 52,
  },

  // 집게
  CLAW: {
    MOVE: 0.55,             // ←→ 속도
    DROP: 0.9,              // 내려가는 속도
    LIFT: 0.8,              // 올라가는 속도
    CARRY: 0.65,            // 배출구로 가는 속도
    CLOSE_TIME: 16,         // 집게 오므리는 시간
    OPEN_TIME: 16,
    REACH: 3,               // 집게 끝에서 인형까지 이만큼 가까우면 집기 시도
  },
  // 집는 힘: 기계마다 매번 다름 (진짜 인형뽑기처럼) — 가운데를 잘 집을수록 · 가벼울수록 성공
  GRIP_MIN: 0.15,
  GRIP_MAX: 0.62,

  GRAVITY: 0.18,

  // 인형 종류: r = 크기(반지름), value = 점수, weight = 무게(무거울수록 잘 미끄러짐)
  PRIZES: {
    // (크기를 키워서 무슨 인형인지 잘 보이게: 인형 14px · 주사위 12px · 칩 10px · 황금곰 17px)
    bear: { r: 7, value: 10, weight: 1, name: '곰' },
    cat: { r: 7, value: 10, weight: 1, name: '고양이' },
    duck: { r: 7, value: 10, weight: 1, name: '오리' },
    tiger: { r: 7, value: 10, weight: 1, name: '호랑이' },
    shiba: { r: 7, value: 10, weight: 1, name: '시바' },
    dice: { r: 6, value: 15, weight: 0.8, name: '주사위' },
    chip: { r: 5, value: 5, weight: 0.85, name: '칩' },
    gold: { r: 8.5, value: 30, weight: 2.3, name: '황금곰' },
  },
  // 기계 하나에 들어가는 인형 (모든 기계가 같은 배치)
  LINEUP: ['bear', 'cat', 'duck', 'tiger', 'shiba', 'bear', 'tiger', 'shiba', 'dice', 'dice', 'chip', 'chip', 'gold'],

  END_DELAY: 150,

  // 개인 화면 모드 (나 + CPU 4명, 모든 기계가 같은 인형 배치 → 내 점수를 그대로 비교)
  CPU_SKILL: [0.15, 0.9],   // 판마다 잘하는 CPU · 못하는 CPU 가 섞임

  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키 3개: ← / → = 집게 옮기기, 가운데 = 집게 내리기
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
