// 시험 도구: "교수님 몰래 댄스!" 시험용 진행기(Sim)를 가짜 시계로 봇만으로 끝까지 돌려 본다.
//   node tests/sneaky-sim.mjs
// 확인하는 것: 2 · 3 · 5명 모두 끝까지 진행되고, game.end 의 results 가 공통 결과 형식인지,
//             화면 모듈(minigame.js)이 브라우저 없이 import 만으로 오류가 나지 않는지.
import assert from 'node:assert/strict';
import { Sim, createBots } from '../src/games/sneaky/sim/Sim.js';

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

for (const n of [2, 3, 5]) {
  const rng = seeded(100 + n);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i, character: 'bear' }));
  const sim = new Sim(players, {}, rng);
  const bots = createBots(players.map((p) => p.id), rng);
  let now = 0;
  sim.start(now);
  const opt = sim.clientOptions();
  assert.equal(opt.config.CLASS_TIME, 3600);
  const kinds = new Set();
  let states = 0;
  let lastState = null;
  while (!sim.finished) {
    now += 1 / Sim.tickHz;
    assert.ok(now < 90, '게임이 끝나지 않음');
    for (const input of bots(sim, now)) sim.onInput(input.playerId, input.data, now);
    sim.tick(now);
    for (const [to, kind, data] of sim.drain()) {
      assert.equal(to, null);
      if (kind === 'event') kinds.add(data.type);
      else {
        states++;
        lastState = data;
      }
    }
  }
  const res = sim.results;
  assert.equal(res.length, n);
  for (const r of res) {
    assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
    assert.ok(Number.isInteger(r.score) && r.score >= 0);
    assert.deepEqual(Object.keys(r.stats).sort(), ['caught', 'danceSec', 'maxFever', 'out']);
  }
  assert.equal(res[0].rank, 1);
  assert.ok(res[0].isWinner && res[0].score > 0);
  for (let i = 1; i < res.length; i++) assert.ok(res[i].score <= res[i - 1].score && res[i].rank >= res[i - 1].rank);
  for (const k of ['teacher', 'say', 'end']) assert.ok(kinds.has(k), `사건 ${k} 없음`);
  assert.ok(!kinds.has('verdict'));
  assert.ok(states > 1500 && lastState.phase === 'done' && lastState.results.length === n);
  assert.deepEqual(Object.keys(lastState).sort(),
    ['frame', 'left', 'line', 'now', 'phase', 'plan', 'results', 'startAt', 'students', 'teacher', 'verdict']);
  console.log(`${n}명: ${now.toFixed(1)}초, 결과`, res.map((r) => `${r.rank}등 ${r.name} ${r.score}점(걸림 ${r.stats.caught})`).join(' / '));
}

// 화면 모듈은 import 만으로는 브라우저 객체를 건드리지 않아야 한다
const mod = await import('../src/games/sneaky/minigame.js');
assert.equal(mod.meta.id, 'sneaky');
assert.equal(typeof mod.mount, 'function');
console.log('sneaky-sim 통과');
