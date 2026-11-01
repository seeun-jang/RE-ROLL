// =====================================================
// 결과: 3라운드 합계 점수 순위 (라운드별 점수도 표시, 잭팟 라운드는 2배 반영)
// =====================================================
class ResultScene {
  constructor(game, players, opts, plan) {
    this.game = game;
    this.plan = plan;
    this.opts = opts;
    this.players = players;
    this.t = 0;
    this.particles = new ParticleSystem();
    this.result = buildResult(opts.mode, players);
    emitResult(this.result); // 메인 게임으로 결과 전송
  }

  enter() {
    this.game.audio.sfx('win');
    this.game.audio.playBgm('result');
  }

  update() {
    this.t++;
    if (this.t % 4 === 0) {
      const cols = [C('9'), C('8'), C('5'), C('h'), C('e'), C('p')];
      this.particles.add(Math.random() * CONFIG.WIDTH, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 1);
    }
    this.particles.update();
    if (this.opts.embed) return;
    const input = this.game.input;
    const m = input.mouse;
    if (this.t > 60 && (input.confirm() || (m && m.pressed))) {
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
    drawBackdrop(ctx, t);
    this.particles.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, 1, C('9'), { align: 'center', font: 'L', outline: C('1') });
    // 라운드 모양 이름 머리글
    const rows = this.result.ranking;
    const rowH = rows.length > 4 ? 26 : 30;
    const y0 = rows.length <= 3 ? 32 + Math.round((5 - rows.length) * 13) : 32; // 사람이 적으면 가운데로
    // 머리글: 합계 · 라운드별 모양 (칸 간격을 넓혀 안 붙게)
    this.plan.forEach((r, i) => KText.draw(ctx, SHAPES[r.shape].short + (r.mult > 1 ? '×2' : ''), 184 + i * 34, y0 - 13, C(SHAPES[r.shape].color), { font: 'n', align: 'center', outline: C('1') }));
    KText.draw(ctx, '합계', 150, y0 - 13, C('a'), { font: 'n', align: 'right', outline: C('1') });
    if (this.opts.mode !== 'personal') KText.draw(ctx, '메인', 300, y0 - 13, C('e'), { font: 'n', align: 'right', outline: C('1') });
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
      KText.draw(ctx, `${r.score}`, x + 140, y + 4, C('9'), { font: 'b', outline: C('1'), align: 'right' });
      r.rounds.forEach((v, k) => {
        const acc = p.rounds[k] ? p.rounds[k].accuracy : 0;
        const col = acc >= CONFIG.SCORE.SUCCESS ? C('9') : acc >= CONFIG.SCORE.OKAY ? C('a') : C('j');
        KText.draw(ctx, String(v), x + 170 + k * 34, y + 4, col, { font: 's', align: 'center' });
      });
      if (r.rankPoints != null) KText.draw(ctx, `+${r.rankPoints}`, x + 286, y + 4, C('e'), { font: 'b', align: 'right' });
    });
    const by = CONFIG.HEIGHT - 15;
    if (this.opts.embed) KText.draw(ctx, '결과 전송 완료', W / 2, by, C('a'), { align: 'center', font: 's', outline: C('1') });
    else if (t > 60 && t % 40 < 28) {
      const msg = this.opts.mode === 'personal' ? `내 점수 ${rows[0].score}점 → 진행자에게! (R 다시)` : '클릭/Space: 타이틀 · R: 다시 하기';
      KText.draw(ctx, msg, W / 2, by, C('9'), { align: 'center', font: 's', outline: C('1') });
    }
  }
}
