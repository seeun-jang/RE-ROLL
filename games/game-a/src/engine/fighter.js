// =============================================================
//  선수 한 명 (student / 황종철 교수 공통)
//
//  state
//    idle, walk, guard   : 자유롭게 조작
//    action              : 기술 사용 중 (action.type = 기술 이름)
//    hit, block, broken  : 맞음 / 막음 / 방어가 깨짐
//    stunned             : 포효에 놀라 굳음
//    down, getup         : 큰 기술에 맞고 넘어짐 / 일어나는 중
//    ko, win, lose       : 라운드·경기 종료 연출
//
//  기술 고르기 (버튼 + 거리 + 방향키)
//    student   공격: 잽 → 크로스 → 발톱 베기 (연타)
//           기술: 가까우면 니킥 / 앞+기술 도약 내려찍기 / 뒤+기술 포효 / 그냥 타이거 대시
//           회피: 구르기 (모든 공격 무적, 상대를 지나갈 수 있음)
//    교수   공격: 가까우면 장풍 밀치기 / 멀면 매직 미사일
//           기술: 가까우면 아케인 폭발 / 앞+기술 낙뢰 / 뒤+기술 블링크 / 그냥 파이어볼
//           회피: 백스텝
// =============================================================

import { FIGHTER, MAX_MISSILES, PROFESSOR_MOVES, STAGE, TIGER_MOVES } from '../config.js';

const FREE = new Set(['idle', 'walk', 'guard']);
const STUNNED = new Set(['hit', 'block', 'broken', 'stunned']);

export function emptyStats() {
  return { thrown: 0, landed: 0, damage: 0, blocked: 0, dodged: 0, spells: 0, supers: 0, knockdowns: 0 };
}

export function movesOf(f) {
  return f.player.kind === 'professor' ? PROFESSOR_MOVES : TIGER_MOVES;
}

export function createFighter(player, x, facing) {
  return {
    id: player.id,
    player,
    x,
    y: 0, // 공중 높이 (도약)
    vx: 0,
    facing,
    hp: FIGHTER.maxHp,
    res: player.resource.max, // 마나 / 스태미나
    super: 0,
    state: 'idle',
    stateTime: 0,
    action: null, // { type, time, fired, hasHit, data }
    stun: 0,
    hitZone: 'high',
    buffer: null,
    combo: { step: 0, timer: 0 },
    invuln: 0,
    flash: 0,
    tired: 0,
    stats: emptyStats(),
  };
}

export function setState(f, state) {
  f.state = state;
  f.stateTime = 0;
}

export function dealDamage(f, amount) {
  const actual = Math.min(f.hp, amount);
  f.hp -= actual;
  return actual;
}

export function gainSuper(f, amount) {
  f.super = Math.min(FIGHTER.superMax, f.super + amount);
}

export const isFree = (f) => FREE.has(f.state);
export const isGuarding = (f) => f.state === 'guard' || f.state === 'block';
export const isDown = (f) => f.state === 'down' || f.state === 'getup' || f.state === 'ko';

export function bodyRadius(f) {
  return FIGHTER.bodyRadius * (0.6 + 0.4 * f.player.height);
}

export function moveSpec(f) {
  return f.action ? movesOf(f)[f.action.type] : null;
}

/** 'startup' | 'active' | 'recovery' */
export function actionPhase(f) {
  const m = moveSpec(f);
  if (!m) return null;
  const t = f.action.time;
  if (t < m.startup) return 'startup';
  if (t < m.startup + m.active) return 'active';
  return 'recovery';
}

const totalTime = (m) => m.startup + m.active + m.recovery;

/** 지금 이 선수가 어떤 공격에 무적인지: null | 'projectile' | 'all' */
export function immunity(f) {
  if (f.invuln > 0 || isDown(f)) return 'all';
  const m = moveSpec(f);
  if (m?.immune && actionPhase(f) === 'active') return m.immune;
  if (m?.kind === 'super' && f.action.data?.connected) return 'all';
  return null;
}

export function clampToStage(f) {
  f.x = Math.max(STAGE.left, Math.min(STAGE.right, f.x));
}

// ---------------- 기술 고르기 ----------------

function chooseMove(f, button, input, opponent, world) {
  const prof = f.player.kind === 'professor';
  const dist = Math.abs(opponent.x - f.x);
  const close = dist < FIGHTER.closeRange * (0.6 + 0.4 * f.player.height);
  const forward = input.move * f.facing > 0.3;
  const back = input.move * f.facing < -0.3;

  if (button === 'super') return prof ? 'meteor' : 'whiteTiger';
  if (button === 'dodge') return prof ? 'backstep' : 'roll';
  if (button === 'attack') {
    if (prof) {
      if (close) return 'palm';
      return world.countMissiles(f.id) < MAX_MISSILES ? 'missile' : null;
    }
    const step = f.combo.timer > 0 ? f.combo.step : 0;
    return ['jab', 'cross', 'claw'][step];
  }
  // skill
  if (prof) {
    if (close) return 'blast';
    if (forward) return 'lightning';
    if (back) return 'blink';
    return 'fireball';
  }
  if (close) return 'knee';
  if (forward) return 'pounce';
  if (back) return 'roar';
  return 'dash';
}

function startAction(f, type, input, world) {
  const m = movesOf(f)[type];
  if (m.kind === 'super') {
    if (f.super < FIGHTER.superMax) return false;
    f.super = 0;
    f.stats.supers += 1;
  } else if (f.res < (m.cost ?? 0)) {
    f.tired = 0.8;
    world.events.push({ type: 'tired', fighter: f.id });
    return false;
  } else {
    f.res -= m.cost ?? 0;
  }
  // 구르기 방향: 방향키 쪽, 없으면 앞으로 (백스텝은 항상 뒤로)
  let dir = f.facing;
  if (m.back) dir = -f.facing;
  else if (m.kind === 'roll' && Math.abs(input.move) > 0.3) dir = Math.sign(input.move);
  f.action = { type, time: 0, fired: false, hasHit: false, dir, data: {} };
  setState(f, 'action');
  f.stats.thrown += 1;
  if (m.kind === 'cast' || m.kind === 'lightning' || m.kind === 'blast' || type === 'meteor') f.stats.spells += 1;
  if (type === 'jab' || type === 'cross') {
    const next = type === 'jab' ? 1 : 2;
    f.combo = { step: next, timer: totalTime(m) + FIGHTER.comboWindow };
  } else if (type !== 'claw') {
    f.combo = { step: 0, timer: 0 };
  } else {
    f.combo = { step: 0, timer: 0 };
  }
  world.events.push({ type: 'start', move: type, fighter: f.id, x: f.x });
  return true;
}

// ---------------- 기술 진행 ----------------

function updateAction(f, dt, opponent, world) {
  const m = moveSpec(f);
  const a = f.action;
  a.time += dt;
  const phase = actionPhase(f);
  const activeT = a.time - m.startup;

  switch (m.kind) {
    case 'melee':
      f.vx = phase === 'startup' ? f.facing * (m.lunge ?? 0) : f.vx * Math.exp(-14 * dt);
      break;
    case 'dash':
      if (phase === 'active' && !a.hasHit) f.vx = f.facing * m.speed;
      else f.vx *= Math.exp(-12 * dt);
      break;
    case 'roll':
      f.vx = phase === 'active' ? a.dir * m.speed : f.vx * Math.exp(-14 * dt);
      break;
    case 'pounce':
      if (phase === 'active') {
        const t = activeT / m.active;
        f.vx = f.facing * (m.travel / m.active);
        f.y = Math.sin(Math.PI * t) * m.jump;
      } else {
        f.y = 0;
        f.vx = phase === 'startup' ? 0 : f.vx * Math.exp(-16 * dt);
      }
      // 착지하는 순간 주변을 내려찍음
      if (phase === 'recovery' && !a.fired) {
        a.fired = true;
        world.events.push({ type: 'land', fighter: f.id, x: f.x });
        world.areaHit(f, f.x, m.radius, m);
      }
      break;
    case 'super':
      if (f.player.kind === 'tiger') {
        // 백호 난무: 돌진 → 닿으면 연타
        if (a.data.connected) {
          f.vx = 0;
        } else if (phase === 'active') {
          f.vx = f.facing * m.speed;
        } else {
          f.vx *= Math.exp(-10 * dt);
        }
      } else {
        f.vx = 0;
        if (phase !== 'startup' && !a.fired) {
          a.fired = true;
          world.castMeteor(f, opponent);
        }
      }
      break;
    default: {
      f.vx *= Math.exp(-14 * dt);
      if (phase !== 'startup' && !a.fired) {
        a.fired = true;
        if (m.kind === 'cast') world.spawnProjectile(f, m.projectile);
        else if (m.kind === 'lightning') world.spawnLightning(f, opponent, m);
        else if (m.kind === 'blink') blink(f, opponent, m, world);
        else if (m.kind === 'roar') world.roar(f, m);
        else if (m.kind === 'blast') world.areaHit(f, f.x, m.radius, m);
      }
    }
  }

  const done = m.kind === 'super' && a.data.connected ? a.data.finished : a.time >= totalTime(m);
  if (done) {
    f.action = null;
    f.y = 0;
    setState(f, 'idle');
  }
}

function blink(f, opponent, m, world) {
  const from = f.x;
  const away = Math.sign(f.x - opponent.x) || -f.facing;
  let to = f.x + away * m.distance;
  // 벽에 막히면 반대편으로 넘어감 (구석에 몰렸을 때 탈출)
  if (to < STAGE.left || to > STAGE.right) to = opponent.x - away * Math.min(m.distance, 260);
  f.x = Math.max(STAGE.left, Math.min(STAGE.right, to));
  f.invuln = m.invuln;
  f.facing = opponent.x >= f.x ? 1 : -1;
  world.events.push({ type: 'blink', fighter: f.id, from, to: f.x });
}

// ---------------- 한 프레임 ----------------

export function tickTimers(f, dt) {
  f.stateTime += dt;
  f.flash = Math.max(0, f.flash - dt);
  f.invuln = Math.max(0, f.invuln - dt);
  f.tired = Math.max(0, f.tired - dt);
  f.combo.timer = Math.max(0, f.combo.timer - dt);
}

function control(f, input, opponent, world) {
  if (f.buffer) {
    const type = chooseMove(f, f.buffer.button, input, opponent, world);
    f.buffer = null;
    if (type && startAction(f, type, input, world)) {
      if (f.state === 'action' && moveSpec(f).kind !== 'roll') f.vx = 0;
      return;
    }
  }
  if (input.guard) {
    if (f.state !== 'guard') setState(f, 'guard');
  } else if (f.state === 'guard') {
    setState(f, 'idle');
  }
  const speed = f.player.walkSpeed * (f.state === 'guard' ? 0.4 : 1) * (input.move * f.facing < 0 ? 0.85 : 1);
  f.vx = input.move * speed;
  if (f.state !== 'guard') {
    const moving = Math.abs(input.move) > 0.1;
    if (moving && f.state === 'idle') setState(f, 'walk');
    else if (!moving && f.state === 'walk') setState(f, 'idle');
  }
}

/**
 * @param world  match.js가 넘겨주는 도우미 { events, spawnProjectile, spawnLightning, castMeteor, roar, areaHit, countMissiles }
 */
export function updateFighter(f, input, dt, opponent, world) {
  tickTimers(f, dt);

  if (f.buffer) {
    f.buffer.time -= dt;
    if (f.buffer.time <= 0) f.buffer = null;
  }
  const pressed = input.super ? 'super' : input.dodge ? 'dodge' : input.skill ? 'skill' : input.attack ? 'attack' : null;
  if (pressed) f.buffer = { button: pressed, time: FIGHTER.inputBuffer };

  const R = f.player.resource;
  if (f.state !== 'action') {
    const k = f.state === 'guard' ? FIGHTER.guardRegenFactor : 1;
    f.res = Math.min(R.max, f.res + R.regen * k * dt);
  }

  if (STUNNED.has(f.state)) {
    f.stun -= dt;
    if (f.stun <= 0) setState(f, 'idle');
  } else if (f.state === 'down') {
    f.stun -= dt;
    if (f.stun <= 0) {
      setState(f, 'getup');
      world.events.push({ type: 'getup', fighter: f.id });
    }
  } else if (f.state === 'getup') {
    if (f.stateTime >= FIGHTER.getupSeconds) {
      setState(f, 'idle');
      f.invuln = FIGHTER.getupInvuln;
    }
  } else if (f.state === 'action') {
    updateAction(f, dt, opponent, world);
  }

  if (isFree(f)) control(f, input, opponent, world);
  else if (f.state !== 'action') f.vx *= Math.exp(-9 * dt);

  f.x += f.vx * dt;
  clampToStage(f);
}

/** 경기가 멈춘 동안 (인트로, 라운드 종료) */
export function updatePassive(f, dt) {
  tickTimers(f, dt);
  f.vx *= Math.exp(-9 * dt);
  f.x += f.vx * dt;
  if (f.state === 'down') {
    f.stun -= dt;
    if (f.stun <= 0) setState(f, 'getup');
  } else if (f.state === 'getup' && f.stateTime >= FIGHTER.getupSeconds) {
    setState(f, 'idle');
  } else if (STUNNED.has(f.state)) {
    f.stun -= dt;
    if (f.stun <= 0) setState(f, 'idle');
  }
  clampToStage(f);
}
