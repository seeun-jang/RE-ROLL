// =============================================================
//  메인 게임에 전달할 결과 데이터 만들기
//
//  {
//    gameId: 'game-a',
//    scores: [ { playerId: 'p1', score: 100 }, { playerId: 'p2', score: 46 } ],
//    details: { ... }   // 참고용 추가 정보 (메인 게임에서 안 써도 됨)
//  }
//
//  점수 규칙
//    - 승자: 100점
//    - 패자: 상대에게 준 데미지 비율 × 80점 (0 ~ 80)
//    - 무승부: 둘 다 100점
// =============================================================

import { GAME_ID, MATCH, SCORE } from '../config.js';

export function buildResult(match) {
  const isDraw = match.winnerId === null;
  const ids = match.playerIds;

  const scores = ids.map((id) => {
    const me = match.fighters[id];
    let score;
    if (isDraw || id === match.winnerId) {
      score = SCORE.winner;
    } else {
      const ratio = Math.max(0, Math.min(1, me.stats.damageDealt / MATCH.maxHp));
      score = Math.round(ratio * SCORE.loserMax);
    }
    return { playerId: id, score };
  });

  const players = ids.map((id) => {
    const f = match.fighters[id];
    return {
      playerId: id,
      rank: isDraw || id === match.winnerId ? 1 : 2,
      hp: Math.round(f.hp),
      damageDealt: f.stats.damageDealt,
      hitsLanded: f.stats.hitsLanded,
      blocked: f.stats.blocked,
    };
  });

  return {
    gameId: GAME_ID,
    scores,
    details: {
      winner: match.winnerId,           // 'p1' | 'p2' | null(무승부)
      reason: match.reason,             // 'ko' | 'decision'(판정) | 'draw'
      fightTimeMs: Math.round(match.elapsed * 1000),
      players,
    },
  };
}
