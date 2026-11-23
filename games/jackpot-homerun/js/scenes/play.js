// =====================================================
// 플레이: 한 명씩 타석 → 같은 순서의 공 8기회 → 점수 합계로 대결
//  타자 소개 → 중계 화면에서 타격 → 맞으면 타구 화면 (홈런이면 불꽃) → 다음 타자 … → 시상
//  개인 화면: 나만 치고, CPU 4명은 같은 공으로 미리 쳐 둠 (내가 끝나면 공개)
// =====================================================
class PlayScene {
  // opts: { mode, count, charIdx, embed, autoplay, seed }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    const personal = opts.mode === 'personal';
    const n = personal ? CONFIG.MAX_PLAYERS : opts.count;
    const seed = opts.seed != null ? opts.seed : personal ? dateSeed() : (Math.random() * 1e9) | 0;
    this.pitches = makePitches(seed);
    this.players = [];
    for (let i = 0; i < n; i++) {
      const human = !opts.autoplay && (personal ? i === opts.charIdx : true);
      const rng = mulberry32(seed + 31 + i * 977);
      const [s0, s1] = CONFIG.CPU_SKILL;
      this.players.push({
        slot: i,
        index: i,
        def: CHARACTERS[i],
        name: CHARACTERS[i].name,
        human,
        bot: human ? null : new BatBot(s0 + rng() * (s1 - s0), rng),
        ab: null,
        done: false,
      });
    }
    this.order = personal ? [this.players.find((p) => p.human)] : [...this.players];
    // 개인 화면: CPU 기록은 같은 공으로 바로 계산
    if (personal) for (const p of this.players) if (!p.human) this.simulate(p);
    this.turn = 0;
    this.phase = 'intro'; // intro | bat | flight | summary | end
    this.t = 0;
    this.frame = 0;
    this.call = null; // 화면 가운데 판정 글자
    this.fl = null; // 타구 연출
    this.flash = 0;
    this.crowd = 0;
    this.particles = new ParticleSystem();
    this.paused = false;
    this.pauseSel = 0;
  }

  enter() {
    this.game.audio.playBgm('game');
  }

  get cur() {
    return this.order[this.turn];
  }

  simulate(p) {
    const ab = new AtBat(this.pitches);
    for (let t = 0; t < 30000 && !ab.done; t++) {
      ab.update(p.bot.think(ab));
      if (ab.phase === 'hit') ab.resolve();
      ab.events.length = 0;
    }
    p.ab = ab;
    p.done = true;
  }

  inputOf(p) {
    if (!p.human) return p.bot.think(p.ab);
    const input = this.game.input;
    const k = this.opts.mode === 'personal' ? input.solo(p.index) : input.player(p.index);
    return { left: k.left, right: k.right, swing: k.skillPressed };
  }

  liveRank(p) {
    const done = this.players.filter((q) => q.done || q === p);
    done.sort((a, b) => this.cmp(a, b));
    return done.indexOf(p) + 1;
  }

  cmp(a, b) {
    const A = a.ab;
    const B = b.ab;
    return B.total - A.total || B.hr - A.hr || B.longest - A.longest;
  }

  setPhase(ph) {
    this.phase = ph;
    this.t = 0;
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    if (!this.demo && this.phase !== 'end' && input.anyPressed(['KeyP', 'Escape'])) {
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
    if (this.flash > 0) this.flash--;
    if (this.crowd > 0) this.crowd--;
    if (this.call) this.call.t++;
    this.particles.update();
    const p = this.cur;

    if (this.phase === 'intro') {
      if (this.t === 1) {
        p.ab = new AtBat(this.pitches);
        audio.sfx('call');
      }
      if (this.t >= CONFIG.INTRO_TIME || (this.t > 25 && !this.demo && p.human && input.confirm())) this.setPhase('bat');
      return;
    }
    if (this.phase === 'bat') {
      const ab = p.ab;
      ab.update(this.inputOf(p));
      for (const e of ab.events) this.onEvent(p, e);
      ab.events.length = 0;
      return;
    }
    if (this.phase === 'flight') {
      this.updateFlight(p);
      return;
    }
    if (this.phase === 'summary') {
      if (this.t >= 110 || (this.t > 30 && !this.demo && input.confirm())) {
        this.turn++;
        if (this.turn >= this.order.length) {
          if (this.demo) {
            this.game.changeScene();
            return;
          }
          this.setPhase('end');
          const opts = this.opts;
          const players = this.players;
          this.game.changeScene(() => new ResultScene(this.game, players, opts), 'circle');
        } else this.setPhase('intro');
      }
    }
  }

  onEvent(p, e) {
    const audio = this.game.audio;
    switch (e.type) {
      case 'release':
        audio.sfx('swish');
        break;
      case 'swing':
        audio.sfx('whoosh');
        break;
      case 'mitt':
        audio.sfx('mitt');
        break;
      case 'contact': {
        audio.sfx('crack', e.hit.q);
        this.flash = 6;
        this.setPhase('flight');
        this.startFlight(e.hit);
        break;
      }
      case 'call':
        if (e.result === 'strike' || e.result === 'miss') audio.sfx('umpire');
        if (e.result === 'ball') audio.sfx('tick');
        if (!['hr', 'triple', 'double', 'single', 'fly', 'pop', 'ground', 'foul'].includes(e.result)) this.call = { result: e.result, pts: 0, t: 0 };
        break;
      case 'done':
        p.done = true;
        this.setPhase('summary');
        audio.sfx(this.liveRank(p) === 1 ? 'jackpot' : 'point');
        break;
      default:
        break;
    }
  }

  // ---- 타구 연출 ----
  startFlight(hit) {
    const dur = Math.max(50, Math.round((hit.hang * 60) / CONFIG.FLIGHT_SPEED));
    const extra = hit.result === 'hr' ? 1.12 : 1;
    const f = hit.fielder;
    this.fl = {
      hit,
      dur,
      t: 0,
      extra,
      trail: [],
      apex: hit.ground ? 0 : Math.max(2, ((hit.v0 * Math.sin((hit.angle * Math.PI) / 180)) ** 2 / (2 * CONFIG.GRAV)) * 0.8),
      fielder: f ? { ...polar(f.dir, f.r) } : null,
      caught: ['fly', 'pop', 'ground'].includes(hit.result),
      shown: false,
    };
    // 땅볼: 타자가 1루로 뛰고, 아웃이면 내야수가 잡아서 1루로 던짐 (1루수는 베이스로)
    if (hit.ground && (hit.result === 'ground' || hit.result === 'single')) {
      const fl = this.fl;
      fl.runner = { d: 0, speed: RUN_SPEED };
      fl.base = BASE1;
      if (hit.result === 'ground') {
        const isFirst = f && f.id === '1B';
        fl.play = 'roll';
        if (!isFirst) {
          const c = FIELDERS.find((q) => q.id === '1B');
          fl.cover = { ...polar(c.dir, c.r) };
        }
        // 공이 1루에 닿는 시각을 미리 계산해서, 주자가 조금 늦게 도착하게 맞춤
        const field = polar(hit.dir, Math.min(hit.dist, 38));
        const to = Math.hypot(BASE1.x - field.x, BASE1.z - field.z);
        const arrive = isFirst ? dur + Math.ceil(to / RUN_SPEED) : dur + FIELD_PAUSE + Math.max(14, Math.ceil(to / THROW_SPEED));
        fl.runner.speed = Math.min(RUN_SPEED * 1.3, BASE_DIST / (arrive + 12));
      }
    }
  }

  updateFlight(p) {
    const fl = this.fl;
    const audio = this.game.audio;
    fl.t++;
    const hold = 18; // 맞는 순간은 중계 화면에서 잠깐
    if (fl.t <= hold) return;
    // 주자 · 1루 커버
    if (fl.runner && fl.runner.d < BASE_DIST) {
      fl.runner.d = Math.min(BASE_DIST, fl.runner.d + fl.runner.speed);
      if (fl.runner.d >= BASE_DIST && fl.hit.result === 'single') {
        fl.tag = { text: '세이프!', col: 'e', t: 0 };
        audio.sfx('point');
      }
    }
    if (fl.cover) stepToward(fl.cover, BASE1, RUN_SPEED * 1.1);
    if (fl.tag) fl.tag.t++;
    if (fl.play && fl.play !== 'roll') {
      this.updateThrow(p, fl);
      return;
    }
    const k = Math.min(fl.extra, (fl.t - hold) / fl.dur);
    const h = fl.hit;
    // 땅볼 아웃은 내야수가 잡는 자리까지만 굴러감
    const r = (fl.play === 'roll' ? Math.min(h.dist, 38) : h.dist) * k;
    const pos = polar(h.dir, r);
    const height = h.ground ? Math.abs(Math.sin(k * Math.PI * 3)) * 1.5 * (1 - Math.min(1, k)) : 4 * fl.apex * k * (1 - Math.min(1, k)) + (k > 1 ? -0 : 0);
    fl.ball = { x: pos.x, z: pos.z, h: Math.max(0, height) };
    fl.trail.push([pos.x, pos.z, Math.max(0, height)]);
    if (fl.trail.length > 30) fl.trail.shift();
    // 수비수가 떨어지는 곳으로 달려감 (잡을 땐 딱 맞춰, 못 잡으면 조금 늦게)
    if (fl.fielder) {
      const land = polar(h.dir, h.ground ? Math.min(h.dist, 38) : h.dist);
      const tx = land.x - fl.fielder.x;
      const tz = land.z - fl.fielder.z;
      const dist = Math.hypot(tx, tz);
      const left = Math.max(1, fl.dur - (fl.t - hold));
      const sp = fl.caught ? dist / left : Math.min(dist / left, (CONFIG.FIELDER_RUN * CONFIG.FLIGHT_SPEED) / 60) * 0.8;
      if (dist > 0.3) {
        fl.fielder.x += (tx / dist) * sp;
        fl.fielder.z += (tz / dist) * sp;
        fl.moving = true;
      } else fl.moving = false;
    }
    if (k >= 1 && fl.play === 'roll') {
      fl.play = 'field';
      fl.playT = 0;
      audio.sfx('mitt');
      return;
    }
    if (k >= 1 && !fl.shown) {
      fl.shown = true;
      fl.showT = fl.t;
      const pts = hitPoints(h);
      this.call = { result: h.result, pts, t: 0, dist: Math.round(h.dist), gold: h.gold };
      if (h.result === 'hr') {
        audio.sfx('jackpot');
        audio.sfx('cheer');
        this.crowd = 90;
        for (let i = 0; i < 4; i++) {
          const q = fproj(pos.x + (i - 1.5) * 8, pos.z, 12 + i * 3);
          this.particles.burst(q.sx, q.sy, 18, [C('9'), C('5'), C('h'), C('b')], 2.2, 40, 1, 0.04);
        }
      } else if (['triple', 'double', 'single'].includes(h.result)) {
        audio.sfx('cheer');
        audio.sfx('point');
        this.crowd = 40;
      } else if (h.result === 'foul') audio.sfx('miss');
      else audio.sfx('mitt');
    }
    if (fl.shown && fl.t - fl.showT >= CONFIG.RESULT_TIME) {
      this.phase = 'bat';
      p.ab.resolve();
      for (const e of p.ab.events) if (e.type !== 'call') this.onEvent(p, e);
      p.ab.events.length = 0;
      this.fl = null;
    }
  }

  // 땅볼 아웃: 잡음 → (잠깐) → 1루로 송구 (1루수가 잡았으면 직접 베이스로 뜀) → 아웃!
  updateThrow(p, fl) {
    const audio = this.game.audio;
    fl.playT++;
    const f = fl.fielder;
    const isFirst = fl.hit.fielder && fl.hit.fielder.id === '1B';
    if (fl.play === 'field') {
      fl.ball = { x: f.x, z: f.z, h: 1 };
      fl.trail.length = 0;
      if (isFirst) {
        fl.moving = stepToward(f, BASE1, RUN_SPEED);
        fl.ball = { x: f.x, z: f.z, h: 1 };
        if (!fl.moving) this.outAtFirst(fl);
      } else if (fl.playT >= FIELD_PAUSE) {
        fl.play = 'throw';
        fl.playT = 0;
        fl.from = { x: f.x, z: f.z };
        const d = Math.hypot(BASE1.x - f.x, BASE1.z - f.z);
        fl.throwDur = Math.max(14, Math.ceil(d / THROW_SPEED));
        fl.throwArc = Math.min(4, 1 + d / 12);
        fl.moving = false;
        audio.sfx('swish');
      }
      return;
    }
    if (fl.play === 'throw') {
      const k = Math.min(1, fl.playT / fl.throwDur);
      const tgt = fl.cover || BASE1;
      const x = fl.from.x + (tgt.x - fl.from.x) * k;
      const z = fl.from.z + (tgt.z - fl.from.z) * k;
      const h = 1.5 + 4 * fl.throwArc * k * (1 - k);
      fl.ball = { x, z, h };
      fl.trail.push([x, z, h]);
      if (fl.trail.length > 14) fl.trail.shift();
      if (k >= 1) this.outAtFirst(fl);
      return;
    }
    if (fl.play === 'out') {
      const tgt = fl.cover || fl.fielder;
      fl.ball = { x: tgt.x, z: tgt.z, h: 1 };
      if (fl.playT >= CONFIG.RESULT_TIME) {
        this.phase = 'bat';
        p.ab.resolve();
        for (const e of p.ab.events) if (e.type !== 'call') this.onEvent(p, e);
        p.ab.events.length = 0;
        this.fl = null;
      }
    }
  }

  outAtFirst(fl) {
    const audio = this.game.audio;
    fl.play = 'out';
    fl.playT = 0;
    fl.shown = true;
    fl.trail.length = 0;
    fl.tag = { text: '아웃!', col: '5', t: 0 };
    this.call = { result: 'ground', pts: 0, t: 0, dist: 0, gold: fl.hit.gold };
    audio.sfx('mitt');
    audio.sfx('umpire');
  }

  // ---- 그리기 ----
  render(ctx) {
    const W = CONFIG.WIDTH;
    const p = this.cur;
    const ab = p && p.ab;
    const inField = this.phase === 'flight' && this.fl && this.fl.t > 18;
    if (inField) this.renderField(ctx);
    else this.renderBroadcast(ctx, p, ab);
    this.particles.render(ctx);
    if (this.flash > 0) {
      ctx.fillStyle = DITHER.get(ctx, 'b', this.flash * 2);
      ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    }
    if (this.call && this.call.t < 80 && !this.demo) this.renderCall(ctx);
    if (!this.demo) this.renderHud(ctx, p, ab);
    if (this.phase === 'intro' && !this.demo) this.renderIntro(ctx);
    if (this.phase === 'summary' && !this.demo) this.renderSummary(ctx);
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

  renderBroadcast(ctx, p, ab) {
    const W = CONFIG.WIDTH;
    drawBroadcast(ctx, this.frame, this.crowd > 0 && this.frame % 10 < 5 ? 1 : 0);
    // 투수 자세
    let pose = 0;
    if (ab && ab.phase === 'windup') pose = ab.t < 30 ? 0 : ab.t < 50 ? 1 : 2;
    if (ab && (ab.phase === 'pitch' || ab.phase === 'hit' || this.phase === 'flight')) pose = 3;
    drawPitcher(ctx, pose, this.frame);
    const zone = drawZone(ctx, this.frame, false);
    let swingK = 0;
    if (ab && ab.swingT >= 0 && (ab.phase === 'pitch' || ab.phase === 'hit' || ab.phase === 'after' || this.phase === 'flight')) {
      const since = ab.phase === 'pitch' ? ab.t - ab.swingT : CONFIG.SWING_TIME;
      swingK = Math.min(1, since / CONFIG.SWING_TIME);
    }
    if (ab) drawBatBar(ctx, ab.batX, swingK > 0 && swingK < 0.6 ? 1 : 0, zone);
    // 공
    if (ab && ab.phase === 'pitch') {
      const k = ab.t / ab.pitch.frames;
      if (k <= 1.15) drawBall(ctx, pitchPos(ab.pitch, Math.min(1.12, k)), ab.pitch.gold, this.frame);
      if (k > 1) drawMitt(ctx, pitchPos(ab.pitch, 1));
    } else if (ab && ab.phase === 'after' && ab.t < 20 && ab.log.length && !['hr', 'triple', 'double', 'single', 'fly', 'pop', 'ground', 'foul'].includes(ab.log[ab.log.length - 1].result)) {
      drawMitt(ctx, pitchPos(ab.pitch, 1));
    } else if (this.phase === 'flight' && this.fl) {
      // 맞은 공이 하늘로 솟구침
      const k = this.fl.t / 18;
      const hit = this.fl.hit;
      const sx = W / 2 + ab.batX + hit.dir * 2.2 * k;
      const sy = 120 - k * (hit.ground ? 10 : 90);
      px(ctx, sx - 1, sy - 1, 3, 3, hit.gold ? '9' : 'b');
    }
    if (p) drawBatter(ctx, p.index, swingK, this.frame);
  }

  renderField(ctx) {
    const fl = this.fl;
    // 땅볼은 카메라가 내야로 2배 확대 (송구 · 1루 승부가 잘 보이게)
    //  화면 가운데에 홈~1루~유격수 사이가 오도록 1.7배
    const zk = fl.runner ? Math.min(1, (fl.t - 18) / 20) : 0;
    const zoom = 1 + 0.7 * zk;
    const fx = 160 + 36 * zk;
    const fy = 102 + 10 * zk;
    const Z = (sx, sy) => ({ x: 160 + (sx - fx) * zoom, y: 102 + (sy - fy) * zoom });
    ctx.save();
    if (zoom > 1) {
      ctx.translate(160, 102);
      ctx.scale(zoom, zoom);
      ctx.translate(-fx, -fy);
    }
    drawFieldView(ctx, this.frame, this.crowd > 0 && this.frame % 10 < 5 ? 1 : 0);
    // 수비수 (움직이는 한 명 + 나머지)
    for (const f of FIELDERS) {
      if (fl.hit.fielder && f.id === fl.hit.fielder.id && fl.fielder) continue;
      if (fl.cover && f.id === '1B') continue;
      const q = polar(f.dir, f.r);
      drawFielder(ctx, q.x, q.z, false, this.frame);
    }
    if (fl.cover) drawFielder(ctx, fl.cover.x, fl.cover.z, Math.hypot(fl.cover.x - BASE1.x, fl.cover.z - BASE1.z) > 0.3, this.frame);
    if (fl.fielder) drawFielder(ctx, fl.fielder.x, fl.fielder.z, fl.moving, this.frame);
    // 1루로 뛰는 타자 (캐릭터 색 헬멧)
    if (fl.runner) {
      const k = fl.runner.d / BASE_DIST;
      drawRunner(ctx, this.cur.index, BASE1.x * k, BASE1.z * k, k < 1, this.frame);
    }
    if (fl.ball) drawFlightBall(ctx, fl.ball.x, fl.ball.z, fl.ball.h, fl.hit.gold, fl.trail);
    ctx.restore();
    // 1루 위 판정 글자 (아웃! / 세이프!) — 확대와 상관없이 또렷하게
    if (fl.tag && fl.tag.t < 70) {
      const b0 = fproj(BASE1.x, BASE1.z, 0);
      const b = Z(b0.sx, b0.sy);
      const up = Math.min(6, fl.tag.t);
      const w = KText.width(fl.tag.text, 'b') + 10;
      drawTag(ctx, Math.round(b.x - w / 2), Math.round(b.y) - 34 - up, w, 14, fl.tag.col, fl.tag.text, '1', 'b');
    }
    if (this.demo) return;
    // 타구 데이터 판 (타구 속도 · 발사각 · 비거리)
    const h = fl.hit;
    const d = fl.ball ? Math.round(Math.hypot(fl.ball.x, fl.ball.z)) : 0;
    // 1루 쪽 플레이를 가리지 않게 오른쪽 아래에 작게
    const x = CONFIG.WIDTH - 104;
    const y = 112;
    drawBroadcastPanel(ctx, x, y, 102, 44, h.gold ? '9' : 'h');
    const rows = [['타구 속도', Math.round(h.v0 * 3.6), 'km/h', 'b'], ['발사각', Math.round(h.angle), '도', 'b'], ['비거리', d, 'm', '9']];
    rows.forEach(([k, v, u, col], i) => {
      const yy = y + 2 + i * 14;
      KText.draw(ctx, k, x + 6, yy + 2, C('k'), { font: 'n' });
      drawValue(ctx, x + 99, yy, v, u, col, 'b', 'j');
      if (i < 2) px(ctx, x + 5, yy + 14, 94, 1, '2');
    });
  }

  // 판정 연출: 스트라이크/볼은 존 옆 그래픽 · 안타는 띠 · 홈런은 화면 가득 빛줄기
  renderCall(ctx) {
    const W = CONFIG.WIDTH;
    const c = this.call;
    const look = HIT_LOOK[c.result];
    const t = c.t;
    if (c.result === 'hr') {
      const k = Math.min(1, t / 10);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 44, W, 62);
      ctx.clip();
      drawRays(ctx, W / 2, 75, 260, this.frame, '6', '7');
      ctx.restore();
      px(ctx, 0, 43, W, 2, '9');
      px(ctx, 0, 105, W, 2, '9');
      const s = k < 1 ? 3 : 2;
      KText.draw(ctx, '홈런!', W / 2, 47 - (s - 2) * 6, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: s });
      const shown = Math.min(c.dist, Math.round((c.dist * t) / 30));
      const sub = `${shown}m  +${Math.round((c.pts * shown) / Math.max(1, c.dist))}점${c.gold ? '  잭팟 ×2!' : ''}`;
      const sw = KText.width(sub, 'b') + 16;
      drawTag(ctx, W / 2 - sw / 2, 88, sw, 15, '1', sub, '9', 'b');
      return;
    }
    const hitLike = ['triple', 'double', 'single', 'fly', 'pop', 'ground', 'foul'].includes(c.result);
    if (hitLike) {
      // 왼쪽에서 밀려 들어오는 띠
      const slide = Math.max(0, 10 - t) * 18;
      const good = ['triple', 'double', 'single'].includes(c.result);
      const w = 150;
      const x = 8 - slide;
      drawBroadcastPanel(ctx, x, 112, w, 34, good ? 'e' : 'j');
      KText.draw(ctx, look.name, x + 10, 113, C(good ? 'e' : 'k'), { font: 'L', outline: C('1') });
      KText.draw(ctx, good ? `+${c.pts}점${c.gold ? ' (잭팟 ×2)' : ''}` : '점수 없음', x + 10, 131, C(good ? '9' : 'j'), { font: 's' });
      return;
    }
    // 스트라이크 · 헛스윙 · 볼: 존 오른쪽에 도장처럼
    const pop = t < 5 ? 5 - t : 0;
    const col = c.result === 'ball' ? 'd' : '6';
    const label = look.name;
    const w = KText.width(label, 'L') + 18 + pop * 2;
    const x = 194 - pop;
    drawBroadcastPanel(ctx, x, 96 - pop, w, 24 + pop * 2, null, col);
    px(ctx, x, 96 - pop, w, 2, c.result === 'ball' ? 'e' : '5');
    KText.draw(ctx, label, x + w / 2, 100, C('b'), { align: 'center', font: 'L', outline: C('1') });
  }

  // 중계 그래픽 (스코어 박스 · 구속판 · 하단 바)
  renderHud(ctx, p, ab) {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    if (!p || !ab) return;
    const col = p.def.color;
    // ---- 스코어 박스 (왼쪽 위) ----
    drawBroadcastPanel(ctx, 2, 2, 132, 32, col);
    px(ctx, 5, 2, 129, 12, '2');
    ctx.drawImage(SPR.players[p.index].face, 6, 13);
    KText.draw(ctx, `${this.turn + 1}번`, 7, 1, C(col), { font: 'n', outline: C('1') });
    KText.draw(ctx, p.name, 27, 1, C('b'), { font: 's' });
    KText.draw(ctx, `${this.turn + 1} / ${this.order.length} 타자`, 131, 2, C('k'), { font: 'n', align: 'right', outline: C('1') });
    // 기회 = 야구공 아이콘
    const goldPip = CONFIG.CHANCES - 1 - CONFIG.GOLD_AT;
    for (let i = 0; i < CONFIG.CHANCES; i++) {
      const used = i >= ab.chances;
      drawBallIcon(ctx, 27 + i * 8, 18, used ? 'used' : i === goldPip ? 'gold' : 'left');
    }
    // 점수 LED
    px(ctx, 95, 15, 37, 17, 'o');
    drawValue(ctx, 132, 14, ab.total, '점', '9', 'b', 'a');
    // ---- 구속판 (오른쪽 위): 공이 나가면 미끄러져 들어옴 ----
    const pt = ab.pitch;
    if (pt && (ab.phase === 'pitch' || ab.phase === 'after' || ab.phase === 'hit')) {
      const since = ab.phase === 'pitch' ? ab.t : 99;
      const x = W - 78 + Math.max(0, 8 - since) * 10;
      drawBroadcastPanel(ctx, x, 2, 76, 34, pt.gold ? '9' : PITCH_COLOR[pt.typeId]);
      drawValue(ctx, x + 73, 0, pt.kmh, 'km/h', pt.gold ? '9' : 'b', 'L', 'k');
      drawTag(ctx, x + 6, 21, 66, 13, PITCH_COLOR[pt.typeId], pt.name, 'b', 'n');
    }
    if (pt && pt.gold && ab.phase === 'windup') {
      const blink = this.frame % 24 < 16;
      drawBroadcastPanel(ctx, W - 98, 2, 96, 18, '9', blink ? '7' : '1');
      drawBallIcon(ctx, W - 92, 7, 'gold');
      KText.draw(ctx, '잭팟 볼! ×2', W - 46, 4, C('9'), { align: 'center', font: 's' });
    }
    // ---- 하단 바 ----
    const y0 = H - 22;
    px(ctx, 0, y0, W, 22, '1');
    px(ctx, 0, y0, W, 1, '9');
    px(ctx, 0, y0 + 1, W, 1, '8');
    // 조작키 (왼쪽)
    if (p.human) {
      const input = this.game.input;
      const solo = this.opts.mode === 'personal';
      const labels = solo ? ['<', 'SP', '>'] : KEYMAP[p.index].keys;
      const k = solo ? input.solo(p.index) : input.player(p.index);
      const held = [k.left, k.skillHeld, k.right];
      let x = 4;
      labels.forEach((l, j) => {
        const cap = getKeycap(l, j === 1 ? 'strike' : 'plain', !!held[j]);
        ctx.drawImage(cap, x, y0 + 2);
        x += cap.width;
      });
      KText.draw(ctx, '← → 배트', x + 3, y0 + 1, C('k'), { font: 'n', outline: C('1') });
      KText.draw(ctx, '가운데 스윙', x + 3, y0 + 11, C('9'), { font: 'n', outline: C('1') });
    } else {
      drawTag(ctx, 4, y0 + 5, 40, 13, '2', 'CPU', 'j', 'b');
      KText.draw(ctx, '타격 중', 50, y0 + 6, C('j'), { font: 'n', outline: C('1') });
    }
    // LED 전광판 (오른쪽): 얼굴 + 점수
    const personal = this.opts.mode === 'personal';
    const bx = W - this.players.length * 38 - 2;
    px(ctx, bx - 2, y0 + 3, this.players.length * 38 + 2, 18, 'o');
    this.players.forEach((q, i) => {
      const x = bx + i * 38;
      const now = q === p && this.phase !== 'summary';
      if (now && this.frame % 30 < 22) {
        px(ctx, x - 1, y0 + 3, 38, 18, '9');
        px(ctx, x, y0 + 4, 36, 16, 'o');
      }
      ctx.drawImage(SPR.players[q.index].face, x, y0 + 3);
      let val = '---';
      if (q.ab && (q.done || q === p)) val = personal && !q.human && !p.done ? '---' : q.ab.total;
      KText.draw(ctx, String(val), x + 37, y0 + 4, C(now ? '9' : val === '---' ? 'i' : 'a'), { font: 'b', align: 'right', outline: C('1') });
    });
  }

  // 타자 소개: 하단 자막처럼 밀려 들어오는 이름표 + 캐릭터 크게
  renderIntro(ctx) {
    const W = CONFIG.WIDTH;
    const p = this.cur;
    const col = p.def.color;
    const k = Math.min(1, this.t / 12);
    const x = Math.round(-230 * (1 - k)) + 6;
    // 캐릭터 (2배, 외곽선)
    const img = batterImg(p.index, ((this.frame / 20) | 0) % 2);
    ctx.fillStyle = DITHER.get(ctx, '1', 8);
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 20, CONFIG.WIDTH, 128);
    ctx.clip();
    drawRays(ctx, x + 40, 104, 150, this.frame, '2', '1');
    ctx.restore();
    ctx.drawImage(img, x + 40 - img.width, 128 - img.height * 2, img.width * 2, img.height * 2);
    drawBroadcastPanel(ctx, x, 104, 230, 44, col);
    px(ctx, x + 3, 104, 227, 13, col);
    KText.draw(ctx, `${this.turn + 1}번 타자 등장!`, x + 84, 104, C('1'), { font: 's' });
    KText.draw(ctx, p.name, x + 84, 117, C('b'), { font: 'L', outline: C('1') });
    const best = this.players.filter((q) => q.done && q !== p).sort((a, b) => this.cmp(a, b))[0];
    const goal = best && this.opts.mode !== 'personal' ? `목표: ${best.name} ${best.ab.total}점` : `기회 ${CONFIG.CHANCES}번 · 금색 공 ×2`;
    KText.draw(ctx, goal, x + 84, 135, C('9'), { font: 'n', outline: C('1') });
    if (p.human) {
      const labels = this.opts.mode === 'personal' ? ['<', 'SP', '>'] : KEYMAP[p.index].keys;
      let kx = x + 166;
      labels.forEach((l, j) => {
        const cap = getKeycap(l, j === 1 ? 'strike' : 'plain', false);
        ctx.drawImage(cap, kx, 120);
        kx += cap.width - 1;
      });
    } else drawTag(ctx, x + 176, 121, 40, 13, '2', 'CPU', 'j', 'b');
  }

  // 타석 끝: 기록표
  renderSummary(ctx) {
    const W = CONFIG.WIDTH;
    const p = this.cur;
    const ab = p.ab;
    const rank = this.liveRank(p);
    ctx.fillStyle = DITHER.get(ctx, '1', 8);
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    const x = W / 2 - 100;
    drawBroadcastPanel(ctx, x, 40, 200, 86, p.def.color);
    px(ctx, x + 3, 40, 197, 14, '2');
    ctx.drawImage(SPR.players[p.index].face, x + 6, 38);
    KText.draw(ctx, `${p.name} 타석 결과`, x + 27, 41, C('b'), { font: 's' });
    drawValue(ctx, x + 194, 56, ab.total, '점', '9', 'L', 'a');
    const stats = [['홈런', ab.hr], ['안타', ab.hits], ['최장', ab.longest ? `${ab.longest}m` : '-']];
    stats.forEach(([k, v], i) => {
      const yy = 58 + i * 14;
      KText.draw(ctx, k, x + 10, yy, C('k'), { font: 's' });
      KText.draw(ctx, String(v), x + 92, yy, C('a'), { font: 'b', align: 'right' });
    });
    // 공마다 결과 (작은 칸)
    ab.log.filter((l) => l.result !== 'ball').forEach((l, i) => {
      const c = TRACK_COLOR[l.result] || 'k';
      px(ctx, x + 10 + i * 11, 104, 9, 9, '1');
      px(ctx, x + 11 + i * 11, 105, 7, 7, c);
      if (l.gold) px(ctx, x + 13 + i * 11, 107, 3, 3, 'b');
    });
    const msg = this.opts.mode === 'personal' ? 'CPU 기록 공개!' : `현재 ${rank}위`;
    drawTag(ctx, x + 120, 104, 74, 14, rank === 1 ? '9' : '3', msg, rank === 1 ? '1' : 'b', 's');
  }
}
