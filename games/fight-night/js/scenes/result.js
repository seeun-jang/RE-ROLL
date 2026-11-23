// =====================================================
// 최종 결과 (클리어): 순위표 + 메인 게임에 넘길 점수
// =====================================================
class ResultScene {
  constructor(game, players, opts) {
    this.game = game;
    this.opts = opts;
    this.players = players;
    this.t = 0;
    this.ring = new Ring();
    this.ring.excite = 9999;
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
    this.ring.update(this.t);
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
    this.ring.renderBack(ctx, t);
    ctx.fillStyle = ctx.createPattern(Transition.patterns[9], 'repeat');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    this.particles.render(ctx);
    if (this.opts.mode === 'personal') this.renderPersonal(ctx);
    else this.renderTournament(ctx);
    const by = CONFIG.HEIGHT - 15;
    if (this.opts.embed) KText.draw(ctx, '결과 전송 완료', W / 2, by, C('a'), { align: 'center', font: 's' });
    else if (t > 60 && t % 40 < 28) KText.draw(ctx, 'Space: 타이틀 · R: 다시 하기', W / 2, by, C('9'), { align: 'center', font: 's', outline: C('1') });
  }

  // 챔피언 시상 (왼쪽) + 순위표 (오른쪽)
  renderTournament(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    const rows = this.result.ranking;
    const champ = this.players.find((pp) => pp.def.id === rows[0].playerId);
    this.drawChampion(ctx, champ, 64, t, '챔피언!');
    px(ctx, 126, 0, CONFIG.WIDTH - 126, 20, 'o');
    KText.draw(ctx, '최종 순위', 200, 0, C('9'), { align: 'center', font: 'L', outline: C('1') });
    KText.draw(ctx, '메인 점수', 314, 3, C('e'), { font: 's', align: 'right', outline: C('1') });
    const rowH = 25;
    const y0 = 22;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.players.find((pp) => pp.def.id === r.playerId);
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 14;
      const x = 128 + slide;
      const y = y0 + i * rowH;
      drawBroadcastPanel(ctx, x, y, 188, rowH - 3, r.rank === 1 ? '9' : p.def.color, r.rank === 1 ? '7' : '1');
      KText.draw(ctx, String(r.rank), x + 13, y + 1, C(r.rank <= 3 ? medal[r.rank - 1] : 'a'), { align: 'center', font: 'L', outline: C('1') });
      ctx.drawImage(p.spr.face, x + 24, y + 2);
      KText.draw(ctx, r.name, x + 45, y + 3, C(p.def.color), { font: 'b', outline: C('1') });
      KText.draw(ctx, `${r.wins}승 KO ${r.kos}`, x + 158, y + 4, C('k'), { font: 's', align: 'right', outline: C('1') });
      KText.draw(ctx, `+${r.rankPoints}`, x + 184, y + 3, C('e'), { font: 'b', align: 'right', outline: C('1') });
    });
  }

  // 챔피언: 빛줄기 + 2배 캐릭터 + 허리에 챔피언 벨트 + 머리 위 왕관
  drawChampion(ctx, p, cx, t, label) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 126, 150);
    ctx.clip();
    drawRays(ctx, cx, 80, 140, t, '7', '2');
    ctx.restore();
    const img = p.spr.frames[((t / 14) | 0) % 2];
    const S = 2;
    const w = img.width * S;
    const h = img.height * S;
    const by = 138;
    const hop = Math.round(Math.abs(Math.sin(t / 12)) * 3);
    px(ctx, cx - 30, by - 1, 60, 3, '1');
    ctx.drawImage(img, Math.round(cx - w / 2), by - h - hop, w, h);
    drawBelt(ctx, cx, Math.round(by - h * 0.36) - hop, Math.round(w * 0.72), t);
    ctx.drawImage(SPR.crown, cx - 2, by - h - hop - 6);
    drawBroadcastPanel(ctx, cx - 54, 140, 108, 18, '9', '7');
    KText.draw(ctx, `${label} ${p.name}`, cx + 2, 142, C('9'), { align: 'center', font: 'b', outline: C('1') });
  }

  renderPersonal(ctx) {
    const W = CONFIG.WIDTH;
    const r = this.result.ranking[0];
    const p = this.players[0];
    drawPanel(ctx, 60, 14, 200, 136, 'red');
    KText.draw(ctx, 'CPU 3연전 결과', W / 2, 20, C('9'), { align: 'center', font: 'b', outline: C('1') });
    const f = ((this.t / 14) | 0) % 2;
    drawStanding(ctx, p.spr.frames[f], W / 2, 82);
    if (r.wins >= 3) {
      drawBelt(ctx, W / 2, 66, 30, this.t);
      ctx.drawImage(SPR.crown, W / 2 - 2, 34);
    } else ctx.drawImage(SPR.gloves.red, W / 2 + 8, 52);
    KText.draw(ctx, `P${r.slot} ${r.name}`, W / 2, 84, p.color, { align: 'center', font: 'b', outline: C('1') });
    BitmapFont.draw(ctx, r.score + ' PT', W / 2, 102, C('9'), { align: 'center', scale: 3, outline: C('1') });
    KText.draw(ctx, `${r.wins}승 · KO ${r.kos}`, W / 2, 122, C('k'), { align: 'center', font: 'b' });
    KText.draw(ctx, '점수를 진행자에게 알려주세요', W / 2, 136, C('a'), { align: 'center', font: 's' });
  }
}

// 챔피언 벨트: 가죽 띠 + 가운데 금판(빨간 보석) + 반짝
function drawBelt(ctx, cx, y, w, t) {
  const x0 = Math.round(cx - w / 2);
  px(ctx, x0 - 1, y - 1, w + 2, 9, '1');
  px(ctx, x0, y, w, 7, '2');
  px(ctx, x0, y + 1, w, 1, '3');
  for (let x = x0 + 3; x < x0 + w - 3; x += 6) px(ctx, x, y + 3, 2, 2, '8');
  // 금판
  const pw = Math.max(16, Math.round(w * 0.42));
  const px0 = Math.round(cx - pw / 2);
  px(ctx, px0 - 1, y - 4, pw + 2, 15, '1');
  px(ctx, px0, y - 3, pw, 13, '8');
  px(ctx, px0 + 1, y - 2, pw - 2, 11, '9');
  px(ctx, px0 + 1, y - 2, pw - 2, 2, 't');
  px(ctx, cx - 3, y, 6, 6, '1');
  px(ctx, cx - 2, y + 1, 4, 4, '6');
  px(ctx, cx - 2, y + 1, 2, 2, '5');
  if (t % 50 < 6) px(ctx, px0 + pw - 4, y - 2, 2, 2, 'b');
}
