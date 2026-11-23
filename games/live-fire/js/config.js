// =====================================================
// 실거리 사격 — 군대 실거리 사격장(자동 표적)을 모티브로 한 5사로 동시 사격 (설정은 여기서만)
//  100m · 200m · 250m 에서 표적이 하나씩 올라옴 → 20발로 몇 개 맞히나
//  방향키 4개로 조준점을 움직이고 (놓으면 그 자리에 멈춤) · 발사 키로 격발
// =====================================================
const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 게임 로직 60 FPS 고정

  MIN_PLAYERS: 1,
  MAX_PLAYERS: 5,

  TARGETS: 20,              // 표적 수 (= 실탄 20발)
  MAG_SIZE: 10,             // 탄알집 1개 = 10발 (10발 쏘면 탄알집 교체)
  RELOAD_TIME: 80,          // 탄알집 교체 시간

  // 거리별 표적: y = 화면에서 표적 발 위치(사로 칸 기준), w·h = 크기, time = 서 있는 시간(프레임)
  DISTANCES: {
    100: { y: 68, w: 13, h: 20, time: 170, slots: [-12, 0, 12] },
    200: { y: 44, w: 9, h: 13, time: 200, slots: [-11, 1, 11] },
    250: { y: 28, w: 7, h: 10, time: 230, slots: [-9, 0, 9] },
  },
  TARGET_GAP: 36,           // 표적이 내려가고 다음 표적까지
  RISE_TIME: 10,            // 표적이 올라오는/넘어가는 시간

  // 조준 (사로 칸 안 좌표) — 방향키로 움직이고, 놓으면 그 자리에 멈춤
  AIM_START_Y: 60,          // 처음 조준 높이
  AIM_TOP_Y: 12,            // 위 한계
  AIM_BOTTOM_Y: 78,         // 아래 한계
  AIM_SPEED_X: 0.6,         // ←→ 조준 속도 (px/프레임)
  AIM_SPEED_Y: 0.7,         // ↑↓ 조준 속도
  AIM_RANGE: 27,            // 좌우 한계
  SWAY: 1.8,                // 호흡에 따른 흔들림 크기
  STEADY_TIME: 40,          // 조준점을 이만큼 가만히 두면 숨이 골라져서 흔들림이 줄어듦
  STEADY_SWAY: 0.55,        // 숨 고른 뒤 흔들림 배율
  RECOIL: 7,                // 반동 (총구가 튀어 올랐다가 제자리로)
  FIRE_COOLDOWN: 18,        // 연속 격발 최소 간격

  // 점수: 명중 1발 10점 + 빨리 맞힐수록 보너스 (표적이 다 올라온 뒤 0.5초마다 1점씩 줄어듦, 최대 5)
  HIT_POINTS: 10,
  QUICK_MAX: 5,
  QUICK_STEP: 30,

  // 사격 등급 (20발 기준 명중 수)
  GRADES: [
    { min: 18, name: '특등사수', color: '9' },
    { min: 15, name: '1급', color: 'e' },
    { min: 12, name: '2급', color: 'h' },
    { min: 10, name: '3급', color: 'k' },
    { min: 0, name: '불합격', color: '5' },
  ],

  // 개인 화면 모드 (나 + CPU 4명, 모두 같은 순서로 표적이 올라옴 → 내 점수를 그대로 비교)
  CPU_SKILL: [0.15, 0.9],   // 판마다 잘 쏘는 CPU · 못 쏘는 CPU 가 섞임

  RANK_POINTS: [10, 7, 5, 3, 1],
};

// 플레이어별 키 5개: 방향키 모양 4개(↑ ← ↓ →)로 조준 + 발사 키 (방향키 왼쪽 위)
//  skill = 발사 키. keys = 화면에 보여 줄 글자
const KEYMAP = [
  { up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD', skill: 'KeyQ', keys: { up: 'W', left: 'A', down: 'S', right: 'D', fire: 'Q' } },
  { up: 'KeyT', left: 'KeyF', down: 'KeyG', right: 'KeyH', skill: 'KeyR', keys: { up: 'T', left: 'F', down: 'G', right: 'H', fire: 'R' } },
  { up: 'KeyI', left: 'KeyJ', down: 'KeyK', right: 'KeyL', skill: 'KeyU', keys: { up: 'I', left: 'J', down: 'K', right: 'L', fire: 'U' } },
  { up: 'ArrowUp', left: 'ArrowLeft', down: 'ArrowDown', right: 'ArrowRight', skill: 'Slash', keys: { up: '^', left: '<', down: 'v', right: '>', fire: '/' } },
  { up: 'Numpad8', left: 'Numpad4', down: 'Numpad5', down2: 'Numpad2', right: 'Numpad6', skill: 'Numpad0', keys: { up: '8', left: '4', down: '5', right: '6', fire: '0' } },
];

// 개인 화면: 방향키 (또는 WASD) 조준 + Space 발사
const SOLO_KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  skill: ['Space', 'Enter'],
};
const SOLO_CAPS = { up: '^', left: '<', down: 'v', right: '>', fire: 'SP' }; // SP = Space
