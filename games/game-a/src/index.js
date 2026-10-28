// =============================================================
//  game-a 공개 진입점 — 메인 보드게임은 이 파일만 import 하면 됩니다.
//
//    import BlackCombatGame, { gameMeta } from '../games/game-a/src';
//    <BlackCombatGame onFinish={(result) => {}} onExit={() => {}} />
//
//  result = {
//    gameId: 'game-a',
//    scores: [ { playerId: 'p1', score: 182 }, { playerId: 'p2', score: 97 } ],
//    details: { winner, wins, rounds, players, ... }  // 참고용
//  }
//  - 승자 점수 > 패자 점수 (점수 순위 = 경기 승패), 무승부면 같은 점수
//  - 부모 요소에 너비/높이를 지정해 주세요. 게임은 그 안에 16:9로 맞춰집니다.
// =============================================================

import { GAME_ID, GAME_TITLE } from './config.js';

export { default } from './BlackCombatGame.jsx';

export const gameMeta = {
  gameId: GAME_ID,
  title: GAME_TITLE,
  genre: '마법 vs 격투 1:1 대결',
  players: ['p1', 'p2'],
};
