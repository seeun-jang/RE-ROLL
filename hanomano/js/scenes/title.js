// =====================================================
// 타이틀: 모드 / 인원(또는 내 캐릭터) 선택 — 방 코드 없음
// 테이블 위에서 과일 카드가 넘어가고, 5개가 되면 종이 딩!
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
    this.startBtn = new Button('시작!', 120, 164, 80, 14);
    this.leaving = false;
    // 시범 카드 (5장이 하나씩 넘어감)
    this.demo = [
      { fruit: 0, n: 2 }, { fruit: 0, n: 3 }, { fruit: 0, n: 3 }, { fruit: 2, n: 1 }, { fruit: 3, n: 4 },
    ];
    this.shake = 0;
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
    if (this.shake > 0) this.shake--;
    if (this.t % 240 === 75) this.shake = 16; // 체리 2+3 = 5 → 딩!
    this.startBtn.update();
    if (this.leaving) return;
    // V: 책상 탁! = 종 (개인 화면에서만)
    if (input.wasPressed('KeyV') && this.mode === 'personal') {
      SlapBell.toggle();
      audio.sfx('select');
    }
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
      audio.sfx('bell');
      Object.assign(this.game.settings, { mode: this.mode, count: this.count, charIdx: this.charIdx });
      const opts = { mode: this.mode, count: this.count, charIdx: this.charIdx, embed: false };
      this.game.changeScene(() => new PlayScene(this.game, opts), 'circle');
    }
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    // 테이블 배경 (게임 화면과 같은 펠트)
    PlayScene.prototype.renderTable.call({ frame: t, timeLeft: CONFIG.TIME_LIMIT }, ctx);
    ctx.fillStyle = C('o');
    ctx.fillRect(100, 12, 120, 34);
    // 로고
    const bob = Math.round(Math.sin(t / 18) * 1.5);
    KText.draw(ctx, '하노마노', W / 2, -1 + bob, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    // 설명 띠 (테이블 금테와 안 겹치게 화면 폭 전체 어두운 띠)
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 35, W, 18);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, 35, W, 1);
    ctx.fillRect(0, 52, W, 1);
    KText.draw(ctx, '같은 과일이 딱 5개! 제일 먼저 종을 쳐라!', W / 2, 38, C('a'), { align: 'center', font: 's' });
    // 시범: 카드 넘기기 + 종
    const shown = Math.min(5, Math.floor((t % 240) / 15));
    for (let i = 0; i < 2; i++) {
      const img = i < shown ? cardFace(this.demo[i]) : cardBack();
      ctx.drawImage(img, W / 2 - 74 + i * 112, 55);
    }
    drawBell(ctx, W / 2, 74, this.shake, this.shake > 10);
    if (this.shake > 0) KText.draw(ctx, '딩!', W / 2 + 22, 54, C('9'), { font: 'b', outline: C('1') });
    // 캐릭터 이름표 + 키
    const together = this.mode === 'together';
    CHARACTERS.forEach((ch, i) => {
      const on = together ? i < this.count : i === this.charIdx;
      const x = 4 + i * 63;
      const y = 96;
      drawNameCard(ctx, x, y, 60, { def: ch, name: ch.name, index: i, place: null }, t);
      if (!on) {
        ctx.fillStyle = DITHER.get(ctx, 'o', 10);
        ctx.fillRect(x, y, 60, 17);
        return;
      }
      const keys = together ? KEYMAP[i].keys : ['<', 'Space', '>'];
      const caps = keys.map((k, j) => getKeycap(k, j === 1 ? 'strike' : 'plain', false));
      const tw = caps.reduce((s, c) => s + c.width, 0) + 2;
      let kx = Math.round(x + 30 - tw / 2);
      caps.forEach((c) => {
        ctx.drawImage(c, kx, y + 18);
        kx += c.width + 1;
      });
    });
    // 개인 화면에서는 책상 종(마이크) 상태를 번갈아 보여 줌
    const slapLabel = { off: '꺼짐', loading: '준비 중…', on: '켜짐', error: '' }[SlapBell.status];
    const slapLine = SlapBell.status === 'error' ? SlapBell.message : `V: 책상을 탁! 치면 종 (${slapLabel})`;
    const showSlap = this.mode === 'personal' && (SlapBell.status !== 'off' || (t / 150 | 0) % 2 === 1);
    KText.draw(ctx, showSlap ? slapLine : '양쪽 키 = 카드 뒤집기 · 가운데(금색) = 종', W / 2, 134, C(showSlap && SlapBell.status === 'error' ? '5' : '9'), { align: 'center', font: 's', outline: C('1') });
    // 메뉴
    drawCard(ctx, 50, 148, 220, 15, '1', '3');
    const items = [
      ['모드', MODES[this.modeIdx].label],
      this.mode === 'personal' ? ['캐릭터', CHARACTERS[this.charIdx].name] : ['인원', `${this.count}명`],
    ];
    items.forEach(([k, v], i) => {
      const cx = 105 + i * 110;
      const sel = this.row === i;
      KText.draw(ctx, sel ? `◀ ${k} ${v} ▶` : `${k} ${v}`, cx, 149, sel ? C('9') : C('a'), { font: 's', align: 'center' });
    });
    this.startBtn.render(ctx, this.row === 2, t);
  }
}
