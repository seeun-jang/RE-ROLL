// =====================================================
// 교수님 몰래 댄스! — 화면 쪽 설정 (원본 js/config.js)
//  판정에 쓰는 숫자는 서버(server/party/games/sneaky/config.py)가 정하고,
//  게임이 시작될 때 options.config 로 받아 여기 값을 덮어쓴다(applyServerConfig).
// =====================================================
export const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 화면 로직 60 FPS 고정
  MAX_SCALE: 6,

  CLASS_TIME: 60 * 60,      // 수업 시간 60초 (프레임)
  SMALL_RATE: 6,            // 작은 춤: 초당 6점
  BIG_RATE: 15,             // 큰 춤: 초당 15점
  BIG_RECOVER: 14,          // 큰 춤을 멈추고 자리에 앉기까지
  FEVER: [1, 1.5, 2, 3],    // 피버 배수
  CAUGHT_PENALTY: 20,       // 걸리면 깎이는 점수
  PUNISH_TIME: 150,         // 벌서기 시간
  MAX_STRIKES: 3,           // 이만큼 걸리면 복도로
  GRACE: 12,                // 교수님이 보기 시작한 뒤 유예(통신 지연용)
  SEE_FROM: 0.55,           // 돌아보는 동작의 이 지점부터 보임
  FLOW: { INTRO_TIME: 4.0, END_HOLD: 170 / 60, FINAL_TIME: 8.0 },
};

/** 서버가 보낸 설정으로 덮어쓴다 */
export function applyServerConfig(options) {
  const c = (options && options.config) || {};
  for (const k of Object.keys(c)) if (k in CONFIG) CONFIG[k] = c[k];
  if (options && typeof options.seeFrom === 'number') CONFIG.SEE_FROM = options.seeFrom;
}

// 동물 id(대기실에서 고른 캐릭터) → 원본 그림 파일 이름과 이름표 색(팔레트 키)
export const CHARACTER_DEFS = {
  bear: { id: 'bear', sprite: 'bear', color: 'e' },
  cat: { id: 'cat', sprite: 'cat', color: 'q' },
  duck: { id: 'duck', sprite: 'duck', color: 't' },
  tiger: { id: 'tiger', sprite: 'tiger', color: '8' },
  shiba: { id: 'shiba', sprite: 'shiba', color: 'p' },
};
export const CHARACTER_ORDER = ['shiba', 'tiger', 'duck', 'bear', 'cat'];

// 조작키 (각자 자기 키보드): 누르고 있는 동안 춤춘다
export const KEYS = {
  big: ['KeyZ', 'ArrowLeft', 'ArrowRight'],   // 큰 춤
  small: ['KeyX', 'Space', 'ArrowUp'],        // 작은 춤
  mute: 'KeyM',
};
