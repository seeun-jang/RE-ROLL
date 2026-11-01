// =====================================================
// 타이틀: 모드 / 인원(또는 내 캐릭터) 선택 — 방 코드 없음
// 가운데에 옆으로 누운 레인: CPU 가 계속 굴려서 핀이 쓰러지는 시범
// =====================================================
const MODES = [
  { id: 'together', label: '함께 하기' },
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
    this.frames = s.frames || 3;
    this.aimGuide = s.aimGuide !== false;
    this.row = 4; // 0 모드, 1 인원/캐릭터, 2 프레임, 3 조준선, 4 시작
    this.startBtn = new Button('시작!', 228, 164, 88, 14);
    this.leaving = false;
    this.newDemo();
  }

  // 뒤에서 돌아가는 시범 경기 (CPU 5명, 소리 없음) — 끝나면 새로 시작
  newDemo() {
    const fake = {
      audio: { sfx() {}, playBgm() {} },
      input: { anyPressed: () => false },
      changeScene: () => this.newDemo(),
    };
    this.demo = new PlayScene(fake, { mode: 'together', count: 5, autoplay: true });
    this.demo.demo = true;
    this.demo.anim = null;
    this.demo.t = 120;
  }

  enter() {
    this.game.audio.playBgm('lobby');
  }

  get mode() {
    return MODES[this.modeIdx].id;
  }

  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    this.t++;
    this.demo.update();
    this.startBtn.update();
    if (this.leaving) return;
    if (input.anyPressed(['ArrowUp', 'KeyW'])) {
      this.row = (this.row + 4) % 5;
      audio.sfx('select');
    }
    if (input.anyPressed(['ArrowDown', 'KeyS'])) {
      this.row = (this.row + 1) % 5;
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
      if (this.row === 2) {
        const ch = CONFIG.FRAME_CHOICES;
        this.frames = ch[(ch.indexOf(this.frames) + dx + ch.length) % ch.length];
      }
      if (this.row === 3) this.aimGuide = !this.aimGuide;
    }
    if (input.confirm()) {
      if (this.row !== 4) {
        this.row = 4;
        audio.sfx('select');
        return;
      }
      this.startBtn.press();
      this.leaving = true;
      audio.sfx('start');
      Object.assign(this.game.settings, { mode: this.mode, count: this.count, charIdx: this.charIdx, frames: this.frames, aimGuide: this.aimGuide });
      const opts = { mode: this.mode, count: this.count, charIdx: this.charIdx, embed: false, frames: this.frames, aimGuide: this.aimGuide };
      this.game.changeScene(() => new PlayScene(this.game, opts), 'circle');
    }
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    // 뒤: 시범 경기 (전광판 + 레인)
    this.demo.render(ctx);
    ctx.fillStyle = DITHER.get(ctx, 'o', 9);
    ctx.fillRect(0, 75, W, CONFIG.HEIGHT - 75);
    // 로고 (뒤에 어두운 띠 — 시범 경기 무늬가 글자 사이로 비치지 않게)
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 75, W, 30);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, 75, W, 1);
    const bob = Math.round(Math.sin(t / 18) * 1.5);
    KText.draw(ctx, '잭팟 볼링', W / 2, 74 + bob, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    drawCard(ctx, 20, 106, 280, 16, '1', '8');
    const lines = ['한 레인에서 차례대로! 전광판에 스트라이크를 띄워라', '←→ 위치 · 가운데 키 = 방향, 힘 멈춤 · 굴릴 때 ←→ 스핀'];
    const line = lines[(t / 180 | 0) % 2];
    KText.draw(ctx, line, W / 2, 108, C('a'), { align: 'center', font: KText.width(line, 's') > 272 ? 'n' : 's' });
    // 캐릭터 이름표 + 키
    const together = this.mode === 'together';
    CHARACTERS.forEach((ch, i) => {
      const on = together ? i < this.count : i === this.charIdx;
      const x = 4 + i * 63;
      const y = 123;
      drawNameCard(ctx, x, y, 60, { def: ch, name: ch.name, index: i, place: null }, t);
      if (!on) {
        ctx.fillStyle = DITHER.get(ctx, 'o', 10);
        ctx.fillRect(x, y, 60, 17);
        return;
      }
      const keys = together ? KEYMAP[i].keys : ['<', '^', '>'];
      const caps = keys.map((k, j) => getKeycap(k, j === 1 ? 'strike' : 'plain', false));
      const tw = caps.reduce((s, c) => s + c.width, 0) + 2;
      let kx = Math.round(x + 30 - tw / 2);
      caps.forEach((c) => {
        ctx.drawImage(c, kx, y + 18);
        kx += c.width + 1;
      });
    });
    // 메뉴 (모드 · 인원 · 프레임 · 조준선)
    drawCard(ctx, 2, 163, 222, 17, '1', '3');
    const items = [
      MODES[this.modeIdx].label,
      this.mode === 'personal' ? CHARACTERS[this.charIdx].name : `${this.count}명`,
      `${this.frames}프레임`,
      this.aimGuide ? '조준선 켬' : '조준선 끔',
    ];
    items.forEach((v, i) => {
      const cx = [30, 80, 128, 186][i];
      const sel = this.row === i;
      KText.draw(ctx, sel ? `◀${v}▶` : v, cx, 166, sel ? C('9') : C('a'), { font: 'n', align: 'center', outline: C('1') });
    });
    for (const sx of [55, 104, 152]) {
      ctx.fillStyle = C('3');
      ctx.fillRect(sx, 167, 1, 10);
    }
    this.startBtn.render(ctx, this.row === 4, t);
  }
}
