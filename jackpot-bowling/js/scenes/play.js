// =====================================================
// 플레이: 레인 하나에서 5명이 차례대로 (실제 볼링처럼)
//  1프레임: 럼블 → 나르 → 꽥스 → 볼리베어 → 에코 → 2프레임 …
//  한 투구: 위치(←→) + 방향 멈추기(가운데) → 힘 멈추기(가운데) → 굴러가는 동안 스핀(←→)
//  투구 사이: 피니세터 스위퍼가 쓰러진 핀을 치우고, 프레임이 바뀌면 핀 10개를 새로 세움
//  위쪽 전광판: 실제 볼링장 점수표 + 스트라이크/스페어/스플릿/거터 애니메이션
// =====================================================
const SWEEP_TIME = 54;   // 스위퍼 한 번 (내려옴 → 쓸기 → 올라감)
const SWEEP_MID = 26;    // 이때 핀을 치우거나 새로 세움

class PlayScene {
  // opts: { mode, count, charIdx, embed, autoplay }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    CONFIG.FRAMES = opts.frames || 3; // 타이틀에서 고른 프레임 수 (3 · 5 · 10)
    this.aimGuide = opts.aimGuide !== false; // 조준선 (공이 갈 길 점선)
    this.shake = 0;
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
        bot: human ? null : new BowlBot(s0 + Math.random() * (s1 - s0)),
        rolls: [],
        bonus: 0,
        reactBonus: 0, // 리액션 캠 보너스 (bonus 에 포함)
        strikes: 0,
        spares: 0,
        streak: 0,
        startX: 0, // 마지막으로 선 위치 (다음 차례에도 그대로)
        place: null,
      });
    }
    this.rack = new Rack();
    this.rack.reset(this.randomGold());
    this.turn = 0;
    this.frameNo = 0;
    this.laneNo = 1 + Math.floor(Math.random() * 24);
    // 지금 투구 상태 (봇도 이걸 보고 판단)
    this.shot = { state: 'wait', t: 0, startX: 0, aimPhase: 0, angle: 0, power: 0, powerT: 0, rack: this.rack };
    this.sweep = { t: SWEEP_TIME, mode: 'clear', next: false };
    this.drop = 0; // 새 핀 내려오는 연출
    this.anim = { type: 'welcome', t: 0, dur: 130, text: '잭팟 볼링장', sub: `LANE ${this.laneNo} · ${CONFIG.FRAMES}프레임 · ${n}명` };
    this.banner = null;
    this.state = 'intro'; // intro | play | end
    this.t = 0;
    this.frame = 0;
    this.particles = new ParticleSystem();
    this.paused = false;
    this.pauseSel = 0;
    this.clackCD = 0;
  }

  enter() {
    this.game.audio.playBgm('game');
  }

  get cur() {
    return this.players[this.turn];
  }

  // 금색 핀 번호 (가끔만 나옴, 없으면 -1)
  randomGold() {
    return Math.random() < CONFIG.JACKPOT_CHANCE ? Math.floor(Math.random() * 10) : -1;
  }

  inputOf(p) {
    if (!p.human) return p.bot.think(this.shot);
    const input = this.game.input;
    return this.opts.mode === 'personal' ? input.solo(p.index) : input.player(p.index);
  }

  total(p) {
    return runningScore(p.rolls) + p.bonus;
  }

  // 이 사람 차례 시작
  beginTurn() {
    const p = this.cur;
    Object.assign(this.shot, { state: 'aim', t: 0, startX: p.startX, aimPhase: Math.random() * Math.PI * 2, angle: 0, power: 0, powerT: 0 });
    if (p.bot) p.bot.plan = null;
    const ball = frameState(p.rolls).ball;
    if (ball === 0) {
      this.banner = { text: `${p.name} 차례`, sub: `${this.frameNo + 1}프레임`, t: 0, color: p.def.color };
      this.game.audio.sfx('select');
    }
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    if (this.state !== 'end' && input.anyPressed(['KeyP', 'Escape'])) {
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
    if (this.clackCD > 0) this.clackCD--;
    if (this.drop > 0) this.drop--;
    this.particles.update();
    if (this.anim && ++this.anim.t > this.anim.dur) this.anim = null;
    if (this.banner && ++this.banner.t > 80) this.banner = null;

    if (this.state === 'intro') {
      if (this.t === 20) audio.sfx('start');
      if (this.t >= 130) {
        this.state = 'play';
        this.beginTurn();
      }
      return;
    }
    if (this.state === 'end') {
      if (this.t === CONFIG.END_DELAY) this.game.changeScene(() => new ResultScene(this.game, this.players, this.opts), 'circle');
      return;
    }
    this.updateShot(this.inputOf(this.cur));
  }

  updateShot(inp) {
    const s = this.shot;
    const p = this.cur;
    const audio = this.game.audio;
    s.t++;
    if (s.state === 'aim') {
      // 위치 옮기기 + 방향 화살표가 좌우로 흔들림
      const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      s.startX = Math.max(-CONFIG.START_RANGE, Math.min(CONFIG.START_RANGE, s.startX + dx * CONFIG.MOVE_SPEED));
      s.aimPhase += CONFIG.AIM_SPEED;
      s.angle = Math.sin(s.aimPhase) * CONFIG.AIM_MAX;
      if (inp.skillPressed && s.t > 12) {
        s.state = 'power';
        s.powerT = 0;
        s.t = 0;
        audio.sfx('lock');
      }
    } else if (s.state === 'power') {
      // 힘 게이지가 오르내림 (0 → 100% → 0 …)
      s.powerT++;
      const u = (s.powerT / (CONFIG.POWER_PERIOD / 2)) % 2;
      s.power = 1 - Math.abs(1 - u);
      if (inp.skillPressed && s.powerT > 3) {
        const speed = CONFIG.SPEED_MIN + s.power * (CONFIG.SPEED_MAX - CONFIG.SPEED_MIN);
        s.standBefore = this.rack.standing;
        const gold = this.rack.pins.find((q) => q.gold);
        s.goldUp = gold && gold.up && !gold.gone ? gold : null;
        this.rack.launch(s.startX, s.angle, speed);
        p.startX = s.startX;
        s.settleT = 0;
        s.state = 'roll';
        s.t = 0;
        audio.sfx(s.power > 0.85 ? 'power' : 'thud');
      }
    } else if (s.state === 'roll') {
      const spin = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const b = this.rack.ball;
      const ev = this.rack.step(spin);
      if (spin && b.spin > 0 && !b.gutter && b.y < CONFIG.LANE.HEAD_Y - 4 && s.t % 3 === 0) {
        const q = proj(b.x, b.y);
        this.particles.add(q.x - spin * 4, q.y - 2, -spin * 0.5, 0.2, 14, C('h'), 1);
      }
      // 굴러가는 소리: 핀에 가까워질수록 촘촘해짐 (두구두구…)
      const near = Math.max(0, Math.min(1, b.y / CONFIG.LANE.HEAD_Y));
      const gap = Math.max(3, Math.round(9 - near * 6));
      if (s.t % gap === 0 && !b.gone && b.y < CONFIG.LANE.HEAD_Y) audio.sfx('tick');
      if (ev.pinHits) {
        if (this.clackCD === 0) {
          audio.sfx('clack');
          this.clackCD = 4;
        }
        const q = proj(b.x, Math.max(b.y, CONFIG.LANE.HEAD_Y));
        this.particles.burst(q.x, q.y - 8, 4 * ev.pinHits, [C('b'), C('k'), C('6')], 1.4, 18, 1);
        this.shake = Math.min(8, this.shake + ev.pinHits * 2); // 핀이 와르르 → 화면 흔들림
      }
      if (ev.gutter) audio.sfx('miss');
      if (b.gone) s.settleT++;
      if ((b.gone && this.rack.settled) || s.settleT > CONFIG.SETTLE_TIME) this.countPins();
    } else if (s.state === 'show') {
      this.rack.step(0); // 핀이 마저 굴러가게
      if (s.t >= s.showTime) this.afterShow();
    } else if (s.state === 'sweep') {
      const sw = this.sweep;
      sw.t++;
      if (sw.t === 4) audio.sfx('deal');
      if (sw.t === SWEEP_MID) {
        if (sw.mode === 'reset') {
          this.rack.reset(this.randomGold());
          this.drop = 14;
          audio.sfx('drop');
        } else this.rack.sweep();
        this.rack.ball = null;
      }
      if (sw.t >= SWEEP_TIME) {
        if (sw.next) this.beginTurn();
        else {
          s.state = 'aim';
          s.t = 0;
          s.angle = 0;
        }
      }
    }
  }

  // 남은 핀이 두 덩어리 이상으로 떨어져 있고 1번 핀이 없으면 스플릿
  isSplit() {
    const spots = pinSpots();
    const up = this.rack.pins.filter((q) => q.up && !q.gone).map((q) => q.id);
    if (up.length < 2 || up.includes(0)) return false;
    const seen = new Set([up[0]]);
    const queue = [up[0]];
    while (queue.length) {
      const a = queue.pop();
      for (const b of up) {
        if (seen.has(b)) continue;
        if (Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y) < 9.6) {
          seen.add(b);
          queue.push(b);
        }
      }
    }
    return seen.size < up.length;
  }

  // 공이 들어가고 핀이 멈춤 → 쓰러진 핀 세기 + 전광판 연출
  countPins() {
    const s = this.shot;
    const p = this.cur;
    const audio = this.game.audio;
    const fresh = s.standBefore === 10;
    const knocked = s.standBefore - this.rack.standing;
    p.rolls.push(knocked);
    const head = proj(0, CONFIG.LANE.HEAD_Y + 8);
    const sub = `${p.name} · ${knocked}핀`;
    let anim = null;
    if (fresh && knocked === 10) {
      p.strikes++;
      p.streak++;
      anim = { type: 'strike', text: strikeName(p.streak), sub: p.name };
      this.particles.explode(head.x, head.y - 6, true);
      this.shake = 10;
      // 볼러 머리 위로 색종이
      const bx = proj(this.shot.startX, -8).x + 16;
      for (let i = 0; i < 26; i++) this.particles.add(bx + (Math.random() - 0.5) * 30, 120, (Math.random() - 0.5) * 2, -1.5 - Math.random() * 1.5, 60, C(['9', '5', 'h', 'e', 'q', 'b'][i % 6]), 2, 0.06);
      audio.sfx('jackpot');
    } else if (!fresh && this.rack.standing === 0) {
      p.spares++;
      anim = { type: 'spare', text: '스페어!', sub: p.name };
      this.particles.burst(head.x, head.y - 6, 24, [C('h'), C('g'), C('b')], 1.6, 34, 1);
      audio.sfx('coin');
    } else if (knocked === 0 && this.rack.ball && this.rack.ball.gutter) {
      anim = { type: 'gutter', text: '거터…', sub: p.name };
    } else if (fresh && this.isSplit()) {
      anim = { type: 'split', text: '스플릿!', sub };
      audio.sfx('warning');
    } else if (knocked >= 7) audio.sfx('chip');
    if (fresh && knocked !== 10) p.streak = 0;
    // 잭팟 핀
    if (s.goldUp && !s.goldUp.up) {
      p.bonus += CONFIG.JACKPOT_BONUS;
      const extra = `잭팟 핀 +${CONFIG.JACKPOT_BONUS}`;
      if (anim) anim.extra = extra;
      else anim = { type: 'jackpot', text: '잭팟 핀!', sub, extra: `+${CONFIG.JACKPOT_BONUS}점` };
      const g = proj(s.goldUp.x, s.goldUp.y);
      for (let i = 0; i < 14; i++) this.particles.add(g.x, g.y - 6, (Math.random() - 0.5) * 1.8, -0.8 - Math.random(), 50, C(i % 3 ? '9' : 't'), 2, 0.05);
      audio.sfx('golden');
    }
    if (anim) this.anim = { ...anim, t: 0, dur: anim.type === 'jackpot' ? 80 : 110, color: p.index };
    // 리액션 캠: 사람 차례의 스트라이크 · 스페어 · 거터 · 스플릿
    if (anim && ReactionCam.on && !this.demo && p.human && ['strike', 'spare', 'gutter', 'split'].includes(anim.type)) this.captureReaction(p, this.anim);
    s.showTime = anim ? Math.min(this.anim.dur, 100) : 50;
    s.state = 'show';
    s.t = 0;
  }

  // 결과가 뜨고 0.5초 뒤(리액션이 나올 때) 찍어서 전광판에 띄움. 크게 리액션하면 보너스
  captureReaction(p, a) {
    setTimeout(() => {
      ReactionCam.snap()
        .then((r) => {
          if (!r) return;
          a.reaction = r;
          a.dur = Math.max(a.dur, a.t + 70); // 사진을 볼 시간
          const big = r.kind !== 'calm' && r.score >= ReactionCam.MIN_SCORE;
          if (big && p.reactBonus < ReactionCam.BONUS_MAX) {
            p.reactBonus += ReactionCam.BONUS;
            p.bonus += ReactionCam.BONUS;
            r.bonus = ReactionCam.BONUS;
            this.game.audio.sfx('coin');
          }
        })
        .catch((e) => console.warn('[reaction] 판정 실패', e));
    }, 500);
  }

  // 결과 보여 준 뒤: 같은 사람 한 번 더 / 다음 사람 / 끝
  afterShow() {
    const p = this.cur;
    const fs = frameState(p.rolls);
    const frameDone = fs.done || fs.frame > this.frameNo;
    this.sweep = { t: 0, mode: 'clear', next: false };
    if (frameDone) {
      this.turn++;
      if (this.turn >= this.players.length) {
        this.turn = 0;
        this.frameNo++;
        if (this.frameNo >= CONFIG.FRAMES) return this.finish();
      }
      this.sweep.mode = 'reset';
      this.sweep.next = true;
    } else if (this.rack.standing === 0) this.sweep.mode = 'reset'; // 마지막 프레임 보너스 투구
    this.shot.state = 'sweep';
    this.shot.t = 0;
  }

  finish() {
    this.state = 'end';
    this.t = 0;
    this.shot.state = 'wait';
    const rows = buildResult(this.opts.mode, this.players).ranking;
    for (const r of rows) this.players.find((p) => p.slot === r.seat).place = r.rank;
    const top = this.players.find((p) => p.place === 1);
    this.anim = { type: 'end', text: '게임 끝!', sub: `1위 ${top.name} ${this.total(top)}점`, t: 0, dur: CONFIG.END_DELAY, color: top.index };
    this.game.audio.sfx('win');
  }

  // ---------------- 그리기 ----------------
  render(ctx) {
    const W = CONFIG.WIDTH;
    const s = this.shot;
    const p = this.cur;
    if (this.shake > 0) this.shake -= 0.5;
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * this.shake * 0.6), Math.round((Math.random() - 0.5) * this.shake * 0.4));
    drawLane3D(ctx, this.frame);
    drawMasking(ctx, this.frame, this.laneNo);
    drawPinsAndBall(ctx, this.rack, p.index, this.drop);
    if (s.state === 'sweep') drawSweeper(ctx, this.sweep.t / SWEEP_TIME);
    this.renderBowler(ctx);
    this.particles.render(ctx);
    ctx.restore();
    if (!this.demo) this.renderSidePanels(ctx);
    drawMonitor(ctx, { players: this.players, cur: this.state === 'end' ? -1 : this.turn, frameNo: this.frameNo, anim: this.anim, frame: this.frame, laneNo: this.laneNo });
    // 차례 안내
    if (this.banner && this.banner.t < 70 && !this.demo) {
      const b = this.banner;
      const slide = Math.max(0, 8 - b.t) * 10;
      drawCard(ctx, W / 2 - 50 + slide, 116, 100, 30, '1', b.color);
      KText.draw(ctx, b.text, W / 2 + slide, 118, C(b.color), { align: 'center', font: 'b', outline: C('1') });
      KText.draw(ctx, b.sub, W / 2 + slide, 132, C('a'), { align: 'center', font: 'n' });
    }
    if (this.paused) {
      ctx.fillStyle = ctx.createPattern(Transition.patterns[10], 'repeat');
      ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
      drawPanel(ctx, 110, 55, 100, 70, 'default');
      KText.draw(ctx, '일시정지', W / 2, 62, C('9'), { align: 'center', font: 'b', outline: C('1') });
      ['계속하기', '타이틀로'].forEach((str, i) => {
        const sel = this.pauseSel === i;
        KText.draw(ctx, (sel ? '▶ ' : '') + str, W / 2, 84 + i * 16, sel ? C('9') : C('j'), { align: 'center', font: 'b' });
      });
    }
  }

  // 볼러 + 들고 있는 공 + 조준 화살표
  renderBowler(ctx) {
    const s = this.shot;
    const p = this.cur;
    const holding = s.state === 'aim' || s.state === 'power';
    if (holding && this.aimGuide && p.human) {
      // 조준 도우미: 스핀 없이 굴렸을 때 공이 갈 길을 핀 앞까지 옅게 (거터면 빨강)
      for (let k = 42; k <= CONFIG.LANE.HEAD_Y; k += 3) {
        const gx = s.startX + s.angle * k;
        const q = proj(gx, k);
        ctx.fillStyle = C(Math.abs(gx) > CONFIG.LANE.HALF ? '5' : 'k');
        ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
    }
    if (holding) {
      // 방향 화살표 (원근 점선, 멈추면 실선)
      const locked = s.state === 'power';
      for (let k = 4; k <= 40; k += locked ? 1 : 2.5) {
        const q = proj(s.startX + s.angle * k, k);
        ctx.fillStyle = locked ? C('8') : C('9');
        ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
      const tip = proj(s.startX + s.angle * 40, 40);
      ctx.fillStyle = locked ? C('8') : C('9');
      ctx.fillRect(Math.round(tip.x) - 1, Math.round(tip.y) + 1, 3, 1);
      ctx.fillRect(Math.round(tip.x), Math.round(tip.y), 1, 1);
    }
    // 볼러: 공 오른쪽에 서서 (던진 뒤엔 그 자리에서 지켜봄)
    const bx = proj(s.startX, -8).x;
    const sp = SPR.players[p.index];
    const happy = this.anim && (this.anim.type === 'strike' || this.anim.type === 'spare') && this.anim.t < 60;
    const sad = this.anim && this.anim.type === 'gutter';
    const hop = happy ? Math.round(Math.abs(Math.sin(this.anim.t / 5)) * 4) : 0;
    const img = sad ? sp.ghost : sp.frames[((this.frame / 18) | 0) % 2];
    if (this.state !== 'intro' || this.t > 60) drawStanding(ctx, img, Math.round(bx + 16), CONFIG.HEIGHT + 3 - hop);
    if (holding) drawBall3D(ctx, { x: s.startX, y: -9 }, p.index);
  }

  // 왼쪽: 선수 목록 (얼굴 · 이름 · 점수) / 오른쪽: 지금 볼러 · 핀 표시판 · 조작키 · 힘/스핀
  renderSidePanels(ctx) {
    const s = this.shot;
    const p = this.cur;
    const input = this.game.input;
    const solo = this.opts.mode === 'personal';
    // 왼쪽 선수 목록
    const n = this.players.length;
    const rowH = 20;
    const y0 = 77 + Math.floor((100 - n * rowH) / 2);
    const best = Math.max(...this.players.map((q) => this.total(q)));
    this.players.forEach((q, i) => {
      const y = y0 + i * rowH;
      const on = i === this.turn && this.state === 'play';
      drawCard(ctx, 0, y, 66, rowH - 1, on ? '7' : '1', on ? '9' : q.def.color);
      ctx.fillStyle = C(on ? '7' : '1'); // 반짝 줄은 글자와 겹치니 지움
      ctx.fillRect(3, y + 2, 56, 1);
      ctx.drawImage(SPR.players[q.index].face, 1, y);
      KText.draw(ctx, q.name, 21, y, C(q.def.color), { font: 'n' });
      // 아랫줄: 점수 (오른쪽, 1등은 금색)
      const sc = this.total(q);
      BitmapFont.draw(ctx, String(sc), 62, y + 11, C(sc === best && sc > 0 ? '9' : 'b'), { align: 'right' });
    });
    // 오른쪽: 지금 볼러
    const x0 = 256;
    drawCard(ctx, x0, 77, 64, 101, '1', '3');
    drawNameCard(ctx, x0 + 2, 79, 60, { def: p.def, name: p.name, index: p.index, place: null }, this.frame);
    const fs = frameState(p.rolls);
    const ballNo = this.state === 'end' ? '' : `${this.frameNo + 1}프레임 ${Math.min(fs.ball, 2) + 1}구`;
    KText.draw(ctx, ballNo, x0 + 32, 96, C('a'), { align: 'center', font: 'n', outline: C('1') });
    drawPinIndicator(ctx, x0 + 32, 110, this.rack);
    // 지금 볼러의 조작키 (사람일 때) — 지금 눌러야 할 키가 밝게
    if (p.human) {
      const K = KEYMAP[p.index];
      const labels = solo ? ['<', '^', '>'] : K.keys;
      const held = solo
        ? [input.anyDown(SOLO_KEYS.left), input.anyDown(SOLO_KEYS.skill), input.anyDown(SOLO_KEYS.right)]
        : [input.isDown(K.left), input.isDown(K.skill), input.isDown(K.right)];
      const caps = labels.map((k, j) => getKeycap(k, j === 1 ? 'strike' : 'plain', held[j]));
      const tw = caps.reduce((a, c) => a + c.width, 0);
      let kx = Math.round(x0 + 32 - tw / 2);
      caps.forEach((c) => {
        ctx.drawImage(c, kx, 128);
        kx += c.width;
      });
      const hint = s.state === 'aim' ? (this.frame % 120 < 60 ? '←→ 위치' : '가운데=방향') : s.state === 'power' ? '가운데=힘' : s.state === 'roll' ? '←→ 스핀!' : '';
      if (hint) KText.draw(ctx, hint, x0 + 32, 145, C('9'), { align: 'center', font: 'n', outline: C('1') });
    } else KText.draw(ctx, 'CPU 차례', x0 + 32, 132, C('j'), { align: 'center', font: 's', outline: C('1') });
    // 힘 · 스핀 게이지 (글자와 막대가 겹치지 않게)
    const bar = (label, k, col, y) => {
      KText.draw(ctx, label, x0 + 4, y - 3, C('k'), { font: 'n' });
      ctx.fillStyle = C('o');
      ctx.fillRect(x0 + 25, y, 35, 7);
      ctx.fillStyle = C(col);
      ctx.fillRect(x0 + 26, y + 1, Math.round(33 * k), 5);
      ctx.fillStyle = C('w');
      ctx.fillRect(x0 + 26, y + 1, Math.round(33 * k), 1);
    };
    const pw = s.state === 'power' ? s.power : s.state === 'roll' || s.state === 'show' ? s.power : 0;
    bar('힘', pw, pw > 0.85 ? '5' : pw > 0.5 ? '9' : 'e', 160);
    const b = this.rack.ball;
    const spin = s.state === 'roll' && b ? b.spin / CONFIG.SPIN_BUDGET : s.state === 'aim' || s.state === 'power' ? 1 : 0;
    bar('스핀', spin, 'h', 170);
  }
}
