// =====================================================
// 토너먼트 씬: 대진표 → 경기 → 대진표 → … → 최종 결과
// 개인 화면 모드는 같은 흐름으로 CPU 3연전
// =====================================================
class TournamentScene {
  // opts: { mode, count, charIdx, embed }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    this.mode = opts.mode;
    if (this.mode === 'personal') {
      this.players = [new Participant(opts.charIdx)];
      this.bracket = new Gauntlet(this.players[0]);
    } else {
      this.players = CHARACTERS.slice(0, opts.count).map((_, i) => new Participant(i));
      this.bracket = new Tournament(this.players);
    }
    this.ring = new Ring();
    this.bout = null;
    this.paused = false;
    this.pauseSel = 0;
    // 토너먼트는 먼저 대진을 직접 정함 (자동 시연은 바로 무작위)
    this.cursor = 0;
    this.pick = null;
    this.setState(this.mode === 'tournament' && !opts.autoplay ? 'draw' : 'bracket');
  }

  enter() {
    this.game.audio.playBgm('lobby');
  }

  setState(s) {
    this.state = s;
    this.t = 0;
  }

  startBout() {
    const m = this.bracket.current;
    const a = this.bracket.resolve(m.a);
    const b = this.bracket.resolve(m.b);
    this.bout = new Bout(this.game, a, b, { mode: this.mode, label: m.label, aiLevel: m.level, autoplay: this.opts.autoplay });
    this.setState('bout');
    this.game.audio.playBgm(m.id === 'F' ? 'boss' : 'game');
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    this.t++;

    if (this.state === 'bout' && input.anyPressed(['KeyP', 'Escape'])) {
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

    if (this.state === 'draw') {
      this.updateDraw(input, audio);
      return;
    }
    if (this.state === 'bracket') {
      this.ring.update(this.t);
      if (this.bracket.finished) {
        if (this.t > 120 || (this.t > 40 && input.confirm())) this.finish();
      } else if (this.t > 40 && (input.confirm() || this.t > 360) && !this.game.transition) {
        audio.sfx('start');
        this.game.transitionTo(() => this.startBout(), 'circle');
      }
    } else if (this.state === 'bout') {
      this.bout.update(input);
      if (this.bout.done && !this.game.transition) {
        const b = this.bout;
        const w = b.winner.player;
        const l = b.loser.player;
        w.wins++;
        if (b.byKO) w.kos++;
        w.damage += b.winner.damageDealt;
        l.damage += b.loser.damageDealt;
        this.bracket.record(w, l, b.byKO, b.winner.hp);
        this.game.transitionTo(() => {
          this.bout = null;
          this.setState('bracket');
          this.game.audio.playBgm('lobby');
        }, 'circle');
      }
    }
  }

  // ---- 대진 정하기: ← → 칸 고르기 · Space 두 칸을 차례로 골라 자리 바꾸기 · 무작위 · 확정 ----
  updateDraw(input, audio) {
    const leaves = this.bracket.tree().leaves;
    const n = leaves.length + 2; // 선수 칸 + [무작위] + [확정]
    const dx = (input.menuRight() ? 1 : 0) - (input.menuLeft() ? 1 : 0);
    if (dx) {
      this.cursor = (this.cursor + dx + n) % n;
      audio.sfx('select');
    }
    if (input.wasPressed('KeyR')) this.shuffleDraw(audio);
    if (!input.confirm() || this.t < 10) return;
    if (this.cursor < leaves.length) {
      const p = leaves[this.cursor].p;
      if (!this.pick) {
        this.pick = p;
        audio.sfx('select');
      } else if (this.pick === p) {
        this.pick = null;
        audio.sfx('select');
      } else {
        this.bracket.swap(this.pick, p);
        this.pick = null;
        audio.sfx('chip');
        this.ring.excite = 20;
      }
    } else if (this.cursor === leaves.length) this.shuffleDraw(audio);
    else {
      audio.sfx('start');
      this.pick = null;
      this.setState('bracket');
    }
  }

  shuffleDraw(audio) {
    this.bracket.shuffle();
    this.pick = null;
    audio.sfx('deal');
  }

  finish() {
    if (this.game.transition) return;
    this.setState('done');
    this.game.changeScene(() => new ResultScene(this.game, this.players, this.opts), 'circle');
  }

  render(ctx, alpha) {
    if (this.state === 'bout' && this.bout) this.bout.render(ctx, alpha);
    else if (this.mode === 'tournament') this.renderTree(ctx);
    else this.renderBracket(ctx);
    if (this.paused) {
      const W = CONFIG.WIDTH;
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

  // ---- 대진표 나무: 아래 = 선수 → 위로 올라가며 이긴 선을 금색으로 → 맨 위 우승 트로피 ----
  renderTree(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    const B = this.bracket;
    const drawing = this.state === 'draw';
    this.ring.renderBack(ctx, t);
    // 배경은 아주 어둡게 (글씨 · 선이 또렷하게)
    ctx.fillStyle = ctx.createPattern(Transition.patterns[14], 'repeat');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    px(ctx, 0, 0, W, 18, 'o');
    px(ctx, 0, 18, W, 1, '9');
    KText.draw(ctx, drawing ? '대진 정하기' : '토너먼트 대진표', W / 2, -2, C('9'), { align: 'center', font: 'L', outline: C('1') });

    const tr = B.tree();
    const L = tr.leaves.length;
    const LEAF_Y = 112;
    const TOP_Y = 52;
    // 경기 마디는 선수 칸에서 충분히 띄움 (화살표 · 이름표와 안 겹치게)
    const L1 = LEAF_Y - 18;
    const gap = (L1 - TOP_Y) / Math.max(1, tr.depth - 1);
    const yOf = (level) => (level === 0 ? LEAF_Y : Math.round(L1 - (level - 1) * gap));
    const spacing = Math.min(62, 300 / L);
    tr.leaves.forEach((lf, i) => (lf.x = Math.round(W / 2 + (i - (L - 1) / 2) * spacing)));
    const place = (node) => {
      if (node.kind === 'leaf') return node.x;
      node.x = Math.round((place(node.kids[0]) + place(node.kids[1])) / 2);
      node.y = node.level === tr.depth ? TOP_Y : yOf(node.level);
      return node.x;
    };
    place(tr.root);
    const who = (node) => (node.kind === 'leaf' ? node.p : node.m.winner);
    const line = (x, y, w, h, gold) => {
      px(ctx, x - 1, y - 1, w + 2, h + 2, '1');
      px(ctx, x, y, w, h, gold ? '9' : 'j');
    };
    // 선
    for (const nd of tr.nodes) {
      const m = nd.m;
      for (const k of nd.kids) {
        const won = m.winner && who(k) === m.winner;
        const top = k.kind === 'leaf' ? LEAF_Y - 2 : k.y;
        line(k.x - 1, nd.y, 2, top - nd.y, won);
        const x0 = Math.min(k.x, nd.x);
        line(x0 - 1, nd.y, Math.abs(nd.x - k.x) + 2, 2, won);
      }
    }
    const root = tr.root;
    line(root.x - 1, 40, 2, root.y - 40, !!root.m.winner);
    // 경기 마디: 끝났으면 이긴 선수 얼굴, 다음 경기면 깜빡이는 표시
    for (const nd of tr.nodes) {
      const m = nd.m;
      const next = !drawing && B.current === m;
      if (m.winner) {
        ctx.drawImage(m.winner.spr.face, nd.x - 9, nd.y - 9);
        KText.draw(ctx, m.ko ? 'KO' : '판정', nd.x + 11, nd.y - 7, C(m.ko ? '5' : 'k'), { font: 'b', outline: C('1') });
      } else {
        const lab = m.label;
        const w = KText.width(lab, 'b') + 10;
        const on = next && t % 30 < 20;
        drawTag(ctx, nd.x - w / 2, nd.y - 7, w, 15, on ? '9' : '3', lab, on ? '1' : 'b', 'b');
      }
    }
    // 맨 위 트로피 / 챔피언
    const F = root.m;
    if (F.winner) {
      ctx.drawImage(F.winner.spr.face, root.x - 9, 20);
      ctx.drawImage(SPR.crown, root.x - 2, 15);
    } else drawTrophy(ctx, root.x, 22, t);
    // 아래 선수 칸
    tr.leaves.forEach((lf, i) => {
      const p = lf.p;
      const sel = drawing && this.cursor === i;
      const picked = drawing && this.pick === p;
      const lost = !drawing && this.isOut(p);
      const x = lf.x - 15;
      drawCard(ctx, x, LEAF_Y, 30, 24, picked ? '9' : lost ? '1' : '2', sel ? '9' : p.def.color);
      const face = lost ? buildFlashCached(p.spr.face, PALETTE.i) : p.spr.face;
      ctx.drawImage(face, lf.x - 9, LEAF_Y + 3);
      KText.draw(ctx, p.name, lf.x, LEAF_Y + 25, C(lost ? 'i' : picked ? '9' : 'a'), { align: 'center', font: KText.width(p.name, 's') > spacing - 4 ? 'n' : 's', outline: C('1') });
      if (sel) {
        const bob = Math.round(Math.abs(Math.sin(t / 6)) * 2);
        for (let k = 0; k < 4; k++) px(ctx, lf.x - 3 + k, LEAF_Y - 7 + k - bob, 7 - k * 2, 1, '9');
      }
    });
    // 3·4위전 (따로 작은 칸)
    const Bm = B.find('B');
    if (Bm) {
      const a = B.resolve(Bm.a);
      const b = B.resolve(Bm.b);
      drawBroadcastPanel(ctx, 4, 22, 74, 38, '8');
      KText.draw(ctx, '3·4위전', 42, 21, C('8'), { align: 'center', font: 'b', outline: C('1') });
      [a, b].forEach((q, k) => {
        const fx = 12 + k * 42;
        if (q) ctx.drawImage(Bm.winner && Bm.winner !== q ? buildFlashCached(q.spr.face, PALETTE.i) : q.spr.face, fx, 38);
        else KText.draw(ctx, '?', fx + 9, 38, C('j'), { align: 'center', font: 'b', outline: C('1') });
      });
      KText.draw(ctx, 'vs', 42, 39, C('9'), { align: 'center', font: 'b', outline: C('1') });
    }
    // 아래 안내
    const by = 152;
    px(ctx, 0, by, W, CONFIG.HEIGHT - by, '1');
    px(ctx, 0, by, W, 1, '9');
    if (drawing) {
      // 왼쪽: 두 줄 안내 (버튼과 안 겹치게 폭 제한) · 오른쪽: 버튼 두 개
      if (this.pick) {
        KText.draw(ctx, `${this.pick.name} 선택됨`, 8, by + 2, C('9'), { font: 's', outline: C('1') });
        KText.draw(ctx, '바꿀 선수 고르고 Space', 8, by + 13, C('a'), { font: 's', outline: C('1') });
      } else {
        KText.draw(ctx, '← → 고르기 · Space 선택', 8, by + 2, C('a'), { font: 's', outline: C('1') });
        KText.draw(ctx, '두 명 고르면 자리 바뀜', 8, by + 13, C('k'), { font: 's', outline: C('1') });
      }
      const btns = [['무작위', L], ['확정!', L + 1]];
      btns.forEach(([lab, idx], k) => {
        const on = this.cursor === idx;
        drawTag(ctx, 204 + k * 58, by + 6, 54, 17, on ? (k ? '6' : '9') : '2', lab, on ? (k ? 'b' : '1') : 'k', 'b');
      });
    } else if (B.finished) {
      KText.draw(ctx, '모든 경기 종료! 결과 발표', W / 2, by + 6, C('9'), { align: 'center', font: 'b', outline: C('1') });
    } else {
      const m = B.current;
      const a = B.resolve(m.a);
      const b = B.resolve(m.b);
      if (t % 40 < 30) KText.draw(ctx, `${m.label}: ${a.name} vs ${b.name} — Space 시작`, W / 2, by + 6, C('a'), { align: 'center', font: 'b', outline: C('1') });
    }
  }

  // 이미 진 선수 (회색으로)
  isOut(p) {
    // 나무 위 경기(예선 · 준결승 · 결승)에서 졌으면 우승 길에서 탈락
    return this.bracket.matches.some((m) => m.loser === p && m.id !== 'B');
  }

  // 대진표: 경기마다 한 줄 (크게, 읽기 쉽게)
  renderBracket(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    this.ring.renderBack(ctx, t);
    ctx.fillStyle = ctx.createPattern(Transition.patterns[10], 'repeat');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    const title = this.mode === 'personal' ? 'CPU 3연전' : '토너먼트 대진표';
    KText.draw(ctx, title, W / 2, 3, C('9'), { align: 'center', font: 'b', outline: C('1'), scale: 2 });

    const ms = this.bracket.matches;
    const rowH = Math.min(26, Math.floor(136 / ms.length));
    const y0 = 32;
    ms.forEach((m, i) => {
      const y = y0 + i * rowH;
      const isNext = this.bracket.current === m;
      const doneM = !!m.winner;
      drawPanel(ctx, 8, y, W - 16, rowH - 2, isNext ? 'red' : 'dark');
      KText.draw(ctx, m.label, 16, y + Math.floor(rowH / 2) - 7, isNext ? C('9') : C('k'), { font: 'b' });
      const a = this.bracket.resolve(m.a);
      const b = this.bracket.resolve(m.b);
      this.drawSide(ctx, a, 128, y, rowH, 'right', doneM ? m.winner === a : null);
      BitmapFont.draw(ctx, 'VS', 160, y + Math.floor(rowH / 2) - 4, C('9'), { align: 'center', scale: 2, outline: C('1') });
      this.drawSide(ctx, b, 192, y, rowH, 'left', doneM ? m.winner === b : null);
      if (doneM) KText.draw(ctx, m.ko ? 'KO' : '판정', W - 16, y + Math.floor(rowH / 2) - 7, m.ko ? C('5') : C('j'), { font: 'b', align: 'right' });
      else if (isNext && t % 40 < 28) BitmapFont.draw(ctx, 'NEXT', W - 16, y + Math.floor(rowH / 2) - 4, C('9'), { align: 'right', scale: 2 });
    });

    const by = y0 + ms.length * rowH + 2;
    if (this.bracket.finished) {
      KText.draw(ctx, '모든 경기 종료! 결과 발표', W / 2, by, C('9'), { align: 'center', font: 'b', outline: C('1') });
    } else {
      const m = this.bracket.current;
      const a = this.bracket.resolve(m.a);
      const b = this.bracket.resolve(m.b);
      if (t % 40 < 30) KText.draw(ctx, `${a.name} vs ${b.name} — Space 로 시작`, W / 2, by, C('a'), { align: 'center', font: 'b', outline: C('1') });
    }
  }

  // 선수 칸: 얼굴 + 이름 (승자는 금색, 패자는 회색)
  drawSide(ctx, p, x, y, rowH, align, won) {
    if (!p) {
      KText.draw(ctx, '???', x, y + Math.floor(rowH / 2) - 7, C('i'), { font: 'b', align });
      return;
    }
    const face = p.spr.portrait;
    const fh = Math.min(rowH - 4, face.height);
    const fw = Math.min(26, face.width);
    const fx = align === 'right' ? x - fw : x;
    const img = won === false ? buildFlashCached(face, PALETTE.i) : face;
    ctx.drawImage(img, Math.floor((face.width - fw) / 2), 0, fw, fh, fx, y + 2, fw, fh);
    const nx = align === 'right' ? x - fw - 3 : x + fw + 3;
    const col = won === true ? C('9') : won === false ? C('i') : p.color;
    KText.draw(ctx, p.name, nx, y + Math.floor(rowH / 2) - 7, col, { font: 'b', align, outline: C('1') });
    if (won === true) ctx.drawImage(SPR.crown, align === 'right' ? x - 16 : x + 10, y + 1);
  }
}

// 단색 실루엣 캐시 (패자 얼굴 회색 처리 등)
const FLASH_CACHE = new Map();
function buildFlashCached(img, color = '#ffffff') {
  if (!FLASH_CACHE.has(img)) FLASH_CACHE.set(img, new Map());
  const m = FLASH_CACHE.get(img);
  if (!m.has(color)) m.set(color, buildFlash(img, color));
  return m.get(color);
}

// 우승 트로피 (금색 컵)
function drawTrophy(ctx, cx, y, t) {
  px(ctx, cx - 8, y, 16, 1, '1');
  px(ctx, cx - 7, y + 1, 14, 8, '1');
  px(ctx, cx - 6, y + 1, 12, 7, '9');
  px(ctx, cx - 6, y + 1, 3, 7, 't');
  px(ctx, cx - 10, y + 2, 3, 4, '1');
  px(ctx, cx + 7, y + 2, 3, 4, '1');
  px(ctx, cx - 9, y + 3, 1, 2, '8');
  px(ctx, cx + 8, y + 3, 1, 2, '8');
  px(ctx, cx - 4, y + 8, 8, 2, '1');
  px(ctx, cx - 2, y + 9, 4, 4, '8');
  px(ctx, cx - 6, y + 13, 12, 4, '1');
  px(ctx, cx - 5, y + 14, 10, 2, '8');
  if (t % 50 < 6) px(ctx, cx + 3, y + 2, 2, 2, 'b');
}
