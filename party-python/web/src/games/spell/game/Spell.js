// ============================================================
// 주문 실행: 주문 데이터 + 위력 → 실제 게임 오브젝트(투사체/낙뢰/방어막/회복)
// ============================================================
import { powerTier } from '../config.js';
import { ELEMENT_COLORS } from '../data/palette.js';

export class Projectile {
  /**
   * @param owner 'player' | 'enemy'
   * @param size  1 = 8x8, 2 = 16x16 (외침/대형 공격)
   */
  constructor({ owner, element, x, y, vx, vy = 0, damage, power = 0.5, size = 1, sprite = 'orb', name = '' }) {
    Object.assign(this, { owner, element, x, y, vx, vy, damage, power, size, sprite, name });
    this.alive = true;
    this.age = 0;
    this.trailTimer = 0;
  }

  get radius() {
    return this.size >= 2 ? 7 : 3;
  }

  update(dt, particles) {
    this.age += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // 꼬리 파티클 (위력이 클수록 많이)
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.03 / (0.5 + this.power);
      const cols = ELEMENT_COLORS[this.element] || ELEMENT_COLORS.neutral;
      const back = this.vx === 0 ? 0 : -Math.sign(this.vx);
      particles.spawn({
        x: this.x + back * this.radius + (Math.random() * 4 - 2),
        y: this.y + (Math.random() * this.radius * 2 - this.radius),
        vx: back * 20 + (Math.random() * 10 - 5),
        vy: this.element === 'fire' ? -15 - Math.random() * 10 : Math.random() * 10 - 5,
        life: 0.25 + Math.random() * 0.2,
        color: cols[Math.floor(Math.random() * 3)],
        size: this.size >= 2 && Math.random() < 0.5 ? 2 : 1,
        drag: 3,
      });
    }
  }

  render(r, assets) {
    const img = assets.frameAt(this.sprite, 'default', this.age, { variant: this.element, flip: this.vx < 0, fps: 10 });
    if (!img) return;
    r.sprite(img, this.x, this.y, { anchorX: 0.5, anchorY: 0.5, sx: this.size, sy: this.size });
  }
}

/**
 * 플레이어 주문 시전
 * @returns 생성된 효과 설명 (Battle이 이벤트/사운드에 사용)
 */
export function castPlayerSpell(battle, caster, target, spell, power, comboBonus) {
  const tier = powerTier(power);
  const mult = tier.mult * (1 + comboBonus);
  const cp = caster.castPoint;
  const big = tier.id === 'shout';

  switch (spell.type) {
    case 'projectile': {
      const proj = new Projectile({
        owner: 'player',
        element: spell.element,
        x: cp.x,
        y: cp.y,
        vx: caster.facing * spell.speed * (0.9 + power * 0.3),
        damage: spell.damage * mult,
        power,
        size: big ? 2 : 1,
        sprite: spell.element === 'wind' ? 'crescent' : 'orb',
        name: spell.name,
      });
      battle.projectiles.push(proj);
      battle.particles.burst(cp.x, cp.y, ELEMENT_COLORS[spell.element], Math.round(6 * tier.fx), 40 * tier.fx);
      return { kind: 'projectile', proj };
    }
    case 'strike': {
      battle.strikes.push({
        owner: 'player',
        target,
        element: spell.element,
        damage: spell.damage * mult,
        power,
        delay: spell.delay ?? 0.15,
        flash: 0,
        width: big ? 3 : 2,
      });
      return { kind: 'strike' };
    }
    case 'shield': {
      const hp = Math.round(spell.shield * tier.mult);
      caster.shield = { hp, max: hp, time: spell.duration, duration: spell.duration };
      battle.particles.burst(caster.x + caster.facing * 10, caster.centerY, ELEMENT_COLORS.ice, Math.round(14 * tier.fx), 50);
      return { kind: 'shield', amount: hp };
    }
    case 'heal': {
      const amount = Math.round(spell.heal * tier.mult);
      const before = caster.hp;
      caster.hp = Math.min(caster.maxHp, caster.hp + amount);
      const healed = Math.round(caster.hp - before);
      // 위로 떠오르는 분홍 파티클
      for (let i = 0; i < Math.round(18 * tier.fx); i++) {
        battle.particles.spawn({
          x: caster.x + (Math.random() * 16 - 8),
          y: caster.y - Math.random() * 28,
          vy: -20 - Math.random() * 25,
          life: 0.6 + Math.random() * 0.4,
          color: ELEMENT_COLORS.heal[Math.floor(Math.random() * 3)],
          size: Math.random() < 0.4 ? 2 : 1,
          drag: 1,
        });
      }
      battle.healRings.push({ x: caster.x, y: caster.centerY, age: 0, life: 0.5 });
      return { kind: 'heal', amount: healed };
    }
    default:
      return { kind: 'none' };
  }
}

/** 적 투사체 생성 */
export function spawnEnemyProjectile(battle, enemy, attack) {
  const cp = enemy.castPoint;
  const speedMult = enemy.phase.speedMult || 1;
  const proj = new Projectile({
    owner: 'enemy',
    element: attack.element,
    x: cp.x,
    y: cp.y,
    vx: enemy.facing * attack.speed * speedMult,
    damage: attack.damage,
    power: attack.power ?? (attack.size >= 2 ? 0.9 : 0.55),
    size: attack.size || 1,
    sprite: attack.element === 'wind' ? 'crescent' : 'orb',
    name: attack.name,
  });
  battle.projectiles.push(proj);
  battle.particles.burst(cp.x, cp.y, ELEMENT_COLORS[attack.element], 8, 40);
  return proj;
}
