// 시험 도구: 잭팟 볼링 시험용 진행기(Sim)를 가짜 시계로 끝까지 돌려 본다.
//   node tests/bowling-sim.mjs            봇만으로 2 · 3 · 5명 한 판씩 → game.end 의 results 모양 확인
//   node tests/bowling-sim.mjs --config   규칙 값 출력 (server/tests/test_bowling_game.py 가 서버 값과 비교)
//   node tests/bowling-sim.mjs --rack     표준 입력의 투구 목록(JSON)을 굴려 핀 상태를 출력 (서버 계산과 비교용)
import assert from 'node:assert/strict';
import { Sim, createBots } from '../src/games/bowling/sim/Sim.js';
import { DEFAULT_CONFIG, frameState, scoreFrames, simulateThrow } from '../src/games/bowling/sim/rules.js';

/** 씨앗이 정해진 난수 (판마다 같은 결과가 나오게) */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function playOnce(count, seed) {
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i }));
  const rng = seeded(seed);
  const sim = new Sim(players, {}, rng);
  const bots = createBots(players.map((p) => p.id), rng);
  let t = 100;
  sim.start(t);
  const options = sim.clientOptions();
  assert.equal(options.frames, DEFAULT_CONFIG.FRAMES);
  assert.equal(options.golds.length, options.frames);
  const kinds = new Set();
  let states = 0;
  const collect = () => {
    for (const [to, kind, data] of sim.drain()) {
      if (kind === 'state') {
        states++;
        assert.ok(to && data.me && data.players[to], '상태는 참가자마다 me 와 함께 간다');
      } else kinds.add(data.type);
    }
  };
  collect();
  while (!sim.finished && t < 100 + 600) {
    t += 1 / Sim.tickHz;
    for (const input of bots(sim, t)) sim.onInput(input.playerId, input.data, t);
    sim.tick(t);
    collect();
  }
  assert.ok(sim.finished, '한 판이 끝나야 한다');
  const seconds = t - 100;
  assert.ok(seconds < 240, `한 판이 너무 길다: ${seconds}초`);
  assert.ok(states > 10 && kinds.has('roll') && kinds.has('say'));
  assert.ok(!kinds.has('verdict'), '시험용 진행기는 총평을 보내지 않는다');

  // game.end 의 results 는 공통 결과 형식이어야 한다
  const results = sim.results;
  assert.equal(results.length, count);
  results.forEach((r, i) => {
    assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
    assert.equal(typeof r.score, 'number');
    assert.ok(r.rank >= 1 && r.rank <= count);
    assert.equal(r.isWinner, r.rank === 1);
    if (i > 0) assert.ok(results[i - 1].score >= r.score && results[i - 1].rank <= r.rank);
    assert.ok(frameState(r.stats.rolls, options.frames).done, '모든 프레임을 다 쳤다');
    const frames = scoreFrames(r.stats.rolls, options.frames);
    assert.equal(frames[frames.length - 1].cum + r.stats.bonus, r.score);
  });
  assert.equal(results[0].rank, 1);
  return { count, seconds: Math.round(seconds), scores: results.map((r) => r.score) };
}

if (process.argv.includes('--config')) {
  process.stdout.write(JSON.stringify(DEFAULT_CONFIG));
} else if (process.argv.includes('--rack')) {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const out = JSON.parse(text).map((t) => {
    const res = simulateThrow(DEFAULT_CONFIG, t.up, t.gold, t.x, t.angle, t.power, t.spin, t.seed);
    return {
      frames: res.frames, up: res.up, knocked: res.knocked, gutter: res.gutter, goldHit: res.goldHit,
      pins: res.rack.pins.map((p) => [p.x, p.y, p.vx, p.vy, p.up ? 1 : 0, p.gone ? 1 : 0, p.fall]),
      ball: [res.rack.ball.x, res.rack.ball.y, res.rack.ball.vx, res.rack.ball.vy, res.rack.ball.spin],
    };
  });
  process.stdout.write(JSON.stringify(out));
} else {
  for (const [count, seed] of [[2, 11], [3, 22], [5, 33]]) {
    const r = playOnce(count, seed);
    console.log(`${r.count}명: ${r.seconds}초, 점수 ${r.scores.join(' · ')}`);
  }
  console.log('bowling-sim: 통과');
}
