// =====================================================
// 타이틀: 모드 / 인원(또는 내 캐릭터) 선택 — 방 코드 없음
// 5명이 라켓 위에 공을 통통 튀기며 대기
// =====================================================
const MODES = [
  { id: 'personal', label: '개인 화면' },
];

class TitleScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.hall = new Hall();
    const s = game.settings;
    this.modeIdx = Math.max(0, MODES.findIndex((m) => m.id === s.mode));
    this.count = s.count;
    this.charIdx = s.charIdx;
    this.row = 2; // 0 모드, 1 인원/캐릭터, 2 시작
    this.startBtn = new Button('시작!', 120, 161, 80, 15);
    this.leaving = false;
    // 라켓 위로 공을 튀기는 5명 (동작만)
    this.demo = CHARACTERS.map((_, i) => {
      const p = new Paddler(new Participant(i), i < 3 ? 0 : 1);
      p.x = p.px = 32 + i * 64;
      p.paddle = { x: 9, y: -16 };
      p.paddleP = { ...p.paddle };
      return p;
    });
    this.fake = { frame: 0 };
  }

  enter() {
    this.game.audio.playBgm('lobby');
  }

  get mode() {
    return MODES[this.modeIdx].id;
  }

  update() {
    // 컴퓨터 1대 = 플레이어 1명: 처음엔 이름부터 정하고, 고른 캐릭터 이름을 내 이름으로
    if (!PlayerName.get() && !PlayerName.isOpen) PlayerName.open();
    PlayerName.applyTo(CHARACTERS, this.charIdx);
    PlayerName.showBadge();
    if (PlayerName.isOpen) return;
    const input = this.game.input;
    const audio = this.game.audio;
    this.t++;
    this.fake.frame = this.t;
    this.hall.update(this.t, CONFIG.WIDTH / 2 + Math.sin(this.t / 60) * 120);
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
      if (this.row === 0) this.modeIdx = (this.modeIdx + dx + MODES.length) % MODES.length;
      if (this.row === 1) {
        if (this.mode === 'personal') this.charIdx = (this.charIdx + dx + CONFIG.MAX_PLAYERS) % CONFIG.MAX_PLAYERS;
        else this.count = Math.max(CONFIG.MIN_PLAYERS, Math.min(CONFIG.MAX_PLAYERS, this.count + dx));
      }
    }
    if (input.confirm()) {
      if (this.row !== 2) {
        this.row = 2;
        audio.sfx('select');
        return;
      }
      this.startBtn.press();
      this.leaving = true;
      audio.sfx('start');
      Object.assign(this.game.settings, { mode: this.mode, count: this.count, charIdx: this.charIdx });
      const opts = { mode: this.mode, count: this.count, charIdx: this.charIdx, embed: false };
      // 토너먼트는 대진을 먼저 직접 정함
      this.game.changeScene(() => (this.mode === 'tournament' ? new SeedScene(this.game, opts) : new TournamentScene(this.game, opts)), 'circle');
    }
  }

  render(ctx, alpha) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    this.hall.noLamps = true; // 샹들리에는 제목 띠와 겹치니 타이틀에선 숨김
    this.hall.renderBack(ctx, t, alpha);
    // 키 · 이름 뒤 어두운 띠 (뒤 슬롯머신과 섞이지 않게)
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 52, W, 38);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, 52, W, 1);
    ctx.fillRect(0, 89, W, 1);

    // 로고 (큰 제목 글꼴) + 부제
    const bob = Math.round(Math.sin(t / 18) * 1.5);
    KText.draw(ctx, '잭팟 탁구왕', W / 2, -1 + bob, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    drawPanel(ctx, 30, 35, 260, 17, 'dark');
    KText.draw(ctx, '3점 먼저! 탁구 토너먼트 최후의 1인은 누구?', W / 2, 37, C('a'), { align: 'center', font: 's' });

    // 선수 + 머리 위에 각자의 키 3개
    const together = this.mode === 'tournament';
    this.demo.forEach((p, i) => {
      const on = together ? i < this.count : i === this.charIdx;
      const cx = 32 + i * 64;
      ctx.save();
      ctx.translate(0, -8); // 선수 발이 메뉴와 안 겹치게
      if (on) {
        p.render(ctx, this.fake, alpha);
        // 라켓 위에서 통통 튀는 공
        const ph = ((t + i * 13) % 36) / 36;
        const by = CONFIG.FLOOR_Y - 20 - Math.round(Math.sin(ph * Math.PI) * 16);
        const bx = Math.round(p.x + p.facing * 9);
        ctx.fillStyle = C('1');
        ctx.fillRect(bx - 2, by - 3, 5, 5);
        ctx.fillStyle = C('b');
        ctx.fillRect(bx - 1, by - 2, 3, 3);
        const keys = together ? KEYMAP[i].keys : ['<', 'Space', '>'];
        const tones = ['plain', 'strike', 'plain'];
        const caps = keys.map((kk, l) => getKeycap(kk, tones[l], false));
        const totalW = caps.reduce((s, c) => s + c.width, 0) + (caps.length - 1);
        let x = Math.round(cx - totalW / 2);
        caps.forEach((c) => {
          ctx.drawImage(c, x, 63);
          x += c.width + 1;
        });
      } else {
        drawStanding(ctx, SPR.players[i].ghost, cx, CONFIG.FLOOR_Y);
      }
      ctx.restore();
      if (on) KText.draw(ctx, CHARACTERS[i].name, cx, 73, C(CHARACTERS[i].color), { align: 'center', font: 'b', outline: C('1') });
    });

    // 메뉴
    drawPanel(ctx, 50, 143, 220, 17, 'dark');
    const items = [
      ['모드', MODES[this.modeIdx].label],
      this.mode === 'personal' ? ['캐릭터', CHARACTERS[this.charIdx].name] : ['인원', `${this.count}명`],
    ];
    items.forEach(([k, v], i) => {
      const cx = 105 + i * 110;
      const sel = this.row === i;
      const txt = sel ? `◀ ${k} ${v} ▶` : `${k} ${v}`;
      KText.draw(ctx, txt, cx, 145, sel ? C('9') : C('a'), { font: 's', align: 'center' });
    });
    this.startBtn.render(ctx, this.row === 2, t);
  }
}
