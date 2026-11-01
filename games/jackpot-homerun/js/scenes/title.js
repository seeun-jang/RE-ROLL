// =====================================================
// 타이틀: 모드 / 인원(또는 내 캐릭터) 선택 — 방 코드 없음
// 뒤에서 CPU 타자가 치는 시범 중계
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
    this.row = 2; // 0 모드, 1 인원/캐릭터, 2 시작
    this.startBtn = new Button('시작!', 226, 166, 88, 13);
    this.leaving = false;
    this.newDemo();
  }

  // 뒤에서 돌아가는 시범 경기 (CPU, 소리 없음) — 끝나면 새로 시작
  newDemo() {
    const fake = {
      audio: { sfx() {}, playBgm() {}, stopBgm() {} },
      input: { anyPressed: () => false, confirm: () => false },
      changeScene: () => this.newDemo(),
    };
    this.demo = new PlayScene(fake, { mode: 'together', count: 5, autoplay: true });
    this.demo.demo = true;
    this.demo.phase = 'bat';
    this.demo.cur.ab = new AtBat(this.demo.pitches);
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
      this.game.changeScene(() => new PlayScene(this.game, opts), 'circle');
    }
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    // 뒤: 시범 중계
    this.demo.render(ctx);
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, 33);
    ctx.fillRect(0, 147, W, CONFIG.HEIGHT - 147);
    px(ctx, 0, 31, W, 1, '8');
    px(ctx, 0, 32, W, 1, '9');
    px(ctx, 0, 147, W, 1, '9');
    // 로고: 엠블럼 + 글자
    const bob = Math.round(Math.sin(t / 18) * 1.5);
    drawEmblem(ctx, 40, 16 + bob, t);
    drawEmblem(ctx, W - 40, 16 + bob, t + 30);
    KText.draw(ctx, '잭팟 홈런 더비', W / 2, -1 + bob, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const lines = [`한 명씩 타석에! 같은 공 ${CONFIG.CHANCES}기회로 홈런 점수 대결`, '← → 배트 옮기기 · 가운데 = 스윙 · 볼은 골라내기 · 금색 공 ×2'];
    const line = lines[(t / 180 | 0) % 2];
    drawBroadcastPanel(ctx, 14, 36, 292, 16, '6');
    KText.draw(ctx, line, W / 2, 38, C('a'), { align: 'center', font: KText.width(line, 's') > 284 ? 'n' : 's' });
    // 캐릭터 + 키 (5명 한 줄)
    const together = this.mode === 'together';
    CHARACTERS.forEach((ch, i) => {
      const on = together ? i < this.count : i === this.charIdx;
      const x = 2 + i * 64;
      const y = 148;
      drawCard(ctx, x, y, 62, 20, on ? '2' : '1', on ? ch.color : 'i');
      ctx.drawImage(SPR.players[i].face, x + 1, y + 1);
      if (!on) return;
      const keys = together ? KEYMAP[i].keys : ['<', 'SP', '>'];
      let kx = x + 18;
      keys.forEach((k, j) => {
        const cap = getKeycap(k, j === 1 ? 'strike' : 'plain', false);
        ctx.drawImage(cap, kx, y);
        kx += Math.min(14, cap.width - 1);
      });
    });
    // 메뉴
    drawCard(ctx, 6, 167, 214, 13, '1', '3');
    const items = [MODES[this.modeIdx].label, this.mode === 'personal' ? CHARACTERS[this.charIdx].name : `${this.count}명`];
    items.forEach((v, i) => {
      const cx = 60 + i * 106;
      const sel = this.row === i;
      KText.draw(ctx, sel ? `◀ ${v} ▶` : v, cx, 166, sel ? C('9') : C('a'), { font: 's', align: 'center' });
    });
    this.startBtn.render(ctx, this.row === 2, t);
  }
}
