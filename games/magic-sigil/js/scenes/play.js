// =====================================================
// 마법진 그리기: 마우스를 차례로 넘기며 같은 마법진을 따라 그림
//  라운드 슬롯머신(마법진 + 저주) → (한 명씩) 준비 → 그리기 → 채점 연출 → … → 갤러리 → 다음 라운드
//  저주: 기억 마법 / 거울 저주 / 투명 잉크 / 흔들 종이 / 번개 마법
//  마지막은 잭팟 라운드 (점수 2배)
// =====================================================
const PAPER_X = 100;
const PAPER_Y = 28;

class PlayScene {
  // opts: { mode, count, charIdx, embed, autoplay, seed }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    const personal = opts.mode === 'personal';
    const n = personal ? 1 : opts.count;
    this.players = [];
    for (let i = 0; i < n; i++) {
      const idx = personal ? opts.charIdx : i;
      this.players.push({ slot: i, index: idx, def: CHARACTERS[idx], name: CHARACTERS[idx].name, rounds: [], total: 0 });
    }
    // 개인 화면은 오늘 날짜 seed → 모두 같은 마법진·저주로 점수 비교
    this.seed = opts.seed != null ? opts.seed : personal ? dateSeed() : (Math.random() * 1e9) | 0;
    this.plan = planRounds(this.seed);
    this.round = 0;
    this.turn = 0;
    this.state = 'intro'; // intro | ready | draw | score | gallery | done
    this.t = 0;
    this.frame = 0;
    this.paper = null;
    this.particles = new ParticleSystem();
    this.doneBtn = new Button('완료', 236, 158, 76, 16);
    this.shown = 0; // 채점 숫자 올라가는 연출
    this.live = 0; // 그리는 중 실시간 정확도
    this.streak = 0; // 선 위에서 연속으로 그린 프레임
    this.icons = []; // 마법 발동 때 튀어나오는 모양 아이콘 (별 · 하트 · 달 …)
    this.spell = null;
  }

  enter() {
    this.game.audio.playBgm('lobby');
  }

  get P() {
    return this.plan[this.round];
  }

  get shape() {
    return SHAPES[this.P.shape];
  }

  get twist() {
    return this.P.twist;
  }

  get drawTime() {
    return this.twist === 'speed' ? CONFIG.SPEED_TIME : CONFIG.DRAW_TIME;
  }

  get cur() {
    return this.players[this.turn];
  }

  // 흔들 종이: 그리는 동안 종이 위치가 출렁임
  get offset() {
    if (this.state !== 'draw' || this.twist !== 'shake') return { x: 0, y: 0 };
    const t = this.t;
    return {
      x: Math.round(Math.sin(t / 19) * CONFIG.SHAKE.X + Math.sin(t / 7) * 2),
      y: Math.round(Math.cos(t / 23) * CONFIG.SHAKE.Y),
    };
  }

  // 종이 위의 펜 좌표 (종이 밖이면 null). 거울 저주면 좌우 반대
  paperMouse() {
    const m = this.game.input.mouse;
    if (!m) return null;
    const o = this.offset;
    let x = m.x - PAPER_X - o.x;
    const y = m.y - PAPER_Y - o.y;
    const S = CONFIG.CANVAS;
    if (x < 0 || y < 0 || x >= S || y >= S) return null;
    if (this.state === 'draw' && this.twist === 'mirror') x = S - 1 - x;
    return { x, y };
  }

  // 안내선이 보이나
  get guideVisible() {
    if (this.state === 'draw') return this.twist !== 'memory' || this.t < CONFIG.MEMORY_TIME;
    return true;
  }

  setState(s) {
    this.state = s;
    this.t = 0;
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    const m = input.mouse;
    this.frame++;
    this.t++;
    this.particles.update();
    this.doneBtn.update();
    for (const ic of this.icons) {
      ic.x += ic.vx;
      ic.y += ic.vy;
      ic.vy += 0.03;
      ic.life--;
    }
    this.icons = this.icons.filter((ic) => ic.life > 0);
    if (this.spell && ++this.spell.t > 90) this.spell = null;
    const go = input.confirm() || (m && m.pressed);

    if (this.state === 'intro') return this.updateIntro(go);
    if (this.state === 'ready') {
      // 다음 사람이 마우스를 받아서 클릭하면 시작 (넘겨주는 시간은 안 셈)
      if ((this.t > 20 && go) || (this.opts.autoplay && this.t > 30)) {
        this.paper = new Paper();
        this.auto = this.opts.autoplay ? new AutoDrawer(this.shape, 0.15 + Math.random() * 0.8) : null;
        this.armed = !(m && m.down); // 시작 클릭을 뗀 뒤부터 그려짐
        this.live = 0;
        this.streak = 0;
        this.setState('draw');
        audio.sfx('go');
      }
      return;
    }
    if (this.state === 'draw') return this.updateDraw(input, m);
    if (this.state === 'score') {
      if (this.shown < this.result.total) this.shown = Math.min(this.result.total, this.shown + 3);
      if (this.t === 30) this.spellEffect();
      if (this.t >= CONFIG.SCORE_SHOW || (this.t > 36 && go && !this.opts.autoplay)) {
        if (this.turn < this.players.length - 1) {
          this.turn++;
          this.setState('ready');
        } else {
          this.setState('gallery');
          audio.sfx('flip');
        }
      }
      return;
    }
    if (this.state === 'gallery') {
      if (this.t === 50) audio.sfx('win');
      if (this.t >= CONFIG.GALLERY_TIME || (this.t > 40 && go)) {
        if (this.round < this.plan.length - 1) {
          this.round++;
          this.setState('intro');
          audio.sfx('start');
        } else {
          this.setState('done');
          this.game.changeScene(() => new ResultScene(this.game, this.players, this.opts, this.plan), 'circle');
        }
      }
    }
  }

  // 슬롯머신: 마법진 릴 → 저주 릴 순서로 멈춤
  updateIntro(go) {
    const audio = this.game.audio;
    const t = this.t;
    if (t < 70 && t % 5 === 0) audio.sfx('tick');
    if (t === 70) audio.sfx('slotStop');
    if (t > 70 && t < 110 && t % 5 === 0) audio.sfx('tick');
    if (t === 110) {
      audio.sfx('slotStop');
      if (this.twist !== 'none') audio.sfx('warning');
    }
    if (t === 125 && this.P.mult > 1) {
      audio.sfx('jackpot');
      for (let i = 0; i < 40; i++) this.particles.add(40 + Math.random() * 240, -4, (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, 120, C(i % 3 ? '9' : '8'), 2, 0.02);
    }
    if (t >= CONFIG.ROUND_INTRO || (t > 112 && go)) {
      this.turn = 0;
      this.setState('ready');
      audio.sfx('select');
    }
  }

  updateDraw(input, m) {
    const audio = this.game.audio;
    if (this.t === CONFIG.MEMORY_TIME && this.twist === 'memory') audio.sfx('whoosh');
    const left = this.drawTime - this.t;
    if (left > 0 && left <= 180 && left % 60 === 0) audio.sfx('countdown');
    let p = null;
    if (this.auto) {
      p = this.auto.next();
      if (!p) return this.finishTurn(true);
    } else if (m && m.down && this.armed) {
      p = this.paperMouse();
    } else if (m && !m.down) this.armed = true;
    if (p) this.inkAt(p);
    else this.paper.end();
    if (this.t % 10 === 0) this.live = scoreDrawing(this.paper, this.shape).accuracy;
    // 일찍 끝내기: Space / Enter / 오른쪽 클릭 / 완료 버튼
    const b = this.doneBtn;
    const onBtn = m && m.pressed && m.x >= b.x && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h;
    if (this.t > 20 && (input.confirm() || (m && m.right) || onBtn)) {
      b.press();
      return this.finishTurn(true);
    }
    if (this.t >= this.drawTime) this.finishTurn(false);
  }

  // 펜 한 번 찍기 + 선 위면 반짝이 / 벗어나면 연기
  inkAt(p) {
    const S = CONFIG.CANVAS;
    const prep = prepareShape(this.shape);
    const ix = Math.max(0, Math.min(S - 1, Math.round(p.x)));
    const iy = Math.max(0, Math.min(S - 1, Math.round(p.y)));
    const on = prep.dist[iy * S + ix] <= CONFIG.SCORE.NEAT_RADIUS;
    this.paper.stroke(p.x, p.y, on ? PALETTE['1'] : PALETTE['5']); // 선 위 = 검정 · 벗어나면 밝은 빨강
    if (this.twist === 'ghost') return; // 투명 잉크: 반응도 안 보임
    const o = this.offset;
    const sx = PAPER_X + o.x + ix;
    const sy = PAPER_Y + o.y + iy;
    if (on) {
      this.streak++;
      if (this.streak % 3 === 0) this.particles.add(sx, sy, (Math.random() - 0.5) * 0.8, -0.3 - Math.random() * 0.5, 22, C(this.streak % 9 ? this.shape.color : 'b'), 1);
      if (this.streak % 60 === 0) {
        this.particles.text(sx, sy - 8, this.streak >= 180 ? '대단해!' : '좋아!', C('9'), { kind: 'k', life: 40 });
        this.game.audio.sfx('coin');
      }
    } else {
      if (this.streak > 10) this.game.audio.sfx('tap');
      this.streak = 0;
      if (this.frame % 6 === 0) this.particles.add(sx, sy, (Math.random() - 0.5) * 0.4, -0.4, 26, C(this.frame % 12 ? 'j' : 'i'), 2);
    }
  }

  // 그리기 끝 → 채점
  finishTurn(early) {
    const sc = scoreDrawing(this.paper, this.shape);
    const S = CONFIG.SCORE;
    const left = Math.max(0, this.drawTime - this.t);
    const per = S.TIME_BONUS * (this.twist === 'speed' ? 2 : 1);
    const bonus = early && sc.accuracy >= S.OKAY ? Math.min(16, Math.floor(left / 60) * per) : 0;
    const mult = this.P.mult;
    this.result = { ...sc, bonus, mult, total: (sc.accuracy + bonus) * mult, img: this.paper.canvas };
    this.cur.rounds[this.round] = this.result;
    this.cur.total += this.result.total;
    this.shown = 0;
    this.paper.end();
    this.setState('score');
    this.game.audio.sfx('lock');
  }

  // 그린 선을 금색으로 칠한 사본 (합성만 사용 → file:// 에서도 동작)
  goldInk() {
    if (this.gold && this.gold.src === this.paper) return this.gold.c;
    const c = document.createElement('canvas');
    c.width = c.height = CONFIG.CANVAS;
    const g = c.getContext('2d');
    g.drawImage(this.paper.canvas, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = C('9');
    g.fillRect(0, 0, c.width, c.height);
    this.gold = { src: this.paper, c };
    return c;
  }

  // 점수에 따라 마법 발동 / 그럭저럭 / 펑!
  spellEffect() {
    const S = CONFIG.SCORE;
    const acc = this.result.accuracy;
    const path = prepareShape(this.shape).path;
    const audio = this.game.audio;
    if (acc >= S.SUCCESS) {
      this.spell = { t: 0, ok: true, icon: SPELL_ICON[this.shape.short] || 'star', color: this.shape.color };
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        this.icons.push({ x: PAPER_X + 60, y: PAPER_Y + 60, vx: Math.cos(a) * (1 + Math.random()), vy: Math.sin(a) * (1 + Math.random()) - 0.6, life: 60 + Math.random() * 20, icon: this.spell.icon, color: i % 3 ? this.shape.color : '9' });
      }
      for (let i = 0; i < path.length; i += 6) {
        const [x, y] = path[i];
        this.particles.add(PAPER_X + x, PAPER_Y + y, (Math.random() - 0.5) * 0.6, -0.4 - Math.random() * 0.6, 50, C(i % 12 ? '9' : 'b'), 1);
      }
      this.particles.ring(PAPER_X + 60, PAPER_Y + 60, 2.2, C('9'), 26);
      audio.sfx('jackpot');
    } else if (acc >= S.OKAY) {
      this.particles.burst(PAPER_X + 60, PAPER_Y + 60, 16, [C(this.shape.color), C('a')], 1.2, 30, 1);
      audio.sfx('coin');
    } else {
      this.spell = { t: 0, ok: false };
      this.particles.burst(PAPER_X + 60, PAPER_Y + 60, 40, [C('i'), C('j'), C('k'), C('1')], 1.8, 60, 3, -0.02);
      audio.sfx('explode');
    }
  }

  // ---------------- 그리기 ----------------
  render(ctx) {
    drawBackdrop(ctx, this.frame);
    this.renderHeader(ctx);
    this.renderLeft(ctx);
    this.renderBoard(ctx);
    this.renderSpellBack(ctx);
    this.renderPaper(ctx);
    this.particles.render(ctx);
    for (const ic of this.icons) drawSpellIcon(ctx, ic.x, ic.y, ic.icon, ic.color, ic.life < 15 && ic.life % 4 < 2);
    if (this.spell && !this.spell.ok && this.spell.t < 60) {
      // 펑! 큰 글자
      const s = this.spell.t;
      KText.draw(ctx, '펑!', PAPER_X + 60, PAPER_Y + 8 - Math.min(6, s / 3), C('j'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    }
    this.renderBottom(ctx);
    if (this.state === 'intro') this.renderSlot(ctx);
    if (this.state === 'gallery') this.renderGallery(ctx);
  }

  renderHeader(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 14);
    KText.draw(ctx, '마법진 그리기', 4, 1, C('9'), { font: 'b' });
    const jack = this.P.mult > 1 ? ' ×2' : '';
    KText.draw(ctx, `라운드 ${this.round + 1}/${this.plan.length} · ${this.shape.name}${jack}`, W - 4, 1, jack && this.frame % 30 < 20 ? C('9') : C('a'), { font: 's', align: 'right' });
    const k = this.state === 'draw' ? 1 - this.t / this.drawTime : this.state === 'ready' ? 1 : 0;
    ctx.fillStyle = C('2');
    ctx.fillRect(0, 13, W, 2);
    ctx.fillStyle = k < 0.25 && this.frame % 20 < 10 ? C('5') : C('9');
    ctx.fillRect(0, 13, Math.round(W * Math.max(0, k)), 2);
  }

  // 가운데 양피지: 안내선 + 그린 그림
  renderPaper(ctx) {
    const S = CONFIG.CANVAS;
    const o = this.offset;
    const x = PAPER_X + o.x;
    const y = PAPER_Y + o.y;
    const tw = CONFIG.TWISTS[this.twist];
    drawCard(ctx, x - 3, y - 3, S + 6, S + 6, 'l', this.twist === 'shake' ? '8' : 'r');
    ctx.fillStyle = C('a');
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = DITHER.get(ctx, 'n', 2);
    ctx.fillRect(x, y, S, S);
    const success = this.state === 'score' && this.t > 30 && this.result.accuracy >= CONFIG.SCORE.SUCCESS;
    if (this.guideVisible) {
      if (this.state === 'draw' && this.twist === 'mirror') {
        // 거울 저주: 가운데 거울 줄
        ctx.fillStyle = DITHER.get(ctx, 'h', 6);
        ctx.fillRect(x + S / 2, y, 1, S);
      }
      ctx.drawImage(guideImage(this.shape), x, y);
    } else if (this.state === 'draw') {
      KText.draw(ctx, '기억나요?', x + S / 2, y + 2, C('i'), { align: 'center', font: 'n' });
    }
    const showInk = this.state === 'score' || (this.state === 'draw' && this.twist !== 'ghost');
    if (this.paper && showInk) {
      ctx.drawImage(this.paper.canvas, x, y);
      if (success && this.frame % 10 < 6) ctx.drawImage(this.goldInk(), x, y);
    }
    if (this.state === 'draw' && this.twist === 'ghost') {
      // 투명 잉크: 2초마다 아주 잠깐 비침
      if (this.t % 120 > 112 && this.paper) ctx.drawImage(this.paper.canvas, x, y);
      KText.draw(ctx, '선이 안 보여요…', x + S / 2, y + S - 13, C('j'), { align: 'center', font: 'n' });
    }
    if (success) {
      ctx.fillStyle = DITHER.get(ctx, '9', this.frame % 20 < 10 ? 3 : 1);
      ctx.fillRect(x, y, S, S);
    }
    // 마우스 펜 커서 (실제 마우스 위치)
    const m = this.game.input.mouse;
    if (this.state === 'draw' && !this.auto && m && m.inside && m.x >= x && m.x < x + S && m.y >= y && m.y < y + S) {
      const cx = Math.round(m.x);
      const cy = Math.round(m.y);
      ctx.fillStyle = C('1');
      ctx.fillRect(cx - 1, cy - 6, 3, 6);
      ctx.fillStyle = C(this.cur.def.color);
      ctx.fillRect(cx, cy - 5, 1, 4);
      ctx.fillStyle = C('1');
      ctx.fillRect(cx, cy, 1, 1);
      if (this.twist === 'mirror') {
        // 실제로 잉크가 찍히는 자리 (반대편) 를 작은 십자로
        const mx = x + (S - 1 - (cx - x));
        ctx.fillStyle = C('g');
        ctx.fillRect(mx - 2, cy, 5, 1);
        ctx.fillRect(mx, cy - 2, 1, 5);
      }
    }
    if (this.state === 'ready') {
      ctx.fillStyle = DITHER.get(ctx, 'o', 8);
      ctx.fillRect(x, y, S, S);
      drawCard(ctx, x + 6, y + 34, S - 12, 52, '2', this.cur.def.color);
      KText.draw(ctx, `${this.cur.name} 차례!`, x + S / 2, y + 37, C(this.cur.def.color), { align: 'center', font: 'b', outline: C('1') });
      KText.draw(ctx, tw.name, x + S / 2, y + 52, C(tw.color), { align: 'center', font: 's' });
      if (this.frame % 40 < 28) KText.draw(ctx, '클릭하면 시작', x + S / 2, y + 67, C('a'), { align: 'center', font: 's' });
    }
    // 저주 이름표 (종이 위)
    if (this.twist !== 'none' && this.state !== 'intro') {
      const w = KText.width(tw.name, 's') + 10;
      drawCard(ctx, PAPER_X + S / 2 - w / 2, 14, w, 14, '1', tw.color);
      KText.draw(ctx, tw.name, PAPER_X + S / 2, 15, C(tw.color), { align: 'center', font: 's' });
    }
    if (this.state === 'score') {
      const r = this.result;
      const S2 = CONFIG.SCORE;
      const label = r.accuracy >= S2.SUCCESS ? '마법 발동!' : r.accuracy >= S2.OKAY ? '그럭저럭!' : '펑! 실패';
      const col = r.accuracy >= S2.SUCCESS ? '9' : r.accuracy >= S2.OKAY ? 'e' : 'j';
      if (this.t > 30) {
        drawCard(ctx, x + 8, y + 32, S - 16, 54, '1', col);
        KText.draw(ctx, label, x + S / 2, y + 35, C(col), { align: 'center', font: 'b' });
        KText.draw(ctx, `${this.shown}점`, x + S / 2, y + 50, C('a'), { align: 'center', font: 'L', outline: C('1') });
        const detail = `정확도 ${r.accuracy}${r.bonus ? ` + 빨리 ${r.bonus}` : ''}${r.mult > 1 ? ` ×${r.mult}` : ''}`;
        KText.draw(ctx, detail, x + S / 2, y + 70, r.mult > 1 ? C('9') : C('k'), { align: 'center', font: 'n' });
      }
    }
  }

  // 마법 발동: 종이 뒤로 돌아가는 빛줄기
  renderSpellBack(ctx) {
    if (!this.spell || !this.spell.ok) return;
    const cx = PAPER_X + 60;
    const cy = PAPER_Y + 60;
    const n = 12;
    // 가운데 칸 안에서만 (양옆 점수판 · 이름표 글씨를 가리지 않게)
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAPER_X - 5, 15, CONFIG.CANVAS + 10, 140);
    ctx.clip();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + this.spell.t / 30;
      const a1 = a0 + Math.PI / n;
      ctx.fillStyle = DITHER.get(ctx, i % 2 ? '9' : this.spell.color, 4);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * 140, cy + Math.sin(a0) * 140);
      ctx.lineTo(cx + Math.cos(a1) * 140, cy + Math.sin(a1) * 140);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 왼쪽: 지금 그리는 사람 + 실시간 마력 + 다음 차례
  renderLeft(ctx) {
    const p = this.cur;
    drawCard(ctx, 4, 20, 90, 132, '2', p.def.color);
    drawNameCard(ctx, 8, 24, 82, { def: p.def, name: p.name, index: p.index, place: null }, this.frame);
    const img = SPR.players[p.index].frames[((this.frame / 16) | 0) % 2];
    const scored = this.state === 'score' && this.t > 30;
    const hop = scored && this.result.accuracy >= CONFIG.SCORE.SUCCESS ? Math.round(Math.abs(Math.sin(this.frame / 6)) * 4) : 0;
    const shiver = scored && this.result.accuracy < CONFIG.SCORE.OKAY ? (this.frame % 4 < 2 ? 1 : -1) : 0;
    // 그리는 동안: 잘 그리면 신나서 통통, 못 그리면 땀 · 지팡이 끝 반짝이
    let dHop = 0;
    if (this.state === 'draw' && this.twist !== 'ghost') {
      if (this.live >= CONFIG.SCORE.SUCCESS) dHop = Math.round(Math.abs(Math.sin(this.frame / 5)) * 3);
      else if (this.live >= CONFIG.SCORE.OKAY) dHop = Math.round(Math.abs(Math.sin(this.frame / 9)) * 1);
    }
    drawStanding(ctx, img, 49 + shiver, 92 - hop - dHop);
    if (this.state === 'draw') {
      // 지팡이 (오른손 쪽) + 끝 반짝
      ctx.fillStyle = C('1');
      ctx.fillRect(66, 58 - dHop, 2, 16);
      ctx.fillStyle = C('l');
      ctx.fillRect(66, 59 - dHop, 1, 14);
      const tip = this.streak > 0 && this.frame % 6 < 3 ? C('b') : C(this.shape.color);
      ctx.fillStyle = C('1');
      ctx.fillRect(64, 54 - dHop, 6, 5);
      ctx.fillStyle = tip;
      ctx.fillRect(65, 55 - dHop, 4, 3);
      if (this.streak > 0 && this.frame % 4 === 0) this.particles.add(67, 55 - dHop, (Math.random() - 0.5) * 0.6, -0.5, 20, C(this.shape.color), 1);
      if (this.t > 90 && this.live < CONFIG.SCORE.OKAY && this.twist !== 'ghost') {
        // 땀 방울
        const sy = 50 + ((this.frame >> 2) % 8);
        ctx.fillStyle = C('h');
        ctx.fillRect(33, sy, 2, 3);
        ctx.fillStyle = C('b');
        ctx.fillRect(33, sy, 1, 1);
      }
    }
    if (this.state === 'draw') {
      const sec = Math.ceil((this.drawTime - this.t) / 60);
      KText.draw(ctx, `${sec}초`, 49, 92, sec <= 3 ? C('5') : C('a'), { align: 'center', font: 'L', outline: C('1') });
      // 마력 게이지 = 지금까지 그린 정확도
      KText.draw(ctx, '마력', 10, 111, C('q'), { font: 'n' });
      ctx.fillStyle = C('1');
      ctx.fillRect(32, 113, 56, 8);
      if (this.twist === 'ghost') {
        KText.draw(ctx, '???', 60, 111, C('j'), { align: 'center', font: 'n' });
      } else {
        const k = this.live / 100;
        const col = this.live >= CONFIG.SCORE.SUCCESS ? '9' : this.live >= CONFIG.SCORE.OKAY ? 'e' : 'q';
        ctx.fillStyle = C(col);
        ctx.fillRect(33, 114, Math.round(54 * k), 6);
        ctx.fillStyle = C('w');
        ctx.fillRect(33, 114, Math.round(54 * k), 1);
        // 성공 기준선
        const gx = 33 + Math.round((54 * CONFIG.SCORE.SUCCESS) / 100);
        ctx.fillStyle = C('b');
        ctx.fillRect(gx, 112, 1, 10);
        BitmapFont.draw(ctx, String(CONFIG.SCORE.SUCCESS), gx, 106, C('9'), { align: 'center' });
        KText.draw(ctx, '발동', 88, 122, C('j'), { font: 'n', align: 'right' });
      }
    } else {
      const status = { intro: '준비', ready: '마우스 받기!', score: '채점', gallery: '감상 시간', done: '' }[this.state];
      KText.draw(ctx, status, 49, 94, C('9'), { align: 'center', font: 'b', outline: C('1') });
    }
    // 다음 차례 얼굴들
    if (this.players.length > 1) {
      KText.draw(ctx, '다음', 10, 132, C('k'), { font: 'n' });
      let k = 0;
      for (let i = this.turn + 1; i < this.players.length && k < 3; i++, k++) ctx.drawImage(SPR.players[this.players[i].index].face, 34 + k * 19, 130);
    }
  }

  // 오른쪽: 점수판 (혼자면 라운드별 기록)
  renderBoard(ctx) {
    drawCard(ctx, 226, 20, 90, 132, '2', '3');
    if (this.players.length === 1) return this.renderSoloBoard(ctx);
    KText.draw(ctx, '점수판', 271, 22, C('9'), { align: 'center', font: 'b' });
    const sorted = [...this.players].sort((a, b) => b.total - a.total);
    sorted.forEach((p, i) => {
      const y = 36 + i * 23;
      const me = p === this.cur && this.state !== 'gallery';
      ctx.drawImage(SPR.players[p.index].face, 230, y + 2);
      // 1줄: 이름 / 2줄: 합계 + 이번 라운드 점수
      KText.draw(ctx, p.name, 250, y, me ? C('9') : C(p.def.color), { font: KText.width(p.name, 's') > 60 ? 'n' : 's', outline: C('1') });
      KText.draw(ctx, `${p.total}점`, 250, y + 11, C('a'), { font: 'n' });
      const last = p.rounds[this.round];
      if (last) KText.draw(ctx, `+${last.total}`, 312, y + 11, C('e'), { font: 'n', align: 'right' });
    });
  }

  renderSoloBoard(ctx) {
    const p = this.players[0];
    KText.draw(ctx, '내 기록', 271, 22, C('9'), { align: 'center', font: 'b' });
    this.plan.forEach((r, i) => {
      const y = 38 + i * 30;
      const sh = SHAPES[r.shape];
      const cur = i === this.round && this.state !== 'gallery';
      ctx.fillStyle = C(cur ? '3' : '1');
      ctx.fillRect(230, y, 82, 27);
      if (i <= this.round) ctx.drawImage(previewImage(sh), 0, 0, 60, 60, 231, y + 1, 25, 25);
      else KText.draw(ctx, '?', 243, y + 7, C('j'), { align: 'center', font: 'b' });
      KText.draw(ctx, `${i + 1}R${r.mult > 1 ? ' ×2' : ''}`, 259, y + 1, r.mult > 1 ? C('9') : C('k'), { font: 'n' });
      const rr = p.rounds[i];
      const txt = rr ? `${rr.total}점` : i <= this.round ? '그리는 중' : '';
      KText.draw(ctx, txt, 310, y + 13, rr ? (rr.accuracy >= CONFIG.SCORE.SUCCESS ? C('9') : C('a')) : C('j'), { font: rr ? 's' : 'n', align: 'right' });
    });
    KText.draw(ctx, `합계 ${p.total}점`, 271, 132, C('9'), { align: 'center', font: 's', outline: C('1') });
  }

  renderBottom(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 155, W, 25);
    const tw = CONFIG.TWISTS[this.twist];
    if (this.state === 'draw') {
      const msg = this.twist === 'none' ? '누른 채 그리기 · 다 그렸으면 완료 →' : `${tw.name}: ${tw.desc}`;
      KText.draw(ctx, msg, 6, 160, this.twist === 'none' ? C('a') : C(tw.color), { font: KText.width(msg, 's') > 224 ? 'n' : 's' });
      this.doneBtn.render(ctx, true, this.frame);
    } else if (this.state === 'ready') {
      KText.draw(ctx, `마우스를 ${this.cur.name}에게! 클릭(또는 Space)하면 시작`, W / 2, 160, C('9'), { align: 'center', font: 's' });
    } else if (this.state === 'gallery') {
      KText.draw(ctx, '클릭하면 다음으로', W / 2, 160, C('k'), { align: 'center', font: 's' });
    } else {
      KText.draw(ctx, '선 위로 그리면 반짝! · 빨리 끝내면 보너스', W / 2, 160, C('k'), { align: 'center', font: 's' });
    }
  }

  // 라운드 시작 슬롯머신: [마법진] [저주]
  renderSlot(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    const k = Math.min(1, t / 12);
    const dy = -Math.round((1 - k) * 40);
    const jack = this.P.mult > 1;
    // 뒤 화면이 삐져나오지 않게 전체를 어둡게 덮음
    ctx.fillStyle = DITHER.get(ctx, 'o', 12);
    ctx.fillRect(0, 15, W, 140);
    drawCard(ctx, 40, 20 + dy, 240, 130, jack ? '7' : '1', jack ? '9' : '8');
    // 위 전구 줄 (깜빡)
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = C((i + (t >> 3)) % 2 ? '9' : '8');
      ctx.fillRect(48 + i * 13, 23 + dy, 3, 2);
    }
    const title = jack ? '잭팟 라운드! 점수 ×2' : `라운드 ${this.round + 1}`;
    KText.draw(ctx, title, W / 2, 27 + dy, jack && t % 20 < 12 ? C('9') : C('a'), { align: 'center', font: 'b', outline: C('1') });
    // 릴 1: 마법진 (같은 난이도 모양들이 돌아감)
    const pool = SHAPES.filter((s) => s.tier === this.shape.tier);
    const s1 = t < 70 ? pool[((t / 4) | 0) % pool.length] : this.shape;
    const bounce1 = t < 70 ? (t % 4) - 2 : t < 76 ? 76 - t : 0;
    drawCard(ctx, 58, 44 + dy, 68, 68, 'a', t >= 70 ? '9' : 'i');
    ctx.save();
    ctx.beginPath();
    ctx.rect(60, 46 + dy, 64, 63);
    ctx.clip();
    ctx.drawImage(previewImage(s1), 62, 48 + dy + bounce1);
    ctx.restore();
    KText.draw(ctx, s1.name, 92, 114 + dy, C(s1.color), { align: 'center', font: 's', outline: C('1') });
    // 릴 2: 저주
    const keys = Object.keys(CONFIG.TWISTS);
    const tk = t < 110 ? keys[((t / 4) | 0) % keys.length] : this.twist;
    const tw = CONFIG.TWISTS[tk];
    const bounce2 = t < 110 ? (t % 4) - 2 : t < 116 ? 116 - t : 0;
    KText.draw(ctx, '저주', 201, 44 + dy, C('j'), { align: 'center', font: 'n' });
    drawCard(ctx, 138, 56 + dy, 126, 30, '2', t >= 110 ? tw.color : 'i');
    ctx.save();
    ctx.beginPath();
    ctx.rect(140, 58 + dy, 122, 26);
    ctx.clip();
    KText.draw(ctx, tw.name, 201, 63 + dy + bounce2, C(tw.color), { align: 'center', font: 'b', outline: C('1') });
    ctx.restore();
    if (t >= 110) {
      KText.draw(ctx, tw.desc, 201, 92 + dy, C('a'), { align: 'center', font: KText.width(tw.desc, 's') > 134 ? 'n' : 's' });
      if (t > 130 && t % 40 < 28) KText.draw(ctx, '클릭하면 시작', 201, 120 + dy, C('k'), { align: 'center', font: 'n' });
    }
  }

  // 라운드 갤러리: 모두의 그림을 나란히 (점수 높은 순)
  renderGallery(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    drawCard(ctx, 4, 18, 312, 136, '1', '9');
    KText.draw(ctx, `라운드 ${this.round + 1} 갤러리 · ${this.shape.name}`, W / 2, 21, C('9'), { align: 'center', font: 'b' });
    const list = [...this.players].sort((a, b) => b.rounds[this.round].total - a.rounds[this.round].total);
    const n = list.length;
    const step = 62;
    const x0 = Math.round(W / 2 - (n * step) / 2) + 1;
    list.forEach((p, i) => {
      if (t < 8 + i * 10) return; // 한 장씩 펼쳐짐
      const r = p.rounds[this.round];
      const x = x0 + i * step;
      const y = 40;
      const best = i === 0;
      drawCard(ctx, x, y, 60, 60, 'a', best ? '9' : r.accuracy < CONFIG.SCORE.OKAY ? 'i' : 'r');
      ctx.drawImage(guideImage(this.shape), x + 1, y + 1, 58, 58);
      ctx.drawImage(r.img, x + 1, y + 1, 58, 58);
      if (best && t > 50) ctx.drawImage(SPR.crown, x + 24, y - 6 - Math.round(Math.abs(Math.sin(t / 8)) * 2));
      if (n > 1 && i === n - 1 && r.accuracy < CONFIG.SCORE.OKAY && t > 50) {
        drawCard(ctx, x + 32, y + 44, 26, 13, '7', 'j');
        KText.draw(ctx, '펑!', x + 45, y + 44, C('a'), { align: 'center', font: 'n' });
      }
      ctx.drawImage(SPR.players[p.index].face, x + 1, y + 62);
      KText.draw(ctx, p.name, x + 38, y + 63, C(p.def.color), { align: 'center', font: KText.width(p.name, 's') > 40 ? 'n' : 's', outline: C('1') });
      KText.draw(ctx, `${r.total}점`, x + 30, y + 80, best ? C('9') : C('a'), { align: 'center', font: 'b' });
    });
    if (t > 50) {
      const top = list[0];
      const msg = n > 1 ? `최고의 마법사: ${top.name}!` : top.rounds[this.round].accuracy >= CONFIG.SCORE.SUCCESS ? '훌륭한 마법!' : '다음엔 더 잘할 수 있어!';
      KText.draw(ctx, msg, W / 2, 137, C('9'), { align: 'center', font: 's', outline: C('1') });
    }
  }
}

// 마법진 모양별로 튀어나오는 아이콘
const SPELL_ICON = { 고리: 'moon', 삼각: 'star', 다이아: 'gem', 별: 'star', 번개: 'bolt', 왕관: 'gem', 하트: 'heart', 소용돌이: 'swirl', 물고기: 'coin' };
const SPELL_ART = {
  star: ['..1..', '.111.', '11111', '.111.', '1...1'],
  heart: ['11.11', '11111', '11111', '.111.', '..1..'],
  moon: ['.111.', '11...', '11...', '11...', '.111.'],
  gem: ['.111.', '11111', '.111.', '..1..', '.....'],
  bolt: ['...11', '..11.', '.111.', '.11..', '11...'],
  swirl: ['11111', '1...1', '1.1.1', '1.111', '1....'],
  coin: ['.111.', '1.1.1', '11.11', '1.1.1', '.111.'],
};
function drawSpellIcon(ctx, x, y, icon, color, blink) {
  if (blink) return;
  const art = SPELL_ART[icon] || SPELL_ART.star;
  const ox = Math.round(x) - 2;
  const oy = Math.round(y) - 2;
  ctx.fillStyle = C('1');
  for (let r = 0; r < 5; r++) for (let c2 = 0; c2 < 5; c2++) if (art[r][c2] === '1') ctx.fillRect(ox + c2 - 1, oy + r - 1, 3, 3);
  ctx.fillStyle = C(color);
  for (let r = 0; r < 5; r++) for (let c2 = 0; c2 < 5; c2++) if (art[r][c2] === '1') ctx.fillRect(ox + c2, oy + r, 1, 1);
}
