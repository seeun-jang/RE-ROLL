// ============================================================
// config.js — 게임의 모든 숫자 값을 한곳에 모은 설정 파일
// (밸런스 조정은 이 파일만 고치면 된다)
// ============================================================

// 화면: 320×180 기준 해상도를 정수배로 확대
export const SCREEN = {
  WIDTH: 320,
  HEIGHT: 180,
  MAX_SCALE: 8,          // 창 크기에 맞춰 1~MAX_SCALE 사이 정수배로 확대
};

export const LOGIC_FPS = 60;   // 게임 로직은 고정 60FPS
export const ANIM_FPS = 10;    // 스프라이트 애니메이션 기본 속도 (8~12FPS 느낌)

// ------------------------------------------------------------
// 키 배치 (KeyboardEvent.code 기준 → 한글 IME 상태에서도 정상 동작)
// 키보드마다 동시 입력(롤오버) 한계가 다르므로, 준비 화면의
// "동시 입력 테스트"에서 5키가 모두 켜지는지 확인하고 필요하면 여기서 바꾼다.
// 대안 예시: ['KeyA', 'KeyG', 'KeyL', 'Numpad4', 'ArrowUp']
// ------------------------------------------------------------
export const PLAYER_KEYS = ['KeyQ', 'KeyR', 'KeyU', 'KeyP', 'ArrowRight'];

// 화면에 표시할 키 이름
export const KEY_LABELS = {
  KeyQ: 'Q', KeyR: 'R', KeyU: 'U', KeyP: 'P', ArrowRight: '→',
  ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Space: 'SPC',
  KeyA: 'A', KeyG: 'G', KeyL: 'L', Numpad4: 'N4', Enter: 'ENT',
};

// 시스템 키 (플레이어 키와 겹치지 않게)
export const SYSTEM_KEYS = {
  CONFIRM: ['Enter', 'NumpadEnter', 'Space'],
  PAUSE: 'Escape',
  BACK: 'Backspace',
  MUTE: 'KeyM',
};

// 기본 플레이어 5명 (외부에서 start(players)로 덮어쓸 수 있음)
// color/shade 는 Sweetie 16 팔레트 안에서 고름
export const DEFAULT_PLAYERS = [
  { id: 'p1', name: 'P1', color: '#b13e53', shade: '#5d275d', key: 'KeyQ' },
  { id: 'p2', name: 'P2', color: '#ffcd75', shade: '#ef7d57', key: 'KeyR' },
  { id: 'p3', name: 'P3', color: '#a7f070', shade: '#38b764', key: 'KeyU' },
  { id: 'p4', name: 'P4', color: '#3b5dc9', shade: '#29366f', key: 'KeyP' },
  { id: 'p5', name: 'P5', color: '#73eff7', shade: '#257179', key: 'ArrowRight' },
];
export const MAX_PLAYERS = 5;

// ------------------------------------------------------------
// 이동 (단위: 미터, 초)
// ------------------------------------------------------------
export const MOVE = {
  MAX_SPEED: 1.1,          // 최고 속도 (m/s)
  ACCEL: 3.0,              // 가속도 — 최고 속도까지 약 0.37초
  DECEL: 6.5,              // 감속도 — 최고 속도에서 정지까지 약 0.17초 (관성)
  MOVING_THRESHOLD: 0.05,  // 이 속도를 넘으면 "움직이는 중"으로 판정
  DUST_INTERVAL: 0.12,     // 달릴 때 먼지 파티클 간격
};

// ------------------------------------------------------------
// 규칙
// ------------------------------------------------------------
export const RULES = {
  TIME_LIMIT: 60,          // 제한시간 (초)
  GRACE_TIME: 0.2,         // 술래가 돌아보기 시작한 뒤 판정까지 유예시간
  COUNTDOWN: 3,            // 시작 카운트다운
  END_DELAY: 1.0,          // 게임 종료 후 '결과 확인' 버튼이 나오기까지
  READY_DELAY: 1.2,        // 전원 준비 완료 후 시작까지
};

// ------------------------------------------------------------
// 운동장(트랙) 배치 — 픽셀 좌표 (320×180 기준)
// ------------------------------------------------------------
export const TRACK = {
  METERS: 20,              // 출발선 → 결승선 거리 (m)
  START_Y: 164,            // 출발선 y
  FINISH_Y: 88,            // 결승선 y
  CENTER_X: 160,
  LANE_SPACING_BOTTOM: 32, // 아래쪽(가까운 쪽) 레인 간격
  LANE_SPACING_TOP: 26,    // 위쪽(먼 쪽) 레인 간격 → 쿼터뷰 원근감
  HALF_WIDTH_BOTTOM: 84,   // 트랙 반폭 (아래)
  HALF_WIDTH_TOP: 66,      // 트랙 반폭 (위)
  TOP_Y: 80,               // 트랙이 그려지는 위쪽 끝
  BOTTOM_Y: 180,           // 트랙이 그려지는 아래쪽 끝
  MARK_EVERY: 5,           // 바닥 거리 표시 간격 (m)
  HORIZON_Y: 54,           // 하늘/땅 경계
};

// ------------------------------------------------------------
// 술래
// ------------------------------------------------------------
export const TAGGER = {
  PHRASE: ['무', '궁', '화', '꽃', '이', '피', '었', '습', '니', '다'],
  X: 152,                  // 술래 스프라이트(16×32) 왼쪽 위
  Y: 50,
  TREE_X: 144,             // 나무(32×64) 왼쪽 위
  TREE_Y: 16,
  TURN_TIME: 0.15,         // 돌아보기 애니메이션 (3프레임)
  TURN_BACK_TIME: 0.24,    // 다시 뒤돌기 애니메이션
  REST_TIME: 0.2,          // 뒤돈 뒤 다음 외치기까지 쉬는 시간
  LINE_DURATION: 1.8,      // 말풍선 표시 시간
};

// 술래 패턴 생성 범위 (규칙 기반 TaggerBrain 이 사용)
export const PATTERN = {
  STYLE_SPEED: {           // 글자 사이 간격 (초)
    normal: [0.24, 0.36],
    fast: [0.09, 0.15],
    slow: [0.45, 0.65],
  },
  FIRST_DELAY: [0.25, 0.6],     // 첫 글자 전 대기
  STUTTER_PAUSE: [0.7, 1.3],    // "멈칫" 시 추가 정지
  TURN_DELAY: [0.02, 0.18],     // 마지막 글자 후 돌아보기까지
  LOOK_DURATION: [1.3, 2.6],    // 돌아보고 있는 시간
  FAKE_CHANCE: [0.15, 0.4],     // 페이크 확률 (게임 초반 → 후반)
  FAKE_DURATION: [0.35, 0.55],
  // AI(외부) 출력이 엉뚱해도 게임이 깨지지 않도록 하는 안전 범위
  LIMITS: {
    INTERVAL: [0.05, 2.0],
    LOOK: [0.6, 4.0],
    FAKE: [0.2, 1.0],
    TURN_DELAY: [0.0, 1.0],
  },
};

// ------------------------------------------------------------
// 점수 배점
// ------------------------------------------------------------
export const SCORE = {
  FINISH_BONUS: [500, 350, 250, 150, 100], // 도착 순위별 보너스
  PER_METER: 10,                           // 전진 1m 당 점수 (최대 200)
  TIME_BONUS_PER_SEC: 5,                   // 도착 시 남은 시간 1초당
};

// ------------------------------------------------------------
// 연출(손맛)
// ------------------------------------------------------------
export const FX = {
  HIT_STOP_TURN: 0.07,
  HIT_STOP_CATCH: 0.12,
  SHAKE_TURN: { amp: 1, time: 0.12 },
  SHAKE_CATCH: { amp: 3, time: 0.35 },
  BLINK_TIME: 1.0,         // 탈락 플레이어 깜빡임
  WATCH_DARKEN: 0.22,      // 술래가 볼 때 화면 어둡게 (불투명도)
  DUSK_MAX: 0.2,           // 판이 끝날 무렵 노을 오버레이 최대치
  TRANSITION_TIME: 0.7,
};

// ------------------------------------------------------------
// 사운드
// ------------------------------------------------------------
export const AUDIO = {
  MASTER: 0.5,
  SFX: 0.8,
  BGM: 0.32,
  BGM_TEMPO: 132,
  SYLLABLE_BASE_FREQ: 523.25,              // 첫 글자 음 (C5)
  SYLLABLE_STEPS: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21], // 글자마다 올라가는 음정 (반음)
};

// ------------------------------------------------------------
// 폰트 (Galmuri — 각 폰트가 선명하게 보이는 크기 사용)
// ------------------------------------------------------------
export const FONTS = {
  big: { family: "'Galmuri14', 'Galmuri11', 'DungGeunMo', monospace", size: 15 },
  main: { family: "'Galmuri11', 'DungGeunMo', monospace", size: 12 },
  small: { family: "'Galmuri9', 'Galmuri11', monospace", size: 10 },
  tiny: { family: "'Galmuri7', 'Galmuri9', monospace", size: 8 },
};
