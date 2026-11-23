// 시험 도구: 마법진 그리기 시험용 진행기(Sim)를 가짜 시계로 봇만으로 끝까지 돌려 본다.
//   node tests/sigil-sim.mjs            2 · 3 · 5명으로 한 판씩 돌리고 결과 형식을 확인
//   node tests/sigil-sim.mjs --parity   모양 · 종이 · 채점 값을 JSON 으로 출력 (server/tests/test_sigil_game.py 가 Python 과 비교)
import { CONFIG } from '../src/games/sigil/config.js';
import { SHAPES, prepareShape } from '../src/games/sigil/shapes.js';
import { Paper, scoreDrawing } from '../src/games/sigil/sketch.js';
import { Sim, createBots } from '../src/games/sigil/sim/Sim.js';
import { meta } from '../src/games/sigil/minigame.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`확인 실패: ${msg}`);
}

/** 고정된 난수(테스트가 매번 같게) */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (process.argv.includes('--parity')) {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const { strokes } = JSON.parse(text);
  const paper = new Paper(false);
  for (const s of strokes) {
    paper.end();
    for (let i = 0; i < s.length; i += 2) paper.stroke(s[i], s[i + 1], null);
  }
  const shapes = SHAPES.map((shape) => {
    const prep = prepareShape(shape);
    const full = new Paper(false);
    for (const [x, y] of prep.path) full.stroke(Math.round(x), Math.round(y), null);
    return {
      name: shape.name, tier: shape.tier,
      cells: prep.path.flatMap(([x, y]) => [Math.round(x), Math.round(y)]),
      distSum: prep.dist.reduce((a, b) => a + b, 0),
      accuracy: scoreDrawing(paper, shape).accuracy,
      perfect: scoreDrawing(full, shape).accuracy,
    };
  });
  process.stdout.write(JSON.stringify({ bits: paper.bits(), inkCount: paper.inkCount, shapes, config: CONFIG }));
} else {
  assert(meta.id === 'sigil' && meta.howTo, 'meta');
  for (const n of [2, 3, 5]) {
    const rng = makeRng(100 + n);
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `봇${i + 1}`, index: i }));
    const sim = new Sim(players, {}, rng);
    const bots = createBots(players.map((p) => p.id), rng);
    const seen = { phases: new Set(), events: {}, states: 0 };
    let now = 1000;
    sim.start(now);
    const options = sim.clientOptions();
    JSON.stringify(options);
    assert(options.shapes.length === 9 && options.rounds.length === 3, 'options');
    let reconnect = null;
    while (!sim.finished) {
      now += 1 / Sim.tickHz;
      assert(now < 1000 + 300, `시간 초과 (phase=${sim.phase})`);
      for (const input of bots(sim, now)) sim.onInput(input.playerId, input.data, now);
      sim.tick(now);
      if (sim.phase === 'gallery' && !reconnect) reconnect = sim.stateFor('p1', now);
      for (const [to, kind, data] of sim.drain()) {
        assert(to === null, '모두에게 보내는 메시지');
        JSON.stringify(data);
        if (kind === 'state') {
          seen.states++;
          seen.phases.add(data.phase);
        } else seen.events[data.type] = (seen.events[data.type] || 0) + 1;
      }
    }
    for (const ph of ['intro', 'slot', 'ready', 'draw', 'score', 'gallery', 'final', 'done']) assert(seen.phases.has(ph), `phase ${ph}`);
    assert(seen.events.reveal === 3, 'reveal 3번');
    assert(seen.events.done >= n, 'done 사건');
    assert(seen.events.say >= 4, 'say 사건');
    assert(!seen.events.verdict && !seen.events.review, 'sim 에는 AI 가 없다');
    assert(reconnect && Object.keys(reconnect.drawings).length === n, '재접속 상태에 그림');
    const res = sim.results;
    assert(res.length === n, '결과 수');
    res.forEach((r, i) => {
      assert(['playerId', 'name', 'score', 'rank', 'isWinner', 'stats'].every((k) => k in r), '공통 결과 형식');
      assert(Number.isInteger(r.score) && r.score >= 0 && r.score <= 464, `점수 범위 ${r.score}`);
      assert(i === 0 || res[i - 1].score >= r.score, '점수 내림차순');
      assert(r.rank === (i > 0 && res[i - 1].score === r.score ? res[i - 1].rank : i + 1), '순위');
      assert(r.isWinner === (r.score === res[0].score), '승자');
      assert(r.stats.rounds.length === 3 && r.stats.rounds.reduce((a, b) => a + b, 0) === r.score, '라운드 합 = 점수');
    });
    assert(res[0].score > 0, '봇이 그림을 그렸다');
    console.log(`${n}명: ${(now - 1000).toFixed(1)}초, 점수 ${res.map((r) => r.score).join(' / ')}, 상태 ${seen.states}번`);
  }
  console.log('sigil sim 통과');
}
