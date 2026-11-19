// 적(좀비) — 일반 / 달리기 / 철모 / 점프 / 보스
export class Enemy {
  constructor(type, lane, x, cfg, mods, extra = {}) {
    const base = cfg.enemies[type];
    this.cfg = cfg;
    this.base = base;
    this.type = type;
    this.lane = lane;
    this.x = x;
    this.w = base.w; this.h = base.h;
    this.hitL = base.hitL; this.hitR = base.hitR;
    this.mods = mods;
    this.maxHp = Math.ceil(base.hp * mods.hpMul);
    this.hp = this.maxHp;
    this.maxHelmet = type === 'helmet' ? Math.ceil(base.helmetHp * mods.hpMul) : 0;
    this.helmetHp = this.maxHelmet;
    this.baseSpeed = base.speed * mods.speedMul;
    this.dps = base.damage;
    this.score = base.score;
    this.coin = base.coin;
    this.jumpsLeft = base.jumps || 0;
    this.state = 'walk';       // walk | attack | jump
    this.target = null;
    this.anim = extra.animOffset || 0;
    this.flash = 0;
    this.slow = 0; this.slowFactor = 1;
    this.yOff = 0;             // 점프/레인 전환 시 시각적 y 오프셋
    this.dead = false;
    this.card = extra.card || null;   // 확장 자리: 단어 카드를 든 특수 좀비 {word, bonus}
    this.fromBoss = !!extra.fromBoss;
    this.id = extra.id ?? 0;
    // 점프
    this.jumpT = 0; this.jumpFrom = 0; this.jumpTo = 0;
    // 보스
    this.summonTimer = base.summonInterval || 0;
    this.laneTimer = base.laneSwitchInterval || 0;
    this.laneTween = 0; this.laneFromY = 0;
    this.stepTimer = 0;
  }

  get front() { return this.x + this.hitL; }
  get back() { return this.x + this.hitR; }
  get speed() { return this.baseSpeed * (this.slow > 0 ? this.slowFactor : 1); }
  get isBoss() { return this.type === 'boss'; }

  applySlow(factor, time) { this.slow = Math.max(this.slow, time); this.slowFactor = factor; }

  update(dt, world) {
    this.anim += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.slow > 0) this.slow -= dt;
    if (this.laneTween > 0) this.laneTween -= dt;
    if (this.dead) return;
    const L = this.cfg.layout;

    if (this.isBoss) this.updateBoss(dt, world);

    if (this.state === 'walk') {
      const t = world.grid.blockingTurret(this.lane, this.front);
      if (t) {
        if (this.jumpsLeft > 0) this.startJump(t, world);
        else { this.state = 'attack'; this.target = t; }
      } else {
        this.x -= this.speed * dt;
        // 발걸음 먼지 (가끔)
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) { this.stepTimer = this.isBoss ? 0.5 : 1.2; world.particles.dust(this.x + this.w / 2, world.grid.laneBottom(this.lane) - 1, this.isBoss ? 5 : 2); if (this.isBoss) world.renderer.shake(1.5, 0.15); }
      }
      if (this.front <= L.exitX) {
        if (this.isBoss) { this.x = L.exitX - this.hitL; this.state = 'eat'; this.eatTimer = 0; } // 보스는 문 앞에서 집을 뜯는다
        else world.enemyReachedHouse(this);
        return;
      }
    } else if (this.state === 'eat') {
      this.eatTimer -= dt;
      if (this.eatTimer <= 0) { this.eatTimer = 3; world.enemyReachedHouse(this); }
    } else if (this.state === 'attack') {
      if (!this.target || this.target.dead) { this.state = 'walk'; this.target = null; }
      else {
        this.target.takeDamage(this.dps * dt, world);
        // 물어뜯는 모션: 앞뒤 1px
        this.xBite = Math.floor(this.anim * 8) % 2;
      }
    } else if (this.state === 'jump') {
      this.jumpT += dt;
      const J = this.cfg.jump;
      const p = Math.min(1, this.jumpT / J.duration);
      this.x = this.jumpFrom + (this.jumpTo - this.jumpFrom) * p;
      this.yOff = -Math.round(Math.sin(p * Math.PI) * J.height);
      if (p >= 1) { this.state = 'walk'; this.yOff = 0; world.particles.dust(this.x + 8, world.grid.laneBottom(this.lane) - 1, 4); world.audio?.play('land'); }
    }
  }

  startJump(turret, world) {
    this.jumpsLeft--;
    this.state = 'jump';
    this.jumpT = 0;
    this.jumpFrom = this.x;
    const left = world.grid.cellX(turret.col) + this.cfg.turretHitbox.left;
    this.jumpTo = left - 2 - this.cfg.fx.knockback - this.hitL; // 포탑 왼쪽으로 착지 (넉백에도 다시 걸리지 않게)
    world.audio?.play('jump');
  }

  updateBoss(dt, world) {
    // 주기적으로 일반 좀비 소환 (양 옆 레인)
    this.summonTimer -= dt;
    if (this.summonTimer <= 0) {
      this.summonTimer = this.base.summonInterval;
      const n = this.base.summonCount;
      for (let i = 0; i < n; i++) {
        const dir = (i % 2 === 0) ? 1 : -1;
        let lane = this.lane + dir;
        if (lane < 0 || lane >= this.cfg.layout.lanes) lane = this.lane - dir;
        world.spawnEnemy('normal', Math.max(0, Math.min(this.cfg.layout.lanes - 1, lane)), Math.min(this.x + 10, this.cfg.layout.spawnX), { fromBoss: true });
      }
      world.texts.add('SUMMON!', this.x + 16, world.grid.laneTop(this.lane) - 4, { color: 28, life: 0.9 });
      world.audio?.play('bossSummon');
      world.renderer.shake(2, 0.2);
    }
    // 주기적으로 옆 레인으로 이동 (시드 난수로 결정 → 모든 플레이어 동일 순서)
    this.laneTimer -= dt;
    if (this.laneTimer <= 0 && this.state === 'walk') {
      this.laneTimer = this.base.laneSwitchInterval;
      const L = this.cfg.layout.lanes;
      let dir = world.bossRng.chance(0.5) ? 1 : -1;
      // 보스(40px)는 맨 위 레인에서 HUD에 가리므로 1..L-2 레인만 쓴다
      if (this.lane + dir < 1 || this.lane + dir > L - 2) dir = -dir;
      this.laneFromY = world.grid.laneBottom(this.lane);
      this.lane += dir;
      this.laneTween = 0.5; this.laneTweenDur = 0.5;
      world.texts.add('!', this.x + 16, world.grid.laneTop(this.lane) - 2, { color: 26, life: 0.5, scale: 2 });
    }
  }

  // 피격. 반환: { killed, helmetBroke }
  hit(dmg, world) {
    if (this.dead) return { killed: false, helmetBroke: false };
    const res = { killed: false, helmetBroke: false };
    this.flash = this.cfg.fx.hitFlash;
    if (!this.isBoss && this.state !== 'jump') {
      this.x = Math.min(this.x + this.cfg.fx.knockback, this.cfg.layout.spawnX);
    }
    if (this.helmetHp > 0) {
      this.helmetHp -= dmg;
      if (this.helmetHp > 0) return res;
      // 철모가 깨지면 일반 좀비와 같은 속도로 (조금 빨라진다). 남은 피해는 몸에 넘어간다(폭탄 등)
      dmg = -this.helmetHp;
      this.helmetHp = 0;
      res.helmetBroke = true;
      this.baseSpeed = this.cfg.enemies.normal.speed * this.mods.speedMul;
      if (dmg <= 0) return res;
    }
    this.hp -= dmg;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; res.killed = true; }
    return res;
  }

  // 그리기 기준: 레인 바닥에 발을 맞춘다
  draw(r, sprites, grid, time) {
    let name = this.base.sprite, frame;
    if (this.state === 'jump') { name = 'zombie_jump'; frame = 0; }
    else if (this.state === 'attack' || this.state === 'eat') frame = Math.floor(this.anim * this.base.animFps * 0.6) % this.base.frames;
    else frame = Math.floor(this.anim * this.base.animFps) % this.base.frames;
    const swap = this.base.swap || null;
    const img = sprites.get(name, frame, swap, this.flash > 0);
    let bottom = grid.laneBottom(this.lane);
    if (this.laneTween > 0) { // 보스 레인 전환 보간
      const p = 1 - this.laneTween / this.laneTweenDur;
      bottom = Math.round(this.laneFromY + (bottom - this.laneFromY) * p);
    }
    const x = Math.round(this.x) - ((this.state === 'attack' || this.state === 'eat') ? (Math.floor(this.anim * 8) % 2) : 0);
    const y = bottom - this.h + this.yOff;
    // 그림자 (채도 낮은 어두운 초록)
    r.rect(x + this.hitL - 1, bottom - 1, this.hitR - this.hitL + 2, 1, 15);
    r.sprite(img, x, y);
    if (this.type === 'helmet' && this.helmetHp > 0) {
      r.sprite(sprites.get('helmet', this.helmetHp < this.maxHelmet * 0.5 ? 1 : 0, null, this.flash > 0), x + 3, y - 2);
    }
    if (this.slow > 0) { // 서리 표시
      const k = Math.floor(time * 6) % 3;
      r.rect(x + 2 + k * 4, y + 6 + (k % 2) * 8, 1, 1, 18);
      r.rect(x + this.w - 4 - k * 3, y + 12 - (k % 2) * 6, 1, 1, 18);
    }
    if (this.isBoss) { // 보스 체력 바 (머리 위)
      const w = 28, filled = Math.ceil(w * this.hp / this.maxHp);
      r.rect(x + 2, y - 4, w, 2, 25); r.rect(x + 2, y - 4, filled, 2, 26);
    }
    if (this.card) { // 확장: 단어 카드
      const cx = x + (this.w >> 1) - 7, cy = y - 10;
      r.sprite(sprites.get('card'), cx, cy);
      r.font?.draw(r.ctx, String(this.card.word).slice(0, 3), cx + 7, cy + 1, { color: 25, align: 'center' });
    }
  }
}
