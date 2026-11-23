// =====================================================
// 타이틀: 모드 / 인원(또는 내 캐릭터) 선택 — 방 코드 없음
// 뒤에서 CPU 5명이 인형뽑기를 하는 시범
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
    this.startBtn = new Button('시작!', 226, 165, 88, 14);
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
    this.demo.t = 90; // 코인 넣는 연출은 건너뜀
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
    // 뒤: 시범 인형뽑기 (5대)
    this.demo.render(ctx);
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, 33);
    ctx.fillRect(0, 102, W, CONFIG.HEIGHT - 102);
    ctx.fillStyle = C('c');
    ctx.fillRect(0, 32, W, 1);
    ctx.fillRect(0, 102, W, 1);
    // 로고
    const bob = Math.round(Math.sin(t / 18) * 1.5);
    KText.draw(ctx, '잭팟 인형뽑기', W / 2, -1 + bob, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    // 설명 띠 (불투명 · 시범 기계를 덮지 않게 화면 폭 전체)
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 84, W, 18);
    ctx.fillStyle = C('c');
    ctx.fillRect(0, 84, W, 1);
    KText.draw(ctx, '코인 8개로 인형을 최대한 많이! 황금곰은 30점', W / 2, 87, C('a'), { align: 'center', font: 's' });
    // 키 아래 빈 공간: 조작 안내
    KText.draw(ctx, '←→ 집게 옮기기 · 가운데 키 = 내리기 (빨간 점 = 내려갈 곳)', W / 2, 143, C('k'), { align: 'center', font: 'n' });
    KText.draw(ctx, '인형 가운데를 집어야 안 미끄러짐 · 출구에 떨어지면 획득!', W / 2, 154, C('9'), { align: 'center', font: 'n' });
    // 캐릭터 이름표 + 키
    const together = this.mode === 'together';
    CHARACTERS.forEach((ch, i) => {
      const on = together ? i < this.count : i === this.charIdx;
      const x = 4 + i * 63;
      const y = 104;
      drawNameCard(ctx, x, y, 60, { def: ch, name: ch.name, index: i, place: null }, t);
      if (!on) {
        ctx.fillStyle = DITHER.get(ctx, 'o', 10);
        ctx.fillRect(x, y, 60, 17);
        return;
      }
      const keys = together ? KEYMAP[i].keys : ['<', '^', '>'];
      const caps = keys.map((k, j) => getKeycap(k, j === 1 ? 'strike' : 'plain', false));
      const tw = caps.reduce((s2, c) => s2 + c.width, 0) + 2;
      let kx = Math.round(x + 30 - tw / 2);
      caps.forEach((c) => {
        ctx.drawImage(c, kx, y + 19);
        kx += c.width + 1;
      });
    });
    // 메뉴
    drawCard(ctx, 6, 165, 214, 15, '1', '3');
    const items = [
      ['모드', MODES[this.modeIdx].label],
      this.mode === 'personal' ? ['캐릭터', CHARACTERS[this.charIdx].name] : ['인원', `${this.count}명`],
    ];
    items.forEach(([k, v], i) => {
      const cx = 60 + i * 106;
      const sel = this.row === i;
      KText.draw(ctx, sel ? `◀ ${k} ${v} ▶` : `${k} ${v}`, cx, 166, sel ? C('9') : C('a'), { font: 's', align: 'center' });
    });
    this.startBtn.render(ctx, this.row === 2, t);
  }
}
