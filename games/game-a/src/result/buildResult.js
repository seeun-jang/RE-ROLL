// =============================================================
//  메인 게임에 전달할 결과 데이터
//
//  { gameId: 'game-a', scores: [{ playerId, score }, ...], details: { ... 참고용 } }
//
//  점수 = 준 데미지 + 명중 수 + 이긴 라운드×25 + 최종 승리 +30
//  승자 점수는 항상 패자보다 높음 → 점수 순위 = 경기 승패 / 무승부는 같은 점수
// =============================================================

import { GAME_ID, RESULT_SCORE } from '../config.js';

export function buildResult(match) {
  const ids = match.playerIds;
  const { winnerId, wins, rounds } = match.result;
  const raw = Object.fromEntries(
    ids.map((id) => {
      const s = match.fighters[id].stats;
      return [id, Math.round(s.damage * RESULT_SCORE.damage + s.landed * RESULT_SCORE.landed + wins[id] * RESULT_SCORE.roundWin)];
    }),
  );

  if (winnerId) {
    const loserId = ids.find((id) => id !== winnerId);
    raw[winnerId] += RESULT_SCORE.matchWin;
    raw[winnerId] = Math.max(raw[winnerId], raw[loserId] + 1);
  } else {
    const avg = Math.round(ids.reduce((sum, id) => sum + raw[id], 0) / ids.length);
    for (const id of ids) raw[id] = avg;
  }

  return {
    gameId: GAME_ID,
    scores: ids.map((id) => ({ playerId: id, score: raw[id] })),
    details: {
      winner: winnerId,          // 'p1' | 'p2' | null(무승부)
      wins,                      // 라운드 승수 { p1: 2, p2: 1 }
      rounds,                    // [{ winner, method: 'ko' | 'time' | 'draw', time }]
      fightTimeSec: Math.round(match.elapsed * 10) / 10,
      players: ids.map((id) => ({
        playerId: id,
        character: match.fighters[id].player.kind, // 'tiger' | 'professor'
        rank: !winnerId || id === winnerId ? 1 : 2,
        ...match.fighters[id].stats,
      })),
    },
  };
}
