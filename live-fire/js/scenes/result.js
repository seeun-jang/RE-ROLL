// =====================================================
// 결과: 점수 순 (명중 × 10 + 빨리 맞힌 보너스) + 사격 등급 (특등사수 · 1급 · 2급 · 3급 · 불합격)
// =====================================================
class ResultScene {
  constructor(game, players, opts) {
    this.game = game;
    this.opts = opts;
    this.players = players;
    this.t = 0;
    this.particles = new ParticleSystem();
    this.result = buildResult(opts.mode, players);
    emitResult(this.result); // 메인 게임으로 결과 전송
  }

  enter() {
    this.game.audio.playBgm('result');
    this.game.audio.sfx('win');
  }

  update() {
    this.t++;
    if (this.t % 4 === 0) {
      const cols = [C('9'), C('8'), C('6'), C('h'), C('q'), C('b')];
      this.particles.add(Math.random() * CONFIG.WIDTH, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 2);
    }
    this.particles.update();
    if (this.opts.embed) return;
    const input = this.game.input;
    if (this.t > 60 && input.confirm()) {
      this.game.audio.sfx('select');
      this.game.changeScene(() => new TitleScene(this.game), 'fade');
    }
    if (this.t > 60 && input.wasPressed('KeyR')) {
      this.game.audio.sfx('start');
      this.game.changeScene(() => new PlayScene(this.game, this.opts), 'circle');
    }
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    drawCamo(ctx, t);
    this.particles.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, -3, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    KText.draw(ctx, '메인 점수', 300, 17, C('e'), { font: 's', align: 'right', outline: C('1') });
    const rows = this.result.ranking;
    const rowH = 26;
    const y0 = 32;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.players.find((pp) => pp.slot === r.seat);
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 12;
      const x = 14 + slide;
      const y = y0 + i * rowH;
      drawCard(ctx, x, y, 292, rowH - 3, r.rank === 1 ? '7' : '2', r.rank === 1 ? '9' : '3');
      BitmapFont.draw(ctx, String(r.rank), x + 13, y + 6, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      drawNameCard(ctx, x + 26, y + 3, 84, { def: p.def, name: p.name, index: p.index, place: null }, t);
      if (r.rank === 1) ctx.drawImage(SPR.crown, x + 32, y);
      KText.draw(ctx, `${r.score}점`, x + 116, y + 4, C('9'), { font: 'b', outline: C('1') });
      KText.draw(ctx, `명중 ${r.hits}발`, x + 160, y + 5, C('a'), { font: 'n', outline: C('1') });
      // 사격 등급 배지
      const g = gradeOf(r.hits);
      drawGradeBadge(ctx, x + 233, y + 3, g, 48);
      if (this.opts.mode === 'personal') KText.draw(ctx, r.cpu ? 'CPU' : '나', x + 24, y + 12, r.cpu ? C('j') : C('9'), { align: 'center', font: 'n', outline: C('1') });
      KText.draw(ctx, `+${r.rankPoints}`, x + 286, y + 4, C('e'), { font: 'b', align: 'right' });
    });
    const by = CONFIG.HEIGHT - 15;
    if (this.opts.embed) KText.draw(ctx, '결과 전송 완료', W / 2, by, C('a'), { align: 'center', font: 's', outline: C('1') });
    else if (t > 60 && t % 40 < 28) {
      const me = this.result.ranking.find((rr) => !rr.cpu) || this.result.ranking.find((rr) => rr.slot === this.opts.charIdx + 1);
      const msg = this.opts.mode === 'personal' ? `내 점수 ${me.score}점 → 진행자에게! (R 다시)` : 'Space: 타이틀 · R: 다시 하기';
      KText.draw(ctx, msg, W / 2, by, C('9'), { align: 'center', font: 's', outline: C('1') });
    }
  }
}
