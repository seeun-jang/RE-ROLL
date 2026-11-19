(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 픽셀 검도 — 수치 상수 모음
  // 이동 속도, 타격 판정 거리, 기합 게이지, 경기 시간, AI 반응 속도 등
  // 밸런스에 관련된 숫자는 모두 여기서만 조정한다.
  // 단위: 거리 = 픽셀(320×180 기준 화면), 시간 = 로직 틱(1/60초)
  // ─────────────────────────────────────────────────────────────
  PK.CONFIG = {
    SCREEN_W: 320,
    SCREEN_H: 180,
    TICK_MS: 1000 / 60,
    MAX_STEPS_PER_FRAME: 5,
    ANIM_TICKS: 6,               // 애니메이션 1프레임 = 6틱 (≈10 FPS 느낌)

    // 픽셀 폰트 (갈무리, SIL OFL 1.1). size 는 각 폰트가 선명하게 찍히는 크기
    FONT: {
      M: { family: 'Galmuri11', size: 12, lineH: 13 },
      S: { family: 'Galmuri9', size: 10, lineH: 11 },
      fallback: 'monospace',
      alphaCut: 110              // 이 알파값 이상만 픽셀로 남김 (안티앨리어싱 제거)
    },

    // 실제 이미지로 교체할 스프라이트: { '스프라이트이름': 'assets/img/파일.png' }
    ASSET_OVERRIDES: {},

    // ── 경기장 (월드 좌표) ──
    WORLD_W: 400,
    COURT_LEFT: 56,
    COURT_RIGHT: 344,
    COURT_CENTER: 200,
    START_GAP: 34,               // 중앙 ~ 개시선 거리 (두 선수 간격 68)
    GROUND_Y: 152,               // 선수 발 높이 (화면 y)
    FLOOR_TOP: 112,              // 바닥이 시작되는 화면 y
    REF_GROUND_Y: 124,           // 심판 발 높이 (경기장 뒤쪽)
    OUT_MARGIN: 3,               // 경계선을 이만큼 넘으면 장외

    // ── 이동 (밀어걷기 발놀림) ──
    MOVE: { ACCEL: 0.16, MAX: 1.15, FRICTION: 0.78, BLOCK_MUL: 0.45, KIAI_MUL: 0.85 },
    BODY_MIN_DIST: 16,           // 몸끼리 겹치지 않는 최소 거리
    CLINCH_DIST: 23,             // 이보다 가까우면 코등이 싸움
    CLINCH_WAKARE_TICKS: 150,    // 코등이 싸움이 이만큼 이어지면 "갈려!"

    // ── 타격 ──
    // startup: 준비(들어올림+디딤) 틱, 마지막 틱에 접촉 판정
    // contact: 접촉 순간 두 선수 중심 사이 거리 기준 판정 범위
    //   min 미만 = 너무 가까움(무효), idealLo~idealHi = 최적, max 초과 = 헛침
    STRIKES: {
      men:  { name: '머리', startup: 18, recover: 18, lunge: 12, whiffExtra: 22, contact: { min: 22, idealLo: 26, idealHi: 32, max: 37 } },
      kote: { name: '손목', startup: 13, recover: 14, lunge: 6,  whiffExtra: 18, contact: { min: 24, idealLo: 30, idealHi: 36, max: 40 } },
      do:   { name: '허리', startup: 20, recover: 20, lunge: 8,  whiffExtra: 24, contact: { min: 20, idealLo: 24, idealHi: 30, max: 34 } }
    },
    BLOCKED_EXTRA: 10,           // 막혔을 때 추가 경직
    DEFLECT_EXTRA: 12,           // 빈틈 없는 곳을 쳐서 튕겼을 때 추가 경직
    INPUT_BUFFER: 5,             // 공격 입력 선입력 허용 틱
    FEINT_CANCEL_MAX: 0.45,      // 준비 동작의 이 비율 전까지만 타격을 거둘 수 있다 (페인트)

    // ── 기합 게이지 ──
    KIAI: {
      MAX: 100,
      CHARGE: 1.1,               // Shift 누르고 있는 동안 틱당 증가
      DECAY: 0.22,               // 안 누를 때 틱당 감소
      REQUIRED: 45,              // 타격이 유효하려면 필요한 게이지
      COST: 40,                  // 유효 타격 1회 소모량
      TIMING_WINDOW: 20          // 접촉 전 이 틱 안에 Shift를 새로 누르면 "기검체일치"
    },

    // ── 기세(집중력) 게이지 — 체력 대신 ──
    MOMENTUM: {
      MAX: 100, REGEN: 0.06, SEME_GAIN: 0.05, RETREAT_DRAIN: 0.12, BLOCK_DRAIN: 0.03,
      WHIFF: 14, DEFLECTED: 10, BLOCKED: 8, PARRIED: 22, GOT_HIT: 8,
      BLOCK_GAIN: 4, PARRY_GAIN: 14,
      LOW: 30,                   // 이하이면 판정 감점
      STUN_TICKS: 80,            // 0이 되면 이만큼 경직
      STUN_RECOVER: 45           // 경직이 풀린 뒤 회복값
    },

    // ── 막기 / 받아치기 ──
    PARRY: {
      WINDOW: 9,                 // Space를 누른 뒤 이 틱 안에 상대 타격이 닿으면 받아치기
      STAGGER: 34,               // 받아치기 당한 쪽 무너짐 시간
      COUNTER_TICKS: 40,         // 받아치기 성공 후 반격 보너스 시간
      COUNTER_SPEED: 0.6,        // 반격 타격의 준비 시간 배율
      COUNTER_LUNGE: 0.3,        // 반격은 이미 가까우므로 거의 제자리에서 친다
      MISS_COOLDOWN: 24,         // 헛막기(아무것도 안 닿은 짧은 막기) 뒤 받아치기 불가 시간
      MISS_MOMENTUM: 3,          // 헛막기 기세 감소
      DEBANA_SPEED: 0.5,         // 출발기(상대가 나오는 순간 끊는 손목) 준비 시간 배율
      DEBANA_LUNGE: 0.5
    },

    // ── 상태별 빈틈 (0 = 완전히 막힘, 1 = 완전히 열림) ──
    OPENINGS: {
      idle:        { men: 0.30, kote: 0.25, do: 0.05 },
      forward:     { men: 0.45, kote: 0.40, do: 0.10 },
      backward:    { men: 0.20, kote: 0.30, do: 0.05 },
      windup_men:  { men: 0.50, kote: 1.00, do: 0.95 },
      windup_kote: { men: 0.70, kote: 0.40, do: 0.50 },
      windup_do:   { men: 0.90, kote: 0.60, do: 0.30 },
      recover:     { men: 0.60, kote: 0.60, do: 0.70 },
      recover_bad: { men: 0.85, kote: 0.80, do: 0.85 },
      block:       { men: 0.00, kote: 0.10, do: 0.95 },
      stagger:     { men: 1.00, kote: 1.00, do: 1.00 },
      stun:        { men: 1.00, kote: 1.00, do: 1.00 },
      frozen:      { men: 0.00, kote: 0.00, do: 0.00 },
      present_on: 1.0,           // 수련 상대가 일부러 열어 준 부위
      present_off: 0.2
    },
    DEFLECT_THRESHOLD: 0.15,     // 빈틈이 이보다 작으면 상대 죽도에 걸려 튕김

    // ── 유효타격 판정 가중치 ──
    JUDGE: {
      W_DIST: 0.25, W_OPEN: 0.55, W_KIAI: 0.20,
      KIAI_BASE: 0.5,            // 게이지는 충분하지만 타이밍이 안 맞은 기합 점수
      COUNTER_BONUS: 0.10,
      LOW_MOMENTUM_PENALTY: 0.06,
      BACKWARD_PENALTY: 0.10,
      DIST_EDGE_SCORE: 0.4,      // 판정 범위 끝에서의 간격 점수
      WAVE_MIN: 0.35             // 이 점수 이상인 무효 타격은 심판이 깃발을 흔들어 "무효" 표시
    },
    ZANSHIN: { TICKS: 30, RETREAT_MAX: 10 },  // 잔심 확인 시간 / 물러남 허용 틱
    AIUCHI_TICKS: 8,             // 두 선수 접촉이 이 틱 안이면 상타(무효)

    // 심판 3명 — 각자 기준이 조금씩 다르다
    REFEREES: [
      { name: '부심', threshold: 0.64 },
      { name: '주심', threshold: 0.62 },
      { name: '부심', threshold: 0.68 }
    ],
    REF_NOISE: 0.04,

    // ── 시합 규칙 ──
    MATCH: { TIME_SEC: 180, POINTS_TO_WIN: 2, HANSOKU_LIMIT: 2, ENCHO_SEC: 120 },   // 연장전이 2분을 넘으면 심판 판정(판정승)

    // ── 손맛 연출 ──
    FX: { HITSTOP_CONTACT: 3, HITSTOP_CLASH: 4, HITSTOP_IPPON: 16, FLASH_TICKS: 6, SHAKE_IPPON: 3 },

    // 간격 표시 (두 선수 중심 거리 기준)
    MAAI_LABELS: [
      { max: 23, label: '코등이 싸움', color: 'red' },
      { max: 35, label: '가까움', color: 'orange' },
      { max: 46, label: '일족일도', color: 'green' },
      { max: 9999, label: '멂', color: 'grey' }
    ],

    // ─────────────────────────────────────────────
    // 상대 AI 유형 — 유형별 성향 수치
    //  reaction: 상대 동작을 인지하는 지연 틱 (작을수록 빠름)
    //  prefDist: 선호 간격 / attackThreshold: 빈틈 점수가 이 이상이면 공격
    //  response: 상대 타격 준비를 봤을 때 대응 확률 (guard=막기·받아치기, debana=출발기, retreat=물러나기, 나머지=무대응)
    //  parrySkill: 막기 타이밍 정확도 / renzoku: 실패 후 연속기 확률
    //  feint: 치는 척 들어올렸다 멈추고 다른 부위로 다시 치는 확률 (막기만 노리는 상대 공략)
    // ─────────────────────────────────────────────
    AI_PROFILES: {
      trainer: {
        label: '수련 상대', desc: '사범님이 직접 받아 주신다', defaultName: '백 사범님', swap: 'sensei',
        reaction: 30, reach: 0, swordLen: 20, speedMul: 1, strikeSpeedMul: 1, voice: 0.7
      },
      aggressive: {
        label: '공격형', desc: '쉬지 않고 들어온다 — 받아치기로 공략', defaultName: '강철민', school: '철산고', swap: 'white',
        reaction: 15, decisionEvery: 8, prefDist: 42, distJitter: 5, semeChance: 0.015,
        attackThreshold: 0.42, probeChance: 0.0035, targetPref: { men: 1.0, kote: 0.85, do: 0.5 },
        kiaiDiscipline: 0.85, kiaiTiming: 0.6, kiaiKeep: 60,
        response: { guard: 0.25, debana: 0.08, retreat: 0.07 }, parrySkill: 0.45,
        feint: 0.05, renzoku: 0.55, counterAfterParry: 0.6, edgeAwareness: 0.7, clinchPush: 0.8,
        reach: 0, swordLen: 20, speedMul: 1.05, strikeSpeedMul: 1.0, voice: 0.85
      },
      defensive: {
        label: '수비형', desc: '막기만 한다 — 빈틈을 기다리거나 허리로 공략', defaultName: '문하람', school: '청송고', swap: 'white',
        reaction: 10, decisionEvery: 10, prefDist: 50, distJitter: 4, semeChance: 0.004,
        attackThreshold: 0.62, probeChance: 0.0006, targetPref: { men: 1.0, kote: 0.9, do: 0.6 },
        kiaiDiscipline: 0.95, kiaiTiming: 0.7, kiaiKeep: 70,
        response: { guard: 0.62, debana: 0.04, retreat: 0.18 }, parrySkill: 0.55,
        feint: 0.15, renzoku: 0.15, counterAfterParry: 0.75, edgeAwareness: 0.9, clinchPush: 0.3,
        reach: 0, swordLen: 20, speedMul: 0.95, strikeSpeedMul: 1.0, voice: 0.9
      },
      counter: {
        label: '받아치기형', desc: '먼저 치면 되받아친다 — 출발기로 공략', defaultName: '윤솔', school: '한빛고', swap: 'white',
        reaction: 11, decisionEvery: 10, prefDist: 45, distJitter: 4, semeChance: 0.006,
        attackThreshold: 0.6, probeChance: 0.0008, targetPref: { men: 1.0, kote: 0.9, do: 0.8 },
        kiaiDiscipline: 0.9, kiaiTiming: 0.75, kiaiKeep: 65,
        response: { guard: 0.6, debana: 0.12, retreat: 0.05 }, parrySkill: 0.75,
        feint: 0.3, renzoku: 0.2, counterAfterParry: 0.95, edgeAwareness: 0.8, clinchPush: 0.4,
        reach: 0, swordLen: 20, speedMul: 1.0, strikeSpeedMul: 1.05, voice: 1.0
      },
      tall: {
        label: '장신형', desc: '간격이 길다 — 품 안으로 파고들어라', defaultName: '장우람', school: '백두고', swap: 'white',
        reaction: 14, decisionEvery: 9, prefDist: 50, distJitter: 4, semeChance: 0.01,
        attackThreshold: 0.45, probeChance: 0.0025, targetPref: { men: 1.0, kote: 0.6, do: 0.3 },
        kiaiDiscipline: 0.85, kiaiTiming: 0.6, kiaiKeep: 60,
        response: { guard: 0.3, debana: 0.05, retreat: 0.3 }, parrySkill: 0.5,
        feint: 0.1, renzoku: 0.3, counterAfterParry: 0.6, edgeAwareness: 0.7, clinchPush: 0.2,
        reach: 5, swordLen: 23, speedMul: 0.95, strikeSpeedMul: 0.95, voice: 0.75
      },
      rival: {
        label: '라이벌', desc: '빠른 손목 치기가 특기', defaultName: '서진', school: '명성고', swap: 'rival',
        reaction: 11, decisionEvery: 7, prefDist: 42, distJitter: 4, semeChance: 0.012,
        attackThreshold: 0.4, probeChance: 0.003, targetPref: { men: 0.8, kote: 1.2, do: 0.5 },
        kiaiDiscipline: 0.95, kiaiTiming: 0.8, kiaiKeep: 65,
        response: { guard: 0.4, debana: 0.2, retreat: 0.1 }, parrySkill: 0.65,
        feint: 0.3, renzoku: 0.5, counterAfterParry: 0.8, edgeAwareness: 0.85, clinchPush: 0.5,
        reach: 0, swordLen: 20, speedMul: 1.1, strikeSpeedMul: 1.15, voice: 1.05
      },
      boss: {
        label: '사범님', desc: '모든 유형을 섞어 쓴다 — 2판째부터 달라진다', defaultName: '백 사범님', school: '백운 도장', swap: 'sensei',
        reaction: 10, decisionEvery: 8, prefDist: 46, distJitter: 5, semeChance: 0.012,
        attackThreshold: 0.5, probeChance: 0.0015, targetPref: { men: 1.0, kote: 1.0, do: 0.8 },
        kiaiDiscipline: 1.0, kiaiTiming: 0.9, kiaiKeep: 70,
        response: { guard: 0.45, debana: 0.2, retreat: 0.1 }, parrySkill: 0.7,
        feint: 0.3, renzoku: 0.35, counterAfterParry: 0.9, edgeAwareness: 1.0, clinchPush: 0.6,
        reach: 1, swordLen: 21, speedMul: 1.0, strikeSpeedMul: 1.05, voice: 0.7,
        // 2판째(누구든 한 판을 딴 뒤)부터 바뀌는 패턴
        phase2: {
          reaction: 8, attackThreshold: 0.4, probeChance: 0.004, prefDist: 42,
          response: { guard: 0.35, debana: 0.35, retreat: 0.05 }, parrySkill: 0.85, renzoku: 0.6, feint: 0.4,
          strikeSpeedMul: 1.12
        }
      }
    }
  };
})(window.PK = window.PK || {});
