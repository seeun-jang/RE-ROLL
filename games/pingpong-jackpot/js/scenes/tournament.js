// =====================================================
// 토너먼트 씬: 대진표 → 경기(5점 선승) → 대진표 → … → 최종 결과
// 개인 화면 모드는 같은 흐름으로 CPU 3연전
// =====================================================
class TournamentScene {
  // opts: { mode, count, charIdx, embed, seeds(대진 정하기에서 고른 순서) }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    this.mode = opts.mode;
    if (this.mode === 'personal') {
      this.players = [new Participant(opts.charIdx)];
      this.bracket = new Gauntlet(this.players[0]);
    } else {
      this.players = CHARACTERS.slice(0, opts.count).map((_, i) => new Participant(i));
      this.bracket = new Tournament(this.players, opts.seeds);
    }
    this.backdrop = makeBackdrop();
    this.bout = null;
    this.paused = false;
    this.pauseSel = 0;
    this.setState('bracket');
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
    let waiting = null;
    if (this.mode === 'tournament') {
      const br = this.bracket;
      const out = (p) => br.matches.some((mm) => mm.loser === p && ['Q', 'B', 'F'].includes(mm.id)); // 이미 탈락
      const faces = br.seeds.filter((p) => p !== a && p !== b && !out(p));
      const nm = br.matches[br.cursor + 1];
      let next = null;
      if (nm) {
        next = `다음: ${nm.label}`;
      }
      waiting = { faces, next };
    }
    this.bout = new Match(this.game, a, b, { mode: this.mode, label: m.label, aiLevel: m.level, autoplay: this.opts.autoplay, waiting });
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

    if (this.state === 'bracket') {
      this.backdrop.update(this.t, CONFIG.WIDTH / 2 + Math.sin(this.t / 90) * 40);
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
        for (const f of b.fighters) {
          f.player.scored += f.pts;
          f.player.conceded += (f === b.winner ? b.loser : b.winner).pts;
        }
        const me = b.fighters.find((f) => f.player === this.players[0]);
        this.bracket.record(w, l, b.how, me ? me.pts : 0, b.loser.pts <= 1);
        this.game.transitionTo(() => {
          this.bout = null;
          this.setState('bracket');
          this.game.audio.playBgm('lobby');
        }, 'circle');
      }
    }
  }

  finish() {
    if (this.game.transition) return;
    this.setState('done');
    this.game.changeScene(() => new ResultScene(this.game, this.players, this.opts), 'circle');
  }

  render(ctx, alpha) {
    if (this.state === 'bout' && this.bout) this.bout.render(ctx, alpha);
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

  // 대진표: 개인 화면은 3연전 목록, 토너먼트는 아래 → 위로 올라가는 나무 그림
  renderBracket(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    this.backdrop.renderBack(ctx, t);
    ctx.fillStyle = ctx.createPattern(Transition.patterns[10], 'repeat');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    if (this.mode === 'personal') {
      this.renderGauntlet(ctx);
      return;
    }
    KText.draw(ctx, '토너먼트 대진표', 6, 0, C('9'), { font: 'L', outline: C('1') });
    drawBracket(ctx, this.bracket, { t, current: this.bracket.current });
    const by = 150;
    if (this.bracket.finished) {
      KText.draw(ctx, '모든 경기 종료! 결과 발표', W / 2, by, C('9'), { align: 'center', font: 'b', outline: C('1') });
    } else {
      const m = this.bracket.current;
      const a = this.bracket.resolve(m.a);
      const b = this.bracket.resolve(m.b);
      drawPanel(ctx, W / 2 - 110, by - 2, 220, 18, 'dark');
      if (t % 40 < 30) KText.draw(ctx, `${m.label}: ${a.name} vs ${b.name} — Space`, W / 2, by, C('a'), { align: 'center', font: 'b' });
    }
  }

  // 개인 화면 CPU 3연전: 한 줄씩
  renderGauntlet(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    KText.draw(ctx, 'CPU 3연전', W / 2, -2, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const ms = this.bracket.matches;
    const rowH = 30;
    const y0 = 38;
    ms.forEach((m, i) => {
      const y = y0 + i * rowH;
      const isNext = this.bracket.current === m;
      const doneM = !!m.winner;
      drawPanel(ctx, 8, y, W - 16, rowH - 2, isNext ? 'red' : 'dark');
      KText.draw(ctx, m.label, 16, y + Math.floor(rowH / 2) - 7, isNext ? C('9') : C('k'), { font: 'b' });
      const a = this.bracket.resolve(m.a);
      const b = this.bracket.resolve(m.b);
      this.drawSide(ctx, a, 150, y, rowH, 'right', doneM ? m.winner === a : null);
      BitmapFont.draw(ctx, 'VS', 172, y + Math.floor(rowH / 2) - 4, C('9'), { align: 'center', scale: 2, outline: C('1') });
      this.drawSide(ctx, b, 194, y, rowH, 'left', doneM ? m.winner === b : null);
      if (doneM) KText.draw(ctx, m.how, W - 16, y + Math.floor(rowH / 2) - 7, C('k'), { font: 'b', align: 'right' });
      else if (isNext && t % 40 < 28) KText.draw(ctx, '다음', W - 16, y + Math.floor(rowH / 2) - 7, C('9'), { font: 'b', align: 'right' });
    });
    const by = y0 + ms.length * rowH + 4;
    if (this.bracket.finished) KText.draw(ctx, '3연전 종료! 결과 발표', W / 2, by, C('9'), { align: 'center', font: 'b', outline: C('1') });
    else if (t % 40 < 30) KText.draw(ctx, 'Space 로 시작', W / 2, by, C('a'), { align: 'center', font: 'b', outline: C('1') });
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
