// =====================================================
// 보드게임 규칙 · 보드판 데이터를 JSON 으로 내보내기
//
//  board/shared/rules.js · board/shared/board.js 는 브라우저와 (원래) Node 서버가 같이 쓰던
//  ES 모듈(export const …)이다. 파이썬 서버도 똑같은 데이터가 필요하므로, 손으로 옮겨 적지 않고
//  이 스크립트로 뽑아서 server/party/board/board_data.json 에 저장한다.
//
//  실행 (아무 폴더에서나):
//      node server/tools/export_board_data.mjs            → board_data.json 을 덮어씀
//      node server/tools/export_board_data.mjs <파일경로>  → 그 경로에 저장 (테스트가 씀)
//
//  rules.js / board.js 를 고쳤으면 이 스크립트를 다시 돌려야 한다.
//  (tests/test_board_game.py 가 JSON 이 최신인지 확인한다)
// =====================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.join(HERE, '..', '..', 'board', 'shared');
const OUT = process.argv[2] || path.join(HERE, '..', 'party', 'board', 'board_data.json');

// board 폴더에는 package.json 이 없어서 Node 버전에 따라 .js 를 ES 모듈로 못 읽을 수 있다.
// 두 파일 모두 import 가 없는 순수 데이터 파일이므로, 글자로 읽어서 data: 주소로 불러온다(항상 ES 모듈로 읽힘).
async function load(name) {
  const src = fs.readFileSync(path.join(SHARED, name), 'utf8');
  return import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));
}

const R = await load('rules.js');
const B = await load('board.js');

const data = {
  // ----- rules.js -----
  MAX_PLAYERS: R.MAX_PLAYERS,
  BAG_MAX: R.BAG_MAX,
  TURN_CHOICES: R.TURN_CHOICES,
  DEFAULT_TURNS: R.DEFAULT_TURNS,
  CHARACTERS: R.CHARACTERS,
  // 미니게임은 순서가 중요해서(랜덤으로 고를 때 순서대로 번호를 매김) 목록으로 내보낸다
  MINIGAMES: Object.entries(R.MINIGAMES).map(([id, name]) => ({ id, name })),
  REWARDS: R.REWARDS,
  DICE: R.DICE,       // 키 순서 = rules.js 에 적힌 순서 (diceOf 결과 순서가 여기서 나옴)
  SPACES: R.SPACES,
  // ----- board.js -----
  BOARD: B.BOARD,     // { width, height, nodes: [{ id, x, y, type, next, island, theme }], start, goal }
  DIST: B.DIST,       // 칸 번호 → 결승까지 남은 칸 수
};

fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n', 'utf8');
console.log(`board_data.json 저장: ${OUT} (칸 ${B.BOARD.nodes.length}개, 주사위 ${Object.keys(R.DICE).length}종)`);
