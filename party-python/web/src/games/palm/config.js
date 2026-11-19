// =============================================================
// config.js — 게임의 모든 튜닝 수치를 모아둔 곳
//   - 단위: 별도 표기가 없으면 "프레임"(1/60초) 기준
//   - 균형(balance) 값: -100(뒤로 넘어짐) ~ 0(안정) ~ +100(앞으로 넘어짐)
//     ※ 균형 값은 각 캐릭터 "자기 기준"이다. +는 상대 쪽(앞), -는 등 쪽(뒤).
//   - 속도/충격량 단위: 균형 단위/프레임
//     (감쇠 DAMPING=0.92 기준, 충격량 I 는 대략 I × 12.5 만큼 균형을 움직인다)
// =============================================================

export const CONFIG = {
  // ---------------- 화면 ----------------
  SCREEN: {
    W: 320, // 내부 해상도 (가로)
    H: 180, // 내부 해상도 (세로)
    MAX_SCALE: 6, // 정수배 확대 상한
    LOGIC_FPS: 60, // 게임 로직 고정 프레임
  },

  // ---------------- 무대 배치 (픽셀 좌표) ----------------
  STAGE: {
    CENTER_X: 160,
    P1_X: 153, // 왼쪽(플레이어) 발 중심 x
    P2_X: 167, // 오른쪽(CPU 챔피언) 발 중심 x
    FLOOR_Y: 136, // 받침대(징검돌) 윗면 y — 발바닥이 닿는 줄
    WATER_Y: 142, // 개울 수면 y
    STONE_W: 12, // 징검돌 폭
    MAX_SHEAR: 4, // 균형이 끝에 가까울 때 상체 기울임(행 단위 시어) 최대 px — 발은 고정
  },

  // ---------------- 대결 ----------------
  MATCH: {
    TIME_LIMIT: 30, // 제한 시간(초)
    COUNTDOWN: 3, // 카운트다운(초)
    WOBBLE_START: 12, // 이 시간(초)부터 받침대가 흔들리기 시작
    END_SLOWMO: 0.25, // 승부가 난 순간 슬로모션 배율
    END_SLOWMO_FRAMES: 70, // 슬로모션 지속(실제 프레임)
    RESULT_DELAY: 150, // 넘어진 뒤 결과 화면까지 대기(프레임)
    SEED: 20261102, // 흔들림 패턴 시드 — 모든 플레이어가 같은 조건에서 싸우도록 고정
  },

  // ---------------- 균형 물리 ----------------
  BALANCE: {
    LIMIT: 100, // |균형| 이 이 값에 닿으면 발이 떨어져 패배
    DAMPING: 0.92, // 속도 감쇠 (매 프레임 곱함)
    RECOVER: 0.0006, // 자연 복원력 (중앙으로 당기는 스프링 계수) — "균형 회복 속도"
    TIP: 0.0012, // 넘어지려는 성질: 많이 기울수록 더 기운다 (|균형| 50 부근부터 복원력보다 커짐)
    LEAN_FORCE: 0.065, // A/D 입력 시 가해지는 힘
    MAX_SPEED: 7, // 속도 상한
    SWAY_BASE: 0.026, // 기본 흔들림 힘 크기
    SWAY_GROWTH: 0.016, // 받침대 흔들림 시작 후 추가되는 흔들림 힘(최대)
    SWAY_NOISE: 0.02, // 무작위 흔들림 성분
    DANGER: 70, // 이 이상 기울면 땀방울 + 경고 연출
    STAGGER_THRESHOLD: 3.2, // 이 이상의 충격량을 받으면 "휘청임" 상태
    STAGGER_FRAMES: 28, // 휘청임 지속 시간
    STAGGER_LEAN_MULT: 0.35, // 휘청임 중 A/D 효율
    HOLD_LEAN_MULT: 0.5, // 버티는 중 A/D 효율 (자세를 고정하고 있으니까)
    HOLD_SWAY_MULT: 0.4, // 버티는 중 흔들림 감소율
    CHARGE_DRIFT: 0.012, // 차지 중 앞으로 쏠리는 힘
  },

  // ---------------- 행동 타이밍 ----------------
  ACTION: {
    // 밀기 (J)
    PUSH_WINDUP: 7, // 짧게 눌렀을 때 준비 동작 (이 동안 떼면 '툭' 밀기)
    PUSH_ACTIVE: 5, // 판정 프레임
    PUSH_RECOVER: 14, // 후딜레이
    CHARGE_MAX: 50, // 차지가 가득 찰 때까지 (준비 동작 이후)
    CHARGE_OVERHOLD: 70, // 가득 찬 뒤 이만큼 더 들고 있으면 자동으로 발사
    CHARGE_RELEASE: 3, // 차지 해제 후 실제로 손이 나갈 때까지
    CHARGE_ACTIVE: 7,
    CHARGE_RECOVER: 22,
    // 손 빼기 / 페인트 (K)
    FEINT_WINDOW: 16, // 이 동안 상대 밀기가 닿으면 헛손질 유도 성공
    FEINT_RECOVER: 16, // 페인트 후 무방비 시간
    FEINT_STREAK_DECAY: 0.6, // 연속으로 페인트하면 판정 창이 이 비율로 줄어든다 (K 연타 방지)
    FEINT_STREAK_RESET: 45, // 페인트가 끝나고 이만큼 쉬면 연속 횟수 초기화
    FEINT_MIN_WINDOW: 4, // 연속 페인트 시 최소 판정 창
    // 버티기 (L)
    HOLD_STARTUP: 4, // 자세 잡는 중 — 이때 밀리면 "버티기 실패"
    HOLD_STAMINA: 90, // 최대 버티기 지속 (프레임)
    HOLD_REGEN: 0.5, // 버티지 않을 때 스태미나 회복/프레임
    HOLD_MIN_STAMINA: 20, // 이보다 적으면 버티기 시작 불가
    HOLD_RECOVER: 6, // 버티기 해제 후딜레이
  },

  // ---------------- 충격량 (상성) ----------------
  IMPACT: {
    PUSH: 2.3, // 툭 밀기 기본 충격량 (받는 쪽 뒤로)
    CHARGE_MULT_MAX: 2.3, // 차지 100%일 때 위력 배율
    PUSH_RECOIL: 0.3, // 밀기 성공 시 미는 쪽이 받는 반동 (뒤로)
    FORWARD_LEAN_POWER: 0.4, // 앞으로 기울수록 미는 힘 증가 (최대 +40%)
    // 페인트 > 밀기
    WHIFF: 2.6, // 헛손질 시 미는 쪽이 앞으로 쏠리는 충격량 (× 밀기 위력)
    WHIFF_LEAN_MULT: 0.5, // 앞으로 기울어 있으면 헛손질 피해 증가 (최대 +50%)
    // 버티기 > 밀기
    HOLD_ABSORB: 0.25, // 버티기 성공 시 받는 충격 비율
    HOLD_REBOUND: 1.7, // 버티기 성공 시 미는 쪽이 튕겨나는 충격량 (× 위력 ^ 0.5)
    HOLD_FAIL_MULT: 1.25, // 버티기 자세 잡는 중에 맞으면 피해 증가
    HOLD_BREAK_MULT: 0.3, // 차지 밀기는 버티기를 일부 뚫는다 (차지 100% 시 받는 비율 +30%)
    // 페인트 > 버티기
    FEINT_VS_HOLD: 3.4, // 버티던 쪽이 앞으로 고꾸라지는 충격량
    // 그 외
    FEINT_EMPTY: 0.5, // 아무도 안 밀었는데 손을 뺀 경우 살짝 앞으로 쏠림
    COUNTER_MULT: 1.2, // 준비/차지 중에 맞으면 피해 증가 (카운터)
    EXPOSED_MULT: 1.35, // 페인트 후딜레이 중에 맞으면 피해 증가
    STAGGER_MULT: 1.15, // 휘청이는 중 맞으면 피해 증가
    CLASH: 1.5, // 서로 동시에 밀었을 때 기본 충격량
    STAMINA_EMPTY_LURCH: 1.2, // 버티다가 힘이 빠지면 앞으로 쏠림
  },

  // ---------------- 연출 ----------------
  JUICE: {
    HITSTOP_PUSH: 4,
    HITSTOP_CHARGE: 9,
    HITSTOP_CLASH: 7,
    HITSTOP_WHIFF: 5,
    HITSTOP_HOLD: 5,
    SHAKE_PUSH: 2,
    SHAKE_CHARGE: 5,
    SHAKE_CLASH: 3,
    SHAKE_WHIFF: 2,
    SHAKE_FALL: 6,
    SHAKE_DECAY: 0.85,
    ANIM_FPS: 10, // 스프라이트 애니메이션 속도 (8~12 FPS 느낌)
    CAMERA_FOLLOW: 0.08, // 카메라가 무게중심을 따라가는 정도
    CAMERA_RANGE: 6, // 카메라 최대 이동(px)
  },

  // ---------------- 점수 ----------------
  //   점수 = (승리 ? WIN_BONUS : 0)
  //        + 남은 균형(0~100) × BALANCE_POINT
  //        + 성공한 페인트 수(연타 제외, 최대 FEINT_MAX_COUNT) × FEINT_POINT
  //        + 성공한 버티기 수 × HOLD_POINT
  //        + 맞힌 밀기 수 × PUSH_POINT
  //        + (KO 승리 시) 남은 초 × TIME_POINT
  SCORE: {
    WIN_BONUS: 1000,
    BALANCE_POINT: 5,
    FEINT_POINT: 150,
    FEINT_MAX_COUNT: 5, // 한 판에서 점수로 인정하는 페인트 성공 최대 횟수
    HOLD_POINT: 80,
    PUSH_POINT: 30,
    TIME_POINT: 20,
    TIME_ONLY_ON_KO: true, // 남은 시간 점수는 상대를 떨어뜨려 이겼을 때만
  },

  // ---------------- CPU 챔피언 ----------------
  CPU: {
    NAME: '마을 챔피언',
    REACTION_FRAMES: 18, // CPU가 보는 상황은 이만큼 과거 (반응 속도 ≈ 300ms)
    REACTION_JITTER: 6, // 반응 속도 흔들림 (±프레임)
    DECISION_INTERVAL: 16, // 이 간격(프레임)마다 행동을 새로 결정
    AI_TIMEOUT_MS: 350, // 비동기 결정이 이보다 늦으면 기본 행동(fallback) 사용
    STABILIZE_DEADZONE: 6, // 균형 보정 데드존
    STABILIZE_LOOKAHEAD: 8, // 균형 보정 시 속도 예측 프레임
    STABILIZE_SKILL: 0.85, // 0~1, 균형 보정 정확도
    AGGRESSION: 0.3, // 0~1, 밀기 선호도
    SKILL: 0.55, // 0~1, 판단 정확도 (낮을수록 실수/무작위성 증가)
    READ_CHANCE: 0.4, // 0~1, 플레이어 패턴/차지를 '읽고' 대응할 확률
    MEMORY_SIZE: 24, // 기억하는 플레이어 행동 개수
    MEMORY_PERSIST: false, // true면 플레이어가 바뀌어도 패턴 기억 유지 (공정성 위해 기본 false)
    HOLD_DURATION: 36, // 'hold' 결정 시 기본 유지 프레임
  },

  // ---------------- 진행 ----------------
  FLOW: {
    DEFAULT_PLAYERS: 5,
    MAX_PLAYERS: 5,
    TRANSITION_FRAMES: 30, // 화면 전환 길이
  },

  // ---------------- 폰트 ----------------
  FONT: {
    CSS_URL: 'https://cdn.jsdelivr.net/npm/galmuri@2.40.3/dist/galmuri.css',
    LOAD_TIMEOUT_MS: 2500,
  },
};

// 옵션으로 받은 값을 깊게 덮어써서 새 설정 객체를 만든다 (원본은 건드리지 않음)
export function mergeConfig(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(override)) {
    const b = base[key];
    const o = override[key];
    out[key] = b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object'
      ? mergeConfig(b, o)
      : o;
  }
  return out;
}
