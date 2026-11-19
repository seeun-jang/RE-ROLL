// =============================================================
// 검도 파티용 규칙 값 — 서버(server/party/games/kendo/config.py)의 MATCH·FLOW 와 같은 내용. 테스트가 비교한다.
// (선수·판정 값은 원본 pk/config.js 를 그대로 쓴다)
// =============================================================
export const PARTY_CONFIG = {
  "MATCH": {
    "TIME_SEC": 60,
    "POINTS_TO_WIN": 2,
    "HANSOKU_LIMIT": 2,
    "HANTEI_NOISE": 0.3
  },
  "FLOW": {
    "PRACTICE_TIME": 30.0,
    "INTRO_TIME": 4.0,
    "END_HOLD": 1.0,
    "RESULT_TIME": 4.0,
    "FINAL_TIME": 8.0,
    "ROUNDS_FOR_TWO": 1,
    "WIN_SCORE": 100,
    "IPPON_SCORE": 10
  }
};

export function mergeConfig(override) {
  const cfg = JSON.parse(JSON.stringify(PARTY_CONFIG));
  for (const [section, values] of Object.entries(override || {})) {
    if (cfg[section] && values && typeof values === 'object') Object.assign(cfg[section], values);
  }
  return cfg;
}
