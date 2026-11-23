// =============================================================
// ScoreBoard — 개인 기여 점수 / 콤보 / 라운드 기록 / 최종 결과
// =============================================================

/** 플레이어 한 명의 빈 기록 */
/**
 * 점수 s 에 points 를 반영. 누적·라운드 점수 모두 0 아래로 내려가지 않게 하되,
 * 두 값에 '같은' 실제 변화량을 적용한다 → 라운드별 점수의 합이 언제나 누적 점수와 같다.
 * (감점은 이번 라운드 점수만큼까지만 깎인다: 지난 라운드에 번 점수는 지켜진다)
 */
function applyPoints(s, points) {
  const delta = Math.max(points, -s.round, -s.total);
  s.total += delta;
  s.round += delta;
  return delta;
}

function emptyStats() {
  return {
    total: 0,       // 누적 점수
    round: 0,       // 이번 라운드 점수
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    spam: 0,
    roundWins: 0,
    power: 0,       // 누적 기여 힘
    roundScores: [], // 라운드별 점수 (라운드 종료 보너스 포함)
  };
}

export class ScoreBoard {
  /**
   * @param {string[]} playerIds
   * @param {object} config
   */
  constructor(playerIds, config) {
    this.playerIds = playerIds.slice();
    this.config = config;
    this.reset();
  }

  /** 전체 초기화 */
  reset() {
    this.stats = new Map();
    for (const id of this.playerIds) this.stats.set(id, emptyStats());
    this.history = [];
    this.currentRound = 0;
  }

  _s(playerId) {
    let s = this.stats.get(playerId);
    if (!s) {
      // 알 수 없는 id 도 안전하게 기록 (외부 PowerSource 등)
      s = emptyStats();
      this.stats.set(playerId, s);
      this.playerIds.push(playerId);
    }
    return s;
  }

  /** 라운드 점수/콤보 초기화 (누적은 유지) */
  startRound(round) {
    this.currentRound = round;
    for (const s of this.stats.values()) {
      s.round = 0;
      s.combo = 0;
    }
  }

  /**
   * 판정 하나를 점수에 반영.
   * perfect/good: 기본점수 × (피버 배율) + min(combo, cap) × step (콤보를 먼저 +1)
   * miss: 0점, 콤보 끊김 / spam: 감점, 콤보 끊김. 누적·라운드 점수는 0 아래로 내려가지 않는다
   * (감점은 이번 라운드 점수까지만 → 라운드 점수 합 = 누적 점수).
   * → { points, combo }
   */
  record(playerId, grade, { fever = false, bonusPoints = 0 } = {}) {
    const sc = this.config.SCORE;
    const s = this._s(playerId);
    let points = 0;
    if (grade === 'perfect' || grade === 'good') {
      s.combo += 1;
      if (s.combo > s.maxCombo) s.maxCombo = s.combo;
      const base = sc[grade] * (fever ? this.config.FEVER_SCORE_MULT : 1);
      points = base + Math.min(s.combo, sc.comboCap) * sc.comboStep;
      s[grade] += 1;
    } else if (grade === 'spam') {
      s.combo = 0;
      points = sc.spam || 0;
      s.spam += 1;
    } else {
      // miss (알 수 없는 등급도 miss 취급)
      s.combo = 0;
      points = sc.miss || 0;
      s.miss += 1;
    }
    // TODO(AI): 퀴즈 정답 등 외부 보너스 점수는 bonusPoints 로 들어온다
    if (Number.isFinite(bonusPoints)) points += bonusPoints;
    points = Math.round(points);
    applyPoints(s, points);
    return { points, combo: s.combo };
  }

  /** 기여 힘 통계 */
  addPower(playerId, amount) {
    if (!Number.isFinite(amount)) return;
    this._s(playerId).power += amount;
  }

  /**
   * 라운드 종료: 승리 팀원에게 roundWin 보너스 (무승부면 전원 roundDraw), 기록 저장.
   * @param {number} round 1-based
   * @param {'left'|'right'|null} winnerSide
   * @param {{ left: import('./Team.js').Team, right: import('./Team.js').Team }} teams
   * → { winnerSide, bonus: { [id]: n }, roundScores: { [id]: n } }
   */
  endRound(round, winnerSide, teams) {
    const sc = this.config.SCORE;
    const bonus = {};
    const roundScores = {};
    const idsOf = (team) => (team && Array.isArray(team.members) ? team.members.map((p) => p.id) : []);
    const leftIds = idsOf(teams && teams.left);
    const rightIds = idsOf(teams && teams.right);

    for (const id of this.playerIds) bonus[id] = 0;
    if (winnerSide === 'left' || winnerSide === 'right') {
      for (const id of winnerSide === 'left' ? leftIds : rightIds) {
        bonus[id] = sc.roundWin;
        this._s(id).roundWins += 1;
      }
    } else {
      // 무승부: 전원 보너스
      for (const id of this.playerIds) bonus[id] = sc.roundDraw;
    }

    const idx = Math.max(0, (round | 0) - 1);
    for (const id of this.playerIds) {
      const s = this._s(id);
      const b = bonus[id] || 0;
      applyPoints(s, b);
      // 라운드별 점수 배열 (빠진 라운드는 0 으로 채움)
      while (s.roundScores.length < idx) s.roundScores.push(0);
      s.roundScores[idx] = s.round;
      roundScores[id] = s.round;
    }

    const w = winnerSide === 'left' || winnerSide === 'right' ? winnerSide : null;
    this.history.push({
      round,
      winnerSide: w,
      left: leftIds,
      right: rightIds,
      roundScores: { ...roundScores },
      bonus: { ...bonus },
    });
    return { winnerSide: w, bonus, roundScores };
  }

  /** 플레이어 기록 사본 */
  get(playerId) {
    const s = this.stats.get(playerId) || emptyStats();
    return { ...s, roundScores: s.roundScores.slice() };
  }

  /**
   * 최종 결과 — 점수 내림차순, 동점은 같은 순위, 최고점 동점자는 모두 우승.
   * @param {{ id: string, name: string }[]} players
   */
  results(players) {
    const list = (players || []).map((p, order) => {
      const s = this.stats.get(p.id) || emptyStats();
      return {
        playerId: p.id,
        name: p.name,
        score: s.total,
        rank: 0,
        isWinner: false,
        order,
        stats: {
          perfect: s.perfect,
          good: s.good,
          miss: s.miss,
          spam: s.spam,
          maxCombo: s.maxCombo,
          roundWins: s.roundWins,
          power: s.power,
          roundScores: s.roundScores.slice(),
        },
      };
    });
    // 점수 내림차순, 동점이면 입력 순서 유지
    list.sort((a, b) => b.score - a.score || a.order - b.order);
    // 표준 경쟁 순위 (1, 1, 3 …)
    list.forEach((r, i) => {
      r.rank = i > 0 && r.score === list[i - 1].score ? list[i - 1].rank : i + 1;
    });
    const top = list.length ? list[0].score : 0;
    for (const r of list) {
      r.isWinner = r.score === top;
      delete r.order;
    }
    return list;
  }
}
