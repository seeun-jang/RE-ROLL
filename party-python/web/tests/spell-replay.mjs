// 시험 도구: 주어진 조작 목록(JSON)을 SpellSim 에 그대로 재생하고 결과를 JSON 으로 출력한다.
// server/tests/test_spell_parity.py 가 같은 목록을 Python 판정에도 넣어 두 결과를 비교한다.
//   node tests/spell-replay.mjs < script.json          (조작 재생)
//   node tests/spell-replay.mjs --spells               (주문 데이터 출력)
import { SpellSim } from '../src/games/spell/sim/SpellSim.js';
import { SPELLS } from '../src/games/spell/data/spells.js';
import { BEATS } from '../src/games/spell/data/elements.js';

if (process.argv.includes('--spells')) {
  process.stdout.write(JSON.stringify({ spells: SPELLS, beats: BEATS }));
} else {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const script = JSON.parse(text);
  let ri = 0;
  const rng = () => script.rng[ri++ % script.rng.length];
  const sim = new SpellSim(script.players, { config: script.config }, rng);
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
