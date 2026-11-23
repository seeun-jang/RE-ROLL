// =====================================================
// 결과 (클리어): 순위표 + 등급 + 메인 게임에 넘길 점수
// =====================================================
class ResultScene {
  constructor(game, performers, opts) {
    this.game = game;
    this.opts = opts;
    this.performers = performers;
    this.t = 0;
    this.stage = new Stage();
    this.particles = new ParticleSystem();
    this.song = expandSong();
    this.music = new MusicPlayer(game.audio);
    this.clock = new SongClock(game.audio);
    this.clock.start(0, 0);
    this.result = buildResult(opts.mode, performers, opts.difficulty);
    emitResult(this.result); // 메인 게임으로 결과 전송
    // 1등은 무대에서 춤
    const top = performers.find((p) => p.def.id === this.result.ranking[0].playerId);
    this.winner = new Dancer(top, opts.mode === 'personal' ? 70 : 292, opts.mode === 'personal' ? 150 : 176, opts.mode === 'personal' ? 2 : 1);
    this.winner.cheer = true;
    this.winner.p.fever = true;
  }

  enter() {
    const a = this.game.audio;
    a.sfx('clear');
    a.onReady(() => {
      if (!a.ctx || a.ctx.state !== 'running') return;
      // 결과 배경음: 인트로 구간 반복 (조용히)
      const at = a.ctx.currentTime + 1.2;
      this.music.play({ startAt: at, fromBar: 0, toBar: 4, loop: true, vol: 0.5 });
      this.clock.start(-1.2, at);
    });
  }

  update() {
    this.t++;
    this.clock.sync();
    this.stage.update(this.clock.time, this.song.beatSec, true);
    this.winner.update();
    if (this.t % 4 === 0) {
      const cols = [C('9'), C('8'), C('5'), C('h'), C('e'), C('p')];
      this.particles.add(Math.random() * CONFIG.WIDTH, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 1);
    }
    this.particles.update();
    if (this.opts.embed) return; // 메인 게임에 들어가 있으면 메인 게임이 다음 화면을 띄움
    const input = this.game.input;
    if (this.t > 60 && input.confirm()) {
      this.game.audio.sfx('select');
      this.music.stop(0.3);
      this.game.changeScene(() => new TitleScene(this.game), 'fade');
    }
    if (this.t > 60 && input.wasPressed('KeyR')) {
      this.game.audio.sfx('start');
      this.music.stop(0.3);
      this.game.changeScene(() => new PlayScene(this.game, this.opts), 'circle');
    }
  }

  render(ctx, alpha) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    this.stage.renderBack(ctx, t / 60, t);
    this.stage.renderFloor(ctx);
    ctx.fillStyle = ctx.createPattern(Transition.patterns[8], 'repeat');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    this.particles.render(ctx);
    if (this.opts.mode === 'personal') this.renderPersonal(ctx, alpha);
    else this.renderTogether(ctx, alpha);
    const by = CONFIG.HEIGHT - 15;
    if (this.opts.embed) KText.draw(ctx, '결과 전송 완료', W / 2, by, C('a'), { align: 'center', font: 's', outline: C('1') });
    else if (t > 60 && t % 40 < 28) KText.draw(ctx, 'Space: 타이틀 · R: 다시 하기', W / 2, by, C('9'), { align: 'center', font: 's', outline: C('1') });
  }

  renderTogether(ctx, alpha) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    KText.draw(ctx, '최종 순위', 134, -3, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const rows = this.result.ranking;
    const rowH = 27;
    const y0 = 30;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.performers.find((pp) => pp.def.id === r.playerId);
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 12;
      const x = 6 - slide;
      const y = y0 + i * rowH;
      drawPanel(ctx, x, y, 256, rowH - 2, r.rank === 1 ? 'red' : 'dark');
      BitmapFont.draw(ctx, String(r.rank), x + 12, y + 7, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      const jump = r.rank === 1 ? Math.abs(Math.round(Math.sin(t / 8) * 2)) : 0;
      const face = p.spr.portrait;
      ctx.drawImage(face, Math.round(x + 38 - face.width / 2), y + 1 - jump, face.width, Math.min(22, face.height));
      if (r.rank === 1) ctx.drawImage(SPR.crown, x + 36, y - 2 - jump);
      KText.draw(ctx, r.name, x + 58, y + 5, p.color, { font: 'b', outline: C('1') });
      // 등급
      drawGradeBadge(ctx, x + 122, y + 11, r.grade);
      // 점수 + 최대 콤보
      BitmapFont.draw(ctx, String(r.score).padStart(7, '0'), x + 168, y + 7, C('a'), { align: 'center', scale: 2 });
      // 풀콤보 FC / 올퍼펙트 AP 딱지
      if (r.fullCombo) {
        const tag = r.allPerfect ? 'AP' : 'FC';
        drawPanel(ctx, x + 200, y + 4, 22, 16, r.allPerfect ? 'default' : 'felt');
        KText.draw(ctx, tag, x + 211, y + 5, r.allPerfect ? C('9') : C('e'), { align: 'center', font: 'b' });
      }
      KText.draw(ctx, `+${r.rankPoints}`, x + 250, y + 5, C('e'), { font: 'b', align: 'right' });
    });
    KText.draw(ctx, '메인 점수', 262, 17, C('e'), { font: 's', align: 'right', outline: C('1') });
    // 1등 춤
    this.winner.render(ctx, this.clock.time, this.song.beatSec, alpha, t);
  }

  renderPersonal(ctx, alpha) {
    const W = CONFIG.WIDTH;
    const r = this.result.ranking[0];
    const p = this.performers[0];
    const t = this.t;
    this.stage.renderSpot(ctx, 70, 150, 26, '9', 6);
    this.winner.render(ctx, this.clock.time, this.song.beatSec, alpha, t);
    drawPanel(ctx, 128, 8, 184, 158, 'red');
    KText.draw(ctx, `P${r.slot} ${r.name}`, 220, 12, p.color, { align: 'center', font: 'b', outline: C('1') });
    KText.draw(ctx, 'SCORE', 220, 26, C('k'), { align: 'center', font: 's' });
    BitmapFont.draw(ctx, String(r.score).padStart(7, '0'), 220, 41, C('9'), { align: 'center', scale: 3, outline: C('1') });
    const g = CONFIG.GRADES.find((gg) => gg.grade === r.grade);
    if (t > 30) {
      const s = t < 36 ? 8 : 6;
      KText.draw(ctx, r.grade, 160, 50 - (s - 6) * 3, C(g.color), { align: 'center', font: 'b', scale: s / 2, outline: C('1') });
    }
    const badge = r.allPerfect ? 'ALL PERFECT!' : r.fullCombo ? 'FULL COMBO!' : `MAX COMBO ${r.maxCombo}`;
    KText.draw(ctx, badge, 250, 64, r.fullCombo ? C('e') : C('a'), { align: 'center', font: 's', outline: C('1') });
    KText.draw(ctx, `난이도 ${(CONFIG.DIFFICULTY[this.opts.difficulty] || CONFIG.DIFFICULTY.normal).label}`, 250, 79, C('8'), { align: 'center', font: 's' });
    const rows = [['PERFECT', 'perfect', '9'], ['GREAT', 'great', 'h'], ['GOOD', 'good', 'e'], ['MISS', 'miss', 'j']];
    rows.forEach(([lab, k, col], i) => {
      const y = 98 + i * 14;
      KText.draw(ctx, lab, 150, y, C(col), { font: 's' });
      BitmapFont.draw(ctx, String(r[k]), 296, y + 2, C('a'), { align: 'right', scale: 2 });
    });
    KText.draw(ctx, '점수를 진행자에게 알려주세요', 220, 152, C('a'), { align: 'center', font: 's' });
  }
}
