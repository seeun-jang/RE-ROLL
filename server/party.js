// =====================================================
// RE:ROLL 파티 — 보드게임 진행 (서버가 모든 판정을 함, 화면은 보여주고 고른 것만 보냄)
//  방: 4자리 번호 · 최대 5명 · 빈 자리는 CPU
//  한 턴: 주사위 고르기 → 모두 같이 굴림 → 동시에 이동 → 도착한 칸 효과 → 다 같이 같은 미니게임 → 순위대로 주사위
//  우승: 결승에 먼저 도착 (마지막 턴까지 아무도 못 가면 결승에 제일 가까운 사람)
//  메시지는 README.md 참고
// =====================================================
import { BOARD, DIST } from '../party/shared/board.js';
import * as R from '../party/shared/rules.js';

// PARTY_SPEED=4 처럼 주면 연출 시간이 그만큼 짧아짐 (시험용)
const SPEED = Math.max(1, +process.env.PARTY_SPEED || 1);
const T0 = {
  STEP_MS: 230,          // 한 칸 이동
  REVEAL_MS: 2600,       // 굴린 결과 보여주기
  EFFECT_MS: 1900,       // 칸 효과 하나 보여주기
  CHOOSE_MS: 20000,      // 주사위 고르기
  ASK_MS: 12000,         // 갈림길 · 사람 고르기 등
  TIMING_MS: 8000,
  MG_INTRO_MS: 3500,
  MG_MAX_MS: 6 * 60 * 1000,
  MG_RESULT_MS: 6000,
  CPU_THINK_MS: [500, 1300],
};
const T = Object.fromEntries(Object.entries(T0).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x / SPEED) : v / SPEED]));

const rooms = new Map(); // code → room
let nextId = 1;
let nextPrompt = 1;

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = rand(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const node = (p) => p.hist[p.hist.length - 1];
const dist = (p) => DIST[node(p)];
const online = (p) => !!p.ws;
const humans = (room) => room.players.filter((p) => !p.cpu);
const cleanName = (s) => String(s || '').trim().slice(0, 8);

class Gone extends Error {}

// ---------------- 보내기 ----------------
function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function snapshot(room) {
  return {
    t: 'room',
    code: room.code,
    phase: room.phase,           // lobby | play | end
    step: room.step,             // choose | reveal | move | space | minigame | mgResult
    turn: room.turn,
    maxTurns: room.maxTurns,
    host: room.host,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, cpu: p.cpu, online: p.cpu || online(p), seat: p.seat,
      node: node(p), dist: dist(p), bag: p.bag.map((d) => d.id), flags: p.flags, ready: p.ready,
    })),
    prompts: [...room.prompts.values()].map(({ id, pid, kind, title, options, deadline, meta }) => ({ id, pid, kind, title, options, deadline, meta })),
    rolls: room.rolls,
    mg: room.mg && { id: room.mg.id, name: room.mg.name, seed: room.mg.seed, startAt: room.mg.startAt, done: Object.keys(room.mg.results).map(Number) },
    mgResult: room.mgResult,
    log: room.log.slice(-8),
    ranking: room.ranking,
  };
}

function broadcast(room) {
  const snap = JSON.stringify(snapshot(room));
  for (const p of room.players) if (p.ws && p.ws.readyState === p.ws.OPEN) p.ws.send(snap);
}

// 화면에 크게 띄우는 알림 (+ 기록)
function announce(room, text, { icon = '', pid = null, big = false } = {}) {
  room.log.push(`${icon ? icon + ' ' : ''}${text}`);
  const msg = { t: 'fx', kind: 'announce', text, icon, pid, big };
  for (const p of room.players) send(p.ws, msg);
}

async function wait(room, ms) {
  await new Promise((r) => setTimeout(r, ms));
  if (room.dead) throw new Gone();
}

// ---------------- 고르기 ----------------
// options: [{ value, label, icon?, desc? }] · kind 'timing' 은 1~10 숫자
// CPU 나 접속이 끊긴 사람은 cpuPick 으로 자동 선택, 시간이 지나면 첫 번째
function ask(room, p, kind, title, options, { timeout = T.ASK_MS, cpuPick, meta } = {}) {
  return new Promise((resolve, reject) => {
    const id = nextPrompt++;
    const fallback = cpuPick ? cpuPick() : options[0]?.value;
    const pr = { id, pid: p.id, kind, title, options, deadline: Date.now() + timeout, meta };
    const finish = (v) => {
      if (!room.prompts.has(id)) return;
      room.prompts.delete(id);
      clearTimeout(pr.timer);
      clearTimeout(pr.cpuTimer);
      if (room.dead) return reject(new Gone());
      broadcast(room);
      resolve(v);
    };
    pr.resolve = finish;
    pr.fallback = fallback;
    pr.timer = setTimeout(() => finish(fallback), timeout);
    if (p.cpu || !online(p)) pr.cpuTimer = setTimeout(() => finish(fallback), T.CPU_THINK_MS[0] + rand(T.CPU_THINK_MS[1] - T.CPU_THINK_MS[0]));
    room.prompts.set(id, pr);
    broadcast(room);
  });
}

function answer(room, me, msg) {
  const pr = room.prompts.get(+msg.id);
  if (!pr || pr.pid !== me.id) return;
  let v = msg.value;
  if (pr.kind === 'timing') {
    v = Math.max(1, Math.min(10, Math.round(+v) || 1));
  } else if (!pr.options.some((o) => o.value === v)) {
    return;
  }
  pr.resolve(v);
}

// 접속이 끊기면 그 사람 질문은 자동으로
function autoAnswer(room, p) {
  for (const pr of room.prompts.values()) if (pr.pid === p.id) setTimeout(() => pr.resolve(pr.fallback), 300);
}

const playerOpts = (room, list) => list.map((o) => ({ value: o.id, label: o.name, icon: '', seat: o.seat }));
const leaderOf = (list) => [...list].sort((a, b) => dist(a) - dist(b))[0];
const lastOf = (list) => [...list].sort((a, b) => dist(b) - dist(a))[0];

// ---------------- 주사위 가방 ----------------
function giveDice(room, p, id, why = '') {
  const def = R.DICE[id];
  p.bag.push({ id, uses: def.uses || 1 });
  while (p.bag.length > R.BAG_MAX) p.bag.shift();
  announce(room, `${p.name} ${why}${def.icon} ${def.name} 획득!`, { pid: p.id });
}
function takeRandomDice(p) {
  if (!p.bag.length) return null;
  return p.bag.splice(rand(p.bag.length), 1)[0];
}

// ---------------- 이동 ----------------
// steps > 0: 앞으로 (갈림길에선 고름) · steps < 0: 왔던 길로 뒤로
async function move(room, p, steps, { landing = false } = {}) {
  let moved = 0;
  for (let i = 0; i < Math.abs(steps); i++) {
    if (steps > 0) {
      const cur = BOARD.nodes[node(p)];
      if (cur.id === BOARD.goal) break;
      let next = cur.next[0];
      if (cur.next.length > 1) {
        next = await ask(room, p, 'branch', '어느 길로 갈까?', cur.next.map((id, k) => ({
          value: id, label: k === 0 ? '위 길' : '아래 길', desc: branchDesc(cur.id, id),
        })), { cpuPick: () => pick(cur.next), meta: { left: Math.abs(steps) - i } });
      }
      p.hist.push(next);
    } else {
      if (p.hist.length <= 1) break;
      p.hist.pop();
    }
    moved++;
    broadcast(room);
    await wait(room, T.STEP_MS);
    if (node(p) === BOARD.goal) {
      p.goalOver = Math.abs(steps) - i - 1; // 남은 걸음 (같은 턴에 여럿 들어오면 많이 남은 사람이 먼저 도착한 셈)
      break;
    }
  }
  if (landing && moved > 0) p.landed = true;
  return moved;
}

function branchDesc(forkId, nextId) {
  // 짧은 길 / 긴 길 표시
  const d = DIST[nextId];
  const other = BOARD.nodes[forkId].next.filter((x) => x !== nextId).map((x) => DIST[x]);
  if (!other.length) return '';
  return d < Math.min(...other) ? '짧지만 위험' : d > Math.min(...other) ? '길지만 안전' : '쌈뽕한 칸 많음';
}

function teleport(room, p, toPlayer) {
  p.hist = [...toPlayer.hist];
}

// ---------------- 한 판 ----------------
async function runGame(room) {
  room.phase = 'play';
  room.turn = 0;
  room.ranking = null;
  room.lastGame = null;
  room.history = [];
  room.log = [];
  // 빈 자리 CPU
  const used = new Set(room.players.map((p) => p.seat));
  for (let s = 0; s < R.MAX_PLAYERS; s++) {
    if (used.has(s)) continue;
    room.players.push({ id: nextId++, name: `CPU ${s + 1}`, cpu: true, seat: s, ws: null });
  }
  room.players.sort((a, b) => a.seat - b.seat);
  for (const p of room.players) {
    p.hist = [BOARD.start];
    p.bag = [];
    p.flags = { skip: 0, mirror: false, shield: false, rest: false };
    p.goalOver = null;
  }
  announce(room, '게임 시작! 결승에 먼저 도착하면 우승', { icon: '🏁', big: true });
  broadcast(room);
  await wait(room, 1500);

  try {
    while (room.turn < room.maxTurns) {
      room.turn++;
      room.history.push(room.players.map((p) => [...p.hist]));
      announce(room, `${room.turn}턴${room.turn === room.maxTurns ? ' (마지막!)' : ''}`, { icon: '🎲', big: true });
      await phaseRoll(room);
      if (winners(room).length) break;
      await phaseSpaces(room);
      if (winners(room).length) break;
      await phaseMinigame(room);
    }
    finishGame(room);
  } catch (e) {
    if (e instanceof Gone) return;
    // 예상 못 한 오류: 멈춰 있지 않게 지금 위치로 게임을 끝냄
    console.error('[party] 진행 오류', e);
    try { finishGame(room); } catch (e2) { console.error(e2); }
  }
}

const winners = (room) => room.players.filter((p) => node(p) === BOARD.goal);

function finishGame(room) {
  room.step = null;
  room.phase = 'end';
  room.prompts.clear();
  const rows = room.players.map((p) => ({ id: p.id, name: p.name, cpu: p.cpu, seat: p.seat, dist: dist(p), over: p.goalOver ?? -1 }));
  rows.sort((a, b) => a.dist - b.dist || b.over - a.over || Math.random() - 0.5);
  rows.forEach((r, i) => (r.rank = i + 1));
  room.ranking = rows;
  announce(room, `${rows[0].name} 우승!`, { icon: '🏆', big: true });
  broadcast(room);
}

// ---------------- 1) 주사위 고르기 → 굴리기 → 이동 ----------------
async function phaseRoll(room) {
  room.step = 'choose';
  room.rolls = {};
  for (const p of room.players) { p.landed = false; p.flags.shield = false; }
  broadcast(room);

  const choices = await Promise.all(room.players.map((p) => chooseDice(room, p)));

  // 굴리기 (복사 · 질투 · 자석은 다른 사람 결과를 봐야 해서 뒤에)
  const rolls = room.players.map((p, i) => ({ p, ...choices[i] }));
  for (const r of rolls) if (!r.skip) rollOne(room, r, rolls);
  for (const r of rolls) if (!r.skip && r.later) r.later();
  for (const r of rolls) {
    if (r.skip) continue;
    if (r.p.flags.mirror && r.move > 0) { r.move = -r.move; r.text += ' → 🪞 거울! 뒤로'; }
    r.p.flags.mirror = false;
  }
  room.rolls = Object.fromEntries(rolls.map((r) => [r.p.id, { dice: r.dice, face: r.face, move: r.move, text: r.text, skip: !!r.skip }]));
  room.step = 'reveal';
  broadcast(room);
  await wait(room, T.REVEAL_MS);

  // 이동 (모두 동시에)
  room.step = 'move';
  broadcast(room);
  await Promise.all(rolls.map(async (r) => {
    if (r.skip) return;
    if (r.toStart) { r.p.hist = [BOARD.start]; broadcast(room); return; }
    if (r.teleport) { teleport(room, r.p, r.teleport); r.p.landed = true; broadcast(room); return; }
    if (r.move) await move(room, r.p, r.move, { landing: true });
  }));
  // 남한테 영향 주는 주사위 (저격 · 남 좋은)
  await Promise.all(rolls.filter((r) => r.other).map(async (r) => {
    const { who, steps } = r.other;
    if (steps < 0 && who.flags.shield) return announce(room, `${who.name} 🔰 방패로 막음!`, { pid: who.id });
    await move(room, who, steps);
  }));
  await wait(room, 400);
}

async function chooseDice(room, p) {
  if (p.flags.skip > 0) {
    p.flags.skip--;
    return { skip: true, dice: null, text: '😵 쉬는 중' };
  }
  // 쓰레기 주사위는 무조건 먼저
  let idx = p.bag.findIndex((d) => R.DICE[d.id].kind === 'trash');
  if (idx < 0) {
    const options = [{ value: -1, label: R.DICE.basic.name, icon: R.DICE.basic.icon, desc: R.DICE.basic.desc }]
      .concat(p.bag.map((d, i) => ({ value: i, label: R.DICE[d.id].name, icon: R.DICE[d.id].icon, desc: R.DICE[d.id].desc })));
    idx = options.length === 1 ? -1 : await ask(room, p, 'dice', '굴릴 주사위를 골라요', options, {
      timeout: T.CHOOSE_MS,
      cpuPick: () => (p.bag.length && Math.random() < 0.6 ? rand(p.bag.length) : -1),
    });
  }
  const id = idx < 0 ? 'basic' : p.bag[idx].id;
  // 다 썼으면 가방에서 빼기 (끈끈이는 2번)
  if (idx >= 0) {
    const d = p.bag[idx];
    if (--d.uses <= 0) p.bag.splice(idx, 1);
  }
  const def = R.DICE[id];
  const c = { dice: id };
  if (def.input === 'parity') {
    c.parity = await ask(room, p, 'parity', '홀? 짝?', [{ value: 'odd', label: '홀', icon: '⬆️' }, { value: 'even', label: '짝', icon: '⬇️' }], { cpuPick: () => pick(['odd', 'even']) });
  } else if (def.input === 'target') {
    const others = room.players.filter((o) => o !== p);
    c.target = await ask(room, p, 'target', '누구를 저격할까?', playerOpts(room, others), { cpuPick: () => leaderOf(others).id });
  } else if (def.input === 'timing') {
    c.timing = await ask(room, p, 'timing', 'Space 로 멈춰!', [], { timeout: T.TIMING_MS, cpuPick: () => 3 + rand(6) });
  }
  return c;
}

function rollOne(room, r, all) {
  const def = R.DICE[r.dice];
  const p = r.p;
  const face = def.faces ? pick(def.faces) : 0;
  r.face = face;
  r.move = face;
  r.text = `${def.icon} ${face}`;
  const others = room.players.filter((o) => o !== p);
  switch (r.dice) {
    case 'double': {
      const a = 1 + rand(6), b = 1 + rand(6);
      r.face = r.move = a + b;
      r.text = `🎲 ${a} + ${b} = ${a + b}`;
      break;
    }
    case 'timing':
      r.face = r.move = r.timing;
      r.text = `⏱️ ${r.timing}`;
      break;
    case 'parity': {
      const ok = (face % 2 === 1) === (r.parity === 'odd');
      r.move = ok ? face * 2 : 0;
      r.text = `☯️ ${face} (${r.parity === 'odd' ? '홀' : '짝'}) ${ok ? `맞힘! ×2 = ${r.move}` : '틀림… 0'}`;
      break;
    }
    case 'roulette':
      r.face = r.move = 1 + rand(20);
      r.text = `🎡 ${r.face}`;
      if (r.face === 13) { r.move = 0; r.toStart = true; r.text += ' 💀 출발점으로!'; }
      break;
    case 'magnet': {
      const ahead = others.filter((o) => dist(o) < dist(p)).sort((a, b) => dist(b) - dist(a))[0];
      if (ahead) { r.teleport = ahead; r.move = 0; r.face = '🧲'; r.text = `🧲 ${ahead.name}에게 철컥!`; }
      else { r.move = r.face = 1; r.text = '🧲 앞에 아무도 없음… 1칸'; }
      break;
    }
    case 'envy':
      r.later = () => {
        const lead = leaderOf(others);
        r.move = r.face = Math.max(1, Math.floor((dist(p) - dist(lead)) / 2));
        r.text = `😤 ${lead.name}이(가) 부러워서 ${r.move}칸`;
      };
      break;
    case 'copy':
      r.later = () => {
        const lead = leaderOf(others);
        const lr = all.find((x) => x.p === lead);
        r.move = r.face = lr && !lr.skip && lr.dice !== 'copy' ? lr.move : 3;
        r.text = `📋 ${lead.name} 따라 ${r.move}칸`;
      };
      break;
    case 'sniper': {
      const who = room.players.find((o) => o.id === r.target);
      r.move = 0;
      r.other = { who, steps: -face };
      r.text = `🔫 ${who.name}을(를) ${face}칸 뒤로!`;
      break;
    }
    case 'shield':
      p.flags.shield = true;
      r.text = `🔰 ${face} (방패)`;
      break;
    case 'helper': {
      const last = lastOf(others);
      r.move = 0;
      r.other = { who: last, steps: face };
      r.text = `🤡 ${face}… ${last.name}만 좋은 일`;
      break;
    }
    case 'slow':
      r.move = Math.floor(face / 2);
      r.text = `🐌 ${face} → 절반 ${r.move}`;
      break;
    case 'banana':
      if (Math.random() < 0.5) { r.move = -face; r.text = `🍌 미끄러져서 ${face}칸 뒤로!`; }
      else r.text = `🍌 ${face}칸 앞으로`;
      break;
    case 'sleepy':
      if (Math.random() < 0.5) { r.move = 0; r.text = '😴 쿨쿨… 안 움직임'; }
      else r.text = `😴 ${face}`;
      break;
    case 'reverse':
      r.text = `🔙 ${-face}칸 뒤로`;
      break;
  }
}

// ---------------- 2) 칸 효과 ----------------
async function phaseSpaces(room) {
  room.step = 'space';
  broadcast(room);
  const order = room.players.filter((p) => p.landed).sort((a, b) => dist(a) - dist(b));
  for (const p of order) {
    if (node(p) === BOARD.goal) continue;
    const type = BOARD.nodes[node(p)].type;
    const sp = R.SPACES[type];
    if (!sp || type === 'plain' || type === 'fork' || type === 'start') continue;
    announce(room, `${p.name} · ${sp.name}!`, { icon: sp.icon, pid: p.id, big: !!sp.tier });
    await wait(room, 700);
    await applySpace(room, p, type);
    broadcast(room);
    await wait(room, T.EFFECT_MS);
    if (winners(room).length) return;
  }
}

async function applySpace(room, p, type) {
  const others = room.players.filter((o) => o !== p);
  const say = (text, icon = '') => announce(room, text, { icon, pid: p.id });
  switch (type) {
    case 'dice':
      return giveDice(room, p, pick(R.diceOf('normal')));
    case 'trash':
      return giveDice(room, p, pick(R.diceOf('trash')), '😩 ');
    case 'trap':
      if (p.flags.shield) return say(`${p.name} 🔰 방패로 함정을 막음!`);
      return move(room, p, -3);

    case 'slot': {
      const reel = ['7️⃣', '🍒', '🔔', '💩'];
      const r = Math.random();
      const res = r < 0.12 ? ['7️⃣', '7️⃣', '7️⃣'] : r < 0.22 ? ['💩', '💩', '💩'] : [pick(reel), pick(reel), pick(reel)];
      if (res.every((x) => x === res[0]) && res[0] !== '7️⃣' && res[0] !== '💩') res[2] = res[0] === '🍒' ? '🔔' : '🍒';
      announce(room, res.join(' '), { icon: '🎰', pid: p.id, big: true });
      await wait(room, 900);
      if (res[0] === '7️⃣' && res[1] === '7️⃣' && res[2] === '7️⃣') { say('대박! 5칸 앞으로', '🎉'); return move(room, p, 5); }
      if (res[0] === '💩' && res[1] === '💩' && res[2] === '💩') { say('똥 3개… 출발점으로', '💀'); p.hist = [BOARD.start]; return; }
      const fun = res.filter((x) => x === '🔔').length, normal = res.filter((x) => x === '🍒').length;
      if (fun >= 2) return giveDice(room, p, pick(R.diceOf('fun')));
      if (normal >= 2) return giveDice(room, p, pick(R.diceOf('normal')));
      if (res.includes('💩')) return giveDice(room, p, pick(R.diceOf('trash')), '😩 ');
      return say('꽝!');
    }
    case 'point': {
      const target = await ask(room, p, 'target', '다음 턴에 쉬게 할 사람', playerOpts(room, others), { cpuPick: () => leaderOf(others).id });
      const who = room.players.find((o) => o.id === target);
      who.flags.skip = Math.max(who.flags.skip, 1);
      return say(`${who.name} 다음 턴 쉬기!`, '👉');
    }
    case 'drill':
      say('나만 빼고 모두 2칸 뒤로!', '📢');
      return Promise.all(others.map((o) => (o.flags.shield ? null : move(room, o, -2))));
    case 'gift': {
      if (!p.bag.length) return say('줄 주사위가 없음…');
      const idx = await ask(room, p, 'dice', '남한테 줄 주사위', p.bag.map((d, i) => ({ value: i, label: R.DICE[d.id].name, icon: R.DICE[d.id].icon, desc: R.DICE[d.id].desc })), {
        cpuPick: () => Math.max(0, p.bag.findIndex((d) => R.DICE[d.id].kind === 'trash')),
      });
      const [d] = p.bag.splice(idx, 1);
      const to = pick(others);
      to.bag.push(d);
      while (to.bag.length > R.BAG_MAX) to.bag.shift();
      return say(`${R.DICE[d.id].icon} ${R.DICE[d.id].name} → ${to.name}에게 선물`, '🎀');
    }
    case 'slide':
      return move(room, p, 6);
    case 'capsule': {
      const r = Math.random();
      if (r < 0.3) return say('꽝!', '🔮');
      return giveDice(room, p, pick(R.diceOf(r < 0.65 ? 'trash' : 'fun')), '🔮 ');
    }
    case 'thief': {
      const rich = others.filter((o) => o.bag.length && !o.flags.shield);
      if (!rich.length) return say('훔칠 주사위가 없음…');
      const target = await ask(room, p, 'target', '누구 걸 훔칠까?', playerOpts(room, rich), { cpuPick: () => [...rich].sort((a, b) => b.bag.length - a.bag.length)[0].id });
      const who = room.players.find((o) => o.id === target);
      const d = takeRandomDice(who);
      if (!d) return;
      p.bag.push(d);
      while (p.bag.length > R.BAG_MAX) p.bag.shift();
      return say(`${who.name}의 ${R.DICE[d.id].icon} ${R.DICE[d.id].name}을(를) 훔침!`, '🦹');
    }
    case 'taxi': {
      const target = await ask(room, p, 'target', '누구 칸으로 갈까?', playerOpts(room, others), { cpuPick: () => leaderOf(others).id });
      const who = room.players.find((o) => o.id === target);
      teleport(room, p, who);
      return say(`${who.name} 칸으로 슝!`, '🚕');
    }
    case 'rest':
      p.flags.rest = true;
      return say('다음 미니게임 보상 2배!', '☕');
    case 'mirror':
      p.flags.mirror = true;
      return say('다음 턴엔 굴린 만큼 뒤로…', '🪞');

    case 'quake': {
      const hists = shuffle(room.players.map((o) => o.hist));
      room.players.forEach((o, i) => (o.hist = [...hists[i]]));
      return announce(room, '모두의 위치가 섞였다!', { icon: '🌋', big: true });
    }
    case 'hole': {
      const near = others.filter((o) => Math.abs(dist(o) - dist(p)) <= 5 && node(o) !== BOARD.start);
      if (!near.length) return say('빨려온 사람이 없음…', '🕳️');
      near.forEach((o) => teleport(room, o, p));
      return announce(room, `${near.map((o) => o.name).join(', ')} 빨려 들어감!`, { icon: '🕳️', big: true });
    }
    case 'rocket':
      if (Math.random() < 0.3) { announce(room, '쾅! 로켓 폭발… 6칸 뒤로', { icon: '💥', big: true }); return move(room, p, -6); }
      announce(room, '발사! 12칸 앞으로', { icon: '🚀', big: true });
      return move(room, p, 12);
    case 'revolt': {
      const lead = leaderOf(room.players), last = lastOf(room.players);
      if (lead === last || dist(lead) === dist(last)) return say('바꿀 사람이 없음…');
      const h = lead.hist; lead.hist = last.hist; last.hist = h;
      return announce(room, `혁명! ${lead.name} ↔ ${last.name}`, { icon: '👑', big: true });
    }
    case 'jackpot': {
      const got = [];
      for (const o of others) {
        if (o.flags.shield) continue;
        const d = takeRandomDice(o);
        if (d) { p.bag.push(d); got.push(R.DICE[d.id].icon); }
      }
      while (p.bag.length > R.BAG_MAX) p.bag.shift();
      return announce(room, got.length ? `잭팟! ${got.join(' ')} 싹쓸이` : '잭팟… 근데 아무도 주사위가 없음', { icon: '💰', big: true });
    }
    case 'tornado': {
      const n = (1 + rand(15)) * (Math.random() < 0.5 ? -1 : 1);
      announce(room, `${Math.abs(n)}칸 ${n > 0 ? '앞으로' : '뒤로'} 날아감!`, { icon: '🌪️', big: true });
      return move(room, p, n);
    }
    case 'bigdice': {
      const n = 1 + rand(30);
      announce(room, `대왕 주사위… ${n}!`, { icon: '🎲', big: true });
      await wait(room, 600);
      return move(room, p, n);
    }
    case 'timemachine': {
      const back = room.history[Math.max(0, room.history.length - 3)];
      room.players.forEach((o, i) => (o.hist = [...back[i]]));
      return announce(room, '모두 3턴 전으로 돌아감!', { icon: '⏪', big: true });
    }
  }
}

// ---------------- 3) 미니게임 ----------------
async function phaseMinigame(room) {
  const ids = Object.keys(R.MINIGAMES).filter((id) => id !== room.lastGame);
  const id = pick(ids);
  room.lastGame = id;
  room.mg = { id, name: R.MINIGAMES[id], seed: 1 + rand(99999), startAt: Date.now() + T.MG_INTRO_MS, results: {} };
  room.mgResult = null;
  room.step = 'minigame';
  announce(room, `미니게임: ${room.mg.name}`, { icon: '🎮', big: true });
  broadcast(room);

  // 접속한 사람이 모두 결과를 보낼 때까지 (최대 6분 · 방장이 건너뛰기 가능)
  const deadline = Date.now() + T.MG_INTRO_MS + T.MG_MAX_MS;
  while (Date.now() < deadline && !room.mg.skip) {
    const waiting = humans(room).filter((p) => online(p) && !(p.id in room.mg.results));
    if (!waiting.length) break;
    await wait(room, 500);
  }

  // CPU 점수: 사람 점수 평균 근처에서 랜덤 (사람이 아무도 없으면 0~100)
  const hs = Object.values(room.mg.results);
  const avg = Math.max(10, hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : 50);
  const scores = room.players.map((p) => ({
    p,
    score: p.id in room.mg.results ? room.mg.results[p.id] : p.cpu || !online(p) ? Math.round(avg * (0.5 + Math.random() * 0.65)) : 0,
  }));
  // 점수가 같으면 랜덤으로 순서를 정함 (모두 0점이면 다 같이 1위가 되지 않게)
  scores.forEach((s) => (s.tie = Math.random()));
  scores.sort((a, b) => b.score - a.score || a.tie - b.tie);
  scores.forEach((s, i) => (s.rank = i + 1));

  room.step = 'mgResult';
  room.mgResult = { name: room.mg.name, rows: scores.map((s) => ({ id: s.p.id, name: s.p.name, score: s.score, rank: s.rank, reward: [] })) };
  broadcast(room);
  await wait(room, 1500);

  // 보상: 1위 재밌는 주사위 3개 중 고르기 · 2위 재밌는 랜덤 · 3위 보통 랜덤 (☕ 쉼터면 2번)
  await Promise.all(scores.map(async (s) => {
    const kind = R.REWARDS[s.rank - 1];
    const row = room.mgResult.rows.find((r) => r.id === s.p.id);
    const times = s.p.flags.rest ? 2 : 1;
    s.p.flags.rest = false;
    if (!kind) return;
    for (let k = 0; k < times; k++) {
      let id;
      if (kind === 'pick-fun') {
        const three = shuffle(R.diceOf('fun')).slice(0, 3);
        id = await ask(room, s.p, 'reward', '1위 보상! 하나 골라요', three.map((d) => ({ value: d, label: R.DICE[d].name, icon: R.DICE[d].icon, desc: R.DICE[d].desc })), { cpuPick: () => pick(three) });
      } else {
        id = pick(R.diceOf(kind));
      }
      row.reward.push(id);
      giveDice(room, s.p, id, `${s.rank}위 보상 `);
      broadcast(room);
    }
  }));
  await wait(room, T.MG_RESULT_MS);
  room.mg = null;
}

// ---------------- 방 ----------------
function makeCode() {
  for (;;) {
    const code = String(1000 + rand(9000));
    if (!rooms.has(code)) return code;
  }
}

function findByToken(token) {
  for (const room of rooms.values()) {
    const p = room.players.find((x) => !x.cpu && x.token === token);
    if (p) return { room, p };
  }
  return null;
}

function pickHost(room) {
  const h = room.players.find((p) => !p.cpu && online(p));
  room.host = h ? h.id : null;
}

// 나감 · 끊김: 대기실에선 잠깐(새로고침) 기다렸다 빼고, 게임 중엔 자리를 남겨 CPU 처럼 자동 진행
function leaveRoom(room, p, { now = false } = {}) {
  p.ws = null;
  const remove = () => {
    room.players = room.players.filter((x) => x !== p);
    pickHost(room);
    checkEmpty(room);
    if (!room.dead) broadcast(room);
  };
  if (room.phase === 'lobby') {
    if (now) remove();
    else setTimeout(() => { if (!p.ws && room.phase === 'lobby' && room.players.includes(p)) remove(); }, 6000);
  } else {
    autoAnswer(room, p);
  }
  pickHost(room);
  checkEmpty(room);
  if (!room.dead) broadcast(room);
}

// 사람이 아무도 없으면 15초 뒤 방 닫기
function checkEmpty(room) {
  if (room.dead || room.players.some((x) => !x.cpu && online(x))) return;
  clearTimeout(room.closeTimer);
  room.closeTimer = setTimeout(() => {
    if (room.players.some((x) => !x.cpu && online(x))) return;
    room.dead = true;
    for (const pr of room.prompts.values()) { clearTimeout(pr.timer); clearTimeout(pr.cpuTimer); }
    rooms.delete(room.code);
    console.log(`[party ${room.code}] 방 닫힘`);
  }, 15000);
}

export function onPartyConnection(ws) {
  let me = null;   // { token, name }
  let room = null;
  let player = null;

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.t === 'hello') {
      me = { token: String(msg.token || '').slice(0, 64), name: cleanName(msg.name) };
      const found = me.token && findByToken(me.token);
      if (found) {
        // 새로고침 · 잠깐 끊김 → 그 자리로 다시
        ({ room, p: player } = found);
        if (player.ws && player.ws !== ws) player.ws.close();
        player.ws = ws;
        clearTimeout(room.closeTimer); // 이름은 그대로 (같은 컴퓨터의 다른 탭이 이름 저장소를 바꿨을 수 있음)
        pickHost(room);
        send(ws, { t: 'welcome', id: player.id });
        broadcast(room);
      } else {
        send(ws, { t: 'welcome', id: null });
      }
      return;
    }
    if (!me) return;

    if (msg.t === 'create' || msg.t === 'join') {
      if (room) return;
      const name = cleanName(msg.name) || me.name;
      if (!name) return send(ws, { t: 'error', text: '이름을 먼저 정해 주세요' });
      let target;
      if (msg.t === 'create') {
        target = { code: makeCode(), phase: 'lobby', step: null, turn: 0, maxTurns: R.DEFAULT_TURNS, players: [], prompts: new Map(), rolls: {}, log: [], host: null };
        rooms.set(target.code, target);
        console.log(`[party ${target.code}] 방 만듦`);
      } else {
        target = rooms.get(String(msg.code || '').trim());
        if (!target) return send(ws, { t: 'error', text: '그런 방이 없어요' });
        if (target.phase !== 'lobby') return send(ws, { t: 'error', text: '이미 게임이 시작된 방이에요' });
        if (target.players.length >= R.MAX_PLAYERS) return send(ws, { t: 'error', text: '방이 꽉 찼어요 (5명)' });
      }
      const seats = new Set(target.players.map((p) => p.seat));
      let seat = 0;
      while (seats.has(seat)) seat++;
      player = { id: nextId++, token: me.token, name, cpu: false, seat, ws, hist: [BOARD.start], bag: [], flags: {} };
      target.players.push(player);
      room = target;
      pickHost(room);
      send(ws, { t: 'welcome', id: player.id });
      broadcast(room);
      return;
    }
    if (!room || !player) return;
    const isHost = room.host === player.id;

    switch (msg.t) {
      case 'leave': {
        const r = room;
        room = null;
        player.token = '';
        leaveRoom(r, player, { now: true });
        player = null;
        send(ws, { t: 'left' });
        break;
      }
      case 'name':
        if (cleanName(msg.name)) { player.name = cleanName(msg.name); broadcast(room); }
        break;
      case 'turns':
        if (isHost && room.phase === 'lobby' && R.TURN_CHOICES.includes(+msg.n)) { room.maxTurns = +msg.n; broadcast(room); }
        break;
      case 'start':
        if (isHost && room.phase === 'lobby') runGame(room);
        break;
      case 'lobby': // 끝난 뒤 다시 대기실로
        if (isHost && room.phase === 'end') {
          room.players = room.players.filter((p) => !p.cpu && online(p));
          room.phase = 'lobby';
          room.step = null;
          room.ranking = null;
          room.mg = room.mgResult = null;
          room.rolls = {};
          room.players.forEach((p) => { p.hist = [BOARD.start]; p.bag = []; p.flags = {}; });
          broadcast(room);
        }
        break;
      case 'answer':
        answer(room, player, msg);
        break;
      case 'result': // 미니게임 점수
        if (room.mg && room.step === 'minigame' && !(player.id in room.mg.results)) {
          room.mg.results[player.id] = Math.max(0, Math.round(+msg.score) || 0);
          announce(room, `${player.name} 미니게임 끝! (${room.mg.results[player.id]}점)`, { icon: '✅', pid: player.id });
          broadcast(room);
        }
        break;
      case 'skipGame': // 방장: 안 끝나는 사람 기다리지 않기
        if (isHost && room.mg) room.mg.skip = true;
        break;
    }
  });

  ws.on('close', () => {
    if (room && player && player.ws === ws) leaveRoom(room, player);
  });
}

export function partyStatus() {
  return [...rooms.values()].map((r) => ({ code: r.code, phase: r.phase, turn: r.turn, players: r.players.filter((p) => !p.cpu).map((p) => p.name) }));
}
