// =====================================================
// 타이틀: 모드 / 인원(또는 내 캐릭터) / 난이도 / 싱크 → 시작
//  - 방 코드 없음
//  - 배경음: 실제 곡의 코러스를 반복 재생, 캐릭터가 박자에 맞춰 춤춤
// =====================================================
const MODES = [
  { id: 'personal', label: '개인 화면' },
];
const DIFFS = ['easy', 'normal', 'hard'];
// 메뉴 줄: 0 모드 · 1 인원/캐릭터 · 2 곡 · 3 난이도 · 4 속도 · 5 싱크 · 6 시작
const ROW_START = 6;
const SYNC_KEY = 'jackpot-groove-sync';

function loadSync() {
  try {
    const v = parseFloat(localStorage.getItem(SYNC_KEY));
    return isNaN(v) ? 0 : Math.max(-CONFIG.SYNC_RANGE, Math.min(CONFIG.SYNC_RANGE, v));
  } catch (e) {
    return 0;
  }
}

function saveSync(v) {
  try {
    localStorage.setItem(SYNC_KEY, String(v));
  } catch (e) {
    /* 저장 못 해도 게임은 계속 */
  }
}

class TitleScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    const s = game.settings;
    if (s.syncOffset === undefined) s.syncOffset = loadSync();
    this.modeIdx = Math.max(0, MODES.findIndex((m) => m.id === s.mode));
    this.count = s.count;
    this.charIdx = s.charIdx;
    this.diffIdx = Math.max(0, DIFFS.indexOf(s.difficulty || 'normal'));
    this.sync = s.syncOffset;
    this.songIdx = Math.max(0, SONG_ORDER.indexOf(s.song || 'groove'));
    this.speed = s.speed || 3;
    this.row = ROW_START;
    this.startBtn = new Button('시작!', 120, 165, 80, 14);
    this.leaving = false;
    this.stage = new Stage();
    useSong(SONG_ORDER[this.songIdx]);
    this.song = expandSong();
    this.music = new MusicPlayer(game.audio);
    this.clock = new SongClock(game.audio);
    this.clock.start(0, 0);
    this.musicOn = false;
    // 춤추는 5명 (판정 없이 박자만 맞춤)
    this.dummies = CHARACTERS.map((c, i) => ({ spr: SPR.players[i], fever: false }));
    this.dancers = this.dummies.map((d, i) => new Dancer(d, 32 + i * 64, 116, 1));
  }

  enter() {
    this.game.input.takeEvents();
  }

  get mode() {
    return MODES[this.modeIdx].id;
  }

  // 오디오가 켜지면 코러스 반복 재생
  startMusic() {
    const a = this.game.audio;
    if (this.musicOn || !a.ctx || a.ctx.state !== 'running') return;
    this.musicOn = true;
    const chorus = this.song.bars.findIndex((b) => b.fever);
    const at = a.ctx.currentTime + 0.1;
    this.music.play({ startAt: at, fromBar: chorus, toBar: chorus + 8, loop: true, vol: 0.7 });
    this.clock.start(-0.1, at);
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
    this.startMusic();
    this.clock.sync();
    const tt = this.clock.time;
    const beat = this.song.beatSec;
    this.stage.update(tt, beat, this.musicOn);
    this.startBtn.update();
    // 박자마다 한 명씩 돌아가며 포즈
    const b = Math.floor(tt / beat);
    if (b !== this.lastBeat) {
      this.lastBeat = b;
      const d = this.dancers[((b % 5) + 5) % 5];
      d.onJudge('perfect', [0, 2, 1][((b % 3) + 3) % 3]);
    }
    this.dancers.forEach((d) => d.update());
    if (this.leaving) return;

    if (input.anyPressed(['ArrowUp', 'KeyW'])) {
      this.row = (this.row + ROW_START) % (ROW_START + 1);
      audio.sfx('select');
    }
    if (input.anyPressed(['ArrowDown', 'KeyS'])) {
      this.row = (this.row + 1) % (ROW_START + 1);
      audio.sfx('select');
    }
    const dx = (input.menuRight() ? 1 : 0) - (input.menuLeft() ? 1 : 0);
    if (dx) {
      audio.sfx('select');
      if (this.row === 0) this.modeIdx = (this.modeIdx + dx + MODES.length) % MODES.length;
      if (this.row === 1) {
        if (this.mode === 'personal') this.charIdx = (this.charIdx + dx + CONFIG.MAX_PLAYERS) % CONFIG.MAX_PLAYERS;
        else this.count = Math.max(2, Math.min(CONFIG.MAX_PLAYERS, this.count + dx));
      }
      if (this.row === 2) this.changeSong(dx);
      if (this.row === 3) this.diffIdx = (this.diffIdx + dx + DIFFS.length) % DIFFS.length;
      if (this.row === 4) this.speed = Math.max(1, Math.min(5, this.speed + dx));
      if (this.row === 5) {
        this.sync = Math.round((this.sync + dx * CONFIG.SYNC_STEP) * 1000) / 1000;
        this.sync = Math.max(-CONFIG.SYNC_RANGE, Math.min(CONFIG.SYNC_RANGE, this.sync));
      }
    }
    if (input.confirm()) {
      if (this.row !== ROW_START) {
        this.row = ROW_START;
        audio.sfx('select');
        return;
      }
      this.startBtn.press();
      this.leaving = true;
      audio.sfx('start');
      this.music.stop(0.4);
      saveSync(this.sync);
      const song = SONG_ORDER[this.songIdx];
      Object.assign(this.game.settings, { mode: this.mode, count: this.count, charIdx: this.charIdx, difficulty: DIFFS[this.diffIdx], syncOffset: this.sync, song, speed: this.speed });
      const opts = { mode: this.mode, count: this.count, charIdx: this.charIdx, difficulty: DIFFS[this.diffIdx], embed: false, autoplay: false, song, speed: this.speed };
      this.game.changeScene(() => new PlayScene(this.game, opts), 'circle');
    }
  }

  // 곡 바꾸기: 그 곡의 코러스로 배경음도 바뀜
  changeSong(dx) {
    this.songIdx = (this.songIdx + dx + SONG_ORDER.length) % SONG_ORDER.length;
    this.music.stop(0.2);
    useSong(SONG_ORDER[this.songIdx]);
    this.song = expandSong();
    this.music = new MusicPlayer(this.game.audio);
    this.musicOn = false;
    this.lastBeat = null;
  }

  render(ctx, alpha) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    const tt = this.clock.time;
    const beat = this.song.beatSec;
    this.stage.renderBack(ctx, t / 60, t);
    this.stage.renderFloor(ctx);

    // 로고: 글자마다 박자에 맞춰 통통
    const title = '잭팟 그루브'; // 게임 이름 (곡 이름은 아래 메뉴 · 부제에)
    const chars = [...title];
    const total = KText.width(title, 'L') * 2;
    let x = W / 2 - total / 2;
    const ph = ((tt / beat) % 1 + 1) % 1;
    chars.forEach((ch, i) => {
      const cw = KText.width(ch, 'L') * 2;
      const hop = Math.round(Math.max(0, Math.sin((ph - i * 0.08) * Math.PI * 2)) * 2);
      const col = ['9', 'a', '8', '9', 't', '9'][(i + Math.floor(tt / beat)) % 6];
      if (ch !== ' ') KText.draw(ctx, ch, x, 0 - hop, C(col), { font: 'L', outline: C('1'), scale: 2 });
      x += cw;
    });
    const sub = this.row === 5 ? '판정이 늦게 나오면 +, 빠르게 나오면 −' : this.row === 2 ? `${SONG.artist} · BPM ${SONG.bpm}` : this.row === 4 ? '숫자가 클수록 노트가 빨리 떨어짐' : '마법사 성 카지노 리듬 배틀! 3키로 박자를 맞춰라';
    KText.draw(ctx, sub, W / 2, 36, this.row === 3 ? C('h') : C('a'), { align: 'center', font: 's', outline: C('1') });

    // 캐릭터 + 머리 위에 각자의 키 3개
    const together = this.mode === 'together';
    this.dancers.forEach((d, i) => {
      const on = together ? i < this.count : i === this.charIdx;
      if (on) {
        this.stage.renderSpot(ctx, d.x, d.feetY, 15, 'a', 5);
        d.render(ctx, tt, beat, alpha, t);
        const keys = together ? KEYMAP[i].keys : ['<', '^', '>'];
        keys.forEach((k, l) => ctx.drawImage(getKeycap('small', l, k, false), d.x - 24 + l * 16, 52));
        KText.draw(ctx, CHARACTERS[i].name, d.x, 117, C(CHARACTERS[i].color), { align: 'center', font: 's', outline: C('1') });
      } else {
        drawStanding(ctx, SPR.players[i].ghost, d.x, d.feetY);
      }
    });

    // 메뉴 (3칸 x 2줄 + 시작 버튼)
    drawPanel(ctx, 10, 130, 300, 34, 'dark');
    // 칸 사이 구분선 (글자끼리 붙어 보이지 않게)
    ctx.fillStyle = C('3');
    for (const sx of [110, 209]) ctx.fillRect(sx, 133, 1, 28);
    ctx.fillRect(14, 146, 292, 1);
    const items = [
      ['모드', MODES[this.modeIdx].label],
      this.mode === 'personal' ? ['캐릭터', CHARACTERS[this.charIdx].name] : ['인원', `${this.count}명`],
      ['곡', SONGS[SONG_ORDER[this.songIdx]].title],
      ['난이도', CONFIG.DIFFICULTY[DIFFS[this.diffIdx]].label],
      ['속도', `${this.speed}`],
      ['싱크', `${this.sync > 0 ? '+' : ''}${Math.round(this.sync * 1000)}ms`],
    ];
    items.forEach(([k, v], i) => {
      const cx = 15 + (i % 3) * 99;
      const y = 132 + Math.floor(i / 3) * 15;
      const sel = this.row === i;
      KText.draw(ctx, k, cx, y, sel ? C('9') : C('j'), { font: 's' });
      const vv = sel ? `◀${v}▶` : v;
      const fit = KText.width(k, 's') + KText.width(vv, 's') + 8 <= 90;
      KText.draw(ctx, vv, cx + 90, y + (fit ? 0 : 1), sel ? C('9') : C('a'), { font: fit ? 's' : 'n', align: 'right' });
    });
    this.startBtn.render(ctx, this.row === ROW_START, t);
  }
}
