// 잭팟 홈런 더비 — 시험용 진행기(Sim) 확인 도구
//   node tests/homerun-sim.mjs             봇만으로 2·3·5명 한 판씩 끝까지 돌려 결과 형식을 확인한다
//   node tests/homerun-sim.mjs --config    규칙 값 출력 (서버 config.py 와 비교용)
//   node tests/homerun-sim.mjs --replay < script.json
//        조작 목록을 그대로 재생하고 결과를 JSON 으로 출력 (server/tests/test_homerun_game.py 가 Python 판정과 비교)
import assert from 'node:assert/strict';
import { RULES } from '../src/games/homerun/config.js';
import { Sim, createBots } from '../src/games/homerun/sim/Sim.js';

/** 시드가 있는 난수(시험이 매번 같게) */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function playOnce(n, seed) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i }));
  const rng = lcg(seed);
  const sim = new Sim(players, {}, rng);
  const bots = createBots(players.map((p) => p.id), rng);
  const kinds = new Set();
  let states = 0;
  let t = 1000;
  sim.start(t);
  const options = sim.clientOptions();
  assert.ok(Array.isArray(options.pitches) && options.pitches.length >= RULES.CHANCES);
  assert.equal(options.pitches.filter((p) => !p.ball).length, RULES.CHANCES);
  assert.equal(options.pitches.filter((p) => p.gold).length, 1);
  for (let i = 0; i < 30 * 600 && !sim.finished; i++) {
    t += 1 / 30;
    for (const input of bots(sim, t)) sim.onInput(input.playerId, input.data, t);
    sim.tick(t);
    for (const [, kind, data] of sim.drain()) {
      if (kind === 'state') states++;
      else kinds.add(data.type);
    }
  }
  assert.ok(sim.finished, '한 판이 끝나야 한다');
  const results = sim.results;
  assert.equal(results.length, n);
  results.forEach((r, i) => {
    assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
    assert.ok(Number.isInteger(r.score) && r.score >= 0);
    assert.ok(r.rank >= 1 && r.rank <= n);
    assert.equal(r.isWinner, r.rank === 1);
    if (i > 0) assert.ok(results[i - 1].score >= r.score, '점수 내림차순');
    assert.ok(r.stats.log.filter((x) => x !== 'ball').length <= RULES.CHANCES);
  });
  assert.equal(results[0].rank, 1);
  assert.ok(states > 10);
  assert.ok(kinds.has('call'));
  return { n, seconds: Math.round(t - 1000), kinds: [...kinds].sort(), scores: results.map((r) => r.score) };
}

if (process.argv.includes('--config')) {
  process.stdout.write(JSON.stringify(RULES));
} else if (process.argv.includes('--replay')) {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const script = JSON.parse(text);
  let ri = 0;
  const rng = () => script.rng[ri++ % script.rng.length];
  const sim = new Sim(script.players, script.options || {}, rng);
  const options = sim.clientOptions();
  const events = [];
  for (const op of script.ops) {
    if (op[0] === 'start') sim.start(op[1]);
    else if (op[0] === 'tick') sim.tick(op[1]);
    else if (op[0] === 'input') sim.onInput(op[1], op[2], op[3]);
    for (const [to, kind, data] of sim.drain()) if (kind === 'event' && data.type !== 'say') events.push([to, data]);
  }
  process.stdout.write(JSON.stringify({ options, events, finished: sim.finished, results: sim.results }));
} else {
  for (const [n, seed] of [[2, 11], [3, 22], [5, 33]]) {
    const r = playOnce(n, seed);
    console.log(`통과: ${r.n}명 · ${r.seconds}초 · 점수 ${r.scores.join('/')} · 사건 ${r.kinds.join(',')}`);
  }
}
