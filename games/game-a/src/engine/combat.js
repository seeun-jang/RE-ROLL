// =============================================================
//  판정: 근접 공격, 범위 공격, 마법 투사체, 낙뢰·메테오, 포효
//
//  상성 정리
//    교수의 마법  ← student의 구르기(완전 무적), 대시(미사일 튕겨냄), 도약(마법 위로), 포효(주변 마법 소멸)
//    student의 돌진  ← 교수의 아케인 폭발(멀리 밀쳐냄), 블링크(순간이동), 낙뢰(착지/대시 끝을 노림)
//    가드        ← 모든 공격을 크게 줄이지만 자원 소모 (마나/스태미나가 바닥나면 방어가 깨짐)
// =============================================================

import { FIGHTER, GUARD, STAGE } from '../config.js';
import { actionPhase, bodyRadius, dealDamage, gainSuper, immunity, isGuarding, moveSpec, setState } from './fighter.js';

const PROJECTILE_ZONE = { missile: 'high', fireball: 'mid' };

/**
 * 공격 적용
 * @returns 'hit' | 'block' | 'break'
 */
export function applyHit(att, def, spec, match, { x, y, dir = att.facing, source = 'melee', move = '' } = {}) {
  const event = { attacker: att.id, defender: def.id, x, y, move, source, heavy: Boolean(spec.heavy) };
  const R = def.player.resource;

  // ---- 가드 ----
  if (isGuarding(def) && def.facing === -dir) {
    const cost = spec.guardCost ?? 10;
    if (def.res >= cost) {
      const damage = dealDamage(def, Math.max(1, Math.round(spec.damage * GUARD.chip)));
      def.res -= cost;
      def.stun = GUARD.blockStun;
      def.vx = dir * Math.min(600, (spec.knockback ?? 20) * 5);
      setState(def, 'block');
      att.stats.damage += damage;
      def.stats.blocked += 1;
      match.hitstop = Math.max(match.hitstop, 0.04);
      match.shake = Math.max(match.shake, 3);
      match.events.push({ ...event, type: 'block' });
      return 'block';
    }
    def.res = 0;
    const damage = dealDamage(def, spec.damage);
    def.stun = GUARD.breakStun;
    def.flash = 0.12;
    setState(def, 'broken');
    att.stats.damage += damage;
    att.stats.landed += 1;
    gainSuper(att, damage * FIGHTER.superPerDamageDealt);
    gainSuper(def, damage * FIGHTER.superPerDamageTaken);
    match.hitstop = Math.max(match.hitstop, 0.12);
    match.shake = Math.max(match.shake, 10);
    match.events.push({ ...event, type: 'guardbreak' });
    return 'break';
  }

  // ---- 정타 ----
  const damage = dealDamage(def, spec.damage);
  def.flash = 0.1;
  def.action = null;
  def.buffer = null;
  def.y = 0;
  def.hitZone = PROJECTILE_ZONE[move] ?? (spec.heavy ? 'high' : 'mid');
  def.vx = dir * (spec.knockback ?? 20) * 9;
  if (spec.heavy) {
    def.stun = FIGHTER.knockdownSeconds;
    setState(def, 'down');
    att.stats.knockdowns += 1;
  } else {
    def.stun = spec.hitstun ?? 0.3;
    setState(def, 'hit');
  }
  att.stats.damage += damage;
  att.stats.landed += 1;
  gainSuper(att, damage * FIGHTER.superPerDamageDealt);
  gainSuper(def, damage * FIGHTER.superPerDamageTaken);
  const big = spec.heavy || damage >= 10;
  match.hitstop = Math.max(match.hitstop, big ? 0.12 : 0.06);
  match.shake = Math.max(match.shake, big ? 10 : 4);
  match.hype = Math.min(1, match.hype + damage * 0.012);
  match.events.push({ ...event, type: 'hit', damage, big });
  return 'hit';
}

function hitPoint(def, zone = 'mid') {
  const h = zone === 'high' ? 200 : zone === 'low' ? 60 : 140;
  return STAGE.floorY - h * def.player.height;
}

// ---------------- 근접 / 돌진 ----------------

/** 근접기, 대시, 백호 난무의 접촉 판정 */
export function resolveMelee(att, def, match) {
  if (att.state !== 'action') return;
  const m = moveSpec(att);
  const a = att.action;
  if (!['melee', 'dash', 'super'].includes(m.kind)) return;
  if (m.kind === 'super' && att.player.kind !== 'tiger') return;

  // 백호 난무 연타 진행
  if (m.kind === 'super' && a.data.connected) {
    a.data.t += match.dt;
    const perHit = 0.13;
    while (a.data.hits < m.hits && a.data.t >= a.data.hits * perHit) {
      a.data.hits += 1;
      const last = a.data.hits === m.hits;
      const part = { damage: Math.round(m.damage / m.hits), knockback: last ? m.knockback : 4, hitstun: 1, heavy: last, guardCost: 0 };
      // 연타 중엔 방어 불가 (돌진이 막히지 않고 닿았으므로)
      def.state = 'hit';
      applyHit(att, def, part, match, { x: def.x - att.facing * 30, y: hitPoint(def, a.data.hits % 2 ? 'high' : 'mid'), move: 'whiteTiger' });
      if (!last) {
        def.stun = 1;
        setState(def, 'hit');
        def.vx = 0;
      }
    }
    if (a.data.hits >= m.hits && a.data.t >= m.hits * perHit + 0.35) a.data.finished = true;
    return;
  }

  if (actionPhase(att) !== 'active' || a.hasHit) return;
  if (immunity(def) === 'all') return;
  const d = (def.x - att.x) * att.facing;
  const reach = (m.reach ?? 150) * (0.6 + 0.4 * att.player.height);
  if (d <= 0 || d > reach) return;

  a.hasHit = true;
  const x = def.x - att.facing * bodyRadius(def) * 0.5;
  if (m.kind === 'super') {
    // 백호 난무: 막히면 끝, 맞으면 연타 시작
    if (isGuarding(def) && def.facing === -att.facing) {
      applyHit(att, def, { ...m, damage: 10 }, match, { x, y: hitPoint(def), move: 'whiteTiger' });
      return;
    }
    a.data = { connected: true, hits: 0, t: 0 };
    att.vx = 0;
    def.action = null;
    def.stun = 2;
    setState(def, 'hit');
    match.events.push({ type: 'superConnect', attacker: att.id, x });
    return;
  }
  applyHit(att, def, m, match, { x, y: hitPoint(def, a.type === 'jab' || a.type === 'cross' ? 'high' : 'mid'), move: a.type });
}

/** 범위 공격 (아케인 폭발, 도약 착지) */
export function areaHit(att, def, cx, radius, spec, match) {
  if (immunity(def) === 'all') return;
  const d = Math.abs(def.x - cx);
  if (d > radius + bodyRadius(def) * 0.4) return;
  const dir = Math.sign(def.x - cx) || att.facing;
  applyHit(att, def, spec, match, { x: def.x - dir * 20, y: hitPoint(def), dir, move: att.action?.type ?? 'area', source: 'area' });
}

// ---------------- 마법 ----------------

export function updateProjectiles(match, dt) {
  for (const p of match.projectiles) {
    p.age += dt;
    p.x += p.vx * dt;
    if (p.age >= p.life || p.x < STAGE.left - 200 || p.x > STAGE.right + 200) p.dead = true;
    if (p.dead) continue;
    const target = match.fighters[p.target];
    const owner = match.fighters[p.owner];
    const imm = immunity(target);
    if (imm === 'all') continue;
    const reach = p.radius + bodyRadius(target) * 0.55;
    if (Math.abs(target.x - p.x) > reach) continue;
    if (target.y > 60) continue; // 공중으로 뛰어넘음
    if (imm === 'projectile') {
      // student의 대시는 미사일을 튕겨냄 (파이어볼은 통과)
      if (p.type === 'missile' && target.action?.type === 'dash') {
        p.dead = true;
        target.stats.dodged += 1;
        match.events.push({ type: 'deflect', x: p.x, y: STAGE.floorY - p.height, fighter: target.id });
      }
      continue;
    }
    p.dead = true;
    applyHit(owner, target, p, match, { x: p.x, y: STAGE.floorY - p.height, dir: Math.sign(p.vx), source: 'projectile', move: p.type });
    match.events.push({ type: 'explode', kind: p.type, x: p.x, y: STAGE.floorY - p.height });
  }
  match.projectiles = match.projectiles.filter((p) => !p.dead);
}

/** 낙뢰·메테오: 표시 후 시간이 되면 내리침 */
export function updateStrikes(match, dt) {
  for (const s of match.strikes) {
    s.timer -= dt;
    if (s.timer > 0 || s.done) continue;
    s.done = true;
    s.flash = 0.4;
    const owner = match.fighters[s.owner];
    const target = match.fighters[s.target];
    match.events.push({ type: 'strike', kind: s.kind, x: s.x, radius: s.radius });
    match.shake = Math.max(match.shake, s.kind === 'meteor' ? 18 : 9);
    if (immunity(target) === 'all' || target.y > 80) {
      target.stats.dodged += 1;
      continue;
    }
    if (Math.abs(target.x - s.x) <= s.radius + bodyRadius(target) * 0.3) {
      const dir = Math.sign(target.x - s.x) || owner.facing;
      applyHit(owner, target, s.spec, match, { x: target.x, y: hitPoint(target, 'high'), dir, source: 'strike', move: s.kind });
    }
  }
  for (const s of match.strikes) if (s.done) s.flash -= dt;
  match.strikes = match.strikes.filter((s) => !s.done || s.flash > 0);
}

/** 포효: 주변 마법 소멸 + 가까운 상대를 굳게 함 */
export function roar(att, def, spec, match) {
  let erased = 0;
  for (const p of match.projectiles) {
    if (p.owner !== att.id && Math.abs(p.x - att.x) <= spec.radius) {
      p.dead = true;
      erased += 1;
      match.events.push({ type: 'explode', kind: 'erase', x: p.x, y: STAGE.floorY - p.height });
    }
  }
  match.projectiles = match.projectiles.filter((p) => !p.dead);
  gainSuper(att, spec.superGain + erased * 4);
  match.events.push({ type: 'roar', fighter: att.id, x: att.x, erased });
  if (immunity(def) === 'all') return;
  if (Math.abs(def.x - att.x) <= spec.stunRadius) {
    const dmg = dealDamage(def, spec.damage);
    att.stats.damage += dmg;
    att.stats.landed += 1;
    def.action = null;
    def.y = 0;
    def.stun = spec.stun;
    setState(def, 'stunned');
    match.events.push({ type: 'stun', fighter: def.id, x: def.x, y: hitPoint(def, 'high') });
  }
}

/** 두 선수가 겹치지 않게 (구르기·대시·도약·궁극기 중엔 지나갈 수 있음) */
export function separate(a, b) {
  const passing = (f) => f.state === 'action' && ['roll', 'pounce', 'dash', 'super'].includes(moveSpec(f).kind);
  if (passing(a) || passing(b) || a.state === 'down' || b.state === 'down') return;
  const minGap = bodyRadius(a) + bodyRadius(b);
  const gap = Math.abs(b.x - a.x);
  if (gap >= minGap) return;
  const push = (minGap - gap) / 2;
  const dir = b.x >= a.x ? 1 : -1;
  a.x -= dir * push;
  b.x += dir * push;
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  if (left < STAGE.left) {
    a.x += STAGE.left - left;
    b.x += STAGE.left - left;
  } else if (right > STAGE.right) {
    a.x -= right - STAGE.right;
    b.x -= right - STAGE.right;
  }
}
