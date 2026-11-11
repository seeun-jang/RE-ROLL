// =====================================================
// 타이틀: 모드 / 인원(또는 내 캐릭터) 선택 — 방 코드 없음
// =====================================================
const MODES = [
  { id: 'tournament', label: '토너먼트', desc: '1:1 토너먼트' },
  { id: 'personal', label: '개인 화면', desc: 'CPU 3연전' },
];

class TitleScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.ring = new Ring();
    const s = game.settings;
    this.modeIdx = Math.max(0, MODES.findIndex((m) => m.id === s.mode));
    this.count = s.count;
    this.charIdx = s.charIdx;
    this.row = 2; // 0 모드, 1 인원/캐릭터, 2 시작
    this.startBtn = new Button('시작!', 226, 128, 86, 15);
    this.leaving = false;
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
    this.ring.update(this.t);
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
      this.game.changeScene(() => new TournamentScene(this.game, opts), 'circle');
    }
  }

  render(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    this.ring.renderBack(ctx, t);
    this.ring.renderFront(ctx, t);
    ctx.fillStyle = ctx.createPattern(Transition.patterns[9], 'repeat');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);

    const bob = Math.round(Math.sin(t / 18) * 1.5);
    KText.draw(ctx, '매직 파이트 나이트', W / 2, -1 + bob, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const sub = this.mode === 'personal' ? 'CPU 3연전! 이길수록 점수가 쌓여요' : '마법성 카지노 복싱 토너먼트! 최후의 1인은?';
    drawBroadcastPanel(ctx, 14, 34, 292, 16, '6');
    KText.draw(ctx, sub, W / 2 + 2, 35, C('a'), { align: 'center', font: 's' });

    // 선수 소개 (글러브 끼고 통통)
    const showAll = this.mode !== 'personal';
    for (let i = 0; i < CONFIG.MAX_PLAYERS; i++) {
      const x = W / 2 - 112 + i * 56;
      const on = showAll ? i < this.count : i === this.charIdx;
      const sp = SPR.players[i];
      const f = ((t / 14 + i) | 0) % 2;
      const hop = on ? Math.round(Math.abs(Math.sin(t / 10 + i)) * 2) : 0;
      ctx.fillStyle = C('o');
      ctx.fillRect(x - 12, 99, 24, 2);
      drawStanding(ctx, on ? sp.frames[f] : sp.ghost, x, 100 - hop);
      if (on) ctx.drawImage(SPR.gloves[i % 2 ? 'blue' : 'red'], x + 7, 76 - hop);
    }

    // 메뉴 (왼쪽) + 시작 (오른쪽)
    drawBroadcastPanel(ctx, 8, 106, 212, 38, '9');
    const rows = [
      ['모드', MODES[this.modeIdx].label],
      this.mode === 'personal' ? ['내 캐릭터', CHARACTERS[this.charIdx].name] : ['인원', `${this.count}명`],
    ];
    rows.forEach(([k, v], i) => {
      const y = 107 + i * 17;
      const sel = this.row === i;
      KText.draw(ctx, k, 18, y, sel ? C('9') : C('k'), { font: 'b' });
      KText.draw(ctx, sel ? `◀ ${v} ▶` : v, 150, y, sel ? C('9') : C('a'), { font: 'b', align: 'center' });
    });
    KText.draw(ctx, MODES[this.modeIdx].desc, 269, 109, C('k'), { font: 's', align: 'center', outline: C('1') });
    this.startBtn.render(ctx, this.row === 2, t);

    // 아래: 선수별 얼굴 + 키 3개 (항상 표시)
    px(ctx, 0, 148, W, CONFIG.HEIGHT - 148, 'o');
    px(ctx, 0, 148, W, 1, '9');
    CHARACTERS.forEach((ch, i) => {
      const on = showAll ? i < this.count : i === this.charIdx;
      const x = 2 + i * 64;
      const y = 152;
      // 키 4개 (← 펀치 → 가드) — 얼굴은 위 선수 줄과 같은 순서
      drawCard(ctx, x, y, 62, 22, on ? '2' : '1', on ? ch.color : 'i');
      if (!on) {
        ctx.drawImage(SPR.players[i].face, x + 22, y + 2);
        return;
      }
      const keys = showAll ? KEYMAP[i].keys : ['<', 'SP', '>', 'v'];
      const tones = ['plain', 'strike', 'plain', 'back'];
      let kx = x + 2;
      keys.forEach((k, j) => {
        const cap = getKeycap(k, tones[j], false);
        ctx.drawImage(cap, kx, y + 1);
        kx += Math.min(15, cap.width);
      });
    });
  }
}
