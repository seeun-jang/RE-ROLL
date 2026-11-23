// =====================================================
// 타이틀: 모드 / 인원(또는 내 캐릭터) 선택 — 방 코드 없음
// 가운데 양피지에 CPU 가 마법진을 그리는 시범 (모양이 차례로 바뀜)
// 메뉴는 마우스 클릭 또는 방향키 + Space 로 조작
// =====================================================
const MODES = [
  { id: 'personal', label: '개인 화면' },
];

class TitleScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    const s = game.settings;
    this.modeIdx = Math.max(0, MODES.findIndex((m) => m.id === s.mode));
    this.count = s.count;
    this.charIdx = s.charIdx;
    this.row = 2; // 0 모드, 1 인원/캐릭터, 2 시작
    this.startBtn = new Button('시작!', 222, 160, 92, 16);
    this.leaving = false;
    this.demoIdx = 0;
    this.newDemo();
  }

  newDemo() {
    this.shape = SHAPES[this.demoIdx % SHAPES.length];
    this.paper = new Paper();
    this.auto = new AutoDrawer(this.shape, 0.85);
    this.dt = 0;
  }

  enter() {
    this.game.audio.playBgm('lobby');
  }

  get mode() {
    return MODES[this.modeIdx].id;
  }

  // 메뉴 칸 영역 (마우스 클릭용)
  menuRects() {
    return [
      { x: 6, y: 160, w: 104, h: 16 },
      { x: 112, y: 160, w: 104, h: 16 },
    ];
  }

  change(row, dx) {
    if (row === 0) this.modeIdx = (this.modeIdx + dx + MODES.length) % MODES.length;
    if (row === 1) {
      if (this.mode === 'personal') this.charIdx = (this.charIdx + dx + CONFIG.MAX_PLAYERS) % CONFIG.MAX_PLAYERS;
      else this.count = Math.max(CONFIG.MIN_PLAYERS, Math.min(CONFIG.MAX_PLAYERS, this.count + dx));
    }
  }

  update() {
    // 컴퓨터 1대 = 플레이어 1명: 처음엔 이름부터 정하고, 고른 캐릭터 이름을 내 이름으로
    if (!PlayerName.get() && !PlayerName.isOpen) PlayerName.open();
    PlayerName.applyTo(CHARACTERS, this.charIdx);
    PlayerName.showBadge();
    if (PlayerName.isOpen) return;
    const input = this.game.input;
    const audio = this.game.audio;
    const m = input.mouse;
    this.t++;
    this.dt++;
    // 시범 그리기
    const p = this.auto.next();
    if (p) this.paper.stroke(p.x, p.y, PALETTE['1']);
    else this.paper.end();
    if (this.dt > 220) {
      this.demoIdx++;
      this.newDemo();
    }
    this.startBtn.update();
    if (this.leaving) return;
    if (input.anyPressed(['ArrowUp', 'KeyW'])) {
      this.row = (this.row + 2) % 3;
      audio.sfx('select');
    }
    if (input.anyPressed(['ArrowDown', 'KeyS'])) {
      this.row = (this.row + 1) % 3;
      audio.sfx('select');
    }
    const dx = (input.menuRight() ? 1 : 0) - (input.menuLeft() ? 1 : 0);
    if (dx) {
      audio.sfx('select');
      this.change(this.row, dx);
    }
    let start = false;
    if (m && m.pressed) {
      const hit = (r) => m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h;
      this.menuRects().forEach((r, i) => {
        if (!hit(r)) return;
        // 칸 왼쪽 절반 클릭 = ◀, 오른쪽 절반 = ▶
        this.row = i;
        this.change(i, m.x < r.x + r.w / 2 ? -1 : 1);
        audio.sfx('select');
      });
      // 캐릭터 이름표 클릭 = 개인 화면에서 내 캐릭터 고르기 / 함께 하기에서 인원
      CHARACTERS.forEach((_, i) => {
        if (!hit({ x: 4 + i * 63, y: 132, w: 60, h: 17 })) return;
        if (this.mode === 'personal') this.charIdx = i;
        else this.count = Math.max(CONFIG.MIN_PLAYERS, i + 1);
        audio.sfx('select');
      });
      if (hit(this.startBtn)) {
        this.row = 2;
        start = true;
      }
    }
    if (input.confirm()) {
      if (this.row !== 2) {
        this.row = 2;
        audio.sfx('select');
        return;
      }
      start = true;
    }
    if (start) {
      this.startBtn.press();
      this.leaving = true;
      audio.sfx('start');
      Object.assign(this.game.settings, { mode: this.mode, count: this.count, charIdx: this.charIdx });
      const opts = { mode: this.mode, count: this.count, charIdx: this.charIdx, embed: false };
      this.game.changeScene(() => new PlayScene(this.game, opts), 'circle');
    }
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    drawBackdrop(ctx, t);
    const bob = Math.round(Math.sin(t / 18) * 1.5);
    KText.draw(ctx, '마법진 그리기', W / 2, -1 + bob, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    drawCard(ctx, 22, 36, 276, 17, '1', '8');
    KText.draw(ctx, '마우스로 마법진을 똑같이! 정확할수록 마법 발동', W / 2, 38, C('a'), { align: 'center', font: 's' });

    // 시범 양피지 (64x64 로 줄여서 보여 줌)
    drawCard(ctx, 126, 58, 68, 68, 'l', 'r');
    ctx.fillStyle = C('a');
    ctx.fillRect(128, 60, 64, 64);
    ctx.drawImage(guideImage(this.shape), 128, 60, 64, 64);
    ctx.drawImage(this.paper.canvas, 128, 60, 64, 64);
    // 모양 이름: 종이 아래 따로 (테두리에 안 걸치게)
    const nw = KText.width(this.shape.name, 'n') + 8;
    ctx.fillStyle = C('1');
    ctx.fillRect(160 - nw / 2, 127, nw, 11);
    KText.draw(ctx, this.shape.name, 160, 127, C(this.shape.color), { align: 'center', font: 'n' });

    // 왼쪽/오른쪽 설명
    drawCard(ctx, 8, 62, 112, 60, '2', '3');
    KText.draw(ctx, '방법', 64, 64, C('9'), { align: 'center', font: 'b' });
    KText.draw(ctx, '왼쪽 버튼 누른 채', 64, 80, C('a'), { align: 'center', font: 's' });
    KText.draw(ctx, '선을 따라 그리기', 64, 93, C('a'), { align: 'center', font: 's' });
    KText.draw(ctx, '선 위면 반짝반짝!', 64, 106, C('k'), { align: 'center', font: 'n' });
    drawCard(ctx, 200, 62, 112, 60, '2', '3');
    KText.draw(ctx, '3라운드', 256, 64, C('9'), { align: 'center', font: 'b' });
    ['1 연습 마법', '2 저주 슬롯머신!', '3 잭팟 ×2'].forEach((s, i) =>
      KText.draw(ctx, s, 206, 80 + i * 13, i === 2 ? C('9') : i === 1 ? C('5') : C('a'), { font: 's' }));

    // 캐릭터 이름표
    const together = this.mode === 'together';
    CHARACTERS.forEach((ch, i) => {
      const on = together ? i < this.count : i === this.charIdx;
      const x = 4 + i * 63;
      const y = 140;
      drawNameCard(ctx, x, y, 60, { def: ch, name: ch.name, index: i, place: null }, t);
      if (!on) {
        ctx.fillStyle = DITHER.get(ctx, 'o', 10);
        ctx.fillRect(x, y, 60, 17);
      }
    });
    // 메뉴
    drawCard(ctx, 6, 161, 210, 16, '1', '3');
    const items = [
      ['모드', MODES[this.modeIdx].label],
      this.mode === 'personal' ? ['캐릭터', CHARACTERS[this.charIdx].name] : ['인원', `${this.count}명`],
    ];
    items.forEach(([k, v], i) => {
      const cx = 58 + i * 106;
      const sel = this.row === i;
      const col = sel ? C('9') : C('a');
      // ◀ 글자 ▶ 를 글자 폭에 붙여서 (간격 일정하게)
      const label = `${k} ${v}`;
      const f = KText.width(label, 's') > 76 ? 'n' : 's';
      const lw = KText.width(label, f);
      KText.draw(ctx, label, cx, 161, col, { font: f, align: 'center' });
      KText.draw(ctx, '◀', cx - lw / 2 - 4, 162, col, { font: 'n', align: 'right' });
      KText.draw(ctx, '▶', cx + lw / 2 + 4, 162, col, { font: 'n' });
    });
    this.startBtn.render(ctx, this.row === 2, t);
    // 마우스 커서 위치 표시 (작은 반짝이)
    const m = this.game.input.mouse;
    if (m && m.inside && t % 30 < 20) {
      ctx.fillStyle = C('9');
      ctx.fillRect(Math.round(m.x), Math.round(m.y) - 3, 1, 7);
      ctx.fillRect(Math.round(m.x) - 3, Math.round(m.y), 7, 1);
    }
  }
}
