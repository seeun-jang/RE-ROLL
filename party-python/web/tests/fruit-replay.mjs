// 시험 도구: 주어진 조작 목록(JSON)을 FruitSim 에 그대로 재생하고 결과를 JSON 으로 출력한다.
// server/tests/test_fruit_parity.py 가 같은 목록을 Python 판정에도 넣어 두 결과를 비교한다.
//   node tests/fruit-replay.mjs < script.json     (조작 재생)
//   node tests/fruit-replay.mjs --config          (규칙 값 출력)
import { FruitSim } from '../src/games/fruit/sim/FruitSim.js';
import { DEFAULT_CONFIG } from '../src/games/fruit/sim/rules.js';

if (process.argv.includes('--config')) {
  process.stdout.write(JSON.stringify(DEFAULT_CONFIG));
} else {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const script = JSON.parse(text);
  let ri = 0;
  const rng = () => script.rng[ri++ % script.rng.length];
  const sim = new FruitSim(script.players, { config: script.config }, rng);
  const trace = [];
  const events = [];
  const options = sim.clientOptions();
  for (const op of script.ops) {
    if (op[0] === 'start') sim.start(op[1]);
    else if (op[0] === 'tick') sim.tick(op[1]);
    else if (op[0] === 'input') sim.onInput(op[1], op[2], op[3]);
    for (const [to, kind, data] of sim.drain()) {
      if (kind === 'event') events.push([to, data]);
      else trace.push(data);
    }
  }
  const reconnect = sim.stateFor(script.players[0].id, script.ops[script.ops.length - 1][1]);
  process.stdout.write(JSON.stringify({ options, trace, events, finished: sim.finished, results: sim.results, reconnect }));
}
