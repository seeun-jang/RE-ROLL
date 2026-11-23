// =============================================================
// Team / TeamAssigner — 라운드마다 2:3 랜덤 팀 배정 (같은 조합 반복 방지)
// =============================================================
import { TEAM_COLORS } from '../palette.js';

export class Team {
  /**
   * @param {'left'|'right'} side
   * @param {object} config
   */
  constructor(side, config) {
    this.side = side;
    this.config = config;
    this.name = (config.TEAM_NAMES && config.TEAM_NAMES[side]) || side;
    const tc = TEAM_COLORS[side] || TEAM_COLORS.left;
    this.color = { main: tc.main, shade: tc.shade, light: tc.light };
    this.members = [];   // index 0 = 중앙에 가장 가까운 선수
    this.multiplier = 1; // 인원 보정 배율
  }

  get size() {
    return this.members.length;
  }

  setMembers(players) {
    this.members = Array.isArray(players) ? players.slice() : [];
  }

  has(playerId) {
    return this.members.some((p) => p && p.id === playerId);
  }
}

/** 두 id 쌍의 키 (순서 무관) */
function pairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** n 개 중 k 개를 고르는 모든 조합 (index 배열) */
function combinations(n, k) {
  const out = [];
  const cur = [];
  const rec = (start) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

/** 분할을 순서 무관한 문자열 키로 (같은 팀 구성이면 좌우가 바뀌어도 같은 키) */
function splitKey(groupA, groupB) {
  const a = groupA.slice().sort().join('|');
  const b = groupB.slice().sort().join('|');
  return a < b ? `${a}#${b}` : `${b}#${a}`;
}

export class TeamAssigner {
  /**
   * @param {string[]} playerIds
   * @param {() => number} rng 0..1 난수 함수 (테스트에서 시드 고정용)
   */
  constructor(playerIds, rng = Math.random) {
    this.playerIds = playerIds.slice();
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.history = [];          // [{ left: [id], right: [id] }]
    this.pairCounts = new Map(); // 같은 팀이었던 횟수 (쌍 키 → 횟수)
    this.smallCounts = new Map(); // 소수 팀(2인)에 들어간 횟수 (id → 횟수)
    this.lastKey = null;         // 직전 라운드 분할 키
  }

  /** 같은 팀이었던 횟수 */
  pairCount(a, b) {
    return this.pairCounts.get(pairKey(a, b)) || 0;
  }

  /**
   * 팀 내부 쌍들의 비용: 각 쌍의 누적 동료 횟수 c 에 대해 c + c² (= c(c+1)).
   * 단순 합(c)만 쓰면 탐욕 선택이 '이미 1번 같은 팀이었던 쌍'을 계속 묶어
   * 3라운드 내내 같은 두 사람이 한 팀이 되는 일이 생긴다(모든 시드에서 재현됨).
   * 제곱 항을 더해 같은 쌍이 반복될수록 비용이 가파르게 커지도록 했다.
   */
  _pairCost(group) {
    let cost = 0;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const c = this.pairCount(group[i], group[j]);
        cost += c + c * c;
      }
    }
    return cost;
  }

  /** 소수 팀 중복 비용: 각 멤버가 이미 소수 팀이었던 횟수 s 에 대해 s + s² (첫 중복 = 2) */
  _smallCost(smallIds) {
    let cost = 0;
    for (const id of smallIds) {
      const s = this.smallCounts.get(id) || 0;
      cost += s + s * s;
    }
    return cost;
  }

  /**
   * 다음 라운드 팀 분할.
   * 모든 분할 중 비용(같은 팀 쌍 누적 횟수 비용 + 소수 팀 중복 비용)이 최소인 것을 고른다.
   * 직전 라운드와 같은 분할은 제외하고, 동점은 rng 로 고른다. 어느 쪽이 소수 팀인지도 rng.
   * → { left: [id], right: [id] }
   */
  next() {
    const ids = this.playerIds;
    const n = ids.length;
    const small = Math.floor(n / 2);

    // 1) 후보 분할 전부 만들고 비용 계산
    let candidates = [];
    for (const combo of combinations(n, small)) {
      const inSmall = new Set(combo);
      const smallIds = combo.map((i) => ids[i]);
      const bigIds = ids.filter((_, i) => !inSmall.has(i));
      const key = splitKey(smallIds, bigIds);
      const isSmall = smallIds.length < bigIds.length; // 짝수 인원이면 소수 팀 개념 없음
      const cost = this._pairCost(smallIds) + this._pairCost(bigIds) + (isSmall ? this._smallCost(smallIds) : 0);
      candidates.push({ smallIds, bigIds, key, cost });
    }
    // 같은 분할이 두 번 나오는 경우(짝수 인원 반반) 중복 제거
    const seen = new Set();
    candidates = candidates.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));

    // 2) 직전 분할 제외 (후보가 그것뿐이면 어쩔 수 없이 허용)
    const filtered = candidates.filter((c) => c.key !== this.lastKey);
    const pool = filtered.length ? filtered : candidates;

    // 3) 최소 비용 후보 중 rng 로 하나
    let minCost = Infinity;
    for (const c of pool) if (c.cost < minCost) minCost = c.cost;
    const best = pool.filter((c) => c.cost === minCost);
    const pick = best[Math.min(best.length - 1, Math.floor(this.rng() * best.length))];

    // 4) 소수 팀을 어느 쪽에 둘지 rng
    const smallLeft = this.rng() < 0.5;
    const split = smallLeft
      ? { left: pick.smallIds.slice(), right: pick.bigIds.slice() }
      : { left: pick.bigIds.slice(), right: pick.smallIds.slice() };

    // 5) 기록
    const addPairs = (group) => {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const k = pairKey(group[i], group[j]);
          this.pairCounts.set(k, (this.pairCounts.get(k) || 0) + 1);
        }
      }
    };
    addPairs(pick.smallIds);
    addPairs(pick.bigIds);
    // 홀수 인원일 때만 '소수 팀' 이 의미가 있다
    if (pick.smallIds.length < pick.bigIds.length) {
      for (const id of pick.smallIds) this.smallCounts.set(id, (this.smallCounts.get(id) || 0) + 1);
    }
    this.lastKey = pick.key;
    this.history.push({ left: split.left.slice(), right: split.right.slice() });
    return split;
  }
}

/**
 * 분할 결과를 팀·플레이어에 적용한다.
 * @param {{ left: Team, right: Team }} teams
 * @param {import('../entities/Player.js').Player[]} players
 * @param {{ left: string[], right: string[] }} split
 */
export function assignTeams(teams, players, split) {
  const byId = new Map(players.map((p) => [p.id, p]));
  // 배정되지 않은 선수는 진영 없음
  for (const p of players) { p.side = null; p.slot = 0; }
  for (const side of ['left', 'right']) {
    const members = (split[side] || []).map((id) => byId.get(id)).filter(Boolean);
    teams[side].setMembers(members);
    members.forEach((p, i) => { p.side = side; p.slot = i; });
  }
  // 인원 보정: 상대보다 적은 팀만. SMALL_TEAM_MULT 가 'ratio' 면 (많은 팀 인원 ÷ 적은 팀 인원), 숫자면 그 값
  const setting = (teams.left.config && teams.left.config.SMALL_TEAM_MULT) || 1;
  const multFor = (small, big) => {
    if (small <= 0 || small >= big) return 1;
    return setting === 'ratio' ? big / small : Number(setting) || 1;
  };
  teams.left.multiplier = multFor(teams.left.size, teams.right.size);
  teams.right.multiplier = multFor(teams.right.size, teams.left.size);
  return teams;
}
