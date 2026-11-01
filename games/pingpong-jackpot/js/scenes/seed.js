// =====================================================
// 대진 정하기: 토너먼트 자리를 직접 고름 (무작위로 정해 놓지 않음)
//  ← → : 선수 칸 고르기 · Space : 고른 두 칸의 자리 바꾸기
//  ↓ : 아래 버튼(섞기 / 시작!)으로 · ↑ : 다시 선수 칸으로
// =====================================================
class SeedScene {
  // opts: TournamentScene 에 넘길 설정 (mode, count, embed ...)
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    this.t = 0;
    this.backdrop = makeBackdrop();
    this.players = CHARACTERS.slice(0, opts.count).map((_, i) => new Participant(i));
    // 처음에는 P1, P2, … 순서로 채워 둠
    this.order = opts.seeds && opts.seeds.length === opts.count ? [...opts.seeds] : this.players.map((p) => p.index);
    this.rebuild();
    this.cursor = 0;      // 0 ~ 선수 수-1: 선수 칸, 선수 수: 섞기, 선수 수+1: 시작!
    this.picked = null;   // 먼저 고른 칸
    this.shuffleBtn = new Button('섞기', 92, 160, 60, 15);
    this.startBtn = new Button('시작!', 168, 160, 60, 15);
    this.swapAnim = 0;
    this.leaving = false;
  }

  enter() {
    this.game.audio.playBgm('lobby');
  }

  rebuild() {
    this.tour = new Tournament(this.players, this.order);
    this.leaves = buildBracketTree(this.tour).leaves;
  }

  get leafCount() {
    return this.leaves.length;
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    this.t++;
    this.backdrop.update(this.t, CONFIG.WIDTH / 2 + Math.sin(this.t / 90) * 40);
    this.shuffleBtn.update();
    this.startBtn.update();
    if (this.swapAnim > 0) this.swapAnim--;
    if (this.leaving) return;
    const n = this.leafCount;
    const dx = (input.menuRight() ? 1 : 0) - (input.menuLeft() ? 1 : 0);
    if (dx) {
      audio.sfx('select');
      if (this.cursor < n) this.cursor = (this.cursor + dx + n) % n;
      else this.cursor = this.cursor === n ? n + 1 : n;
    }
    if (input.anyPressed(['ArrowDown', 'KeyS']) && this.cursor < n) {
      this.cursor = n + 1;
      audio.sfx('select');
    }
    if (input.anyPressed(['ArrowUp', 'KeyW']) && this.cursor >= n) {
      this.cursor = 0;
      audio.sfx('select');
    }
    if (input.confirm()) {
      if (this.cursor < n) this.pick(this.cursor);
      else if (this.cursor === n) this.shuffle();
      else this.start();
    }
  }

  // 칸 고르기: 두 번째로 고른 칸과 자리를 바꿈
  pick(i) {
    const audio = this.game.audio;
    if (this.picked === null) {
      this.picked = i;
      audio.sfx('select');
      return;
    }
    if (this.picked !== i) {
      const a = this.leaves[this.picked].p.index;
      const b = this.leaves[i].p.index;
      const ia = this.order.indexOf(a);
      const ib = this.order.indexOf(b);
      [this.order[ia], this.order[ib]] = [this.order[ib], this.order[ia]];
      this.rebuild();
      this.swapAnim = 12;
      audio.sfx('coin');
    }
    this.picked = null;
  }

  shuffle() {
    this.shuffleBtn.press();
    this.order = shuffleArray([...this.order]);
    this.rebuild();
    this.picked = null;
    this.swapAnim = 12;
    this.game.audio.sfx('token');
  }

  start() {
    this.startBtn.press();
    this.leaving = true;
    this.game.audio.sfx('start');
    const opts = { ...this.opts, seeds: [...this.order] };
    this.game.changeScene(() => new TournamentScene(this.game, opts), 'circle');
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    this.backdrop.renderBack(ctx, t);
    // 배경을 확 어둡게 (대진표 선 · 글씨가 묻히지 않게)
    ctx.fillStyle = DITHER.get(ctx, 'o', 15);
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    KText.draw(ctx, '대진 정하기', 6, 0, C('9'), { font: 'L', outline: C('1') });
    const n = this.leafCount;
    drawBracket(ctx, this.tour, { t, cursor: this.cursor < n ? this.cursor : null, picked: this.picked });
    // 안내 + 버튼
    const hint = this.picked === null ? '←→ 선수 고르기 · Space 선택' : '바꿀 자리를 고르고 Space!';
    KText.draw(ctx, hint, W / 2, 145, this.picked === null ? C('a') : C('9'), { align: 'center', font: 's', outline: C('1') });
    this.shuffleBtn.render(ctx, this.cursor === n, t);
    this.startBtn.render(ctx, this.cursor === n + 1, t);
  }
}
