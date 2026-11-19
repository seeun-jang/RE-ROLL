// 시험 도구: 하노마노 시험용 진행기(Sim)를 가짜 시계로, 봇만으로 한 판 끝까지 돌려 본다.
//   node tests/hanomano-sim.mjs
// 확인하는 것: 2 · 3 · 5명 모두 끝까지 가는지, 카드가 사라지지 않는지, 결과가 공통 결과 형식인지.
import assert from 'node:assert/strict';
import { Sim, createBots } from '../src/games/hanomano/sim/Sim.js';
import { bellReason, CONFIG } from '../src/games/hanomano/sim/rules.js';
import * as minigame from '../src/games/hanomano/minigame.js';

/** 씨앗으로 고정한 난수 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

assert.equal(minigame.meta.id, 'hanomano');
assert.equal(typeof minigame.mount, 'function');
assert.deepEqual(bellReason([[2, 2], [2, 3], [0, 1]], CONFIG.RULES), { ok: true, text: '라임 2+3 = 5개!', fruit: 2, near: false });
assert.equal(bellReason([[3, 4], [0, 1]], CONFIG.RULES).text, '포도 4개뿐! (5개 아님)');

for (const n of [2, 3, 4, 5]) {
  const rng = seeded(100 + n);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i }));
  const sim = new Sim(players, {}, rng);
  const bots = createBots(players.map((p) => p.id), rng);
  const each = Math.floor(52 / n);
  assert.equal(sim.clientOptions().each, each);
  const seen = {};
  let states = 0;
  let now = 0;
  sim.start(now);
  while (!sim.finished && now < 400) {
    now += 1 / Sim.tickHz;
    for (const input of bots(sim, now)) sim.onInput(input.playerId, input.data, now);
    sim.tick(now);
    for (const [to, kind, data] of sim.drain()) {
      assert.equal(to, null);
      if (kind === 'event') seen[data.type] = (seen[data.type] || 0) + 1;
      else {
        states++;
        assert.ok(data.players.every((p) => typeof p.deck === 'number' && p.show.length <= 4));   // 덱 내용은 보내지 않는다
      }
    }
    assert.equal(sim.seats.reduce((s, p) => s + sim.cardsOf(p), 0), each * n);     // 카드는 사라지지 않는다
  }
  assert.ok(sim.finished, `${n}명: 끝나지 않음`);
  assert.ok(seen.flip > 10 && seen.ring > 0 && seen.say > 0 && seen.end === 1 && seen.final === 1, JSON.stringify(seen));
  assert.ok(!seen.verdict);                                // 시험용 진행기에는 AI 총평이 없다
  const rows = sim.results;
  assert.equal(rows.length, n);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
    assert.deepEqual(Object.keys(r.stats).sort(), ['cards', 'correct', 'got', 'wrong']);
    assert.equal(r.score, r.stats.cards);
  }
  assert.equal(rows[0].rank, 1);
  assert.ok(rows[0].isWinner);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].score <= rows[i - 1].score && rows[i].rank >= rows[i - 1].rank);
  console.log(`${n}명: ${now.toFixed(1)}초, 상태 ${states}번, 사건 ${JSON.stringify(seen)}, 1등 ${rows[0].name} ${rows[0].score}장`);
}
console.log('hanomano sim OK');
