// =====================================================
// 플레이: 인형뽑기 기계 5대 동시 (모두 같은 인형 배치)
//  코인 넣기 → ←→ 집게 옮기기 → 가운데 키로 내리기 → 자동으로 집고 · 올리고 · 배출구로 → 놓기
//  코인 8개를 다 쓰면 끝, 뽑은 인형 점수 합계로 순위
// =====================================================
class PlayScene {
  // opts: { mode, count, charIdx, embed, autoplay, seed }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    const personal = opts.mode === 'personal';
    const n = personal ? CONFIG.MAX_PLAYERS : opts.count;
    this.seed = opts.seed != null ? opts.seed : personal ? dateSeed() : (Math.random() * 1e9) | 0;
    const pile = makePile(this.seed);
    this.players = [];
    for (let i = 0; i < n; i++) {
      const human = !opts.autoplay && (personal ? i === opts.charIdx : true);
      const [s0, s1] = CONFIG.CPU_SKILL;
      const m = new Machine(this.seed);
      m.prizes = pile.map((p) => ({ ...p }));
      this.players.push({
        slot: i,
        index: i,
        def: CHARACTERS[i],
        name: CHARACTERS[i].name,
        human,
        bot: human ? null : new ClawBot(opts.autoplay ? 0.1 + Math.random() * 0.85 : s0 + Math.random() * (s1 - s0)),
        m,
        coins: CONFIG.COINS,
        msg: null,
        flash: 0,  // 획득하면 간판 전구가 빠르게 번쩍
        gold: 0,   // 황금곰이면 JACKPOT 간판 번쩍
        place: null,
      });
    }
    this.colX0 = Math.round((CONFIG.WIDTH - n * MACHINE.COL_W) / 2);
    this.phase = 'intro'; // intro | play | end
    this.t = 0;
    this.frame = 0;
    this.particles = new ParticleSystem();
    this.shake = 0;
    // 개인 화면: 내 기계 유리를 2배로 크게 (정수배라 픽셀 그대로)
    this.zoom = personal && !opts.autoplay;
    this.glassBuf = document.createElement('canvas');
    this.glassBuf.width = CONFIG.BOX.W;
    this.glassBuf.height = CONFIG.BOX.H;
    this.paused = false;
    this.pauseSel = 0;
  }

  enter() {
    this.game.audio.playBgm('game');
  }

  inputOf(p) {
    if (!p.human) return p.bot.think(p.m);
    const input = this.game.input;
    const k = this.opts.mode === 'personal' ? input.solo(p.index) : input.player(p.index);
    return { left: k.left, right: k.right, drop: k.skillPressed };
  }

  score(p) {
    return p.m.score;
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
    if (this.shake > 0) this.shake--;
    if (this.phase === 'intro') {
      if (this.t === 30 || this.t === 60) audio.sfx('coin');
      if (this.t >= 100) {
        this.phase = 'play';
        this.t = 0;
        audio.sfx('start');
      }
      return;
    }
    if (this.phase === 'end') {
      if (this.t === CONFIG.END_DELAY) this.game.changeScene(() => new ResultScene(this.game, this.players, this.opts), 'circle');
      // 끝나도 인형은 마저 굴러감
      for (const p of this.players) p.m.physics();
      return;
    }
    for (const p of this.players) this.updateMachine(p);
    if (this.players.every((p) => p.coins === 0 && p.m.claw.state === 'idle')) {
      this.phase = 'end';
      this.t = 0;
      const rows = buildResult(this.opts.mode, this.players).ranking;
      for (const r of rows) this.players.find((q) => q.slot === r.seat).place = r.rank;
      audio.sfx('win');
    }
  }

  updateMachine(p) {
    const audio = this.game.audio;
    const m = p.m;
    if (p.msg && ++p.msg.t > 70) p.msg = null;
    if (p.flash > 0) p.flash--;
    if (p.gold > 0) p.gold--;
    // 코인 넣기
    if (m.claw.state === 'idle' && p.coins > 0) {
      p.coins--;
      m.start();
      audio.sfx('chip');
    }
    m.update(this.inputOf(p));
    const G = this.glassPos(p);
    const gx = G.x;
    const gy = G.y;
    const s = G.s;
    for (const e of m.events) {
      if (e.type === 'drop') audio.sfx('whoosh');
      else if (e.type === 'grab') {
        audio.sfx('clack');
        p.msg = { text: '집었다!', color: 'a', t: 0 };
      }
      else if (e.type === 'miss') p.msg = { text: '헛손질…', color: 'j', t: 0 };
      else if (e.type === 'slip') {
        p.msg = { text: '미끄러짐!', color: '5', t: 0 };
        audio.sfx('miss');
      } else if (e.type === 'won') {
        const P = CONFIG.PRIZES[e.prize.type];
        const gold = e.prize.type === 'gold';
        p.msg = { text: gold ? `황금곰! +${P.value}` : `획득! +${P.value}`, color: gold ? '9' : 'e', t: 0, big: gold };
        audio.sfx(gold ? 'jackpot' : 'coin');
        p.flash = 60;
        if (gold) {
          p.gold = 90;
          this.shake = 12;
        }
        const cx = gx + (CONFIG.BOX.HOLE_W * s) / 2;
        const cy = gy + CONFIG.BOX.H * s;
        this.particles.burst(cx, cy, gold ? 30 : 14, gold ? [C('9'), C('8'), C('b')] : [C('9'), C('e'), C('b')], gold ? 1.8 : 1.2, 30, gold ? 2 : 1, 0.04);
      }
    }
    m.events.length = 0;
    // 집는 순간 반짝
    if (m.claw.state === 'close' && m.claw.t === CONFIG.CLAW.CLOSE_TIME - 1) {
      this.particles.add(gx + m.claw.x * s, gy + (m.claw.y + 9) * s, 0, -0.3, 12, C('b'), 1);
    }
  }

  // ---------------- 그리기 ----------------
  render(ctx) {
    const W = CONFIG.WIDTH;
    ctx.save();
    if (this.shake > 0) ctx.translate(this.shake % 2 ? 2 : -2, 0);
    drawArcade(ctx, this.frame);
    if (this.zoom) this.renderPersonal(ctx);
    else for (const p of this.players) this.renderMachine(ctx, p);
    this.particles.render(ctx);
    ctx.restore();
    if (!this.demo && !this.zoom) this.renderTop(ctx);
    if (this.phase === 'intro' && !this.demo) {
      drawCard(ctx, W / 2 - 70, 70, 140, 32, '7', '9');
      KText.draw(ctx, '코인을 넣는 중…', W / 2, 73, C('9'), { align: 'center', font: 'b', outline: C('1') });
      KText.draw(ctx, `한 사람 ${CONFIG.COINS}번 도전!`, W / 2, 87, C('a'), { align: 'center', font: 's' });
    }
    if (this.phase === 'end' && this.t > 10 && this.t < CONFIG.END_DELAY - 20) {
      drawCard(ctx, W / 2 - 60, 74, 120, 26, '6', '9');
      KText.draw(ctx, '영업 종료!', W / 2, 77, C('9'), { align: 'center', font: 'L', outline: C('1') });
    }
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

  renderTop(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 14);
    ctx.fillStyle = C('4');
    ctx.fillRect(0, 13, W, 1);
    KText.draw(ctx, '잭팟 인형뽑기', 4, 1, C('9'), { font: 'b' });
    KText.draw(ctx, `황금곰 ${CONFIG.PRIZES.gold.value}점 · 주사위 ${CONFIG.PRIZES.dice.value} · 인형 10 · 칩 5`, W - 4, 2, C('k'), { font: 'n', align: 'right' });
  }

  // 기계 유리의 화면 위치 · 확대 배율
  glassPos(p) {
    if (this.zoom && p.human) return { x: 6, y: 6, s: 2 };
    if (this.zoom) return { x: -999, y: -999, s: 1 };
    const x0 = this.colX0 + p.slot * MACHINE.COL_W;
    return { x: x0 + MACHINE.GLASS_X, y: MACHINE.GLASS_Y, s: 1 };
  }

  // 기계 위 글자: 어두운 꼬리표 위에 (유리를 가로지르지 않게 작게)
  drawMsg(ctx, cx, y, msg, w) {
    const font = msg.big ? 's' : 'n';
    const tw = Math.min(w, KText.width(msg.text, font) + 8);
    const yy = Math.round(y - Math.min(4, msg.t / 4));
    ctx.fillStyle = C(msg.color);
    ctx.fillRect(Math.round(cx - tw / 2), yy, tw, msg.big ? 15 : 12);
    ctx.fillStyle = C('1');
    ctx.fillRect(Math.round(cx - tw / 2) + 1, yy + 1, tw - 2, msg.big ? 13 : 10);
    KText.draw(ctx, msg.text, cx, yy + 1, C(msg.color), { align: 'center', font });
  }

  // 옮기는 남은 시간: 시계 그림 + 숫자
  drawTimer(ctx, xr, y, m) {
    if (m.claw.state !== 'move' || this.phase !== 'play') return;
    const sec = Math.ceil((CONFIG.MOVE_TIME - m.claw.t) / 60);
    const urgent = sec <= 3 && this.frame % 20 < 10;
    const txt = `${sec}초`;
    const tw = KText.width(txt, 'n') + 13;
    ctx.fillStyle = C('1');
    ctx.fillRect(xr - tw, y, tw, 11);
    drawPixelRing(ctx, xr - tw + 5, y + 5, 3, C(urgent ? '5' : '9'));
    ctx.fillStyle = C(urgent ? '5' : '9');
    ctx.fillRect(xr - tw + 5, y + 3, 1, 3);
    KText.draw(ctx, txt, xr - 2, y, C(urgent ? '5' : '9'), { font: 'n', align: 'right' });
  }

  renderMachine(ctx, p) {
    const x0 = this.colX0 + p.slot * MACHINE.COL_W;
    const m = p.m;
    drawNameCard(ctx, x0 + 2, 15, 60, { def: p.def, name: p.name, index: p.index, place: this.phase === 'end' ? p.place : null }, this.frame);
    drawMachine(ctx, x0, m, { frame: this.frame + p.slot * 13, color: p.def.color, flash: p.flash, gold: p.gold });
    const gx = x0 + MACHINE.GLASS_X;
    const gy = MACHINE.GLASS_Y;
    this.drawTimer(ctx, gx + CONFIG.BOX.W, gy + 5, m);
    if (p.msg) this.drawMsg(ctx, x0 + 32, gy + 18, p.msg, 60);
    if (p.coins === 0 && m.claw.state === 'idle' && this.phase === 'play') {
      ctx.fillStyle = C('1');
      ctx.fillRect(gx + 8, gy + 30, CONFIG.BOX.W - 16, 12);
      KText.draw(ctx, '코인 끝', x0 + 32, gy + 31, C('k'), { align: 'center', font: 'n' });
    }
    if (this.opts.mode === 'personal' && p.human) {
      ctx.fillStyle = C('9');
      ctx.fillRect(x0, MACHINE.TOP, 1, 110);
      ctx.fillRect(x0 + 63, MACHINE.TOP, 1, 110);
    }
    // 아래: 코인 (그림 + 남은 개수) · 점수
    ctx.fillStyle = C('1');
    ctx.fillRect(x0, 143, MACHINE.COL_W, 13);
    drawCoinIcon(ctx, x0 + 3, 146);
    BitmapFont.draw(ctx, `X${p.coins}`, x0 + 11, 147, p.coins ? C('9') : C('i'));
    KText.draw(ctx, `${this.score(p)}점`, x0 + 62, 144, C('9'), { font: 'n', align: 'right' });
    this.renderKeys(ctx, p, x0 + 32, 158);
  }

  renderKeys(ctx, p, cx, y) {
    if (p.human) {
      const input = this.game.input;
      const solo = this.opts.mode === 'personal';
      const K = KEYMAP[p.index];
      const labels = solo ? ['<', '^', '>'] : K.keys;
      const k = solo ? input.solo(p.index) : input.player(p.index);
      const held = [k.left, k.skillHeld, k.right];
      const caps = labels.map((l, j) => getKeycap(l, j === 1 ? 'strike' : 'plain', !!held[j]));
      const tw = caps.reduce((s2, c) => s2 + c.width, 0) + 2;
      let kx = Math.round(cx - tw / 2);
      caps.forEach((c) => {
        ctx.drawImage(c, kx, y);
        kx += c.width + 1;
      });
    } else KText.draw(ctx, 'CPU', cx, y + 3, C('j'), { align: 'center', font: 'b' });
  }

  // 개인 화면: 왼쪽에 내 기계 유리를 2배로, 오른쪽에 내 정보 + CPU 4명 기록
  renderPersonal(ctx) {
    const me = this.players.find((q) => q.human);
    const m = me.m;
    const B = CONFIG.BOX;
    const f = this.frame;
    // 유리 테두리 (기계 몸체 느낌)
    drawCard(ctx, 2, 2, B.W * 2 + 8, B.H * 2 + 8, '7', me.def.color);
    // 2배 확대 유리
    const g = this.glassBuf.getContext('2d');
    g.clearRect(0, 0, B.W, B.H);
    drawGlass(g, 0, 0, m, f);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.glassBuf, 0, 0, B.W, B.H, 6, 6, B.W * 2, B.H * 2);
    drawGlassLabels(ctx, 6, 6, 2);
    this.drawTimer(ctx, 6 + B.W * 2 - 2, 10, m);
    if (me.msg) this.drawMsg(ctx, 6 + B.W, 34, me.msg, 110);
    if (me.coins === 0 && m.claw.state === 'idle' && this.phase === 'play') {
      ctx.fillStyle = C('1');
      ctx.fillRect(30, 70, 68, 14);
      KText.draw(ctx, '코인 끝', 64, 71, C('k'), { align: 'center', font: 's' });
    }
    // 오른쪽 패널
    const px = 130;
    ctx.fillStyle = C('1');
    ctx.fillRect(px - 2, 0, CONFIG.WIDTH - px + 2, CONFIG.HEIGHT);
    KText.draw(ctx, '잭팟 인형뽑기', px + 2, 1, C('9'), { font: 'b' });
    const flash = me.flash > 0 && f % 6 < 3;
    BitmapFont.draw(ctx, 'JACKPOT', CONFIG.WIDTH - 4, 4, me.gold > 0 ? C(f % 6 < 3 ? 'b' : '5') : flash ? C('b') : C('8'), { align: 'right' });
    drawNameCard(ctx, px + 2, 16, 98, { def: me.def, name: me.name, index: me.index, place: this.phase === 'end' ? me.place : null }, f);
    // 코인 · 점수
    drawCoinIcon(ctx, px + 104, 20);
    BitmapFont.draw(ctx, `X${me.coins}`, px + 113, 21, C('9'), { scale: 2 });
    KText.draw(ctx, `${this.score(me)}점`, CONFIG.WIDTH - 4, 34, C('9'), { font: 'L', align: 'right', outline: C('1') });
    KText.draw(ctx, '뽑은 인형', px + 2, 38, C('k'), { font: 'n' });
    // 뽑은 인형 (큰 그림으로 줄 세움)
    m.won.slice(-8).forEach((q, i) => {
      const img = PLUSH[q.type];
      ctx.drawImage(img, px + 2 + i * 22 - Math.round((img.width - 14) / 2), 52);
    });
    if (!m.won.length) KText.draw(ctx, '아직 없음', px + 2, 54, C('i'), { font: 'n' });
    KText.draw(ctx, `황금곰 ${CONFIG.PRIZES.gold.value} · 주사위 ${CONFIG.PRIZES.dice.value} · 인형 10 · 칩 5`, px + 2, 72, C('j'), { font: 'n' });
    this.renderKeys(ctx, me, px + 94, 86);
    KText.draw(ctx, '←→ 옮기기 · 가운데 = 내리기', px + 94, 106, C('k'), { align: 'center', font: 'n' });
    // CPU 기록
    let y = 120;
    for (const q of this.players) {
      if (q === me) continue;
      ctx.fillStyle = C('2');
      ctx.fillRect(px + 1, y, CONFIG.WIDTH - px - 4, 13);
      ctx.drawImage(SPR.players[q.index].face, px + 2, y - 2);
      KText.draw(ctx, q.name, px + 21, y + 1, C(q.def.color), { font: 'n' });
      drawWonRow(ctx, px + 66, y + 3, q.m.won, 6);
      KText.draw(ctx, `${this.score(q)}점`, CONFIG.WIDTH - 5, y + 1, C('a'), { font: 'n', align: 'right' });
      y += 14;
    }
  }
}
