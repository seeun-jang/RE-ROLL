// =====================================================
// 최종 결과 (클리어): 순위표 + 메인 게임에 넘길 점수
// =====================================================
class ResultScene {
  constructor(game, players, opts) {
    this.game = game;
    this.opts = opts;
    this.players = players;
    this.t = 0;
    this.hall = new Hall();
    this.hall.excite = 99999;
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
    this.hall.update(this.t, CONFIG.WIDTH / 2 + Math.sin(this.t / 80) * 50);
    if (this.t % 4 === 0) {
      const cols = [C('9'), C('8'), C('5'), C('h'), C('e'), C('p')];
      this.particles.add(Math.random() * CONFIG.WIDTH, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 1);
    }
    this.particles.update();
    if (this.opts.embed) return; // 메인 게임에 들어가 있으면 메인 게임이 다음 화면을 띄움
    const input = this.game.input;
    if (this.t > 60 && input.confirm()) {
      this.game.audio.sfx('select');
      this.game.changeScene(() => new TitleScene(this.game), 'fade');
    }
    if (this.t > 60 && input.wasPressed('KeyR')) {
      this.game.audio.sfx('start');
      this.game.changeScene(() => new TournamentScene(this.game, this.opts), 'circle');
    }
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    this.hall.renderBack(ctx, t);
    ctx.fillStyle = ctx.createPattern(Transition.patterns[9], 'repeat');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    this.particles.render(ctx);
    if (this.opts.mode === 'personal') this.renderPersonal(ctx);
    else this.renderTournament(ctx);
    const by = CONFIG.HEIGHT - 15;
    if (this.opts.embed) KText.draw(ctx, '결과 전송 완료', W / 2, by, C('a'), { align: 'center', font: 's' });
    else if (t > 60 && t % 40 < 28) KText.draw(ctx, 'Space: 타이틀 · R: 다시 하기', W / 2, by, C('9'), { align: 'center', font: 's', outline: C('1') });
  }

  renderTournament(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    KText.draw(ctx, '최종 순위', W / 2, -3, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    KText.draw(ctx, '메인 점수', 296, 12, C('e'), { font: 's', align: 'right' });
    const rows = this.result.ranking;
    const rowH = 26;
    const y0 = 28;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.players.find((pp) => pp.def.id === r.playerId);
      const y = y0 + i * rowH;
      drawPanel(ctx, 16, y, W - 32, rowH - 2, r.rank === 1 ? 'red' : 'dark');
      BitmapFont.draw(ctx, String(r.rank), 32, y + 6, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      const jump = r.rank === 1 ? Math.abs(Math.round(Math.sin(t / 8) * 2)) : 0;
      const face = p.spr.portrait;
      ctx.drawImage(face, Math.round(64 - face.width / 2), y + 1 - jump, face.width, Math.min(22, face.height));
      if (r.rank === 1) ctx.drawImage(SPR.crown, 62, y - 2 - jump);
      KText.draw(ctx, r.name, 86, y + 5, p.color, { font: 'b', outline: C('1') });
      KText.draw(ctx, `${r.wins}승 · 득점 ${r.scored}`, 212, y + 5, C('a'), { font: 'b', align: 'center' });
      KText.draw(ctx, `+${r.rankPoints}`, 296, y + 5, C('e'), { font: 'b', align: 'right' });
    });
  }

  renderPersonal(ctx) {
    const W = CONFIG.WIDTH;
    const r = this.result.ranking[0];
    const p = this.players[0];
    drawPanel(ctx, 60, 14, 200, 136, 'red');
    KText.draw(ctx, 'CPU 3연전 결과', W / 2, 20, C('9'), { align: 'center', font: 'b', outline: C('1') });
    const f = ((this.t / 14) | 0) % 2;
    drawStanding(ctx, p.spr.frames[f], W / 2, 82);
    KText.draw(ctx, r.name, W / 2, 84, p.color, { align: 'center', font: 'b', outline: C('1') });
    BitmapFont.draw(ctx, r.score + ' PT', W / 2, 102, C('9'), { align: 'center', scale: 3, outline: C('1') });
    KText.draw(ctx, `${r.wins}승 · 득점 ${r.scored}점`, W / 2, 122, C('k'), { align: 'center', font: 'b' });
    KText.draw(ctx, '점수를 진행자에게 알려주세요', W / 2, 136, C('a'), { align: 'center', font: 's' });
  }
}
