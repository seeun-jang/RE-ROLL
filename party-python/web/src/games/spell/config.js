// ============================================================
// 게임 전체 수치 설정 — 밸런스 조정은 이 파일에서만 한다.
// (주문 개별 수치는 data/spells.js, 적 수치는 data/enemies.js)
// ============================================================

export const CONFIG = Object.freeze({
  // 화면: 320x180 논리 해상도를 정수배로만 확대한다.
  VIEW: { WIDTH: 320, HEIGHT: 180, MIN_SCALE: 1, MAX_SCALE: 8 },

  // 고정 스텝 게임 루프 (로직 60FPS)
  LOOP: { STEP: 1 / 60, MAX_FRAME: 0.25 },

  // 스프라이트 애니메이션 기본 속도 (8~12FPS 느낌)
  ANIM_FPS: 10,

  // 화면 배치 (논리 픽셀)
  LAYOUT: {
    GROUND_Y: 118,      // 캐릭터 발 위치
    PLAYER_X: 64,       // 플레이어 중심 x
    ENEMY_X: 256,       // 적 중심 x
    HUD_H: 24,
    PANEL_Y: 130,       // 하단 주문서 패널 시작 y
  },

  PLAYER: { MAX_HP: 100, MAX_MANA: 100, MANA_REGEN: 6 },

  // ---- "위력(power)" : 지금은 키 홀드/느낌표, 나중에는 마이크 볼륨이 같은 값을 채운다 ----
  POWER: {
    TAP: 0.5,             // 짧게 눌렀을 때 위력
    HOLD_DEADZONE: 0.15,  // 이 시간 이상 눌러야 차지 시작(초)
    CHARGE_TIME: 0.85,    // 최대 위력까지 걸리는 시간(초)
    TEXT_BASE: 0.5,       // 타이핑 주문 기본 위력
    TEXT_BANG_STEP: 0.17, // 느낌표(!) 하나당 위력 증가
    TEXT_WHISPER: 0.25,   // "..." 으로 끝나면 속삭임
    MIN: 0.2,
    MAX: 1.0,
    // 위력 구간: mult = 데미지 배율, fx = 이펙트/흔들림 배율
    TIERS: [
      { min: 0.0, id: 'whisper', name: '속삭임', mult: 0.75, fx: 0.7 },
      { min: 0.4, id: 'normal', name: '보통', mult: 1.0, fx: 1.0 },
      { min: 0.7, id: 'loud', name: '큰 소리', mult: 1.3, fx: 1.4 },
      { min: 0.92, id: 'shout', name: '외침!', mult: 1.6, fx: 1.9 },
    ],
  },

  // 속성 상성 배율
  ELEMENT: { ADVANTAGE: 1.5, DISADVANTAGE: 0.5, ICE_SHIELD_VS_FIRE: 1.5 },

  // 콤보: 서로 다른 속성을 WINDOW초 안에 연속 시전
  COMBO: { WINDOW: 2.2, STEP_BONUS: 0.1, MAX_BONUS: 0.3 },

  // 주문 텍스트 유사도 매칭 (음성 인식 결과에도 그대로 쓰일 기준값)
  MATCH: {
    MIN_SCORE: 0.68,        // 0~1, 이 값 이상이어야 주문으로 인정
    SHORT_KEYWORD_LEN: 2,   // 음절 수가 이 이하인 키워드(예: 힐, 썬더)는 유사도 대신 정확 포함만 허용
    WINDOW_SLACK: 2,        // 부분 문자열 탐색 시 키워드 길이 ± 허용치(자모)
  },

  BATTLE: {
    TIME_LIMIT: 60,
    INTRO_TIME: 2.4,
    HITSTOP_BASE: 2,       // 프레임
    HITSTOP_POWER: 6,      // 위력 1.0일 때 추가 프레임
    SHAKE_BASE: 1.2,       // px
    SHAKE_POWER: 3.5,      // 위력 1.0일 때 추가 px
    CLASH_KEEP: 0.7,       // 상성 승리한 투사체가 상쇄 후 유지하는 위력 비율
    KNOCKBACK: 3,
  },

  // 사운드 (배경음은 낮게 — 나중에 마이크 재유입 방지)
  AUDIO: {
    MASTER: 0.7,
    MUSIC: 0.16,
    SFX: 0.6,
    DUCK_LEVEL: 0.3,       // 주문을 "듣는 중"일 때 배경음 비율
    DUCK_ATTACK: 0.06,
    DUCK_RELEASE: 0.45,
  },

  // 폰트 (Galmuri, SIL OFL) — 로컬 파일로 바꾸려면 index.html의 CSS 링크만 교체
  FONTS: {
    s: { family: 'Galmuri7', size: 8 },
    m: { family: 'Galmuri9', size: 10 },
    l: { family: 'Galmuri11', size: 12 },
  },
});

/** 위력(0~1)을 구간 정보로 변환 */
export function powerTier(power) {
  const tiers = CONFIG.POWER.TIERS;
  let t = tiers[0];
  for (const tier of tiers) if (power >= tier.min) t = tier;
  return t;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
