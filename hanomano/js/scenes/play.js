// =====================================================
// 하노마노 게임 화면
//  카드 나눠주기 → 차례대로 뒤집기 → 같은 과일 '딱 5개'면 종!
//   - 맞으면: 펼쳐진 카드를 전부 가져가고, 다음 차례는 내가
//   - 틀리면: 다른 사람에게 1장씩 주고, 3초 동안 종을 못 침
//   - 카드가 0장이어도 탈락하지 않음 (종을 맞히면 다시 살아남)
//  제한 시간이 끝나면 카드가 많은 순서대로 순위
// =====================================================

// 자리 (블록 왼쪽 위). 인원에 따라 쓰는 자리
const SEATS = [
  { x: 4, y: 118 },   // 0 왼쪽 아래
  { x: 110, y: 118 }, // 1 가운데 아래
  { x: 216, y: 118 }, // 2 오른쪽 아래
  { x: 216, y: 16 },  // 3 오른쪽 위
  { x: 4, y: 16 },    // 4 왼쪽 위
];
const SEAT_ORDER = { 2: [0, 2], 3: [1, 3, 4], 4: [0, 2, 3, 4], 5: [0, 1, 2, 3, 4] };
const BELL = { x: 160, y: 80 };

class PlayScene {
  // opts: { mode, count, charIdx, embed, autoplay }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    this.frame = 0;
    this.t = 0;
    this.state = opts.autoplay ? 'deal' : 'rules'; // rules(하는 법) | deal | play | collect | wrong | end
    this.timeLeft = CONFIG.TIME_LIMIT;
    this.particles = new ParticleSystem();
    this.fx = [];         // 날아가는 카드 연출
    this.msg = null;      // 가운데 안내 { text, color, t }
    this.bellShake = 0;
    this.bellHand = null; // 종을 친 사람 얼굴 { p, t }
    this.reveal = null;   // 종을 친 순간 펼쳐져 있던 카드 + 판정 { tops, why, t }
    this.shake = 0;
    this.paused = false;
    this.pauseSel = 0;
    const personal = opts.mode === 'personal';
    const n = personal ? 5 : opts.count;
    const order = SEAT_ORDER[n];
    this.players = [];
    for (let i = 0; i < n; i++) {
      const idx = personal ? (opts.charIdx + i) % 5 : i;
      const human = !opts.autoplay && (!personal || i === 0);
      this.players.push({
        index: idx,
        def: CHARACTERS[idx],
        name: CHARACTERS[idx].name,
        color: C(CHARACTERS[idx].color),
        seat: SEATS[order[i]],
        deck: [],
        pile: [],
        flying: null,
        lock: 0,
        correct: 0,
        wrong: 0,
        human,
        bot: human ? null : new BellBot(personal ? 0.75 : 0.85),
        place: null,
      });
    }
    // 카드 나눠주기 (한 장씩 돌아가며)
    const deck = makeDeck();
    deck.forEach((c, k) => this.players[k % n].deck.push(c));
    this.turn = Math.floor(Math.random() * n);
    this.turnT = 0;
    this.dealT = 0;
  }

  enter() {
    this.game.audio.playBgm('game');
  }

  get tops() {
    return this.players.map((p) => p.pile[p.pile.length - 1] || null);
  }

  // 카드 수 (가진 덱 + 내 앞에 펼친 카드)
  cardsOf(p) {
    return p.deck.length + p.pile.length + (p.flying ? 1 : 0);
  }

  // 시간이 지날수록 자동 뒤집기가 빨라짐
  get turnTime() {
    const k = 1 - this.timeLeft / CONFIG.TIME_LIMIT;
    return Math.round(CONFIG.TURN_TIME[0] + (CONFIG.TURN_TIME[1] - CONFIG.TURN_TIME[0]) * k);
  }

  // ---- 조작 ----
  keysOf(p) {
    const input = this.game.input;
    if (this.opts.mode === 'personal') {
      return {
        flip: input.anyPressed([...SOLO_KEYS.left, ...SOLO_KEYS.right, KEYMAP[p.index].left, KEYMAP[p.index].right]),
        bell: input.anyPressed([...SOLO_KEYS.skill, KEYMAP[p.index].skill]),
        bellRank: input.pressRank([...SOLO_KEYS.skill, KEYMAP[p.index].skill]),
      };
    }
    const K = KEYMAP[p.index];
    return { flip: input.anyPressed([K.left, K.right]), bell: input.wasPressed(K.skill), bellRank: input.pressRank([K.skill]) };
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    if (this.state !== 'end' && this.state !== 'deal' && this.state !== 'rules' && input.anyPressed(['KeyP', 'Escape'])) {
      this.paused = !this.paused;
      this.pauseSel = 0;
      audio.sfx('pause');
    }
    if (this.paused) {
      if (input.anyPressed(['ArrowUp', 'ArrowDown'])) {
        this.pauseSel = 1 - this.pauseSel;
        audio.sfx('select');
      }
      if (input.confirm()) {
        audio.sfx('select');
        if (this.pauseSel === 0) this.paused = false;
        else this.game.changeScene(() => new TitleScene(this.game), 'fade');
      }
      return;
    }
    this.frame++;
    this.t++;
    if (this.bellShake > 0) this.bellShake--;
    if (this.shake > 0) this.shake--;
    if (this.reveal && ++this.reveal.t > 80) this.reveal = null;
    if (this.bellHand && ++this.bellHand.t > 24) this.bellHand = null;
    if (this.msg && ++this.msg.t > 90) this.msg = null;
    this.updateFx();
    // 시작 전: 하는 법 설명 (아무 키나 누르면 시작 · 15초 뒤 자동)
    if (this.state === 'rules') {
      const keys = ['Space', 'Enter', ...SOLO_KEYS.left, ...SOLO_KEYS.right];
      for (const K of KEYMAP) keys.push(K.left, K.skill, K.right);
      if ((this.t > 40 && input.anyPressed(keys)) || this.t >= CONFIG.RULES_TIME) {
        this.state = 'deal';
        this.t = 0;
        audio.sfx('go');
      }
      return;
    }
    this.particles.update();
    for (const p of this.players) if (p.lock > 0) p.lock--;

    if (this.state === 'deal') {
      // 나눠주는 연출: 카드가 자리로 휙휙
      if (this.t % 3 === 0 && this.t < 60) {
        const p = this.players[(this.t / 3) % this.players.length];
        this.flyCard(BELL.x - CARD_W / 2, BELL.y - CARD_H / 2, p.seat.x + 38, p.seat.y + 22, null, 14, 0.4);
        audio.sfx('deal');
      }
      if (this.t >= 90) {
        this.state = 'play';
        this.t = 0;
        this.say('같은 과일이 딱 5개면 종!', '9');
        audio.sfx('go');
      }
      return;
    }
    if (this.state === 'end') {
      if (this.t === 150) this.game.changeScene(() => new ResultScene(this.game, this.players, this.opts), 'circle');
      return;
    }

    // 시간
    this.timeLeft--;
    if (this.timeLeft > 0 && this.timeLeft <= 600 && this.timeLeft % 60 === 0) audio.sfx('countdown');
    if (this.timeLeft <= 0) {
      this.finish('시간 종료!');
      return;
    }

    // 뒤집는 카드 착지
    for (const p of this.players) {
      if (p.flying && --p.flying.t <= 0) {
        p.pile.push(p.flying.card);
        p.flying = null;
        audio.sfx('flip');
      }
    }

    if (this.state === 'collect' || this.state === 'wrong') {
      if (this.t >= (this.state === 'collect' ? CONFIG.COLLECT_PAUSE : CONFIG.WRONG_PAUSE)) {
        this.state = 'play';
        this.t = 0;
        this.turnT = 0;
      }
      return;
    }

    // ---- 종 (같은 프레임이면 먼저 누른 사람) ----
    // 개인 화면: 책상 탁! (AI 가 치는 소리로 확인) = 종. 확인하는 동안은 CPU 가 못 침
    const solo = this.opts.mode === 'personal';
    const slap = solo && SlapBell.on && SlapBell.takeHit();
    const holdBots = solo && SlapBell.on && SlapBell.holdBots();
    let ringer = null;
    let bestRank = Infinity;
    for (const p of this.players) {
      let want = false;
      let rank = Infinity;
      if (p.human) {
        const k = this.keysOf(p);
        want = k.bell || slap;
        rank = slap ? -1 : k.bellRank;
      } else {
        if (holdBots) continue;
        want = p.bot.wantsBell(this, p);
        rank = 1000 + Math.random();
      }
      if (!want) continue;
      if (p.lock > 0) {
        if (p.human) audio.sfx('miss');
        continue;
      }
      if (rank < bestRank) {
        bestRank = rank;
        ringer = p;
      }
    }
    if (ringer) {
      this.ring(ringer);
      return;
    }

    // ---- 뒤집기 (내 차례) ----
    const cur = this.players[this.turn];
    if (!cur.deck.length) {
      this.nextTurn();
    } else if (!cur.flying) {
      this.turnT++;
      const wants = cur.human ? this.keysOf(cur).flip : cur.bot.wantsFlip(this, cur);
      if (wants || this.turnT >= this.turnTime) this.flip(cur);
    }
    // 아무도 뒤집을 카드가 없으면: 펼친 카드를 각자 덱으로 되돌림
    if (this.players.every((p) => !p.deck.length && !p.flying) && !bellIsRight(this.tops)) {
      this.reshuffle();
    }
    // 한 사람이 카드를 전부 가지면 끝
    const total = this.players.reduce((s, p) => s + this.cardsOf(p), 0);
    const leader = this.players.find((p) => this.cardsOf(p) === total);
    if (leader && this.players.length > 1 && !this.players.some((p) => p !== leader && this.cardsOf(p) > 0)) this.finish(`${leader.name} 싹쓸이!`);
  }

  flip(p) {
    const card = p.deck.shift();
    p.flying = { card, t: 8 };
    this.flyCard(p.seat.x + 38, p.seat.y + 22, p.seat.x + 2, p.seat.y + 4, card, 8, 0);
    this.turnT = 0;
    this.nextTurn();
  }

  nextTurn() {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.turn + k) % n;
      if (this.players[i].deck.length) {
        this.turn = i;
        this.turnT = 0;
        return;
      }
    }
  }

  // 종을 침
  ring(p) {
    const audio = this.game.audio;
    this.bellShake = 16;
    this.bellHand = { p, t: 0 };
    audio.sfx('bell');
    this.particles.ring(BELL.x, BELL.y - 6, 2, C('9'), 14);
    this.particles.text(BELL.x + 30, BELL.y - 10, '딩!', C('9'), { kind: 'k', life: 30 });
    this.shake = 8;
    const why = bellReason(this.tops);
    this.reveal = { tops: this.tops, why, t: 0 };
    if (why.ok) {
      // 성공: 펼친 카드 전부 가져감 (덱 아래에) — 카드가 우르르 날아옴
      let got = 0;
      let fly = 0;
      for (const q of this.players) {
        for (let k = 0; k < Math.min(6, q.pile.length); k++) {
          this.flyCard(q.seat.x + 2, q.seat.y + 4, p.seat.x + 38, p.seat.y + 22, null, 18 + k * 2, 0.15 + fly * 0.04);
          fly++;
        }
        got += q.pile.length;
        p.deck.push(...shuffleCards(q.pile));
        q.pile = [];
      }
      p.correct++;
      this.say(`${p.name} 종! +${got}장`, '9', why.text);
      audio.sfx('jackpot');
      this.particles.burst(BELL.x, BELL.y - 10, 24, [C('9'), C('b'), C('8'), p.color], 2.2, 30, 1, 0.04);
      this.turn = this.players.indexOf(p);
      this.state = 'collect';
    } else {
      // 실패: 다른 사람에게 1장씩 + 손 얼얼 (종 잠김)
      let gave = 0;
      for (const q of this.players) {
        if (q === p || !p.deck.length) continue;
        q.deck.push(p.deck.pop());
        this.flyCard(p.seat.x + 36, p.seat.y + 22, q.seat.x + 36, q.seat.y + 22, null, 18, 0.3);
        gave++;
      }
      p.wrong++;
      p.lock = CONFIG.WRONG_LOCK;
      this.say(`${p.name} 틀림! ${gave ? `-${gave}장` : '손 얼얼'}`, '5', why.text);
      audio.sfx('bust');
      this.state = 'wrong';
    }
    this.t = 0;
  }

  reshuffle() {
    for (const p of this.players) {
      p.deck.push(...shuffleCards(p.pile));
      p.pile = [];
    }
    this.say('카드를 다시 모아서 계속!', 'h');
    this.game.audio.sfx('deal');
    this.nextTurn();
  }

  finish(text) {
    this.state = 'end';
    this.t = 0;
    this.say(text, '9');
    this.game.audio.sfx('timeup');
  }

  say(text, color, sub = null) {
    this.msg = { text, color, sub, t: 0 };
  }

  // 날아가는 카드 연출 (card 가 있으면 앞면으로 뒤집히며 감)
  flyCard(x0, y0, x1, y1, card, dur, delay) {
    this.fx.push({ x0, y0, x1, y1, card, dur, t: -Math.round(delay * dur) });
  }

  updateFx() {
    for (const f of this.fx) f.t++;
    this.fx = this.fx.filter((f) => f.t <= f.dur);
  }

  // ---------------- 그리기 ----------------
  render(ctx, alpha) {
    const W = CONFIG.WIDTH;
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.round(Math.sin(this.shake * 2.3) * Math.min(2, this.shake / 3)), 0);
    this.renderTable(ctx);
    if (this.state === 'rules') {
      this.renderRules(ctx);
      ctx.restore();
      return;
    }
    this.players.forEach((p, i) => this.renderSeat(ctx, p, i));
    // 종 + 종 친 사람 얼굴
    const pressed = this.bellHand && this.bellHand.t < 6;
    drawBell(ctx, BELL.x, BELL.y, this.bellShake, pressed);
    if (this.bellHand) {
      const face = SPR.players[this.bellHand.p.index].face;
      const dy = Math.min(6, this.bellHand.t);
      ctx.drawImage(face, BELL.x - 9, BELL.y - 30 + dy);
    }
    // 날아가는 카드
    for (const f of this.fx) {
      if (f.t < 0) continue;
      const k = f.t / f.dur;
      const e = 1 - (1 - k) * (1 - k);
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(k * Math.PI) * 10;
      const img = f.card && k > 0.5 ? cardFace(f.card) : cardBack();
      const sx = f.card ? Math.abs(Math.cos(k * Math.PI)) : 1; // 뒤집히는 모습
      const w = Math.max(2, Math.round(CARD_W * sx));
      ctx.drawImage(img, Math.round(x + (CARD_W - w) / 2), Math.round(y), w, CARD_H);
    }
    this.particles.render(ctx);
    // 가운데 안내 (없을 때는 조작 설명) — 종 바로 아래 · 자리 판보다 위
    if (!this.msg && this.state === 'play') {
      KText.draw(ctx, '양쪽 키 뒤집기 · 가운데 키 종!', W / 2, 97, C('k'), { align: 'center', font: 'n', outline: C('1') });
    }
    if (this.msg) {
      const k = this.msg.t;
      if (!(k > 70 && k % 4 < 2)) {
        const tw = Math.max(KText.width(this.msg.text, 'b'), this.msg.sub ? KText.width(this.msg.sub, 'n') : 0) + 14;
        const h = this.msg.sub ? 28 : 17;
        const my = this.msg.sub ? 88 : 96; // 아래 자리 이름표를 가리지 않게
        drawCard(ctx, Math.round(W / 2 - tw / 2), my, tw, h, '1', this.msg.color);
        KText.draw(ctx, this.msg.text, W / 2, my + 2, C(this.msg.color), { align: 'center', font: 'b' });
        if (this.msg.sub) KText.draw(ctx, this.msg.sub, W / 2, my + 15, C('a'), { align: 'center', font: 'n' });
      }
    }
    // 차례 리본 · 다음 차례 표시는 맨 위에 (다른 그림에 안 가려지게)
    this.players.forEach((p) => this.renderTurnTag(ctx, p));
    ctx.restore();
    if (this.state === 'end' && this.t > 20) {
      drawCard(ctx, W / 2 - 70, 46, 140, 26, '6', '9');
      KText.draw(ctx, '게임 끝!', W / 2, 49, C('9'), { align: 'center', font: 'L', outline: C('1') });
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

  // 카지노 테이블 (초록 펠트 + 금테) + 위쪽 제목·시간
  renderTable(ctx) {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, H);
    // 뒤쪽 샹들리에 불빛 (천천히 흔들림)
    for (let i = 0; i < 6; i++) {
      const x = Math.round(30 + i * 52 + Math.sin(this.frame / 50 + i) * 3);
      ctx.fillStyle = DITHER.get(ctx, 't', 2);
      ctx.fillRect(x - 10, 0, 20, 14);
      ctx.fillStyle = C(this.frame % 40 < 20 === (i % 2 === 0) ? '9' : '8');
      ctx.fillRect(x - 1, 2, 3, 3);
    }
    // 펠트 (타원)
    const cx = W / 2;
    const cy = 90;
    for (let y = -62; y <= 62; y++) {
      const half = Math.round(Math.sqrt(1 - (y / 63) ** 2) * 150);
      ctx.fillStyle = C('1');
      ctx.fillRect(cx - half - 3, cy + y, half * 2 + 6, 1);
      ctx.fillStyle = C('8');
      ctx.fillRect(cx - half - 2, cy + y, half * 2 + 4, 1);
      ctx.fillStyle = C('c');
      ctx.fillRect(cx - half, cy + y, half * 2, 1);
    }
    ctx.fillStyle = DITHER.get(ctx, 'd', 2);
    ctx.fillRect(cx - 140, cy - 55, 280, 110);
    // 펠트 위 무늬 (가운데 금색 원)
    for (let a = 0; a < 90; a++) {
      const ang = (a / 90) * Math.PI * 2;
      ctx.fillStyle = C('8');
      ctx.fillRect(Math.round(cx + Math.cos(ang) * 32), Math.round(BELL.y + 6 + Math.sin(ang) * 16), 1, 1);
    }
    // 제목 + 시간
    KText.draw(ctx, '하노마노', cx, 14, C('9'), { align: 'center', font: 'L', outline: C('1') });
    const s = Math.max(0, Math.ceil(this.timeLeft / 60));
    const tt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const urgent = this.timeLeft <= 600 && this.frame % 30 < 15;
    KText.draw(ctx, tt, cx, 33, urgent ? C('5') : C('a'), { align: 'center', font: 'b', outline: C('1') });
  }

  // 시작 전 '하는 법' 화면
  renderRules(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    ctx.fillStyle = DITHER.get(ctx, 'o', 13);
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    drawCard(ctx, 6, 4, W - 12, 172, '1', '8');
    KText.draw(ctx, '하노마노 하는 법', W / 2, 7, C('9'), { align: 'center', font: 'b', outline: C('1') });
    const step = (n, text, y, col = 'a') => {
      ctx.fillStyle = C('8');
      ctx.fillRect(14, y + 1, 11, 11);
      ctx.fillStyle = C('1');
      ctx.fillRect(15, y + 2, 9, 9);
      BitmapFont.draw(ctx, String(n), 20, y + 4, C('9'), { align: 'center' });
      KText.draw(ctx, text, 30, y, C(col), { font: KText.width(text, 's') > W - 44 ? 'n' : 's' });
    };
    step(1, '내 차례가 오면 양쪽 키로 카드를 한 장 뒤집어요', 22);
    step(2, '같은 과일이 딱 5개가 되면 가운데 키로 종!', 36, '9');
    // 예시: 체리 2 + 체리 3 = 5 → 종!  /  체리 2 + 레몬 3 → 치면 안 됨
    const ex = (x, a, b, ok) => {
      ctx.drawImage(cardFace(a), x, 52);
      ctx.drawImage(cardFace(b), x + 36, 52);
      KText.draw(ctx, ok ? '5개 → 종!' : '과일이 달라요', x + 36, 93, C(ok ? 'e' : '5'), { align: 'center', font: 'n' });
      // O / X 표시
      ctx.fillStyle = C(ok ? 'e' : '5');
      if (ok) {
        for (let a2 = 0; a2 < 40; a2++) {
          const ang = (a2 / 40) * Math.PI * 2;
          ctx.fillRect(Math.round(x + 82 + Math.cos(ang) * 7), Math.round(70 + Math.sin(ang) * 7), 2, 2);
        }
      } else {
        for (let k = -6; k <= 6; k++) {
          ctx.fillRect(x + 82 + k, 70 + k, 2, 2);
          ctx.fillRect(x + 82 + k, 70 - k, 2, 2);
        }
      }
    };
    ex(40, { fruit: 0, n: 2 }, { fruit: 0, n: 3 }, true);
    ex(180, { fruit: 0, n: 2 }, { fruit: 1, n: 3 }, false);
    step(3, '맞으면 펼쳐진 카드를 전부 가져가요', 106, 'e');
    step(4, '틀리면 모두에게 1장씩 주고 3초 동안 종 금지', 120, '5');
    step(5, '2분 30초 뒤 카드가 제일 많은 사람이 1등!', 134);
    // 조작키 (사람 자리마다)
    const solo = this.opts.mode === 'personal';
    const keyTxt = solo ? `← → 뒤집기 · Space 종${SlapBell.on ? ' · 책상 탁!' : ''}` : '양쪽 키 = 뒤집기 · 가운데(금색) 키 = 종';
    KText.draw(ctx, keyTxt, W / 2, 148, C('k'), { align: 'center', font: 'n' });
    const left = Math.max(0, Math.ceil((CONFIG.RULES_TIME - t) / 60));
    if (t % 40 < 28) KText.draw(ctx, `아무 키나 누르면 시작! (${left})`, W / 2, 160, C('9'), { align: 'center', font: 's', outline: C('1') });
  }

  // 자리 하나: 펼친 카드 + 이름표 + 남은 카드 + 조작키
  renderSeat(ctx, p, i) {
    const { x, y } = p.seat;
    const myTurn = this.state === 'play' && this.players[this.turn] === p && p.deck.length > 0;
    const col = p.def.color;
    drawCard(ctx, x, y, 100, 60, '2', myTurn ? (this.frame % 20 < 10 ? '9' : 'b') : DARK_OF[col] || '3');
    // 펼친 카드 (맨 위 한 장 + 밑에 쌓인 두께)
    //  종을 친 직후에는 그 순간의 카드를 잠깐 보여 주고, 정답 과일 카드는 반짝 테두리
    const R = this.reveal;
    const ri = this.players.indexOf(p);
    const shown = R && R.t < 70 ? R.tops[ri] : p.pile[p.pile.length - 1];
    const depth = R && R.t < 70 ? 0 : Math.min(3, p.pile.length - 1);
    for (let k = depth; k > 0; k--) ctx.drawImage(cardFace(p.pile[p.pile.length - 1 - k]), x + 2 + k, y + 4 + k);
    if (shown) {
      ctx.drawImage(cardFace(shown), x + 2, y + 4);
      const hit = R && R.t < 70 && shown.fruit === R.why.fruit;
      if (hit && R.t % 12 < 8) {
        ctx.fillStyle = C(R.why.ok ? '9' : '5');
        ctx.fillRect(x + 1, y + 3, CARD_W + 2, 2);
        ctx.fillRect(x + 1, y + 3 + CARD_H, CARD_W + 2, 2);
        ctx.fillRect(x + 1, y + 3, 2, CARD_H + 2);
        ctx.fillRect(x + 1 + CARD_W, y + 3, 2, CARD_H + 2);
      }
    } else {
      ctx.fillStyle = DITHER.get(ctx, 'i', 6);
      ctx.fillRect(x + 4, y + 6, CARD_W - 4, CARD_H - 4);
    }
    // 이름표
    drawNameCard(ctx, x + 36, y + 2, 62, { def: p.def, name: p.name, index: p.index, place: null }, this.frame);
    // 남은 카드 (뒷면 더미 + 숫자)
    const back = cardBack();
    const n = p.deck.length;
    for (let k = Math.min(3, n) - 1; k >= 0; k--) ctx.drawImage(back, 0, 0, CARD_W, CARD_H, x + 38 + k, y + 21 - k, 10, 13);
    KText.draw(ctx, `${n}장`, x + 54, y + 21, n ? C('a') : C('5'), { font: 'b', outline: C('1') });
    if (myTurn) {
      // 자동 뒤집기까지 남은 시간
      const k = 1 - this.turnT / this.turnTime;
      ctx.fillStyle = C('1');
      ctx.fillRect(x + 38, y + 35, 58, 3);
      ctx.fillStyle = C('9');
      ctx.fillRect(x + 39, y + 36, Math.round(56 * k), 1);
    }
    // 조작키 (양쪽 = 뒤집기, 가운데 금색 = 종) — 자리 판 오른쪽 칸(64px) 안에 맞춤
    const input = this.game.input;
    if (!p.human) {
      KText.draw(ctx, 'CPU', x + 67, y + 42, C('j'), { align: 'center', font: 'b' });
    } else {
      const K = KEYMAP[p.index];
      const solo = this.opts.mode === 'personal';
      const held = solo
        ? [input.anyDown(SOLO_KEYS.left), input.anyDown(SOLO_KEYS.skill), input.anyDown(SOLO_KEYS.right)]
        : [input.isDown(K.left), input.isDown(K.skill), input.isDown(K.right)];
      let labels = solo ? ['<', 'Space', '>'] : K.keys;
      let caps = labels.map((k, j) => getKeycap(k, j === 1 ? 'strike' : 'plain', held[j]));
      let tw = caps.reduce((s, c) => s + c.width, 0) + 2;
      if (tw > 62) {
        labels = ['<', 'SP', '>'];
        caps = labels.map((k, j) => getKeycap(k, j === 1 ? 'strike' : 'plain', held[j]));
        tw = caps.reduce((s, c) => s + c.width, 0) + 2;
      }
      let kx = Math.round(x + 67 - tw / 2);
      caps.forEach((c) => {
        ctx.drawImage(c, kx, y + 40);
        kx += c.width + 1;
      });
    }
    // 종 잠김 (틀려서 손 얼얼)
    if (p.lock > 0) {
      ctx.fillStyle = DITHER.get(ctx, '7', 10);
      ctx.fillRect(x + 36, y + 39, 62, 19);
      KText.draw(ctx, `손 얼얼 ${Math.ceil(p.lock / 60)}`, x + 67, y + 42, C('5'), { align: 'center', font: 'b', outline: C('1') });
    }
  }

  // '차례!' 리본 (지금 뒤집을 사람) + '다음' 꼬리표 (그다음 사람)
  renderTurnTag(ctx, p) {
    if (this.state !== 'play') return;
    const { x, y } = p.seat;
    const cur = this.players[this.turn];
    const top = y < 90; // 위쪽 자리면 리본을 아래에
    if (cur === p && p.deck.length > 0) {
      const bob = Math.round(Math.abs(Math.sin(this.frame / 8)));
      const ry = top ? y + 59 + bob : y - 9 - bob;
      drawCard(ctx, x + 2, ry, 36, 14, '9', '8');
      KText.draw(ctx, '차례!', x + 20, ry, C('1'), { align: 'center', font: 's' });
      return;
    }
    // 다음 차례
    const n = this.players.length;
    let next = null;
    for (let k = 1; k <= n; k++) {
      const q = this.players[(this.turn + k) % n];
      if (q.deck.length) {
        next = q;
        break;
      }
    }
    if (next === p && next !== cur) {
      const ry = top ? y + 60 : y - 8;
      ctx.fillStyle = C('i');
      ctx.fillRect(x + 2, ry, 28, 11);
      ctx.fillStyle = C('1');
      ctx.fillRect(x + 3, ry + 1, 26, 9);
      KText.draw(ctx, '다음', x + 16, ry, C('k'), { align: 'center', font: 'n' });
    }
  }
}

function shuffleCards(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
