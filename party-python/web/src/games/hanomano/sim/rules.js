// =============================================================
// 하노마노 규칙 (시험용 진행기와 화면이 함께 쓴다)
// 서버의 server/party/games/hanomano/config.py · cards.py 와 같은 값 · 같은 계산이다.
// 카드 = [과일 번호(0~3), 개수(1~5)]. 과일: 0 체리 · 1 레몬 · 2 라임 · 3 포도
// =============================================================

export const CONFIG = {
  RULES: {
    TIME_LIMIT: 150,           // 제한 시간 2분 30초
    TARGET: 5,                 // 같은 과일이 정확히 이 개수일 때 종
    CARD_COUNTS: { 1: 4, 2: 3, 3: 3, 4: 2, 5: 1 },
    FRUITS: ['체리', '레몬', '라임', '포도'],
    TURN_TIME: [3.0, 1.5],     // 자동으로 뒤집히는 시간 (처음 3초 → 끝날 즈음 1.5초)
    WRONG_LOCK: 3.0,           // 틀리게 치면 3초 동안 종을 못 침
    COLLECT_PAUSE: 70 / 60,
    WRONG_PAUSE: 50 / 60,
  },
  FLOW: { INTRO_TIME: 8.0, DEAL_TIME: 1.5, END_TIME: 2.5, FINAL_TIME: 8.0 },
  NET: { BELL_WINDOW: 0.12, BELL_MAX_LAG: 0.35, BELL_MAX_LEAD: 0.05, AWAY_TURN_TIME: 0.8, STALL_TIME: 5.0 },
  AI: { SAY_GAP: 3.0, BIG_POT: 10, LOW_CARDS: 3, LAST_MINUTE: 60.0 },
};

/** 섞은 새 목록 (피셔-예이츠) */
export function shuffleCards(cards, rng) {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 52장 덱(섞어서) */
export function makeDeck(rules, rng) {
  const deck = [];
  rules.FRUITS.forEach((_, fruit) => {
    for (const [n, count] of Object.entries(rules.CARD_COUNTS)) {
      for (let k = 0; k < count; k++) deck.push([fruit, +n]);
    }
  });
  return shuffleCards(deck, rng);
}

/** 모두에게 같은 장수를 나눠 준다. 남는 카드(3명 1장, 5명 2장)는 게임에서 뺀다. */
export function deal(deck, players) {
  const each = Math.floor(deck.length / players);
  const hands = [];
  for (let i = 0; i < players; i++) hands.push(deck.slice(i * each, (i + 1) * each));
  return { hands, spare: deck.slice(players * each) };
}

/** 펼쳐진 카드(각자 맨 위 한 장) 위의 과일별 합계 */
export function fruitTotals(tops, fruits = 4) {
  const sum = new Array(fruits).fill(0);
  for (const c of tops) if (c) sum[c[0]] += c[1];
  return sum;
}

export function bellIsRight(tops, rules) {
  return fruitTotals(tops, rules.FRUITS.length).includes(rules.TARGET);
}

/** 종을 친 순간의 판정과 설명 { ok, text, fruit, near } */
export function bellReason(tops, rules) {
  const T = rules.TARGET;
  const sum = fruitTotals(tops, rules.FRUITS.length);
  const f = sum.indexOf(T);
  if (f >= 0) {
    const parts = tops.filter((c) => c && c[0] === f).map((c) => c[1]);
    return { ok: true, text: `${rules.FRUITS[f]} ${parts.join('+')} = ${T}개!`, fruit: f, near: false };
  }
  let best = -1;
  for (let i = 0; i < sum.length; i++) if (sum[i] > 0 && (best < 0 || Math.abs(sum[i] - T) < Math.abs(sum[best] - T))) best = i;
  if (best < 0) return { ok: false, text: '과일이 없어요!', fruit: -1, near: false };
  return {
    ok: false, text: `${rules.FRUITS[best]} ${sum[best]}개${sum[best] < T ? '뿐' : ''}! (${T}개 아님)`, fruit: best,
    near: sum.includes(T - 1),
  };
}
