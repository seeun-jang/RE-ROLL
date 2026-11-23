// =============================================================
//  경기 진행 — 3판 2선승
//
//  intro(ROUND N → FIGHT!) → fight ─┬─ 체력 0 → roundEnd (K.O.)
//                                    └─ 시간 종료 → roundEnd (TIME: 체력 비율이 높은 쪽 승)
//  roundEnd → 누가 2승? → matchEnd(최종 승자) → done
//                       └ 아니면 다음 라운드 intro
// =============================================================

import { CROWD, FIGHTER, MATCH, PLAYERS, PROFESSOR_MOVES, STAGE } from '../config.js';
import { EMPTY_INPUT } from '../input/actions.js';
import { createFighter, isFree, setState, updateFighter, updatePassive } from './fighter.js';
import { areaHit, resolveMelee, roar, separate, updateProjectiles, updateStrikes } from './combat.js';

export const PHASE = {
  INTRO: 'intro',
  FIGHT: 'fight',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export function createMatch() {
  const fighters = {};
  for (const p of PLAYERS) fighters[p.id] = createFighter(p, STAGE.startX[p.id], p.side === 'left' ? 1 : -1);
  const match = {
    playerIds: PLAYERS.map((p) => p.id),
    fighters,
    round: 0,
    wins: Object.fromEntries(PLAYERS.map((p) => [p.id, 0])),
    rounds: [], // [{ winner, method: 'ko' | 'time' | 'draw', time }]
    phase: PHASE.INTRO,
    phaseTime: 0,
    timeLeft: MATCH.roundSeconds,
    elapsed: 0,
    projectiles: [],
    strikes: [],
    result: null,
    ref: { x: (STAGE.startX.p1 + STAGE.startX.p2) / 2, pose: 'idle', poseTime: 0 },
    focus: null,
    banner: null,
    events: [],
    hitstop: 0,
    timeScale: 1,
    slowmo: 0,
    shake: 0,
    hype: 0.5,
    dt: 0,
    done: false,
  };
  match.world = makeWorld(match);
  beginRound(match);
  return match;
}

function banner(match, text, opts = {}) {
  match.banner = { id: (match.banner?.id ?? 0) + 1, text, sub: '', kind: 'action', life: 1.2, age: 0, color: null, ...opts };
}

function setRef(match, pose) {
  match.ref.pose = pose;
  match.ref.poseTime = 0;
}

/** fighter.js가 기술을 쓸 때 부르는 도우미 */
function makeWorld(match) {
  const other = (f) => match.fighters[match.playerIds.find((id) => id !== f.id)];
  return {
    events: match.events,
    countMissiles: (id) => match.projectiles.filter((p) => p.owner === id && p.type === 'missile').length,
    spawnProjectile(f, spec) {
      const h = spec.height * f.player.height;
      match.projectiles.push({
        ...spec,
        owner: f.id,
        target: other(f).id,
        x: f.x + f.facing * 70 * f.player.height,
        height: h,
        vx: f.facing * spec.speed,
        age: 0,
        dead: false,
      });
      match.events.push({ type: 'cast', kind: spec.type, fighter: f.id, x: f.x + f.facing * 70, y: STAGE.floorY - h });
    },
    spawnLightning(f, target, m) {
      match.strikes.push({ kind: 'lightning', owner: f.id, target: target.id, x: target.x, timer: m.delay, total: m.delay, radius: m.width / 2, spec: m, done: false });
      match.events.push({ type: 'cast', kind: 'lightning', fighter: f.id, x: target.x });
    },
    castMeteor(f, target) {
      const meteor = PROFESSOR_MOVES.meteor;
      match.strikes.push({ kind: 'meteor', owner: f.id, target: target.id, x: target.x, timer: meteor.delay, total: meteor.delay, radius: meteor.radius, spec: meteor, done: false });
      for (const side of [-1, 1]) {
        const x = Math.max(STAGE.left, Math.min(STAGE.right, target.x + side * (200 + Math.random() * 60)));
        const shard = { damage: meteor.shardDamage, hitstun: 0.4, knockback: 40, guardCost: 10 };
        match.strikes.push({ kind: 'shard', owner: f.id, target: target.id, x, timer: meteor.delay * 0.75, total: meteor.delay * 0.75, radius: meteor.shardRadius, spec: shard, done: false });
      }
      match.events.push({ type: 'cast', kind: 'meteor', fighter: f.id, x: target.x });
      banner(match, 'METEOR!', { sub: '피하거나 막아라!', kind: 'super', life: 1.2, color: f.id });
    },
    roar(f, m) {
      roar(f, other(f), m, match);
    },
    areaHit(f, cx, radius, m) {
      match.events.push({ type: 'area', fighter: f.id, move: f.action?.type, x: cx, radius });
      areaHit(f, other(f), cx, radius, m, match);
    },
  };
}

function beginRound(match) {
  match.round += 1;
  match.phase = PHASE.INTRO;
  match.phaseTime = 0;
  match.timeLeft = MATCH.roundSeconds;
  match.fightCalled = false;
  match.focus = null;
  match.projectiles = [];
  match.strikes = [];
  for (const id of match.playerIds) {
    const f = match.fighters[id];
    f.x = STAGE.startX[id];
    f.y = 0;
    f.vx = 0;
    f.facing = f.player.side === 'left' ? 1 : -1;
    f.hp = FIGHTER.maxHp;
    f.res = f.player.resource.max;
    f.action = null;
    f.buffer = null;
    f.invuln = 0;
    setState(f, 'idle');
  }
  setRef(match, 'idle');
  const final = match.round === MATCH.maxRounds || Object.values(match.wins).every((w) => w === MATCH.roundsToWin - 1);
  banner(match, `ROUND ${match.round}`, { sub: final ? 'FINAL ROUND' : '', kind: 'round', life: MATCH.introSeconds * 0.6 });
  match.events.push({ type: 'round', round: match.round });
}

function endRound(match, method) {
  const [a, b] = match.playerIds.map((id) => match.fighters[id]);
  let winner = null;
  if (method === 'ko') {
    if (a.hp <= 0 && b.hp > 0) winner = b.id;
    else if (b.hp <= 0 && a.hp > 0) winner = a.id;
  } else if (a.hp !== b.hp) {
    winner = a.hp > b.hp ? a.id : b.id;
  }
  if (winner) match.wins[winner] += 1;
  match.rounds.push({ winner, method: winner ? method : 'draw', time: Math.round((MATCH.roundSeconds - match.timeLeft) * 10) / 10 });

  match.phase = PHASE.ROUND_END;
  match.phaseTime = 0;
  match.projectiles = [];
  for (const f of [a, b]) {
    f.action = null;
    f.y = 0;
    if (f.state === 'action') setState(f, 'idle'); // 기술 쓰던 중이면 서 있는 자세로
  }
  if (method === 'ko') {
    const loser = winner === a.id ? b : winner === b.id ? a : null;
    for (const f of [a, b]) if (f.hp <= 0) setState(f, 'ko');
    match.focus = loser?.id ?? null;
    match.timeScale = 0.25;
    match.slowmo = 1.2;
    match.shake = 16;
    match.hype = 1;
    setRef(match, 'stop');
    match.events.push({ type: 'ko', x: loser?.x ?? 800, winner });
    banner(match, 'K.O.', { kind: 'finish', life: MATCH.roundEndSeconds, color: winner });
  } else {
    for (const f of [a, b]) if (isFree(f) || f.state === 'action') setState(f, 'idle');
    setRef(match, 'separate');
    match.events.push({ type: 'bell', times: 3 });
    banner(match, winner ? 'TIME' : 'DRAW', { sub: winner ? `${match.fighters[winner].player.name} 라운드 승리` : '무승부 라운드', kind: 'info', life: MATCH.roundEndSeconds, color: winner });
  }
}

function afterRound(match) {
  const ids = match.playerIds;
  const champion = ids.find((id) => match.wins[id] >= MATCH.roundsToWin);
  if (champion || match.round >= MATCH.maxRounds) {
    const [a, b] = ids;
    const winner = champion ?? (match.wins[a] > match.wins[b] ? a : match.wins[b] > match.wins[a] ? b : null);
    match.result = { winnerId: winner, wins: { ...match.wins }, rounds: match.rounds };
    match.phase = PHASE.MATCH_END;
    match.phaseTime = 0;
    for (const id of ids) {
      const f = match.fighters[id];
      f.hp = Math.max(f.hp, 1);
      setState(f, winner ? (id === winner ? 'win' : 'lose') : 'lose');
    }
    match.focus = winner;
    match.hype = 1;
    match.events.push({ type: 'victory', winner });
    banner(match, winner ? 'WINNER' : 'DRAW', { sub: winner ? match.fighters[winner].player.name : '무승부', kind: 'finish', life: MATCH.matchEndSeconds, color: winner });
  } else {
    beginRound(match);
  }
}

// ---------------- 한 프레임 ----------------

export function updateMatch(match, inputs, realDt) {
  if (match.done) return;
  if (match.slowmo > 0) {
    match.slowmo -= realDt;
    if (match.slowmo <= 0) match.timeScale = 1;
  }
  const dt = realDt * match.timeScale;
  match.dt = dt;
  match.world.events = match.events;
  match.phaseTime += realDt;
  match.shake = Math.max(0, match.shake - realDt * 45);
  if (match.banner) {
    match.banner.age += realDt;
    if (match.banner.age >= match.banner.life) match.banner = null;
  }

  const [idA, idB] = match.playerIds;
  const a = match.fighters[idA];
  const b = match.fighters[idB];

  switch (match.phase) {
    case PHASE.INTRO:
      updatePassive(a, dt);
      updatePassive(b, dt);
      if (!match.fightCalled && match.phaseTime >= MATCH.introSeconds * 0.62) {
        match.fightCalled = true;
        setRef(match, 'fight');
        match.events.push({ type: 'bell', times: 1 });
        banner(match, 'FIGHT!', { kind: 'fight', life: 0.9 });
      }
      if (match.phaseTime >= MATCH.introSeconds) {
        match.phase = PHASE.FIGHT;
        match.phaseTime = 0;
      }
      break;

    case PHASE.FIGHT: {
      if (match.hitstop > 0) {
        match.hitstop -= realDt;
        break;
      }
      match.elapsed += dt;
      match.timeLeft = Math.max(0, match.timeLeft - dt);
      if (isFree(a)) a.facing = b.x >= a.x ? 1 : -1;
      if (isFree(b)) b.facing = a.x >= b.x ? 1 : -1;
      updateFighter(a, inputs[idA] ?? EMPTY_INPUT, dt, b, match.world);
      updateFighter(b, inputs[idB] ?? EMPTY_INPUT, dt, a, match.world);
      resolveMelee(a, b, match);
      resolveMelee(b, a, match);
      updateProjectiles(match, dt);
      updateStrikes(match, dt);
      separate(a, b);
      if (a.hp <= 0 || b.hp <= 0) endRound(match, 'ko');
      else if (match.timeLeft <= 0) endRound(match, 'time');
      break;
    }

    case PHASE.ROUND_END:
      updatePassive(a, dt);
      updatePassive(b, dt);
      updateStrikes(match, dt);
      if (match.phaseTime >= MATCH.roundEndSeconds) afterRound(match);
      break;

    case PHASE.MATCH_END:
      updatePassive(a, dt);
      updatePassive(b, dt);
      if (match.phaseTime >= MATCH.matchEndSeconds) match.done = true;
      break;

    default:
      break;
  }

  const floor = match.phase === PHASE.FIGHT ? CROWD.baseHype : 0.5;
  match.hype = Math.min(1, match.hype);
  if (match.hype > floor) match.hype = Math.max(floor, match.hype - CROWD.hypeDecay * realDt);
  else match.hype = Math.min(floor, match.hype + 0.3 * realDt);

  const ref = match.ref;
  ref.poseTime += realDt;
  ref.x += ((a.x + b.x) / 2 - ref.x) * Math.min(1, realDt * 2.2);
  if (ref.pose === 'fight' && ref.poseTime > 1.1) ref.pose = 'idle';
  if (ref.pose === 'separate' && ref.poseTime > 1.6) ref.pose = 'idle';
}

export function takeEvents(match) {
  const list = match.events;
  match.events = [];
  match.world.events = match.events;
  return list;
}
