// 시험 도구: 주어진 조작 목록(JSON)을 MugunghwaSim 에 그대로 재생하고 결과를 JSON 으로 출력한다.
// server/tests/test_mugunghwa_parity.py 가 같은 목록을 Python 판정에도 넣어 두 결과를 비교한다.
//   node tests/mugunghwa-replay.mjs < script.json          (조작 재생)
import { MugunghwaSim } from '../src/games/mugunghwa/sim/MugunghwaSim.js';

{
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const script = JSON.parse(text);
  let ri = 0;
  const rng = () => script.rng[ri++ % script.rng.length];
  const sim = new MugunghwaSim(script.players, { config: script.config, tagger: script.tagger }, rng);
  const trace = [];
  const events = [];
  for (const op of script.ops) {
    if (op[0] === 'start') sim.start(op[1]);
    else if (op[0] === 'tick') sim.tick(op[1]);
    else if (op[0] === 'input') sim.onInput(op[1], op[2], op[3]);
    for (const [, kind, data] of sim.drain()) {
      if (kind === 'event') events.push(data);
      else trace.push(data);
    }
  }
  process.stdout.write(JSON.stringify({ trace, events, finished: sim.finished, results: sim.results }));
}
