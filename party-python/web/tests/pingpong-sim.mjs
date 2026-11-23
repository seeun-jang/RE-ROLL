// 시험 도구: 잭팟 탁구왕 시험용 진행기(Sim)를 가짜 시계 + 봇만으로 끝까지 돌려 본다.
//   node tests/pingpong-sim.mjs            2 · 3 · 5명으로 한 판씩 돌려 결과 형식을 확인한다
//   node tests/pingpong-sim.mjs --trace N SEED
//        N명 한 판의 조작 기록(난수 · 입력 · 틱)과 결과를 JSON 으로 출력한다.
//        server/tests/test_pingpong_game.py 가 같은 기록을 Python 판정에 넣어 두 결과를 비교한다.
import assert from 'node:assert/strict';
import { Sim, createBots } from '../src/games/pingpong/sim/Sim.js';

/** 시드로 고정되는 난수 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 장면 시간을 줄여 빨리 돌린다
const FAST = { FLOW: { ROUNDS_FOR_TWO: 1, INTRO_TIME: 0.5, END_HOLD: 0.2, RESULT_TIME: 0.5, FINAL_TIME: 0.5, MATCH_LIMIT: 120, SAY_GAP: 3, LONG_RALLY: 8 } };

function play(n, seed, record) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `선수${i + 1}`, index: i }));
  const gen = mulberry32(seed);
  const values = Array.from({ length: 997 }, () => gen());
  let ri = 0;
  const rng = () => values[ri++ % values.length];
  const sim = new Sim(players, { config: FAST }, rng);
  const bots = createBots(players.map((p) => p.id), mulberry32(seed + 1000));
  const ops = [];
  const events = [];
  const states = [];
  let t = 1000;
  const collect = () => {
    for (const [, kind, data] of sim.drain()) {
      if (kind === 'event') events.push(data.type === 'say' ? { type: 'say', kind: data.kind, match: data.match } : data);
      else if (data.phase !== 'fight' || data.simFrame % 20 === 0) states.push(data);
    }
  };
  sim.start(t);
  ops.push(['start', t]);
  collect();
  for (let i = 1; i < 30 * 1500 && !sim.finished; i++) {
    t = 1000 + i / 30;
    for (const input of bots(sim, t)) {
      sim.onInput(input.playerId, input.data, t);
      if (record) ops.push(['input', input.playerId, input.data, t]);
    }
    sim.tick(t);
    if (record) ops.push(['tick', t]);
    collect();
  }
  return { players, config: FAST, rng: values, ops, events, states, finished: sim.finished, results: sim.results, seconds: t - 1000 };
}

function checkResults(n, out) {
  assert.ok(out.finished, `${n}명: 끝나지 않음`);
  assert.equal(out.results.length, n);
  out.results.forEach((r, i) => {
    assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
    assert.ok(Number.isInteger(r.score) && r.score >= 0);
    if (i > 0) assert.ok(out.results[i - 1].score >= r.score, '점수 내림차순');
    assert.equal(r.isWinner, r.rank === 1);
  });
  const matches = out.results.reduce((s, r) => s + r.stats.matches, 0) / 2;
  assert.equal(matches, n === 2 ? 1 : (n * (n - 1)) / 2, '모두가 서로 한 번씩');
  assert.equal(out.results.reduce((s, r) => s + r.stats.wins, 0), matches);
}

if (process.argv[2] === '--trace') {
  const out = play(Number(process.argv[3]) || 3, Number(process.argv[4]) || 1, true);
  process.stdout.write(JSON.stringify(out));
} else {
  for (const [n, seed] of [[2, 7], [3, 8], [5, 9]]) {
    const out = play(n, seed, false);
    checkResults(n, out);
    const kinds = {};
    for (const e of out.events) kinds[e.type] = (kinds[e.type] || 0) + 1;
    const says = [...new Set(out.events.filter((e) => e.type === 'say').map((e) => e.kind))];
    const best = Math.max(...out.results.map((r) => r.stats.bestRally));
    console.log(`${n}명: ${Math.round(out.seconds)}초, 가장 긴 랠리 ${best}, 타격 ${kinds.hit}, 득점 ${kinds.point}, 해설 ${says.join('/')}`);
    console.log('   ' + out.results.map((r) => `${r.rank}위 ${r.name} ${r.score}점(${r.stats.wins}승 ${r.stats.scored}:${r.stats.conceded})`).join(' · '));
    assert.ok(best >= 3, '봇끼리 랠리가 이어져야 한다');
  }
  console.log('pingpong sim OK');
}
