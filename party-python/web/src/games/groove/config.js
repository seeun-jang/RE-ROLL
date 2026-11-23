// =====================================================
// 잭팟 그루브 — 수치 설정 (원본 js/config.js 값 그대로)
// 같은 값이 server/party/games/groove/config.py 에 있다(테스트가 비교한다).
// 판정 · 점수는 서버가 하므로, 화면은 이 값을 "미리 보여 주기(예측)" 와 그림에만 쓴다.
// =====================================================
export const CONFIG = {
  WIDTH: 320,
  HEIGHT: 180,
  STEP_MS: 1000 / 60, // 화면 연출 60 FPS 고정 (노트 위치는 곡 시계로 그려서 프레임과 무관하게 부드러움)

  // 판정 범위 (초, ± 기준) — 넓을수록 쉬움
  JUDGE: {
    perfect: 0.045,
    great: 0.09,
    good: 0.135,
    holdEndGrace: 0.12, // 롱노트 끝나기 이만큼 전에 떼도 성공 처리
  },
  // 판정별 점수 비율 ×100 (PERFECT 100%) — 정수로 두어 서버(Python)와 계산 결과가 한 치도 다르지 않게 한다
  JUDGE_WEIGHT100: { perfect: 100, great: 70, good: 35, miss: 0 },
  // 총점 1,000,000 = 판정 점수 900,000 + 최대 콤보 보너스 100,000
  SCORE_MAX: 1000000,
  SCORE_COMBO_PART: 100000,
  // 등급 (이 점수 이상)
  GRADES: [
    { grade: 'S', min: 950000, color: '9' },
    { grade: 'A', min: 880000, color: 'e' },
    { grade: 'B', min: 750000, color: 'h' },
    { grade: 'C', min: 600000, color: 'q' },
    { grade: 'D', min: 0, color: 'j' },
  ],

  FEVER_COMBO: 30,        // 이 콤보부터 피버 (반짝이는 연출)
  SYNC_STEP: 0.01,        // 싱크 조절 단위 (10ms)
  SYNC_RANGE: 0.2,        // 싱크 조절 최대 ±200ms

  // 난이도: 노트가 떨어지는 시간(초) — 짧을수록 빠름
  DIFFICULTY: {
    easy: { label: '쉬움', stars: 1, approach: 1.45 },
    normal: { label: '보통', stars: 3, approach: 1.15 },
    hard: { label: '어려움', stars: 5, approach: 0.9 },
  },

  // 시험용 봇(sim/) 실력 범위: 1 = 완벽 (원본 BOT_SKILL)
  BOT_SKILL: [0.6, 0.98],

  // 화면 배치: 원본 '개인 화면' 배치(큰 레인 1개) — 각자 자기 화면에서 하므로 이것만 쓴다
  LAYOUT_PERSONAL: {
    X: 118,
    LANE_W: 28,
    TOP: 16,
    JUDGE_Y: 146,
    NOTE: 'big',
  },

  // ----- 파티 서버용으로 더한 값 (서버 config.py 와 같다) -----
  FLOW: {
    INTRO_TIME: 5.0,     // 곡 소개 카드 (임시 값 — 원본은 100프레임 뒤 아무 키)
    LEAD_EXTRA: 0.3,     // 카운트인 = 한 마디 + 이 값 (원본 그대로)
    END_WAIT: 0.5,       // 마지막 노트 뒤 이만큼 지나면 피날레 (원본 그대로)
    OUTRO_TIME: 170 / 60, // FINISH! 연출 (원본 170프레임)
    FINAL_TIME: 10.0,    // 최종 순위 화면 (임시 값)
  },
  NET: {
    MAX_LAG: 0.35,       // 이만큼 늦게 도착한 입력까지 "누른 시각" 그대로 판정
    STATE_HZ: 10,
    SAY_GAP: 3.0,        // 해설 사이 최소 간격(초)
  },
};

// 캐릭터(동물 id)별 이름표 · 레인 테두리 색 (원본 characters.js 의 color)
export const ANIMAL_COLORS = { bear: 'e', cat: 'q', duck: 't', tiger: '8', shiba: 'p' };

// 조작: 레인 3개 = ← ↑(↓) → 또는 A S D (원본 '개인 화면' 키 그대로)
export const SOLO_LANES = [
  ['ArrowLeft', 'KeyA'],
  ['ArrowUp', 'KeyS', 'ArrowDown'],
  ['ArrowRight', 'KeyD'],
];

// 싱크(소리 출력 지연) 보정 값 저장 위치 — 원본과 같은 이름
export const SYNC_KEY = 'jackpot-groove-sync';

export function gradeOf(score) {
  return CONFIG.GRADES.find((g) => score >= g.min);
}
