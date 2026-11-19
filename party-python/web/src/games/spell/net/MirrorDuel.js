// =============================================================
// MirrorDuel — 서버가 판정한 결투 한 판을 화면에 비춘다 (판정은 하지 않는다)
//
// - apply(d)        서버 상태(체력·마나·방패·쿨다운·투사체 위치)를 받아 반영
// - handleEvent(e)  서버 사건(시전·상쇄·명중·방어·종료)을 연출(파티클·흔들림·소리·글자)로 바꾼다
// - update/render   원본 Battle.js 의 그리기 부분을 옮긴 것
//
// swap = true 이면 좌우를 뒤집어 보여 준다(내 캐릭터가 항상 왼쪽에 오도록).
// =============================================================
import { CONFIG } from '../config.js';
import { C, ELEMENT_COLORS } from '../data/palette.js';
import { SPELLS, SPELL_BY_ID } from '../data/spells.js';
import { Wizard } from '../game/Wizard.js';
import { Projectile } from '../game/Spell.js';
import { Particles, FloatingTexts } from '../game/Effects.js';

const W = CONFIG.VIEW.WIDTH;

/** 화면용 마법사: 원본 Wizard(그리기·동작) + 서버가 알려 주는 쿨다운·콤보 */
class MirrorMage extends Wizard {
  constructor({ key, player, x, facing }) {
    super({
      name: player.name, sprite: `animal_${player.lookId}`, x, y: CONFIG.LAYOUT.GROUND_Y, facing,
      maxHp: CONFIG.PLAYER.MAX_HP, maxMana: CONFIG.PLAYER.MAX_MANA, manaRegen: 0,
    });
    this.key = key;
    this.player = player;
    this.cooldowns = {};
    this.combo = { count: 0, timer: 0 };
    // 주문서 패널(SpellPanel)이 읽는 모양
    this.spellBook = {
      spells: SPELLS,
      cooldownLeft: (id) => this.cooldowns[id] || 0,
      cooldownRatio: (spell) => (spell.cooldown ? (this.cooldowns[spell.id] || 0) / spell.cooldown : 0),
    };
  }

  update(dt) {
    super.update(dt);
    for (const id in this.cooldowns) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    if (this.combo.timer > 0) this.combo.timer -= dt;
  }
}

export class MirrorDuel {
  /**
   * @param {{game:object, a:object, b:object, swap:boolean, meKey:('a'|'b'|null)}} opts a, b = 참가자 {id, name, lookId}
   */
  constructor({ game, a, b, swap = false, meKey = null }) {
    this.game = game;
    this.swap = swap;
    this.meKey = meKey;
    const L = CONFIG.LAYOUT;
    const leftKey = swap ? 'b' : 'a';
    this.mages = {
      a: new MirrorMage({ key: 'a', player: a, x: leftKey === 'a' ? L.PLAYER_X : L.ENEMY_X, facing: leftKey === 'a' ? 1 : -1 }),
      b: new MirrorMage({ key: 'b', player: b, x: leftKey === 'b' ? L.PLAYER_X : L.ENEMY_X, facing: leftKey === 'b' ? 1 : -1 }),
    };
    this.left = this.mages[leftKey];
    this.right = this.mages[leftKey === 'a' ? 'b' : 'a'];
    this.projectiles = new Map(); // 서버 투사체 id → Projectile(화면용)
    this.bolts = [];
    this.healRings = [];
    this.rings = [];
    this.particles = new Particles();
    this.floats = new FloatingTexts();
    this.flash = null;
    this.state = 'ready';
    this.time = 0;
    this.timeLimit = CONFIG.BATTLE.TIME_LIMIT;
    this.timeLeft = this.timeLimit;
    this.hitstop = 0;
    this.result = null;
  }

  /** 서버 x 좌표 → 화면 x 좌표 */
  vx(x) {
    return this.swap ? W - x : x;
  }

  get fighting() {
    return this.state === 'fight';
  }

  // ---------- 연출 도우미 (원본과 같다) ----------
  sfx(name, opts) {
    this.game.audio?.play(name, opts);
  }

  shake(power, mult = 1) {
    const B = CONFIG.BATTLE;
    this.game.renderer.shake((B.SHAKE_BASE + B.SHAKE_POWER * power) * mult, 0.15 + power * 0.2);
  }

  screenFlash(color, time = 0.08, density = 0.5) {
    this.flash = { color, time, total: time, density };
  }

  // ---------- 서버 상태 반영 ----------
  apply(d) {
    this.state = d.state;
    this.timeLeft = d.timeLeft;
    this.hitstop = d.hitstop;
    this.result = d.result;
    for (const key of ['a', 'b']) {
      const m = this.mages[key];
      const s = d[key];
      m.hp = s.hp;
      m.mana = s.mana;
      m.shield = s.shield ? { hp: s.shield.hp, max: s.shield.max, time: s.shield.time } : null;
      m.cooldowns = { ...s.cd };
      m.combo = { count: s.combo, timer: s.comboTimer };
    }
    const seen = new Set();
    for (const p of d.proj) {
      seen.add(p.id);
      const x = this.vx(p.x);
      const vx = this.swap ? -p.vx : p.vx;
      let pr = this.projectiles.get(p.id);
      if (!pr) {
        pr = new Projectile({
          owner: p.o, element: p.e, x, y: p.y, vx, damage: 0, power: 0.5, size: 1,
          sprite: p.e === 'wind' ? 'crescent' : 'orb',
        });
        this.projectiles.set(p.id, pr);
      } else {
        pr.x = x;
        pr.vx = vx;
      }
    }
    for (const id of [...this.projectiles.keys()]) if (!seen.has(id)) this.projectiles.delete(id);
  }

  // ---------- 서버 사건 → 연출 ----------
  handleEvent(e) {
    const mine = (key) => key === this.meKey;
    switch (e.type) {
      case 'cast': {
        const m = this.mages[e.who];
        const spell = SPELL_BY_ID[e.spell];
        m.onCast();
        const cp = m.castPoint;
        this.sfx(`cast_${e.element}`, { power: 0.5, enemy: !mine(e.who) });
        if (e.kind === 'projectile') this.particles.burst(cp.x, cp.y, ELEMENT_COLORS[e.element], 6, 40);
        if (e.kind === 'shield') {
          this.particles.burst(m.x + m.facing * 10, m.centerY, ELEMENT_COLORS.ice, 14, 50);
          this.floats.add('얼음 방패!', m.x + m.facing * 4, m.y - 40, { color: C.cyan, size: 's' });
        }
        if (e.kind === 'heal') {
          for (let i = 0; i < 18; i++) {
            this.particles.spawn({
              x: m.x + (Math.random() * 16 - 8), y: m.y - Math.random() * 28, vy: -20 - Math.random() * 25,
              life: 0.6 + Math.random() * 0.4, color: ELEMENT_COLORS.heal[Math.floor(Math.random() * 3)],
              size: Math.random() < 0.4 ? 2 : 1, drag: 1,
            });
          }
          this.healRings.push({ x: m.x, y: m.centerY, age: 0, life: 0.5 });
          this.floats.add(`+${e.amount}`, m.x, m.y - 40, { color: C.green, size: 'l' });
        }
        if (e.combo >= 2) {
          this.floats.add(`${e.combo} COMBO!`, m.x, m.y - 50, { color: C.yellow, size: 'm', delay: 0.05 });
          if (mine(e.who)) this.sfx('combo', { combo: e.combo });
        }
        return { mage: m, spell };
      }
      case 'castFail': {
        if (mine(e.who)) this.sfx(e.reason === 'mana' ? 'nomana' : 'fail');
        return { mage: this.mages[e.who] };
      }
      case 'clash': {
        const mx = this.vx(e.x);
        this.particles.burst(mx, e.y, [...ELEMENT_COLORS[e.ea].slice(0, 3), ...ELEMENT_COLORS[e.eb].slice(0, 3)], 18, 70);
        this.rings.push({ x: mx, y: e.y, age: 0, life: 0.3, color: C.white });
        this.sfx('clash');
        this.shake(0.3, 0.6);
        if (e.both) this.floats.add('상쇄!', mx, e.y - 12, { color: C.silver, size: 's' });
        else if (e.advantage) {
          const good = e.winner === this.meKey || this.meKey === null;
          this.floats.add(good ? '상성 승리!' : '상성 패배…', mx, e.y - 12, { color: good ? C.green : C.steel, size: 's' });
        }
        return null;
      }
      case 'blocked': {
        const m = this.mages[e.who];
        this.particles.burst(m.x + m.facing * 11, e.y, ELEMENT_COLORS.ice, 12, 60);
        this.sfx('block');
        this.floats.add('막음!', m.x + m.facing * 12, e.y - 10, { color: C.cyan, size: 's' });
        if (e.broken) {
          this.sfx('shieldBreak');
          this.particles.burst(m.x + m.facing * 11, m.centerY, [C.white, C.cyan, C.silver], 20, 90, { gravity: 120 });
        }
        return null;
      }
      case 'strike': {
        const m = this.mages[e.target];
        this.bolts.push({ target: m, flash: 0.25, seed: Math.floor(Math.random() * 1000), width: 2 });
        this.screenFlash(C.white, 0.06, 0.35);
        this.sfx('thunder', { power: 0.5 });
        return null;
      }
      case 'hit': {
        const m = this.mages[e.target];
        const isMe = mine(e.target);
        m.onHit(e.power);
        const x = e.x === undefined ? m.x : this.vx(e.x);
        this.particles.burst(x, e.y ?? m.centerY, ELEMENT_COLORS[e.element] || ELEMENT_COLORS.neutral, Math.round(10 + 16 * e.power), 50 + 60 * e.power);
        this.shake(e.power, isMe ? 1 : 0.8);
        this.floats.add(String(e.damage), m.x, m.y - 38, { color: isMe ? C.red : C.white, size: 'm' });
        this.sfx(isMe ? 'hurt' : 'hit', { power: e.power });
        return null;
      }
      case 'end': {
        this.result = e.result;
        this.state = 'over';
        const w = e.result.winner;
        if (w === 'a' || w === 'b') {
          this.mages[w].setAnim('win', { force: true });
          this.mages[w === 'a' ? 'b' : 'a'].setAnim('lose', { force: true });
        }
        for (const pr of this.projectiles.values()) this.particles.burst(pr.x, pr.y, ELEMENT_COLORS[pr.element], 8, 40);
        this.projectiles.clear();
        this.shake(1, 1.2);
        this.screenFlash(C.white, 0.15, 0.5);
        this.sfx('ko');
        return null;
      }
      default:
        return null;
    }
  }

  // ---------- 갱신 / 그리기 ----------
  update(dt) {
    if (this.flash) {
      this.flash.time -= dt;
      if (this.flash.time <= 0) this.flash = null;
    }
    this.time += dt;
    this.left.update(dt);
    this.right.update(dt);
    // 투사체: 서버 위치 사이를 속도로 이어 그린다(히트 스톱 중에는 멈춤)
    if (this.hitstop <= 0) for (const pr of this.projectiles.values()) pr.update(dt, this.particles);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const s = this.bolts[i];
      s.flash -= dt;
      if (Math.random() < 0.5) s.seed = Math.floor(Math.random() * 1000);
      if (s.flash <= 0) this.bolts.splice(i, 1);
    }
    for (const list of [this.healRings, this.rings]) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].age += dt;
        if (list[i].age >= list[i].life) list.splice(i, 1);
      }
    }
    this.particles.update(dt);
    this.floats.update(dt);
  }

  render(r) {
    const assets = this.game.assets;
    const text = this.game.text;
    this.right.render(r, assets);
    this.left.render(r, assets);
    this._renderShield(r, this.left);
    this._renderShield(r, this.right);
    for (const pr of this.projectiles.values()) pr.render(r, assets);
    for (const s of this.bolts) this._renderBolt(r, s);
    for (const h of this.healRings) r.ring(h.x, h.y, Math.round(4 + (h.age / h.life) * 14), C.pink);
    for (const g of this.rings) r.ring(g.x, g.y, Math.round(2 + (g.age / g.life) * 12), g.color);
    this.particles.render(r);
    this.floats.render(r, text);
    if (this.flash) r.dither(0, 0, r.W, r.H, this.flash.color, this.flash.density * (this.flash.time / this.flash.total));
  }

  _renderShield(r, p) {
    const s = p.shield;
    if (!s) return;
    if (s.time < 1 && Math.floor(s.time * 12) % 2) return; // 끝나갈 때 깜빡임
    const x = Math.round(p.x + p.facing * 13);
    const top = p.y - 32;
    r.rect(x - 1, top + 2, 3, 29, C.cyan);
    r.rect(x, top, 1, 33, C.white);
    r.rect(x - 2, top + 5, 1, 23, C.steel);
    r.rect(x + 2, top + 5, 1, 23, C.silver);
    r.dither(x - 4, top + 6, 2, 21, C.cyan, 0.5);
    const pips = Math.ceil((s.hp / s.max) * 4);
    for (let i = 0; i < pips; i++) r.rect(x - 1, top + 6 + i * 6, 3, 2, C.white);
  }

  _renderBolt(r, s) {
    const tx = s.target.x;
    const ty = s.target.centerY;
    let seed = s.seed || 1;
    const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const pts = [];
    for (let y = 22; y < ty; y += 8) pts.push([tx + Math.round(rand() * 10 - 5), y]);
    pts.push([tx, ty]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      for (let y = y0; y < y1; y++) {
        const x = Math.round(x0 + ((x1 - x0) * (y - y0)) / (y1 - y0));
        r.rect(x - s.width, y, s.width * 2 + 1, 1, C.gold);
        r.rect(x - Math.floor(s.width / 2), y, s.width, 1, C.white);
      }
    }
  }
}
