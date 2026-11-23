// 잭팟 인형뽑기 시험 도구
//   node tests/claw-sim.mjs            봇만으로 2 · 3 · 5명 한 판씩 끝까지 돌려 결과 형식을 확인한다(가짜 시계)
//   node tests/claw-sim.mjs --config   규칙 값 출력 (server/tests/test_claw_game.py 가 Python 값과 비교)
//   node tests/claw-sim.mjs --trace < script.json
//        기계 하나에 정해진 조작({seed, moves:[[오른쪽으로 누르는 프레임, 기다리는 프레임], ...]})을 넣고
//        인형 위치 · 뽑은 인형을 출력한다 (Python 판정과 완전히 같은지 비교)
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, mergeConfig } from '../src/games/claw/sim/config.js';
import { Machine, makePile } from '../src/games/claw/sim/rules.js';
import { Sim, createBots } from '../src/games/claw/sim/Sim.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function playOnce(n, seed) {
  const rng = seeded(seed);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i }));
  const sim = new Sim(players, {}, rng);
  const bots = createBots(players.map((p) => p.id), rng);
  let t = 1000;
  sim.start(t);
  const options = sim.clientOptions();
  assert.equal(options.coins, 8);
  const kinds = new Set();
  const phases = new Set();
  let says = 0;
  let personal = 0;
  for (let i = 0; i < 30 * 400 && !sim.finished; i++) {
    t += 1 / 30;
    for (const input of bots(sim, t)) sim.onInput(input.playerId, input.data, t);
    sim.tick(t);
    for (const [to, kind, data] of sim.drain()) {
      if (kind === 'state') {
        phases.add(data.phase);
        assert.ok(to, '상태는 참가자마다 따로 보낸다');
        assert.ok(data.me && Array.isArray(data.me.prizes));
        personal++;
      } else {
        kinds.add(data.type);
        if (data.type === 'say') {
          says++;
          assert.equal(to, null);
          assert.equal(data.source, 'canned');
          assert.ok(data.text && !data.text.includes('{'));
        } else assert.ok(to, '기계 사건은 본인에게만');
      }
    }
  }
  assert.ok(sim.finished, '게임이 끝나야 한다');
  const played = t - 1000;
  assert.ok(played > 20 && played < 180, `한 판 길이 ${played.toFixed(1)}초`);
  for (const ph of ['intro', 'play', 'end', 'final', 'done']) assert.ok(phases.has(ph), `단계 ${ph}`);
  assert.ok(kinds.has('coin') && kinds.has('drop'));
  assert.ok(!kinds.has('verdict'), '시험용 진행기는 총평을 보내지 않는다');
  assert.ok(says >= 1);
  // 공통 결과 형식
  const rs = sim.results;
  assert.equal(rs.length, n);
  rs.forEach((r, i) => {
    assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
    assert.ok(Number.isInteger(r.score) && r.score >= 0);
    assert.ok(r.rank >= 1 && r.rank <= n);
    assert.equal(r.isWinner, r.rank === 1);
    assert.equal(r.stats.tries, 8);
    assert.equal(r.stats.prizes, r.stats.won.length);
    if (i > 0) assert.ok(rs[i - 1].score >= r.score && rs[i - 1].rank <= r.rank);
  });
  assert.equal(rs[0].rank, 1);
  return { n, seconds: Math.round(played), scores: rs.map((r) => r.score), personal };
}

function trace(script) {
  const cfg = mergeConfig(script.config);
  const pile = makePile(cfg, script.seed);
  const m = new Machine(cfg, script.seed, pile);
  const events = [];
  const pull = () => {
    for (const e of m.events) events.push(e.type === 'won' || e.type === 'grab' || e.type === 'slip' ? `${e.type}:${e.id}` : e.type);
    m.events = [];
  };
  for (const [hold, wait] of script.moves) {
    m.setInput(1, false);
    for (let i = 0; i < hold; i++) m.step();
    m.setInput(0, false);
    for (let i = 0; i < wait; i++) m.step();
    m.setInput(0, true);
    m.step();
    for (let i = 0; i < 2000 && m.claw.state !== 'idle'; i++) m.step();
    pull();
  }
  for (let i = 0; i < 120; i++) m.step();
  pull();
  return {
    pile: pile.map((p) => [p.id, p.type, p.x, p.y]),
    prizes: m.prizes.map((p) => [p.id, p.x, p.y]),
    won: m.won.map((p) => p.id),
    score: m.score, frame: m.frame, events,
  };
}

if (process.argv.includes('--config')) {
  process.stdout.write(JSON.stringify(DEFAULT_CONFIG));
} else if (process.argv.includes('--trace')) {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  process.stdout.write(JSON.stringify(trace(JSON.parse(text))));
} else {
  for (const [n, seed] of [[2, 11], [3, 22], [5, 33]]) console.log('ok', JSON.stringify(playOnce(n, seed)));
  console.log('claw-sim: 통과');
}
