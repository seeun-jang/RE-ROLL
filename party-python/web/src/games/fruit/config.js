// ============================================================
//  화면·연출·입력 설정 상수 (원본 그대로)
//  ※ 멀티플레이에서 점수·시간·과일 생성 규칙은 서버(server/party/games/fruit/config.py)가 정한다.
//    이 파일의 RULES / SCORE / SPAWN 값은 쓰이지 않고, 같은 값이 sim/rules.js 에 있다.
//  (좌표/속도 단위는 전부 논리 해상도 320×180 픽셀 기준)
// ============================================================

export const VIEW = { W: 320, H: 180 };

export const TIMING = {
  FIXED_DT: 1 / 60, // 게임 로직 고정 스텝 (60 FPS)
  MAX_FRAME_DT: 0.1, // 탭 전환 등으로 생긴 큰 프레임 간격 제한
  ANIM_FPS: 10, // 스프라이트 애니메이션 체감 속도 (8~12 FPS)
  ROT_STEPS: 16, // 회전을 16단계로 끊어 도트 느낌 유지
};

export const RULES = {
  DURATION: 60, // 제한 시간(초)
  COUNTDOWN: 3, // 시작 전 카운트다운
  MAX_HEARTS: 3, // 폭탄을 이만큼 베면 게임 오버
  WARNING_TIME: 10, // 남은 시간이 이 이하이면 경고
  TIME_UP_DELAY: 1.6, // TIME UP 연출 후 결과 화면까지
  GAMEOVER_DELAY: 1.4,
};

export const SCORE = {
  BOMB_PENALTY: 20, // 폭탄을 베면 깎이는 점수
  COMBO_MIN: 3, // 이 이상 연속으로 베면 콤보
  COMBO_BONUS_PER_FRUIT: 5, // 콤보 보너스 = 개수 × 이 값
  COMBO_WINDOW: 0.32, // 이 시간 안에 다음 과일을 베야 콤보 유지
  ITEM_POINTS: 5,
  MAX: 999999,
};

export const PHYSICS = {
  GRAVITY: 150,
  SPAWN_Y: 198, // 화면 아래(보이지 않는 곳)에서 던져 올림
  APEX_MIN_Y: 20, // 최고점 범위 (화면 위에서부터)
  APEX_MAX_Y: 74,
  SPAWN_X_MIN: 36,
  SPAWN_X_MAX: 284,
  TARGET_X_MIN: 70,
  TARGET_X_MAX: 250,
  SPIN_MAX: 3.5, // 최대 회전 속도 (rad/s)
  OFFSCREEN_MARGIN: 28,
  HALF_SPLIT_SPEED: 38, // 반쪽 과일이 갈라지는 속도
  HALF_SPIN: 5,
};

export const SPAWN = {
  INTERVAL_START: 1.45, // 웨이브 간격 (시작 → 끝으로 점점 빨라짐)
  INTERVAL_END: 0.72,
  WAVE_MIN_START: 1,
  WAVE_MAX_START: 2,
  WAVE_MIN_END: 2,
  WAVE_MAX_END: 5,
  STAGGER: 0.13, // 한 웨이브 안에서 과일끼리 던지는 간격
  BOMB_CHANCE_START: 0.1,
  BOMB_CHANCE_END: 0.3,
  ITEM_CHANCE: 0.09,
  ITEM_COOLDOWN: 8,
  FIRST_ITEM_AFTER: 6,
  FRENZY_MULTIPLIER: 3, // 세배 생성 아이템 효과
  FRENZY_BOMB_SCALE: 0.35, // 세배 생성 중엔 폭탄 확률 감소
  MAX_OBJECTS: 30,
  DEMO_INTERVAL: 1.2, // 타이틀 화면 데모 과일
};

export const ITEMS = {
  DOUBLE: { id: 'double', duration: 8, multiplier: 2 },
  TRIPLE: { id: 'triple', duration: 6 },
  ACTIVATE_DELAY: 0.14, // 자르는 소리 뒤 활성화 소리가 나도록 약간 지연
};

export const BLADE = {
  TRAIL_TIME: 0.12, // 칼 궤적이 남는 시간
  MIN_SLICE_SPEED: 60, // 이보다 느리게 움직이면 베지 못함 (px/s)
  SWING_SOUND_SPEED: 520,
  SWING_SOUND_COOLDOWN: 0.22,
  MAX_THICKNESS: 3,
};

export const MOTION = {
  VIDEO_W: 640,
  VIDEO_H: 480,
  MARGIN: 0.12, // 카메라 가장자리 12%는 잘라서 화면 끝까지 손이 닿게
  SMOOTHING: 0.6, // 0~1, 클수록 손떨림 보정이 약함(반응 빠름)
  ACTIVE_SPEED: 240, // 손이 이 속도 이상이면 칼날 활성화
  INACTIVE_SPEED: 120, // 이 속도 이하로 떨어지면 비활성화 (히스테리시스)
  INACTIVE_HOLD: 0.12,
  LOST_TIMEOUT: 0.3, // 손이 안 보인 지 이 시간이 지나면 커서 숨김
  INDEX_TIP: 8, // MediaPipe 랜드마크 번호: 검지 끝
  WASM_PATH: './mediapipe/wasm',
  MODEL_URLS: [
    './models/hand_landmarker.task', // tools/download_model.py 로 받은 로컬 파일 (있으면 우선)
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  ],
};

export const JUICE = {
  HITSTOP_FRUIT: 0.022,
  HITSTOP_ITEM: 0.07,
  HITSTOP_BOMB: 0.3,
  SHAKE_FRUIT: 1.2,
  SHAKE_ITEM: 3,
  SHAKE_BOMB: 8,
  SHAKE_DECAY: 16,
  PARTICLES_FRUIT: 14,
  PARTICLES_BOMB: 46,
  SPLAT_LIFE: 2.8,
  FLASH_BOMB: 0.4,
  FLASH_ITEM: 0.18,
  POPUP_LIFE: 0.75,
};

// 과일 종류 — sprite 이름은 assets/spriteData.js 와 맞춘다 (색은 팔레트 인덱스)
export const FRUITS = [
  { id: 'apple', sprite: 'apple', points: 10, radius: 8, weight: 3, juice: [2, 3, 12], flesh: { line: 12, band: 4 } },
  { id: 'orange', sprite: 'orange', points: 10, radius: 8, weight: 3, juice: [3, 4], flesh: { line: 4, band: 3, rind: 12 } },
  { id: 'lemon', sprite: 'lemon', points: 10, radius: 8, weight: 2, juice: [4, 12], flesh: { line: 12, band: 4, rind: 12 } },
  { id: 'berry', sprite: 'berry', points: 15, radius: 8, weight: 2, juice: [9, 10, 1], flesh: { line: 5, band: 9 } },
  { id: 'melon', sprite: 'melon', points: 20, radius: 10, weight: 1, juice: [2, 12], flesh: { line: 3, band: 2, rind: 5, seed: 0 } },
];

export const BOMB_DEF = { id: 'bomb', sprite: 'bomb', radius: 7 };

export const ITEM_DEFS = {
  double: { id: 'double', sprite: 'star', radius: 9, juice: [4, 3, 12], flesh: { line: 12, band: 4 }, label: 'x2 SCORE' },
  triple: { id: 'triple', sprite: 'prism', radius: 9, juice: [2, 4, 6, 10], flesh: { line: 12, band: 11 }, label: 'FRUIT x3' },
};

export const AUDIO = {
  MASTER: 0.8,
  SFX: 0.9,
  MUSIC: 0.42,
  BPM: 138,
  BPM_HURRY: 156,
  LOOKAHEAD: 0.12, // 음악 스케줄러가 미리 예약하는 시간(초)
};

export const LEADERBOARD = {
  API: './api/scores',
  LOCAL_KEY: 'fruit-slicer.scores',
  NAME_KEY: 'fruit-slicer.name',
  NAME_MAX: 8,
  TOP_N: 10,
};
