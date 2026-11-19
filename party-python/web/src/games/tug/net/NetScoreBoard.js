// =============================================================
// NetScoreBoard — 서버가 보낸 점수를 보여주기만 하는 점수판 (멀티플레이용)
// 원본 ScoreBoard 와 같은 읽기 메서드(get, results)를 제공한다. 점수 계산은 하지 않는다.
// =============================================================

const EMPTY = Object.freeze({
  total: 0, round: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, spam: 0, roundWins: 0, power: 0,
});

export class NetScoreBoard {
  constructor(net, playerIds) {
    this.net = net;
    this.playerIds = playerIds.slice();
  }

  // 계산 쪽 메서드는 서버 몫이라 비워 둔다 (원본 장면 코드와의 호환용)
  reset() {}
  startRound() {}
  record() { return { points: 0, combo: 0 }; }
  addPower() {}
  endRound() { return this.net.roundResult(); }

  /** 플레이어 기록 사본 */
  get(playerId) {
    const scores = this.net.snap && this.net.snap.scores;
    const s = scores && scores[playerId];
    if (!s) return { ...EMPTY, roundScores: [] };
    return { ...EMPTY, ...s, roundScores: Array.isArray(s.roundScores) ? s.roundScores.slice() : [] };
  }

  /** 최종 결과. 서버가 확정한 결과가 있으면 그것을, 아직이면 현재 점수로 만든 임시 순위를 돌려준다 */
  results(players) {
    const final = this.net.snap && this.net.snap.results;
    if (Array.isArray(final) && final.length) return final.map((r) => ({ ...r, stats: { ...(r.stats || {}) } }));
    const list = (players || []).map((p, order) => {
      const s = this.get(p.id);
      return { playerId: p.id, name: p.name, score: s.total, rank: 0, isWinner: false, order, stats: { ...s } };
    });
    list.sort((a, b) => b.score - a.score || a.order - b.order);
    list.forEach((r, i) => { r.rank = i > 0 && r.score === list[i - 1].score ? list[i - 1].rank : i + 1; });
    const top = list.length ? list[0].score : 0;
    for (const r of list) { r.isWinner = r.score === top; delete r.order; }
    return list;
  }
}
