// ============================================================
// 마법사 공통 엔티티 (플레이어/적이 상속)
//  - HP, 마나, 방어막(얼음), 방벽(화염 방벽)
//  - 애니메이션 상태 + 스쿼시&스트레치 + 넉백
// ============================================================
import { CONFIG, clamp } from '../config.js';
import { C } from '../data/palette.js';

// 애니메이션별 재생 속도(FPS)와 반복 여부
const ANIM_SPEC = {
  idle: { fps: 4, loop: true },
  charge: { fps: 8, loop: true },
  cast: { fps: 12, loop: false, hold: 0.32 },
  hit: { fps: 10, loop: false, hold: 0.28 },
  win: { fps: 4, loop: true },
  lose: { fps: 4, loop: false },
};

export class Wizard {
  constructor({ name, sprite, x, y, facing = 1, maxHp, maxMana = 0, manaRegen = 0, affinity = null }) {
    this.name = name;
    this.sprite = sprite;
    this.x = x;
    this.y = y;
    this.facing = facing; // 1 = 오른쪽, -1 = 왼쪽
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.maxMana = maxMana;
    this.mana = maxMana;
    this.manaRegen = manaRegen;
    this.affinity = affinity;
    this.anim = 'idle';
    this.animTime = 0;
    this.animHold = 0;
    this.sx = 1; // 스쿼시&스트레치
    this.sy = 1;
    this.knock = 0;
    this.shield = null;  // { hp, max, time, duration }
    this.barrier = null; // { reduce, time, duration }
    this.lastHitTime = 0;
  }

  get alive() {
    return this.hp > 0;
  }

  get hpRatio() {
    return this.maxHp ? this.hp / this.maxHp : 0;
  }

  /** 지팡이 끝 (투사체 발사 위치) */
  get castPoint() {
    return { x: this.x + this.facing * 9, y: this.y - 20 };
  }

  get centerY() {
    return this.y - 15;
  }

  /** 피격 판정 상자 */
  get hitbox() {
    return { x: this.x - 6, y: this.y - 28, w: 12, h: 28 };
  }

  setAnim(name, { force = false } = {}) {
    if (!force && (this.anim === 'win' || this.anim === 'lose')) return;
    this.anim = name;
    this.animTime = 0;
    this.animHold = ANIM_SPEC[name]?.hold || 0;
  }

  squash(sx, sy) {
    this.sx = sx;
    this.sy = sy;
  }

  onCast() {
    this.setAnim('cast');
    this.squash(1.15, 0.88);
  }

  onHit(power = 0.5) {
    this.setAnim('hit');
    this.squash(0.86, 1.12);
    this.knock = -this.facing * (CONFIG.BATTLE.KNOCKBACK + Math.round(power * 3));
  }

  addMana(v) {
    this.mana = clamp(this.mana + v, 0, this.maxMana);
  }

  update(dt) {
    this.animTime += dt;
    if (this.animHold > 0) {
      this.animHold -= dt;
      if (this.animHold <= 0 && (this.anim === 'cast' || this.anim === 'hit')) this.setAnim('idle');
    }
    // 스쿼시 복원 (스프링 느낌의 지수 감쇠)
    const k = Math.min(1, dt * 12);
    this.sx += (1 - this.sx) * k;
    this.sy += (1 - this.sy) * k;
    this.knock += (0 - this.knock) * Math.min(1, dt * 10);
    if (Math.abs(this.knock) < 0.3) this.knock = 0;

    if (this.maxMana && this.alive) this.addMana(this.manaRegen * dt);

    if (this.shield) {
      this.shield.time -= dt;
      if (this.shield.time <= 0 || this.shield.hp <= 0) this.shield = null;
    }
    if (this.barrier) {
      this.barrier.time -= dt;
      if (this.barrier.time <= 0) this.barrier = null;
    }
  }

  render(r, assets) {
    const spec = ANIM_SPEC[this.anim] || ANIM_SPEC.idle;
    const img = assets.frameAt(this.sprite, this.anim, this.animTime, { flip: this.facing < 0, fps: spec.fps, loop: spec.loop });
    // 그림자: 채도 낮은 어두운 색 디더 타원
    const sw = 14;
    r.dither(this.x - sw / 2 + 1, this.y - 1, sw - 2, 1, C.ink, 0.5);
    r.dither(this.x - sw / 2, this.y, sw, 2, C.ink, 0.5);
    r.sprite(img, this.x + Math.round(this.knock), this.y + 1, { sx: this.sx, sy: this.sy });
  }
}
