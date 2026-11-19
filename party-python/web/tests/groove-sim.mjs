// 시험 도구: 잭팟 그루브 시험용 진행기(sim/Sim.js)
//   node tests/groove-sim.mjs            봇만으로 한 판을 가짜 시계로 끝까지 돌려 결과 형식을 확인한다
//   node tests/groove-sim.mjs --charts   곡 3개 × 난이도 3개의 채보를 JSON 으로 출력 (서버 테스트가 Python 채보와 비교)
//   node tests/groove-sim.mjs --config   규칙 값 출력 (서버 테스트가 config.py 와 비교)
import assert from 'node:assert/strict';
import { Sim, createBots } from '../src/games/groove/sim/Sim.js';
import { CONFIG } from '../src/games/groove/config.js';
import { SONGS, SONG_ORDER, expandSong } from '../src/games/groove/song.js';
import { buildChart, chartJudgeCount } from '../src/games/groove/chart.js';

if (process.argv.includes('--charts')) {
  const out = {};
  for (const id of SONG_ORDER) {
    const ex = expandSong(SONGS[id]);
    out[id] = { duration: ex.duration, barSec: ex.barSec, bars: ex.bars.length };
    for (const diff of ['easy', 'normal', 'hard']) {
      const chart = buildChart(SONGS[id], diff);
      out[id][diff] = { total: chartJudgeCount(chart), notes: chart.map((n) => [n.id, n.time, n.lane, n.endTime, n.step]) };
    }
  }
  process.stdout.write(JSON.stringify(out));
} else if (process.argv.includes('--config')) {
  const { JUDGE, JUDGE_WEIGHT100, SCORE_MAX, SCORE_COMBO_PART, FEVER_COMBO, FLOW, NET } = CONFIG;
  process.stdout.write(JSON.stringify({
    JUDGE, JUDGE_WEIGHT100, SCORE_MAX, SCORE_COMBO_PART, FEVER_COMBO, FLOW, NET,
    GRADES: CONFIG.GRADES.map((g) => [g.grade, g.min]),
    DIFFICULTY: Object.fromEntries(Object.entries(CONFIG.DIFFICULTY).map(([k, v]) => [k, { label: v.label, approach: v.approach }])),
  }));
} else if (process.argv.includes('--replay')) {
  // 조작 목록(JSON, 표준 입력)을 그대로 재생 → 서버 테스트가 Python 판정과 비교한다
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const script = JSON.parse(text);
  const sim = new Sim(script.players, script.options, () => 0);
  const trace = [];
  for (const op of script.ops) {
    if (op[0] === 'start') sim.start(op[1]);
    else if (op[0] === 'tick') sim.tick(op[1]);
    else if (op[0] === 'input') sim.onInput(op[1], op[2], op[3]);
    for (const [, kind, data] of sim.drain()) if (kind === 'state') trace.push([data.phase, data.players]);
  }
  const last = script.ops[script.ops.length - 1];
  process.stdout.write(JSON.stringify({
    options: sim.clientOptions(), trace, finished: sim.finished, results: sim.results,
    reconnect: sim.stateFor(script.players[0].id, last[last.length - 1]).me,
  }));
} else {
  // 간단한 고정 난수(매번 같은 결과)
  const makeRng = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const count of [2, 3, 5]) {
    const players = Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i }));
    const rng = makeRng(count * 7 + 1);
    const sim = new Sim(players, {}, rng);
    const bots = createBots(players.map((p) => p.id), rng);
    const options = sim.clientOptions();
    assert.ok(SONGS[options.song] && options.notes > 50 && options.lead > 1);
    let t = 1000;
    sim.start(t);
    const kinds = new Set();
    const phases = [];
    let states = 0;
    let guard = 0;
    while (!sim.finished) {
      t += 1 / Sim.tickHz;
      for (const input of bots(sim, t)) sim.onInput(input.playerId, input.data, t);
      sim.tick(t);
      for (const [to, kind, data] of sim.drain()) {
        assert.equal(to, null);
        if (kind === 'event') kinds.add(data.type);
        else {
          states++;
          if (phases[phases.length - 1] !== data.phase) phases.push(data.phase);
        }
      }
      assert.ok(++guard < 30 * 200, '한 판이 200초 안에 끝나야 한다');
    }
    assert.deepEqual(phases, ['intro', 'play', 'outro', 'final', 'done']);
    assert.ok(kinds.has('say') && kinds.has('finish') && !kinds.has('verdict'));
    const results = sim.results;
    assert.equal(results.length, count);
    results.forEach((r, i) => {
      assert.deepEqual(Object.keys(r).sort(), ['isWinner', 'name', 'playerId', 'rank', 'score', 'stats']);
      assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= CONFIG.SCORE_MAX);
      assert.ok(r.rank >= 1 && r.rank <= count);
      if (i > 0) assert.ok(results[i - 1].score >= r.score && results[i - 1].rank <= r.rank);
      assert.equal(r.isWinner, r.rank === 1);
      const s = r.stats;
      assert.equal(s.perfect + s.great + s.good + s.miss, options.total);
      assert.ok('SABCD'.includes(s.grade) && s.maxCombo <= options.total);
    });
    assert.equal(results[0].rank, 1);
    assert.ok(results[0].score > 300000, '봇도 어느 정도는 친다');
    const re = sim.stateFor('p1', t);
    assert.ok(re.me && re.me.ptr.length === 3 && re.results.length === count);
    console.log(`${count}명: ${options.song}/${options.difficulty} 노트 ${options.notes}개, ${(t - 1000).toFixed(1)}초, 상태 ${states}번 →`,
      results.map((r) => `${r.rank}위 ${r.name} ${r.score}(${r.stats.grade})`).join(', '));
  }
  console.log('groove-sim: 통과');
}
