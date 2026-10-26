// =============================================================
//  game-a 공개 진입점
//  메인 보드게임은 이 파일만 import 하면 됩니다.
//
//  사용 예시:
//    import BlackCombatGame, { gameMeta } from '../games/game-a/src';
//
//    <BlackCombatGame
//      onFinish={(result) => { ... }}   // 결과 화면에서 [결과 확정]을 눌렀을 때 (한 번만 호출)
//      onExit={() => { ... }}           // 타이틀에서 [메인으로]를 눌렀을 때 (결과 없이 나가기)
//    />
//
//  ※ [다시하기]로 여러 판을 해도 onFinish는 마지막에 확정한 결과로 한 번만 호출됩니다.
//  ※ 부모 요소에 너비/높이를 지정해 주세요. 게임은 그 안에 16:9로 맞춰집니다.
//
//  result 형식:
//    {
//      gameId: 'game-a',
//      scores: [
//        { playerId: 'p1', score: 100 },   // 승자 100점
//        { playerId: 'p2', score: 46 },    // 패자 0~80점 (상대에게 준 데미지 비율)
//      ],
//      details: {                          // 참고용 (안 써도 됨)
//        winner: 'p1',                     // 무승부면 null
//        reason: 'ko',                     // 'ko' | 'decision'(판정) | 'draw'
//        fightTimeMs: 41234,
//        players: [{ playerId, rank, hp, damageDealt, hitsLanded, blocked }],
//      },
//    }
// =============================================================

import { GAME_ID, GAME_TITLE } from './config.js';

export { default } from './BlackCombatGame.jsx';

export const gameMeta = {
  gameId: GAME_ID,
  title: GAME_TITLE,
  genre: '킥복싱 대전',
  players: ['p1', 'p2'],
};
