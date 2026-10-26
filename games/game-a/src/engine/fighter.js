// =============================================================
//  선수(파이터) 상태와 움직임
//
//  상태(state) 종류
//    idle   : 가만히 서 있음        walk  : 이동 중
//    guard  : 가드 중               attack: 펀치/킥/필살기 중
//    hit    : 맞고 휘청             block : 막고 잠깐 경직
//    stun   : 가드가 깨져 어지러움   ko    : 쓰러짐
//    win    : 승리 포즈             lose  : 판정패
// =============================================================

import { ARENA, ATTACKS, FIGHTER, MATCH } from '../config.js';

const BUFFER_SECONDS = 0.18; // 공격 중에 누른 다음 공격을 잠깐 기억했다가 이어서 실행

export function createFighter(id, x, facing) {
  return {
    id,
    x,
    facing,          // 1 = 오른쪽을 봄, -1 = 왼쪽을 봄
    vx: 0,           // 밀려나는 속도
    hp: MATCH.maxHp,
    stamina: FIGHTER.staminaMax,
    power: 0,        // 필살기 게이지

    state: 'idle',
    stateTime: 0,    // 현재 상태가 된 뒤 흐른 시간
    stunTime: 0,     // 남은 경직 시간
    attack: null,    // { type, t, hasHit }
    buffered: null,  // { type, time }
    walkPhase: 0,
    flash: 0,        // 맞았을 때 하얗게 번쩍임
    tired: 0,        // 스태미나 부족 표시

    stats: { damageDealt: 0, hitsLanded: 0, blocked: 0 },
  };
}

export function setState(f, state) {
  if (f.state !== state) {
    f.state = state;
    f.stateTime = 0;
  }
}

export function attackDuration(type) {
  const a = ATTACKS[type];
  return a.startup + a.active + a.recovery;
}

/** 공격이 지금 상대를 맞힐 수 있는 순간인지 */
export function isAttackActive(f) {
  if (f.state !== 'attack' || !f.attack) return false;
  const a = ATTACKS[f.attack.type];
  return f.attack.t >= a.startup && f.attack.t < a.startup + a.active;
}

function canStartAttack(f, type) {
  if (type === 'special') return f.power >= FIGHTER.powerMax;
  return f.stamina >= ATTACKS[type].stamina;
}

function startAttack(f, type) {
  if (type === 'special') f.power = 0;
  f.stamina -= ATTACKS[type].stamina;
  f.attack = { type, t: 0, hasHit: false };
  f.buffered = null;
  setState(f, 'attack');
}

// 이번 프레임에 누른 공격 (필살기 > 킥 > 펀치 순서로 우선)
function pressedAttack(input) {
  if (input.special) return 'special';
  if (input.kick) return 'kick';
  if (input.punch) return 'punch';
  return null;
}

/**
 * 한 프레임 진행
 * @param {object} f        선수
 * @param {object} input    { move: -1~1, guard, punch, kick, special }
 * @param {number} dt       초
 * @param {boolean} canAct  false면 입력을 무시 (카운트다운, 경기 종료 후)
 */
export function updateFighter(f, input, dt, canAct) {
  f.stateTime += dt;
  f.flash = Math.max(0, f.flash - dt);
  f.tired = Math.max(0, f.tired - dt);

  // 밀려나기 (점점 느려짐)
  f.x += f.vx * dt;
  f.vx *= Math.exp(-12 * dt);
  if (Math.abs(f.vx) < 1) f.vx = 0;

  // 스태미나 회복
  if (f.state !== 'attack') {
    const regen = f.state === 'guard' ? FIGHTER.staminaRegenGuard : FIGHTER.staminaRegen;
    f.stamina = Math.min(FIGHTER.staminaMax, f.stamina + regen * dt);
  }

  // 공격 선입력 기억
  const pressed = canAct ? pressedAttack(input) : null;
  if (pressed) f.buffered = { type: pressed, time: BUFFER_SECONDS };
  else if (f.buffered) {
    f.buffered.time -= dt;
    if (f.buffered.time <= 0) f.buffered = null;
  }

  switch (f.state) {
    case 'hit':
    case 'block':
    case 'stun':
      f.stunTime -= dt;
      if (f.stunTime <= 0) setState(f, 'idle');
      return;
    case 'attack':
      f.attack.t += dt;
      if (f.attack.t >= attackDuration(f.attack.type)) {
        f.attack = null;
        setState(f, 'idle');
      }
      return;
    case 'ko':
    case 'win':
    case 'lose':
      return;
    default:
      break;
  }

  // ---- 여기부터는 자유롭게 움직일 수 있는 상태 (idle / walk / guard) ----
  if (!canAct) {
    setState(f, 'idle');
    return;
  }

  if (f.buffered && !input.guard) {
    const type = f.buffered.type;
    if (canStartAttack(f, type)) {
      startAttack(f, type);
      return;
    }
    if (type !== 'special') f.tired = 0.6; // 스태미나 부족
    f.buffered = null;
  }

  const move = Math.max(-1, Math.min(1, input.move || 0));
  if (input.guard) {
    setState(f, 'guard');
    f.x += move * FIGHTER.guardWalkSpeed * dt;
  } else if (move !== 0) {
    setState(f, 'walk');
    f.x += move * FIGHTER.walkSpeed * dt;
    // 앞으로 걸을 때와 뒤로 걸을 때 다리 방향이 맞도록
    f.walkPhase += dt * 11 * Math.sign(move) * f.facing;
  } else {
    setState(f, 'idle');
  }
}

/** 링 밖으로 나가지 않게 */
export function clampToRing(f) {
  const min = ARENA.leftBound + FIGHTER.bodyHalfWidth;
  const max = ARENA.rightBound - FIGHTER.bodyHalfWidth;
  if (f.x < min) {
    f.x = min;
    f.vx = Math.abs(f.vx) * 0.3; // 로프에 튕김
  } else if (f.x > max) {
    f.x = max;
    f.vx = -Math.abs(f.vx) * 0.3;
  }
}

/** 지금 자유롭게 움직일 수 있는 상태인지 */
export function isControllable(f) {
  return f.state === 'idle' || f.state === 'walk' || f.state === 'guard';
}
