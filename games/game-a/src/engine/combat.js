// =============================================================
//  타격 판정
//    - 공격이 맞힐 수 있는 순간 + 사거리 안 → 명중
//    - 상대가 가드 중이면 데미지 감소 (스태미나가 부족하면 가드 브레이크)
//    - 두 선수가 서로 겹치지 않게 밀어내기
// =============================================================

import { ARENA, ATTACKS, FIGHTER, GUARD, POWER } from '../config.js';
import { clampToRing, isAttackActive, setState } from './fighter.js';

// 공격별 맞는 높이 (바닥에서 위로)
const HIT_HEIGHT = { punch: 205, kick: 135, special: 190 };

function addPower(f, amount) {
  f.power = Math.min(FIGHTER.powerMax, f.power + amount);
}

/**
 * attacker의 공격이 지금 defender에게 맞는지 확인
 * @returns 맞는다면 공격 종류('punch' 등), 아니면 null
 */
function checkHit(attacker, defender) {
  if (!isAttackActive(attacker) || attacker.attack.hasHit) return null;
  if (defender.state === 'ko') return null;
  const atk = ATTACKS[attacker.attack.type];
  const forward = (defender.x - attacker.x) * attacker.facing; // 앞쪽 거리
  if (forward <= 0 || forward > atk.reach) return null;
  return attacker.attack.type;
}

/**
 * 두 선수의 공격을 동시에 판정 (서로 동시에 맞히면 둘 다 맞음 = 상쇄)
 */
export function resolveAttacks(a, b, match) {
  const aType = checkHit(a, b);
  const bType = checkHit(b, a);
  if (aType) applyHit(a, b, aType, match);
  if (bType) applyHit(b, a, bType, match);
}

/**
 * 공격 결과 적용
 * @returns {'hit' | 'block' | 'break'}
 */
function applyHit(attacker, defender, type, match) {
  if (attacker.attack) attacker.attack.hasHit = true;
  const atk = ATTACKS[type];
  const dir = attacker.facing;
  const fx = defender.x - dir * 34;
  const fy = ARENA.floorY - HIT_HEIGHT[type];
  const effects = match.effects;

  // ---- 가드 ----
  if (defender.state === 'guard') {
    if (defender.stamina >= atk.guardCost) {
      const damage = Math.max(1, Math.round(atk.damage * GUARD.damageFactor));
      defender.hp = Math.max(0, defender.hp - damage);
      defender.stamina -= atk.guardCost;
      defender.stunTime = GUARD.blockStun;
      defender.vx = dir * atk.knockback * GUARD.knockbackFactor * 6;
      setState(defender, 'block');
      addPower(defender, POWER.onBlocked);
      defender.stats.blocked += 1;
      attacker.stats.damageDealt += damage;
      effects.push({ type: 'block', x: fx, y: fy, age: 0, life: 0.35 });
      effects.push({ type: 'text', text: 'GUARD', x: defender.x, y: fy - 70, color: '#cfd8ff', size: 26, age: 0, life: 0.6 });
      match.shake = Math.max(match.shake, atk.shake * 0.4);
      match.events.push({ type: 'block', attack: type, attacker: attacker.id });
      return 'block';
    }
    // 스태미나 부족 → 가드 브레이크
    defender.stamina = 0;
    defender.stunTime = GUARD.breakStun;
    defender.vx = dir * atk.knockback * 6;
    defender.hp = Math.max(0, defender.hp - atk.damage);
    defender.flash = 0.15;
    defender.attack = null;
    setState(defender, 'stun');
    attacker.stats.damageDealt += atk.damage;
    attacker.stats.hitsLanded += 1;
    effects.push({ type: 'hit', x: fx, y: fy, big: true, age: 0, life: 0.45 });
    effects.push({ type: 'text', text: '가드 브레이크!', x: defender.x, y: fy - 80, color: '#ffd45e', size: 32, age: 0, life: 0.9 });
    match.shake = Math.max(match.shake, atk.shake + 4);
    match.events.push({ type: 'break', attack: type, attacker: attacker.id });
    return 'break';
  }

  // ---- 명중 ----
  defender.hp = Math.max(0, defender.hp - atk.damage);
  defender.stunTime = atk.hitstun;
  defender.vx = dir * atk.knockback * 6;
  defender.flash = 0.12;
  defender.attack = null; // 공격 중이었다면 끊김
  setState(defender, 'hit');
  addPower(attacker, atk.power);
  addPower(defender, POWER.onTaken);
  attacker.stats.damageDealt += atk.damage;
  attacker.stats.hitsLanded += 1;

  const big = type !== 'punch';
  effects.push({ type: 'hit', x: fx, y: fy, big, age: 0, life: big ? 0.45 : 0.3 });
  effects.push({
    type: 'text',
    text: `-${atk.damage}`,
    x: defender.x + (Math.random() - 0.5) * 30,
    y: fy - 60,
    color: '#ffffff',
    size: big ? 40 : 30,
    age: 0,
    life: 0.7,
  });
  if (type === 'special') {
    effects.push({ type: 'text', text: '필살!', x: attacker.x + dir * 60, y: fy - 120, color: '#ffd45e', size: 54, age: 0, life: 1 });
  }
  match.shake = Math.max(match.shake, atk.shake);
  match.events.push({ type: 'hit', attack: type, attacker: attacker.id });
  return 'hit';
}

/** 두 선수가 겹치면 밀어내기 */
export function separateFighters(a, b) {
  const minDist = FIGHTER.bodyHalfWidth * 2;
  const dx = b.x - a.x;
  const dist = Math.abs(dx);
  if (dist < minDist) {
    const push = (minDist - dist) / 2;
    const dir = dx >= 0 ? 1 : -1;
    a.x -= dir * push;
    b.x += dir * push;
  }
  clampToRing(a);
  clampToRing(b);
  // 한 명이 로프에 붙어 더 못 밀리면 다른 한 명을 밀어냄
  const gap = b.x - a.x;
  if (Math.abs(gap) < minDist) {
    const dir = gap >= 0 ? 1 : -1;
    const atLeftWall = (f) => f.x <= ARENA.leftBound + FIGHTER.bodyHalfWidth + 0.5;
    const atRightWall = (f) => f.x >= ARENA.rightBound - FIGHTER.bodyHalfWidth - 0.5;
    if (dir > 0) {
      if (atLeftWall(a)) b.x = a.x + minDist;
      else if (atRightWall(b)) a.x = b.x - minDist;
    } else if (atLeftWall(b)) a.x = b.x + minDist;
    else if (atRightWall(a)) b.x = a.x - minDist;
  }
}
