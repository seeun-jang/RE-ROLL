// =====================================================
// 복서 (사람 / CPU 공용)
// 앞으로 걷기·대시 / 뒤로 걷기 = 가드 / 펀치 (톡 = 잽, 꾹 → 떼기 = 강펀치)
// 위치는 소수로 계산하고, 그릴 때 이전 프레임과 보간 + 정수 좌표로 반올림
// =====================================================

const ARM_SEG = 8.5; // 위팔 · 아래팔 길이 (1배 기준 px)

// 옆으로 눕힌 글러브 (잽 뻗을 때): 세운 글러브를 90도 돌려 만듦 (픽셀 안 깨짐)
const SIDE_GLOVE = {};
function sideGlove(key, f) {
  const id = key + f;
  if (SIDE_GLOVE[id]) return SIDE_GLOVE[id];
  const src = key === 'glow' ? SPR.gloveGlow : SPR.gloves[key];
  const c = document.createElement('canvas');
  c.width = src.height;
  c.height = src.width;
  const g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2);
  g.rotate((f === 1 ? 1 : -1) * Math.PI / 2); // 손목 밴드가 몸 쪽으로
  g.drawImage(src, -src.width / 2, -src.height / 2);
  SIDE_GLOVE[id] = c;
  return c;
}

class Fighter {
  constructor(player, corner) {
    this.player = player;       // 토너먼트 참가자 정보 (점수 기록용)
    this.index = player.index;
    this.def = player.def;
    this.name = player.name;
    this.color = player.color;
    this.corner = corner;       // 'red' (왼쪽) | 'blue' (오른쪽)
    this.facing = corner === 'red' ? 1 : -1;
    const R = CONFIG.RING;
    this.x = corner === 'red' ? R.LEFT + 48 : R.RIGHT - 48;
    this.px = this.x;           // 직전 프레임 위치 (보간용)
    this.vx = 0;
    this.hp = CONFIG.FIGHTER.HP;
    this.hpShown = this.hp;     // 체력바가 부드럽게 줄어드는 표시값
    this.state = 'idle';        // idle | walk | guard | charge | punch | stun | ko | win
    this.t = 0;                 // 현재 상태 경과 프레임
    this.punch = null;          // { kind, t, hit }
    this.chargeT = 0;
    this.stun = 0;
    this.flash = 0;
    this.squash = 0;
    this.lean = 0;              // 몸 기울기 (부드럽게 따라감)
    this.walkPhase = 0;
    this.lastFwdTap = -99;
    this.prevFwd = false;
    this.prevSkill = false;
    this.hits = 0;
    this.damageDealt = 0;
    // 글러브 위치 (몸 기준, 부드럽게 목표를 따라감)
    this.glove = { fx: 11, fy: -12, bx: 6, by: -11 };
    this.gloveP = { ...this.glove };
  }

  get spr() {
    return SPR.players[this.index];
  }

  get canAct() {
    return this.state === 'idle' || this.state === 'walk' || this.state === 'guard';
  }

  // ctrl: { left, right, skillHeld } — 사람은 키보드, CPU 는 AI 가 만들어 줌
  update(bout, ctrl, opp) {
    const F = CONFIG.FIGHTER;
    this.px = this.x;
    this.gloveP = { ...this.glove };
    this.t++;
    if (this.flash > 0) this.flash--;
    if (this.blockShake > 0) this.blockShake--;
    if (this.slipT > 0) this.slipT--;
    if (this.counterT > 0) this.counterT--;
    if (this.squash !== 0) this.squash -= Math.sign(this.squash);

    // 항상 상대를 바라봄
    if (this.state !== 'ko') this.facing = opp.x >= this.x ? 1 : -1;
    const fwdKey = this.facing === 1 ? ctrl.right : ctrl.left;
    const backKey = this.facing === 1 ? ctrl.left : ctrl.right;

    // 대시: 앞키 두 번 톡톡
    const fwdTap = fwdKey && !this.prevFwd;
    this.prevFwd = fwdKey;

    if (this.state === 'ko' || this.state === 'win' || bout.frozen) {
      this.vx *= F.FRICTION;
      this.move(bout);
      this.animateGloves(bout);
      this.prevSkill = ctrl.skillHeld;
      return;
    }

    if (this.state === 'stun') {
      this.stun--;
      if (this.stun <= 0) this.setState('idle');
    } else if (this.state === 'punch') {
      this.updatePunch(bout, opp);
    } else if (this.state === 'charge') {
      // 강펀치 모으는 중: 천천히만 움직일 수 있음
      this.chargeT++;
      // 꾹 누르는 동안에도 앞뒤로 움직일 수 있음 (조금 느리게)
      if (fwdKey && !backKey) this.vx += (this.facing * F.MAX_SPEED * F.CHARGE_MOVE - this.vx) * F.ACCEL;
      else if (backKey && !fwdKey) this.vx += (-this.facing * F.GUARD_SPEED * F.CHARGE_MOVE - this.vx) * F.ACCEL;
      else this.vx *= F.FRICTION;
      if (this.chargeT % 6 === 0) bout.particles.add(this.x + this.facing * 2 + (Math.random() * 8 - 4), CONFIG.RING.FLOOR_Y - 12, 0, -0.5, 16, C('9'), 1);
      if (!ctrl.skillHeld) this.startPunch(this.chargeT >= F.CHARGE_TIME ? 'power' : 'jab', bout);
    } else {
      // 이동 / 가드
      if (fwdTap && !backKey && bout.frame - this.lastFwdTap <= F.DASH_WINDOW) {
        this.vx = this.facing * F.DASH_SPEED;
        this.squash = -2;
        bout.game.audio.sfx('dash');
        bout.particles.burst(this.x - this.facing * 12, CONFIG.RING.FLOOR_Y - 2, 7, [C('k'), C('j')], 1, 14, 1);
        this.lastFwdTap = -99;
      } else if (fwdTap) this.lastFwdTap = bout.frame;

      if (ctrl.down) {
        // 가드: 가드 키 (제자리에서 막음)
        if (this.state !== 'guard') this.guardStart = bout.frame;
        this.setState('guard', true);
        this.vx *= F.FRICTION;
      } else if (backKey) {
        // 뒷걸음 (앞걸음과 같은 속도 · 막지는 않음)
        this.setState('walk', true);
        this.vx += (-this.facing * F.GUARD_SPEED - this.vx) * F.ACCEL;
      } else if (fwdKey) {
        this.setState('walk', true);
        this.vx += (this.facing * F.MAX_SPEED - this.vx) * F.ACCEL;
      } else {
        this.setState('idle', true);
        this.vx *= F.FRICTION;
      }
      // 펀치 키를 누르기 시작 → 모으기
      if (ctrl.skillHeld && !this.prevSkill) {
        this.setState('charge');
        this.chargeT = 0;
      }
    }
    this.prevSkill = ctrl.skillHeld;
    this.move(bout);
    this.animateGloves(bout);
  }

  setState(s, keepT = false) {
    if (this.state === s && keepT) return;
    this.state = s;
    this.t = 0;
  }

  move(bout) {
    const R = CONFIG.RING;
    this.x += this.vx;
    if (Math.abs(this.vx) < 0.02) this.vx = 0;
    // 로프에 닿으면 살짝 튕김
    if (this.x < R.LEFT) {
      this.x = R.LEFT;
      this.vx = Math.abs(this.vx) * 0.4;
    }
    if (this.x > R.RIGHT) {
      this.x = R.RIGHT;
      this.vx = -Math.abs(this.vx) * 0.4;
    }
    // 걷기 리듬
    this.walkPhase += Math.abs(this.vx) * 0.18;
    // 몸 기울기: 이동·펀치 방향으로 부드럽게
    let leanTarget = Math.max(-2, Math.min(2, this.vx * 1.2));
    if (this.state === 'punch') leanTarget = this.facing * (this.punch.kind === 'power' ? 3 : 2);
    if (this.state === 'guard') leanTarget = -this.facing * 1;
    if (this.state === 'stun') leanTarget = -this.facing * 2;
    this.lean += (leanTarget - this.lean) * 0.3;
  }

  startPunch(kind, bout) {
    this.setState('punch');
    this.punch = { kind, t: 0, hit: false };
    this.vx += this.facing * (kind === 'power' ? 1.6 : 0.6); // 체중을 실어 앞으로
    bout.game.audio.sfx(kind === 'power' ? 'whoosh' : 'swish');
  }

  updatePunch(bout, opp) {
    const P = CONFIG.PUNCH[this.punch.kind];
    const t = ++this.punch.t;
    this.vx *= 0.85;
    // 판정 구간
    if (!this.punch.hit && t > P.startup && t <= P.startup + P.active) {
      const dist = Math.abs(opp.x - this.x);
      if (dist <= P.range && opp.state !== 'ko') {
        this.punch.hit = true;
        bout.resolveHit(this, opp, this.punch.kind);
      }
    }
    if (t >= P.startup + P.active + P.recovery) this.setState('idle');
  }

  // 맞음
  takeHit(attacker, kind, bout) {
    const P = CONFIG.PUNCH[kind];
    const G = CONFIG.GUARD;
    const guarding = this.state === 'guard' && this.facing === -attacker.facing;
    let dmg = P.damage;
    const counter = attacker.counterT > 0;
    if (counter) {
      dmg *= CONFIG.COUNTER.COUNTER_MUL;
      attacker.counterT = 0;
    }
    let push = P.push;
    let blocked = false;
    const C2 = CONFIG.COUNTER;
    if (guarding && bout.frame - (this.guardStart || -99) <= C2.SLIP_WINDOW) {
      // 슥! 몸을 빼서 완전히 피함 → 카운터 찬스 · 헛친 상대는 비틀
      this.slipT = 14;
      this.counterT = C2.COUNTER_TIME;
      attacker.setState('stun');
      attacker.stun = C2.ATTACKER_STAGGER;
      this.vx = attacker.facing * 1.4; // 상대에게서 뒤로 빠짐
      return { dmg: 0, blocked: true, slip: true };
    }
    if (guarding) {
      blocked = true;
      this.blockShake = 8;
      dmg = Math.max(1, Math.round(dmg * G.DAMAGE_MUL));
      push *= G.PUSH_MUL;
      if (kind === 'power' && G.BREAK_POWER) {
        // 강펀치는 가드를 깨고 비틀거리게
        this.setState('stun');
        this.stun = 18;
      }
    } else {
      this.setState('stun');
      this.stun = P.stun;
      this.flash = 8;
      this.squash = 3;
    }
    this.hp = Math.max(0, this.hp - dmg);
    this.vx = attacker.facing * push;
    attacker.hits++;
    attacker.damageDealt += dmg;
    return { dmg, blocked, counter: counter && !blocked };
  }

  // 글러브 목표 위치 (몸 기준, 앞쪽이 +)
  // 글러브 목표 위치 (몸 기준, 앞쪽이 + · 발 위치에서 위로 -)
  //  팔이 어깨에 붙어 있어서 글러브는 항상 몸 가까이 · 펀치 때만 쭉 뻗음
  // 손목(글러브를 낀 손) 목표 위치 · 어깨 위치 (몸 기준, 앞쪽이 + · 발에서 위로 -)
  //  캐릭터는 2등신: 발~20px = 몸통, 그 위는 얼굴 → 어깨는 몸통 위쪽(-18)
  //  팔 길이(위팔 + 아래팔)는 정해져 있어서 손이 몸에서 떨어져 떠다니지 않음
  // 그림 속 손 · 소매 위치 (몸 기준 좌표: 앞쪽 + · 발에서 위로 -)
  get hands() {
    if (this._hands) return this._hands;
    const H = HANDS[this.def.id];
    const img = this.spr.frames[0];
    const rel = (p) => ({ x: p[0] - img.width / 2, y: p[1] - img.height });
    this._hands = { fc: rel(H.R.c), fr: rel(H.R.root), bc: rel(H.L.c), br: rel(H.L.root), arm: H.arm };
    return this._hands;
  }

  // 손목(글러브) 목표 위치: 평소엔 그림 속 원래 손 자리 · 가드 · 펀치 때만 움직임
  animateGloves(bout) {
    const S = CONFIG.SCALE;
    const hd = this.hands;
    let fx = hd.fc.x, fy = hd.fc.y; // 앞손
    let bx = hd.bc.x, by = hd.bc.y; // 뒷손
    this.fistSide = false;
    if (this.state === 'guard') {
      // 가드: 두 글러브를 얼굴 앞으로 올려 붙임
      fx = 9; fy = -21; bx = 2; by = -22;
    } else if (this.state === 'charge') {
      bx = hd.bc.x - 2; by = hd.bc.y + 3; // 뒷손을 더 내려 힘을 모음
      fx = hd.fc.x - 2; fy = hd.fc.y - 6; // 앞손은 살짝 올려 지킴
    } else if (this.state === 'punch') {
      const P = CONFIG.PUNCH[this.punch.kind];
      const t = this.punch.t;
      let ext;
      if (t <= P.startup) ext = -0.3 * Math.sin((t / P.startup) * Math.PI);
      else if (t <= P.startup + P.active) ext = 1 - Math.pow(1 - Math.min(1, ((t - P.startup) / P.active) * 1.6), 3);
      else {
        const u = (t - P.startup - P.active) / P.recovery;
        ext = 1 - u * u * (3 - 2 * u);
      }
      const e = Math.max(0, ext);
      const reach = Math.min(P.range / S - 6, 30);
      if (this.punch.kind === 'jab') {
        // 잽: 원래 손 자리에서 상대 턱 쪽으로 쭉
        fx = hd.fc.x + ext * (reach - hd.fc.x);
        fy = hd.fc.y + e * (-17 - hd.fc.y);
        this.fistSide = e > 0.35;
        bx = hd.bc.x; by = hd.bc.y - 4;
      } else {
        // 어퍼컷: 뒷손이 몸 앞으로 둥글게 돌아 올라가 턱을 침
        const a = (e * Math.PI) / 2;
        bx = ext < 0 ? hd.bc.x - 1 : hd.bc.x + Math.sin(a) * (reach - hd.bc.x);
        by = ext < 0 ? hd.bc.y + 2 : hd.bc.y - (1 - Math.cos(a)) * (hd.bc.y + 24);
        fx = hd.fc.x - 2; fy = hd.fc.y - 6;
      }
    } else if (this.state === 'stun') {
      fx = hd.fc.x; fy = hd.fc.y + 3; bx = hd.bc.x; by = hd.bc.y + 3; // 축 늘어짐
    } else if (this.state === 'win') {
      const pump = Math.abs(Math.sin(bout.frame / 8)) * 2;
      fx = hd.fr.x + 2; fy = -36 - pump; bx = hd.br.x - 2; by = -36 - pump; // 만세
    }
    const breath = ((bout.frame / 14) | 0) % 2;
    fy += breath * 0.5;
    by += breath * 0.5;
    const k = this.state === 'punch' ? 0.8 : 0.35;
    this.glove.fx += (fx - this.glove.fx) * k;
    this.glove.fy += (fy - this.glove.fy) * k;
    this.glove.bx += (bx - this.glove.bx) * k;
    this.glove.by += (by - this.glove.by) * k;
  }

  // alpha: 로직 프레임 사이 보간 비율
  render(ctx, bout, alpha) {
    const R = CONFIG.RING;
    const x = this.px + (this.x - this.px) * alpha;
    const ix = Math.round(x + this.lean * CONFIG.SCALE);
    const fy = R.FLOOR_Y;
    // 발 위치를 기준으로 2배 확대해서 그림 (아래 좌표는 모두 1배 기준)
    ctx.save();
    ctx.translate(ix, fy);
    ctx.scale(CONFIG.SCALE, CONFIG.SCALE);
    ctx.translate(-ix, -fy);
    this.draw1x(ctx, bout, x, ix, fy, alpha);
    ctx.restore();
  }

  draw1x(ctx, bout, x, ix, fy, alpha) {
    const gl = {
      fx: this.gloveP.fx + (this.glove.fx - this.gloveP.fx) * alpha,
      fy: this.gloveP.fy + (this.glove.fy - this.gloveP.fy) * alpha,
      bx: this.gloveP.bx + (this.glove.bx - this.gloveP.bx) * alpha,
      by: this.gloveP.by + (this.glove.by - this.gloveP.by) * alpha,
    };
    const gloveImg = this.state === 'charge' && this.chargeT >= CONFIG.FIGHTER.CHARGE_TIME && bout.frame % 6 < 3 ? SPR.gloveGlow : SPR.gloves[this.corner];
    const f = this.facing;

    // 그림자
    ctx.fillStyle = C('j');
    ctx.fillRect(Math.round(x) - 12, fy - 1, 24, 2);

    if (this.state === 'ko') {
      // 다운: 90도 눕기 (90도 회전은 픽셀이 깨지지 않음)
      const img = this.spr.frames[0];
      ctx.save();
      ctx.translate(ix, fy - 6);
      ctx.rotate((-f * Math.PI) / 2);
      ctx.drawImage(img, -Math.round(img.width / 2), -img.height + 6);
      ctx.restore();
      for (let i = 0; i < 3; i++) {
        const a = bout.frame / 10 + (i * Math.PI * 2) / 3;
        drawSprite(ctx, SPR.star, ix + Math.cos(a) * 10, fy - 20 + Math.sin(a) * 3);
      }
      return;
    }

    // 몸: 걷기 리듬 + 숨쉬기 + 맞으면 번쩍 (팔 · 글러브도 같이 출렁)
    const walking = this.state === 'walk' || Math.abs(this.vx) > 0.3;
    const bounce = walking ? Math.round(Math.abs(Math.sin(this.walkPhase)) * 2) : 0;
    const hd = this.hands;
    // 팔 한 개: 소매 끝(그림) → 손목. 손목이 원래 자리면 팔은 안 보이고 글러브만 손에 낌
    // part: 'arm' 팔만 · 'glove' 글러브만 · 없으면 둘 다
    const limb = (root, wx, wy, side, part) => {
      const R = Math.round;
      const sx = ix + f * root.x;
      const sy = fy + root.y - bounce;
      let hx = ix + f * wx;
      let hy = fy + wy - bounce;
      let dx = hx - sx;
      let dy = hy - sy;
      const d = Math.hypot(dx, dy);
      const maxD = 26; // 팔 길이
      if (d > maxD) {
        hx = sx + (dx / d) * maxD;
        hy = sy + (dy / d) * maxD;
      }
      if (d > 2.5 && part !== 'glove') {
        // 그림 팔처럼: 진한 외곽선 + 소매 색 → 손목 쪽은 털 색
        const mx = sx + (hx - sx) * 0.6;
        const my = sy + (hy - sy) * 0.6;
        drawPixelLine(ctx, R(sx), R(sy), R(hx), R(hy), C('1'), 5);
        drawPixelLine(ctx, R(sx), R(sy), R(mx), R(my), C(hd.arm[0]), 3);
        drawPixelLine(ctx, R(mx), R(my), R(hx), R(hy), C(hd.arm[1]), 3);
      }
      if (part === 'arm') return;
      const glow = (this.state === 'charge' && this.chargeT >= CONFIG.FIGHTER.CHARGE_TIME && bout.frame % 6 < 3) || (this.counterT > 0 && bout.frame % 6 < 3);
      const key = glow ? 'glow' : this.corner;
      if (side) {
        const g = sideGlove(key, f);
        ctx.drawImage(g, R(f === 1 ? hx - 3 : hx - g.width + 3), R(hy - g.height / 2));
      } else {
        const g = glow ? SPR.gloveGlow : SPR.gloves[this.corner];
        ctx.drawImage(g, R(hx - g.width / 2), R(hy - g.height / 2));
      }
    };
    const jit = this.blockShake > 0 ? (bout.frame % 2 ? 1 : -1) : 0; // 막을 때 덜덜
    // 뒷팔은 몸 뒤로 지나감 (얼굴을 가로지르지 않게)
    limb(hd.br, gl.bx + jit * 0.5, gl.by, false, 'arm');
    const breath = ((bout.frame / 14) | 0) % 2;
    let img = this.flash > 0 && bout.frame % 4 < 2 ? this.spr.noHandFlash : this.spr.noHand[breath];
    ctx.save();
    if (f === -1) {
      ctx.translate(ix * 2, 0);
      ctx.scale(-1, 1);
    }
    const crouch = this.state === 'guard' ? 1 : 0; // 가드: 몸을 살짝 웅크림
    const slip = this.slipT > 0 ? Math.round(Math.sin((this.slipT / 14) * Math.PI) * 4) : 0;
    if (slip) {
      // 슥: 원래 자리에 잔상 · 몸은 뒤로 빠지며 숙임
      ctx.globalAlpha = 0.35;
      drawStanding(ctx, this.spr.ghost, ix + slip, fy - bounce, 0);
      ctx.globalAlpha = 1;
    }
    drawStanding(ctx, img, ix - slip, fy - bounce + slip / 2, this.squash - crouch - slip);
    ctx.restore();
    // 두 팔 모두 몸 앞: 뒷손(가운데) 먼저 → 앞손(앞쪽) 위에
    // 뒷손 글러브 → 앞팔 + 앞손 글러브 (몸 앞)
    limb(hd.br, gl.bx + jit * 0.5, gl.by, false, 'glove');
    limb(hd.fr, gl.fx + jit, gl.fy, this.fistSide);
  }
}
