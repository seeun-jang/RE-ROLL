// 메인 보드게임으로 넘길 결과 데이터를 만드는 파일입니다.
import { GAME_ID, PLAYER_IDS } from './config.js';
import { finalScore } from './engine.js';

// 공통 형식: { gameId, scores: [{ playerId, score }] }
export function buildResult(state) {
  return {
    gameId: GAME_ID,
    scores: PLAYER_IDS.map((id) => ({ playerId: id, score: finalScore(state, id) })),
  };
}

// 결과 화면에서만 쓰는 추가 기록
export function buildStats(state) {
  return {
    players: PLAYER_IDS.map((id) => {
      const p = state.players[id];
      return { playerId: id, score: p.score, maxCombo: p.maxCombo, ...p.counts };
    }),
  };
}

// 승자 playerId, 무승부면 null
export function getWinner(result) {
  const [a, b] = result.scores;
  if (a.score === b.score) return null;
  return a.score > b.score ? a.playerId : b.playerId;
}
