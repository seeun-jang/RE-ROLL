// 시험 도구: 실거리 사격 시험용 진행기(Sim)를 가짜 시계로, 봇만으로 한 판 끝까지 돌려 본다.
//   node tests/livefire-sim.mjs
// 확인: 2 · 3 · 5명 모두 끝까지 가는지, 결과가 공통 결과 형식인지, 메시지 모양이 서버와 같은지.
import assert from 'node:assert/strict';
import { Sim, createBots } from '../src/games/livefire/sim/Sim.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

for (const n of [2, 3, 5]) {
  const rng = seeded(100 + n);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i }));
  const sim = new Sim(players, {}, rng);
  const bots = createBots(players.map((p) => p.id), rng);
  const opts = sim.clientOptions();
  assert.equal(opts.caster, '호랑대장');
  assert.equal(opts.config.TARGETS, 20);
  let t = 50;
  sim.start(t);
  const events = [];
  let lastState = null;
  let guard = 0;
  while (!sim.finished && guard++ < 30 * 200) {
    t += 1 / Sim.tickHz;
    for (const input of bots(sim, t)) sim.onInput(input.playerId, input.data, t);
    sim.tick(t);
    for (const [to, kind, data] of sim.drain()) {
      if (kind === 'event') events.push([to, data]);
      else if (to === 'p1') lastState = data;
    }
  }
  assert.ok(sim.finished, `${n}명: 끝나지 않음`);
  const seconds = t - 50;
  assert.ok(seconds > 30 && seconds < 180, `${n}명: 한 판 길이 ${seconds.toFixed(1)}초`);
  const res = sim.results;
  assert.equal(res.length, n);
  res.forEach((r, i) => {
    assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
    assert.deepEqual(Object.keys(r.stats).sort(), ['accuracy', 'bestStreak', 'grade', 'hits', 'quick', 'shots']);
    assert.equal(r.score, r.stats.hits * 10 + r.stats.quick);
    assert.ok(r.score <= 300 && r.stats.shots <= 20);
    if (i > 0) assert.ok(res[i - 1].score >= r.score && res[i - 1].rank <= r.rank);
    assert.equal(r.isWinner, r.score === res[0].score);
  });
  assert.equal(res[0].rank, 1);
  assert.ok(res.some((r) => r.stats.hits > 0), '봇이 한 발도 못 맞힘');
  const kinds = new Set(events.map(([, e]) => e.type));
  assert.ok(kinds.has('tower') && kinds.has('shot') && kinds.has('say') && !kinds.has('verdict'));
  assert.ok(events.filter(([, e]) => e.type === 'say').every(([, e]) => e.source === 'canned' && e.who === '호랑대장'));
  assert.equal(lastState.phase, 'done');
  assert.deepEqual(lastState.results, res);
  assert.equal(lastState.lanes.p1.rec.length, 20);
  for (const key of ['ax', 'ay', 'kick', 'still', 'cooldown', 'ph', 'held']) assert.ok(key in lastState.me);
  console.log(`${n}명: ${seconds.toFixed(1)}초 · ` + res.map((r) => `${r.rank}등 ${r.name} ${r.score}점(${r.stats.hits}발 ${r.stats.grade})`).join(' / '));
}
console.log('livefire sim OK');
