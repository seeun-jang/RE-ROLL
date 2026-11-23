// =====================================================
// 플레이: 5사로 동시 실거리 사격
//  통제관 방송: 사수 준비 → 탄알집 결합 → 조정간 단발 → 준비된 사수부터 사격 개시
//  표적 20개가 100 · 200 · 250m 에서 하나씩 올라옴 (모든 사로 같은 순서)
//  방향키 4개로 조준 (놓으면 그 자리) · 발사 키로 격발 · 가만히 조준하면 흔들림이 줄어듦
//  10발 쏘면 탄알집 교체 · 끝나면 사격 끝 → 조정간 안전 → 등급 발표
// =====================================================
const BRIEF = [
  [0, '사수 준비!'],
  [80, '탄알집 결합!'],
  [160, '조정간 단발!'],
  [240, '준비된 사수부터 사격 개시!'],
];
const BRIEF_END = 300;
const CEASE = [
  [0, '사격 끝! 사격 끝!'],
  [90, '조정간 안전! 탄알집 제거!'],
];
const CEASE_END = 230;

class PlayScene {
  // opts: { mode, count, charIdx, embed, autoplay }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    const personal = opts.mode === 'personal';
    const n = personal ? CONFIG.MAX_PLAYERS : opts.count;
    this.players = [];
    for (let i = 0; i < n; i++) {
      const human = !opts.autoplay && (personal ? i === opts.charIdx : true);
      const [s0, s1] = CONFIG.CPU_SKILL;
      this.players.push({
        slot: i,
        index: i,
        def: CHARACTERS[i],
        name: CHARACTERS[i].name,
        human,
        bot: human ? null : new RangeBot(opts.autoplay ? 0.3 + Math.random() * 0.65 : s0 + Math.random() * (s1 - s0)),
        ax: 0,
        ay: CONFIG.AIM_START_Y,
        kick: 0,  // 반동 (조준점이 잠깐 튀어 오름)
        still: 0, // 조준점을 가만히 둔 시간
        sx: 0,
        sy: 0,
        cooldown: 0,
        mag: CONFIG.MAG_SIZE,
        spare: Math.ceil(CONFIG.TARGETS / CONFIG.MAG_SIZE) - 1,
        reloadT: 0,
        shots: 0,
        hits: 0,
        quick: 0,
        hitK: -1,
        fallT: 0,
        flash: 0,
        phase: Math.random() * 10,
        msg: null,
        record: [], // 표적마다 명중 여부
        streak: 0,  // 연속 명중
        shake: 0,   // 맞힌 순간 사로 화면 흔들림
        place: null,
      });
    }
    this.colX0 = Math.round((CONFIG.WIDTH - n * RANGE.COL_W) / 2);
    this.lanes = this.makeLanes(personal);
    this.schedule = makeSchedule();
    this.phase = 'brief'; // brief | fire | cease | end
    this.t = 0;
    this.k = 0;
    this.tPhase = 'gap'; // gap | rise | up | fall
    this.tT = 0;
    this.tower = null; // 통제관 방송 { text, t }
    this.frame = 0;
    this.particles = new ParticleSystem();
    this.paused = false;
    this.pauseSel = 0;
  }

  // 사로 칸 배치: x · w(화면 폭) · s(확대) · top(화면 y) · crop(사로 그림에서 잘라낼 위쪽)
  //  개인 화면이면 내 사로를 2배로 크게 (이름표 줄까지 차지), 나머지 CPU 4칸은 좁게
  makeLanes(personal) {
    const n = this.players.length;
    if (!personal || this.opts.autoplay) {
      return this.players.map((p, i) => ({ x: this.colX0 + i * RANGE.COL_W, w: RANGE.COL_W, s: 1, top: RANGE.VIEW_Y, crop: 0 }));
    }
    const ZW = 128;
    const ow = Math.floor((CONFIG.WIDTH - ZW) / (n - 1));
    let x = 0;
    return this.players.map((p) => {
      const L = p.human ? { x, w: ZW, s: 2, top: 15, crop: 16 } : { x, w: ow, s: 1, top: RANGE.VIEW_Y, crop: 0 };
      x += L.w;
      return L;
    });
  }

  // 사로 그림 좌표 (lx: 0~64, ly: 0~96) → 화면 좌표
  toScreen(p, lx, ly) {
    const L = this.lanes[p.slot];
    return { x: L.x + L.w / 2 + L.s * (lx - RANGE.COL_W / 2), y: L.top + L.s * (ly - L.crop) };
  }

  enter() {
    this.game.audio.playBgm('game');
  }

  get target() {
    return this.phase === 'fire' ? this.schedule[this.k] : null;
  }

  say(text) {
    this.tower = { text, t: 0 };
    this.game.audio.sfx('radio');
  }

  score(p) {
    return p.hits * CONFIG.HIT_POINTS + p.quick;
  }

  // 이 사로에서 지금 표적이 얼마나 올라와 있나 (0~1)
  riseFor(p) {
    if (this.phase !== 'fire') return 0;
    if (p.hitK === this.k) return Math.max(0, 1 - p.fallT / CONFIG.RISE_TIME);
    const R = CONFIG.RISE_TIME;
    return { gap: 0, rise: this.tT / R, up: 1, fall: 1 - this.tT / R }[this.tPhase];
  }

  inputOf(p) {
    if (!p.human) return p.bot.think(p, this);
    const input = this.game.input;
    return this.opts.mode === 'personal' ? input.solo(p.index) : input.player(p.index);
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    if (this.phase !== 'end' && input.anyPressed(['KeyP', 'Escape'])) {
      this.paused = !this.paused;
      this.pauseSel = 0;
      audio.sfx('pause');
    }
    if (this.paused) {
      if (input.anyPressed(['ArrowUp', 'ArrowDown'])) {
        this.pauseSel = 1 - this.pauseSel;
        audio.sfx('select');
      }
      if (input.anyPressed(['Space', 'Enter'])) {
        audio.sfx('select');
        if (this.pauseSel === 0) this.paused = false;
        else this.game.changeScene(() => new TitleScene(this.game), 'fade');
      }
      return;
    }
    this.frame++;
    this.t++;
    this.particles.update();
    if (this.tower) this.tower.t++;

    if (this.phase === 'brief') {
      for (const [at, text] of BRIEF) if (this.t === at + 1) this.say(text);
      if (this.t === 160) audio.sfx('lock'); // 조정간 딸깍
      if (this.t >= BRIEF_END) {
        this.phase = 'fire';
        this.tPhase = 'gap';
        this.tT = 0;
      }
    } else if (this.phase === 'fire') this.updateTargets();
    else if (this.phase === 'cease') {
      for (const [at, text] of CEASE) if (this.t === at + 1) this.say(text);
      if (this.t === 100) audio.sfx('lock');
      if (this.t >= CEASE_END) {
        this.phase = 'end';
        this.t = 0;
        const rows = buildResult(this.opts.mode, this.players).ranking;
        for (const r of rows) this.players.find((p) => p.slot === r.seat).place = r.rank;
        audio.sfx('win');
      }
    } else if (this.phase === 'end') {
      if (this.t === 150) this.game.changeScene(() => new ResultScene(this.game, this.players, this.opts), 'circle');
    }
    for (const p of this.players) this.updateLane(p, this.phase === 'end' ? {} : this.inputOf(p));
  }

  // 표적 올라옴 → 서 있음 → 내려감 → 다음 표적
  updateTargets() {
    const audio = this.game.audio;
    const tg = this.schedule[this.k];
    this.tT++;
    if (this.tPhase === 'gap' && this.tT >= CONFIG.TARGET_GAP) {
      this.tPhase = 'rise';
      this.tT = 0;
      audio.sfx('popup');
      if (this.k === CONFIG.TARGETS / 2) this.say('탄알집 교체 후 계속 사격!');
    } else if (this.tPhase === 'rise' && this.tT >= CONFIG.RISE_TIME) {
      this.tPhase = 'up';
      this.tT = 0;
    } else if (this.tPhase === 'up') {
      // 모든 사로가 맞혔거나 탄이 없으면 조금 일찍 내림
      const allDone = this.players.every((p) => p.hitK === this.k || (p.mag === 0 && p.spare === 0 && p.reloadT === 0));
      if (this.tT >= tg.time || (allDone && this.tT > 25)) {
        this.tPhase = 'fall';
        this.tT = 0;
      }
    } else if (this.tPhase === 'fall' && this.tT >= CONFIG.RISE_TIME) {
      for (const p of this.players) {
        p.record[this.k] = p.hitK === this.k;
        if (p.hitK !== this.k) p.streak = 0; // 못 맞히고 표적이 내려가면 연속 끊김
      }
      this.k++;
      this.tPhase = 'gap';
      this.tT = 0;
      if (this.k >= CONFIG.TARGETS) {
        this.phase = 'cease';
        this.t = 0;
      }
    }
  }

  updateLane(p, inp) {
    if (p.cooldown > 0) p.cooldown--;
    if (p.flash > 0) p.flash--;
    if (p.shake > 0) p.shake--;
    if (p.msg && ++p.msg.t > 45) p.msg = null;
    if (p.hitK === this.k) p.fallT++;
    // 탄알집 교체
    if (p.reloadT > 0) {
      p.reloadT--;
      if (p.reloadT === 0) {
        p.mag = CONFIG.MAG_SIZE;
        p.spare--;
      }
    }
    // 방향키 4개로 조준 (놓으면 그 자리에 멈춤)
    const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    p.ax = Math.max(-CONFIG.AIM_RANGE, Math.min(CONFIG.AIM_RANGE, p.ax + dx * CONFIG.AIM_SPEED_X));
    p.ay = Math.max(CONFIG.AIM_TOP_Y, Math.min(CONFIG.AIM_BOTTOM_Y, p.ay + dy * CONFIG.AIM_SPEED_Y));
    p.still = dx || dy ? 0 : p.still + 1;
    p.kick *= 0.82;
    // 호흡 흔들림 (가만히 조준하고 있으면 숨이 골라져서 덜 흔들림)
    const amp = CONFIG.SWAY * (p.still > CONFIG.STEADY_TIME ? CONFIG.STEADY_SWAY : 1);
    const f = this.frame + p.phase * 60;
    p.sx = Math.sin(f * 0.047 + p.phase) * amp + Math.sin(f * 0.13) * 0.4 * amp;
    p.sy = Math.sin(f * 0.035 + p.phase * 2) * amp * 1.1;
    // 발사 키
    if (inp.skillPressed) this.fire(p);
  }

  // 지금 실제 조준점 (흔들림 + 반동 포함)
  aimOf(p) {
    return { x: p.ax + p.sx, y: p.ay - p.kick + p.sy };
  }

  fire(p) {
    const audio = this.game.audio;
    if (this.phase !== 'fire' || p.cooldown > 0 || p.reloadT > 0) return;
    if (p.mag === 0) {
      audio.sfx('dry');
      return;
    }
    const { x: px, y: py } = this.aimOf(p);
    p.mag--;
    p.shots++;
    p.flash = 6;
    p.cooldown = CONFIG.FIRE_COOLDOWN;
    p.kick += CONFIG.RECOIL; // 반동: 튀어 올랐다가 제자리로
    audio.sfx('rifle');
    audio.sfx('casing');
    // 탄피 (오른쪽으로 튐)
    const sp = this.toScreen(p, RANGE.COL_W / 2 + px, py);
    const gx = sp.x;
    this.particles.add(gx + 4, sp.y + 8, 1.2 + Math.random() * 0.6, -1.4, 26, C('8'), 2, 0.15);
    // 명중 판정
    const tg = this.schedule[this.k];
    const rise = this.riseFor(p);
    let hit = false;
    if (p.hitK !== this.k && rise >= 0.5) {
      const r = targetRect(tg, rise);
      hit = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; // 여유 없이 딱 표적 안만
    }
    if (hit) {
      p.hits++;
      const react = this.tPhase === 'up' ? this.tT : 0;
      p.quick += Math.max(0, CONFIG.QUICK_MAX - Math.floor(react / CONFIG.QUICK_STEP));
      p.hitK = this.k;
      p.fallT = 0;
      p.streak++;
      p.shake = 6;
      p.msg = { text: p.streak >= 2 ? `${p.streak}연속!` : '명중!', color: p.streak >= 3 ? '8' : '9', t: 0 };
      this.particles.burst(gx, sp.y, 10, [C('b'), C('9'), C('k')], 1.1, 18, 1);
      // 표적 밑 흙먼지 (뒤로 넘어가면서)
      const D = CONFIG.DISTANCES[tg.dist];
      const base = this.toScreen(p, RANGE.COL_W / 2 + tg.x, D.y);
      this.particles.burst(base.x, base.y - 1, 8, [C('m'), C('n'), C('l')], 0.7, 24, 1, -0.02);
      audio.sfx('ping');
    } else {
      // 빗나감: 흙먼지
      if (py > 20) this.particles.burst(gx, sp.y, 6, [C('m'), C('n'), C('l')], 0.6, 20, 1, -0.02);
      p.msg = { text: '빗나감', color: 'k', t: 0 };
    }
    // 탄알집이 비면 자동으로 교체
    if (p.mag === 0 && p.spare > 0) {
      p.reloadT = CONFIG.RELOAD_TIME;
      audio.sfx('reload');
    }
  }

  // ---------------- 그리기 ----------------
  render(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    for (const p of this.players) this.renderLane(ctx, p);
    this.particles.render(ctx);
    if (!this.demo) this.renderTower(ctx);
    if (this.paused) {
      ctx.fillStyle = ctx.createPattern(Transition.patterns[10], 'repeat');
      ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
      drawPanel(ctx, 110, 55, 100, 70, 'default');
      KText.draw(ctx, '일시정지', W / 2, 62, C('9'), { align: 'center', font: 'b', outline: C('1') });
      ['계속하기', '타이틀로'].forEach((s, i) => {
        const sel = this.pauseSel === i;
        KText.draw(ctx, (sel ? '▶ ' : '') + s, W / 2, 84 + i * 16, sel ? C('9') : C('j'), { align: 'center', font: 'b' });
      });
    }
  }

  // 위: 통제탑 방송 + 표적 번호
  renderTower(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 14);
    ctx.fillStyle = C('c');
    ctx.fillRect(0, 13, W, 1);
    // 확성기 아이콘
    const on = this.tower && this.tower.t < 90;
    ctx.fillStyle = C(on && this.frame % 16 < 8 ? '9' : 'j');
    ctx.fillRect(4, 5, 3, 4);
    ctx.fillRect(7, 3, 2, 8);
    KText.draw(ctx, '통제관', 12, 1, C('j'), { font: 'n' });
    if (this.tower) KText.draw(ctx, this.tower.text, 46, 1, on ? C('9') : C('k'), { font: 's' });
    const info = this.phase === 'fire' ? `표적 ${this.k + 1}/${CONFIG.TARGETS}` : this.phase === 'brief' ? '준비' : '사격 끝';
    KText.draw(ctx, info, W - 4, 1, C('a'), { font: 'n', align: 'right' });
  }

  renderLane(ctx, p) {
    const L = this.lanes[p.slot];
    const me = this.opts.mode === 'personal' && p.human;
    const zoom = L.s > 1;
    const viewH = 129 - L.top;
    if (!zoom && L.w >= 60) drawNameCard(ctx, L.x + 2, 15, L.w - 4, { def: p.def, name: p.name, index: p.index, place: this.phase === 'end' ? p.place : null }, this.frame);
    else if (!zoom) {
      // 좁은 칸 (개인 화면의 CPU): 얼굴 + 이름 (넘치면 줄임)
      drawCard(ctx, L.x + 1, 15, L.w - 2, 17, p.def.color, DARK_OF[p.def.color] || '3');
      ctx.drawImage(SPR.players[p.index].face, L.x + 2, 15);
      let nm = p.name;
      while (KText.width(nm, 'n') > L.w - 24 && nm.length > 1) nm = nm.slice(0, -1);
      KText.draw(ctx, nm, L.x + 21, 18, C('1'), { font: 'n' });
    }
    // 사로 그림 (칸 밖으로 안 나가게 자름) — 사로 좌표계로 옮겨서 그림
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x, L.top, L.w, viewH);
    ctx.clip();
    const sh = p.shake > 0 ? ((p.shake & 1) ? 1 : -1) : 0;
    ctx.translate(L.x + L.w / 2 - L.s * RANGE.COL_W / 2 + sh, L.top - L.s * (L.crop + RANGE.VIEW_Y));
    ctx.scale(L.s, L.s);
    drawRangeBg(ctx, 0, this.frame, L.x);
    const tg = this.schedule[Math.min(this.k, CONFIG.TARGETS - 1)];
    const rise = this.riseFor(p);
    const hitNow = p.hitK === this.k && this.phase === 'fire';
    for (const d of [250, 200, 100]) {
      if (tg && tg.dist === d) drawTarget(ctx, 0, tg, rise, hitNow && p.fallT < 6, hitNow);
      drawBerm(ctx, 0, d, L.w >= 60);
    }
    drawSandbags(ctx, 0);
    if (this.phase !== 'end') {
      const a = this.aimOf(p);
      drawRifle(ctx, 0, a.x, a.y, p.flash);
    }
    if (!zoom && L.w >= 60) {
      ctx.fillStyle = C('1');
      ctx.fillRect(49, RANGE.VIEW_Y + 85, 13, 10);
      ctx.fillStyle = C('a');
      ctx.fillRect(50, RANGE.VIEW_Y + 86, 11, 8);
      BitmapFont.draw(ctx, String(p.slot + 1), 55, RANGE.VIEW_Y + 88, C('1'), { align: 'center' });
    }
    ctx.restore();

    // ---- 여기부터 화면 좌표 (확대해도 글씨는 그대로) ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x, L.top, L.w, viewH);
    ctx.clip();
    const cx = L.x + L.w / 2;
    // 명중 / 빗나감: 하늘 쪽에 어두운 띠 + 글자 (표적을 안 가림)
    if (p.msg) {
      const font = 'b';
      const tw = KText.width(p.msg.text, font);
      const ty = L.top + 2 - Math.max(0, 4 - p.msg.t);
      ctx.fillStyle = C('1');
      ctx.fillRect(Math.round(cx - tw / 2 - 3), ty, tw + 6, 14);
      KText.draw(ctx, p.msg.text, cx, ty, C(p.msg.color), { align: 'center', font });
    }
    // 탄알집 교체: 사로 아래쪽에 작은 띠 + 진행 막대
    if (p.reloadT > 0) {
      const by = L.top + viewH - 22;
      ctx.fillStyle = C('1');
      ctx.fillRect(L.x + 3, by, L.w - 6, 18);
      KText.draw(ctx, L.w >= 60 ? '탄알집 교체' : '교체', cx, by, C('9'), { align: 'center', font: 'n' });
      const prog = 1 - p.reloadT / CONFIG.RELOAD_TIME;
      ctx.fillStyle = C('2');
      ctx.fillRect(L.x + 6, by + 13, L.w - 12, 3);
      ctx.fillStyle = C('9');
      ctx.fillRect(L.x + 6, by + 13, Math.round((L.w - 12) * prog), 3);
    }
    // 확대한 내 사로: 이름 꼬리표 (왼쪽 아래)
    if (zoom) {
      const tag = `${p.name} · 나`;
      const tw = KText.width(tag, 'n');
      ctx.fillStyle = C('1');
      const tx = L.x + L.w - tw - 8;
      ctx.fillRect(tx, L.top + viewH - 12, tw + 8, 12);
      ctx.fillStyle = C(p.def.color);
      ctx.fillRect(tx, L.top + viewH - 12, 2, 12);
      KText.draw(ctx, tag, tx + 5, L.top + viewH - 12, C(p.def.color), { font: 'n' });
    }
    // 끝나면 등급 발표
    if (this.phase === 'end' || (this.phase === 'cease' && this.t > 140)) {
      const g = gradeOf(p.hits);
      const my = L.top + Math.round(viewH / 2) - 20;
      ctx.fillStyle = DITHER.get(ctx, 'o', 8);
      ctx.fillRect(L.x, L.top, L.w, viewH);
      KText.draw(ctx, `${p.hits}/${CONFIG.TARGETS}`, cx, my, C('b'), { align: 'center', font: 'b', outline: C('1') });
      drawGradeBadge(ctx, cx, my + 18, g, L.w - 8);
    }
    ctx.restore();
    if (me) {
      ctx.fillStyle = C('9');
      ctx.fillRect(L.x, L.top, 1, viewH);
      ctx.fillRect(L.x + L.w - 1, L.top, 1, viewH);
    }
    // 아래 정보줄: 남은 탄 (탄알집) · 예비 탄알집 · 명중 수
    ctx.fillStyle = C('1');
    ctx.fillRect(L.x, 129, L.w, 13);
    ctx.fillStyle = C('2');
    ctx.fillRect(L.x + L.w - 1, 129, 1, 13);
    drawAmmo(ctx, L.x + 2, 131, p.mag, CONFIG.MAG_SIZE);
    for (let i = 0; i < p.spare; i++) {
      ctx.fillStyle = C('j');
      ctx.fillRect(L.x + 33 + i * 4, 130, 3, 8);
      ctx.fillStyle = C('k');
      ctx.fillRect(L.x + 33 + i * 4, 130, 3, 1);
    }
    const hitTxt = L.w >= 60 ? `명중 ${p.hits}` : String(p.hits);
    KText.draw(ctx, hitTxt, L.x + L.w - 2, 128, C('9'), { font: 'n', align: 'right' });
    // 명중 기록판: 표적 20개 — 맞힘 초록 · 놓침 빨강 · 지금 표적 깜빡 · 아직 회색
    const st = L.w >= 62 ? 3 : 2;
    const recW = CONFIG.TARGETS * st + 3 * (st === 2 ? 1 : 0);
    let rx = Math.round(L.x + (L.w - recW) / 2);
    for (let k = 0; k < CONFIG.TARGETS; k++) {
      if (st === 2 && k > 0 && k % 5 === 0) rx++;
      let col = '2';
      if (k < this.k || this.phase !== 'fire' && this.phase !== 'brief') col = p.record[k] ? 'e' : p.record[k] === false ? '6' : '2';
      if (k === this.k && this.phase === 'fire') col = p.hitK === k ? 'e' : this.frame % 30 < 15 ? '9' : '2';
      ctx.fillStyle = C(col);
      ctx.fillRect(rx + k * st, 139, 2, 2);
    }
    // 조작키 (사람) · 엎드려 쏴 모습 (CPU)
    if (p.human) {
      const input = this.game.input;
      const solo = this.opts.mode === 'personal';
      const inp = solo ? input.solo(p.index) : input.player(p.index);
      drawKeyCluster(ctx, L.x + L.w / 2, 142, solo ? SOLO_CAPS : KEYMAP[p.index].keys, inp, L.x, L.x + L.w);
    } else {
      drawProne(ctx, L.x + L.w / 2, 172, p.index, p.flash, this.frame);
      BitmapFont.draw(ctx, 'CPU', L.x + 3, 147, C('i'));
    }
  }
}

// 사격 등급 배지: 어두운 바탕 + 등급 색 테두리 + 등급 색 글자 (칸 폭에 맞춰 글꼴 줄임)
function drawGradeBadge(ctx, cx, y, g, maxW) {
  let font = 'b';
  if (KText.width(g.name, font) + 10 > maxW) font = 'n';
  const tw = KText.width(g.name, font);
  const w = tw + 10;
  const x = Math.round(cx - w / 2);
  ctx.fillStyle = C(g.color);
  ctx.fillRect(x, y, w, 15);
  ctx.fillStyle = C('1');
  ctx.fillRect(x + 1, y + 1, w - 2, 13);
  KText.draw(ctx, g.name, cx, y + (font === 'b' ? 1 : 2), C(g.color), { align: 'center', font });
}
