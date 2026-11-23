// 시험 도구: 매직 파이트 나이트의 시험용 진행기(Sim)를 봇만으로 끝까지 돌려 보고 결과 형식을 확인한다.
//   node tests/fight-sim.mjs
import assert from 'node:assert/strict';
import { Sim, createBots } from '../src/games/fight/sim/Sim.js';

// 고정 난수(매번 같은 결과)
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

for (const n of [2, 3, 4, 5]) {
  const rng = makeRng(100 + n);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i, character: ['shiba', 'tiger', 'duck', 'bear', 'cat'][i] }));
  const sim = new Sim(players, {}, rng);
  const bots = createBots(players.map((p) => p.id), rng);
  let t = 1000;
  sim.start(t);
  const kinds = new Set();
  const says = [];
  let states = 0;
  let last = null;
  for (let i = 0; i < 30 * 60 * 10 && !sim.finished; i++) {
    t += 1 / 30;
    for (const input of bots(sim, t)) sim.onInput(input.playerId, input.data, t);
    sim.tick(t);
    for (const [to, kind, data] of sim.drain()) {
      assert.equal(to, null);
      if (kind === 'state') { states++; last = data; } else {
        kinds.add(data.type);
        if (data.type === 'say') says.push(data);
      }
    }
  }
  assert.ok(sim.finished, `${n}명: 끝나지 않음`);
  const res = sim.results;
  assert.equal(res.length, n);
  for (const r of res) {
    assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
    assert.equal(r.stats.wins + r.stats.losses, r.stats.matches);
  }
  assert.deepEqual(res.map((r) => r.score), [...res.map((r) => r.score)].sort((a, b) => b - a));
  assert.equal(res[0].rank, 1);
  assert.ok(res[0].isWinner);
  const rounds = n === 2 ? 3 : n % 2 ? n : n - 1;
  assert.equal(res.reduce((s, r) => s + r.stats.wins, 0), rounds * Math.floor(n / 2));
  assert.ok(last && last.phase === 'done' && last.results);
  for (const type of ['cue', 'start', 'punch', 'hit', 'end', 'say']) assert.ok(kinds.has(type), `${n}명: ${type} 사건 없음`);
  assert.ok(says.every((s) => s.source === 'canned' && s.text && s.who === '해설자'));
  assert.ok(!kinds.has('verdict'));
  console.log(`${n}명 통과 — ${(t - 1000).toFixed(0)}초, 상태 ${states}개, 1등 ${res[0].name} ${res[0].score}점 (${res[0].stats.wins}승 KO ${res[0].stats.kos})`);
}
console.log('fight-sim 통과');
