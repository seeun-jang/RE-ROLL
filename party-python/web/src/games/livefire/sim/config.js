// =============================================================
// 실거리 사격 수치 — 서버(server/party/games/livefire/config.py)와 같은 값.
// 원본 js/config.js 값을 그대로 옮겼다(좌표는 사로 한 칸 64×96 기준, 시간은 60분의 1초 = 1프레임).
// 시험용 진행기(sim)와 화면의 조준점 미리 그리기(예측)가 함께 쓴다.
// =============================================================
export const DEFAULT_CONFIG = {
  FPS: 60,

  TARGETS: 20,              // 표적 수 (= 실탄 20발)
  MAG_SIZE: 10,             // 탄알집 1개 = 10발
  RELOAD_TIME: 80,          // 탄알집 교체 시간

  // 거리별 표적: y = 표적 발 위치, w·h = 크기, time = 서 있는 시간(프레임), slots = 좌우 위치 후보
  DISTANCES: {
    100: { y: 68, w: 13, h: 20, time: 170, slots: [-12, 0, 12] },
    200: { y: 44, w: 9, h: 13, time: 200, slots: [-11, 1, 11] },
    250: { y: 28, w: 7, h: 10, time: 230, slots: [-9, 0, 9] },
  },
  COUNTS: { 100: 7, 200: 7, 250: 6 },
  LATE_TIME_MUL: 0.85,      // 뒤쪽 절반은 서 있는 시간이 짧아진다
  TARGET_GAP: 36,
  RISE_TIME: 10,
  EARLY_DROP: 25,

  AIM_START_Y: 60,
  AIM_TOP_Y: 12,
  AIM_BOTTOM_Y: 78,
  AIM_SPEED_X: 0.6,
  AIM_SPEED_Y: 0.7,
  AIM_RANGE: 27,
  SWAY: 1.8,
  STEADY_TIME: 40,
  STEADY_SWAY: 0.55,
  RECOIL: 7,
  KICK_DECAY: 0.82,
  FIRE_COOLDOWN: 18,

  HIT_POINTS: 10,
  QUICK_MAX: 5,
  QUICK_STEP: 30,

  GRADES: [
    { min: 18, name: '특등사수', color: '9' },
    { min: 15, name: '1급', color: 'e' },
    { min: 12, name: '2급', color: 'h' },
    { min: 10, name: '3급', color: 'k' },
    { min: 0, name: '불합격', color: '5' },
  ],

  // 통제관 방송 대본(원본 BRIEF / CEASE): [프레임, 대사]
  BRIEF: [[0, '사수 준비!'], [80, '탄알집 결합!'], [160, '조정간 단발!'], [240, '준비된 사수부터 사격 개시!']],
  BRIEF_END: 300,
  HALF_LINE: '탄알집 교체 후 계속 사격!',
  CEASE: [[0, '사격 끝! 사격 끝!'], [90, '조정간 안전! 탄알집 제거!']],
  CEASE_END: 230,
  GRADE_AT: 140,

  FINAL_TIME: 8,            // 최종 순위 화면(초) — 임시 값
  STATE_HZ: 30,
  SAY_GAP: 3,
  SCRIPT_GAP: 2,
};

// 누르고 있는 조준 키(비트)
export const LEFT = 1;
export const RIGHT = 2;
export const UP = 4;
export const DOWN = 8;

export function mergeConfig(override) {
  return { ...DEFAULT_CONFIG, ...(override || {}) };
}
