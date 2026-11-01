// =====================================================
// 플레이: 곡 소개 → 카운트다운 → 연주 → 피날레 → 결과
//  - 함께 모드: 한 화면에 최대 5명, 각자 3레인
//  - 개인 화면: 1명이 큰 레인으로 플레이, 점수를 서로 비교
//  상태: intro → play → outro   (+ 일시정지)
// =====================================================
const PAUSE_ITEMS = ['계속하기', '처음부터', '타이틀로'];

class PlayScene {
  // opts: { mode, count, charIdx, difficulty, embed, autoplay }
  constructor(game, opts) {
    this.game = game;
    this.opts = opts;
    useSong(opts.song || 'groove'); // 곡 고르기
    this.song = expandSong();
    this.diff = CONFIG.DIFFICULTY[opts.difficulty] || CONFIG.DIFFICULTY.normal;
    // 노트 속도 1~5 (3 = 기본)
    this.approach = this.diff.approach * CONFIG.SPEED_MUL[Math.max(1, Math.min(5, opts.speed || 3)) - 1];
    this.chart = buildChart(opts.difficulty);
    this.lastTime = Math.max(...this.chart.map((n) => (n.endTime !== null ? n.endTime : n.time)));
    this.clock = new SongClock(game.audio);
    this.clock.offset = game.settings.syncOffset || 0;
    this.music = new MusicPlayer(game.audio);
    this.stage = new Stage();
    this.particles = new ParticleSystem();
    this.state = 'intro';
    this.t = 0;          // 상태별 프레임
    this.frame = 0;
    this.paused = false;
    this.pauseSel = 0;
    this.resumeT = 0;    // 일시정지 해제 카운트다운
    this.banner = null;  // { text, color, t }
    this.lastBar = -1;
    this.stampsDone = false;
    this.setupPlayers();
  }

  // ---------- 플레이어 / 레인 / 캐릭터 배치 ----------
  setupPlayers() {
    const o = this.opts;
    this.performers = [];
    this.highways = [];
    this.dancers = [];
    this.scoreShown = [];
    if (o.mode === 'personal') {
      const i = o.charIdx;
      const codes = [0, 1, 2].map((l) => [...SOLO_LANES[l], KEYMAP[i].lanes[l], ...[0, 1, 2, 3, 4].map((k) => `Pad${k}:${l}`)]);
      const p = new Performer(i, codes, this.chart, { bot: o.autoplay, botSkill: this.botSkill() });
      const L = CONFIG.LAYOUT_PERSONAL;
      this.performers.push(p);
      this.highways.push(new Highway(p, { x: L.X, laneW: L.LANE_W, top: L.TOP, judgeY: L.JUDGE_Y, size: L.NOTE }, ['<', '^', '>']));
      this.dancers.push(new Dancer(p, 58, 168, 2));
    } else {
      const n = o.count;
      const L = CONFIG.LAYOUT_TOGETHER;
      // 인원이 적으면 칸 · 레인을 넓혀 화면을 꽉 채움 (가운데 정렬)
      const colW = Math.min(L.COL_MAX, Math.floor((CONFIG.WIDTH - 8) / n));
      const laneW = Math.max(L.LANE_W, Math.min(L.LANE_MAX, Math.floor((colW - 12) / 3)));
      const size = laneW >= 24 ? 'big' : 'small';
      const x0 = Math.round((CONFIG.WIDTH - n * colW) / 2);
      for (let i = 0; i < n; i++) {
        const codes = [0, 1, 2].map((l) => [KEYMAP[i].lanes[l], `Pad${i}:${l}`]);
        const p = new Performer(i, codes, this.chart, { bot: o.autoplay, botSkill: this.botSkill() });
        const colX = x0 + i * colW;
        this.performers.push(p);
        this.highways.push(new Highway(p, { x: Math.round(colX + (colW - laneW * 3) / 2), laneW, top: L.TOP, judgeY: L.JUDGE_Y, size, comboTop: true }, KEYMAP[i].keys));
        this.dancers.push(new Dancer(p, colX + colW / 2, 166, 1));
      }
    }
    this.performers.forEach((p, k) => {
      this.scoreShown.push(0);
      const hw = this.highways[k];
      const dancer = this.dancers[k];
      p.on('judge', (kind, lane, isTail) => this.onJudge(p, hw, dancer, kind, lane, isTail));
      p.on('tap', (lane) => this.game.audio.sfx('tap', lane));
      p.on('fever', () => {
        this.game.audio.sfx('fever');
        this.particles.text(hw.centerX, hw.L.top + 16, 'FEVER!', C('9'), { life: 50, scale: 2 });
      });
      p.on('break', (combo) => {
        if (combo >= 30) this.particles.text(hw.centerX, hw.L.top + 16, 'BREAK', C('j'), { life: 40 });
      });
    });
  }

  // 자동 연주 실력 (시연 · 테스트에서 점수가 다 똑같지 않게)
  botSkill() {
    const [a, b] = CONFIG.BOT_SKILL;
    return a + Math.random() * (b - a);
  }

  // 판정 연출 (불꽃, 링, 캐릭터 동작)
  onJudge(p, hw, dancer, kind, lane, isTail) {
    dancer.onJudge(kind, lane);
    if (kind === 'miss') {
      this.game.audio.sfx('miss');
      return;
    }
    const x = hw.laneX(lane);
    const y = hw.L.judgeY;
    const lc = LANE_COLORS[lane];
    const big = hw.L.size === 'big';
    if (kind === 'perfect') {
      this.particles.burst(x, y, big ? 14 : 8, [C(lc.hi), C('b'), C('9')], big ? 2.2 : 1.6, 20, 1);
      this.particles.ring(x, y, big ? 1.4 : 1, C(lc.hi), big ? 10 : 8);
    } else {
      this.particles.burst(x, y, big ? 8 : 5, [C(lc.body), C(lc.hi)], 1.2, 16, 1);
    }
    if (isTail) this.particles.burst(x, y - 4, 6, [C('9'), C('b')], 2, 18, 1, 0.05);
    this.game.audio.sfx('hit');
    if (p.combo > 0 && p.combo % 50 === 0) {
      this.game.audio.sfx('combo');
      this.particles.text(hw.centerX, hw.L.top + 16, p.combo + ' COMBO!', C('9'), { life: 50 });
    }
  }

  enter() {
    this.game.input.takeEvents();
    this.game.audio.unlock();
  }

  get audioReady() {
    const a = this.game.audio;
    const hasAPI = !!(window.AudioContext || window.webkitAudioContext);
    if (!hasAPI || this.opts.autoplay) return true;
    return !!(a.ctx && a.ctx.state === 'running');
  }

  // 곡 시작 (한 마디 카운트인 후 0초)
  startSong() {
    const a = this.game.audio;
    const lead = this.song.barSec + 0.3;
    if (a.ctx && a.ctx.state === 'running') {
      const audioStart = a.ctx.currentTime + lead;
      this.music.play({ startAt: audioStart, countIn: true });
      this.clock.start(-lead, audioStart);
    } else {
      this.clock.start(-lead, 0);
    }
    this.state = 'play';
    this.t = 0;
  }

  // 지금 곡 시간
  get songTime() {
    return this.clock.started ? this.clock.time : -this.song.barSec - 0.3;
  }

  // ---------- 업데이트 ----------
  update() {
    const input = this.game.input;
    const audio = this.game.audio;
    this.frame++;
    this.t++;
    this.clock.sync();
    const events = input.takeEvents();

    if (this.paused) {
      this.updatePause(input);
      return;
    }

    if (this.state === 'intro') {
      if (this.t > 100 && this.audioReady) this.startSong();
      this.updateWorld(this.songTime);
      return;
    }

    if (input.anyPressed(['Escape', 'KeyP']) && this.state === 'play') {
      this.paused = true;
      this.pauseSel = 0;
      this.clock.pause();
      audio.sfx('pause');
      return;
    }

    // 키 입력 → 레인 판정 (눌린 정확한 시각으로)
    for (const ev of events) {
      for (const p of this.performers) {
        if (p.bot) continue;
        const lane = p.laneOf(ev.code);
        if (lane >= 0) p.input(lane, this.clock.timeAt(ev.t), ev.down);
      }
    }
    const t = this.songTime;
    for (const p of this.performers) p.update(t);
    this.updateWorld(t);

    // 구간 알림
    const bar = Math.floor(t / this.song.barSec);
    if (bar !== this.lastBar && bar >= 0 && bar < this.song.bars.length) {
      this.lastBar = bar;
      const b = this.song.bars[bar];
      if (b.firstOfSection) {
        if (b.fever) this.banner = { text: '★ 잭팟 타임! ★', color: '9', panel: 'red', t: 0 };
        else if (b.section === 'break') this.banner = { text: '롱노트! 꾹 누르기', color: 'h', panel: 'blue', t: 0 };
        else if (b.section === 'outro') this.banner = { text: '피날레!', color: 'a', panel: 'red', t: 0 };
      }
    }
    if (this.banner && ++this.banner.t > 150) this.banner = null;

    // 모든 노트가 끝나면 피날레
    if (this.state === 'play' && t > this.lastTime + 0.5 && this.performers.every((p) => p.finished)) {
      this.state = 'outro';
      this.t = 0;
    }
    if (this.state === 'outro') this.updateOutro();
  }

  updateWorld(t) {
    const fever = t >= 0 && t < this.song.duration && this.song.bars[Math.floor(t / this.song.barSec)].fever;
    this.stage.update(t, this.song.beatSec, fever);
    this.highways.forEach((h) => h.update());
    this.dancers.forEach((d) => d.update());
    this.particles.update();
    this.performers.forEach((p, i) => {
      // 점수 숫자가 촤라락 올라감
      const target = p.score;
      this.scoreShown[i] += Math.ceil((target - this.scoreShown[i]) * 0.2);
    });
  }

  updateOutro() {
    const audio = this.game.audio;
    if (this.t === 20) {
      // FULL COMBO / ALL PERFECT 도장
      let any = false;
      this.performers.forEach((p, i) => {
        if (p.allPerfect) this.highways[i].stamp = 'ALL PERFECT';
        else if (p.fullCombo) this.highways[i].stamp = 'FULL COMBO';
        if (this.highways[i].stamp) any = true;
      });
      audio.sfx(any ? 'fullcombo' : 'clear');
      if (any) audio.sfx('stamp');
    }
    if (this.t > 20) this.dancers.forEach((d) => (d.cheer = true));
    if (this.t % 6 === 0) {
      const cols = [C('9'), C('8'), C('5'), C('h'), C('e'), C('p')];
      this.particles.add(Math.random() * CONFIG.WIDTH, -2, (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.6, 300, cols[(Math.random() * cols.length) | 0], 2);
    }
    if (this.t === 170) {
      this.music.stop(0.8);
      this.game.changeScene(() => new ResultScene(this.game, this.performers, this.opts), 'circle');
    }
  }

  updatePause(input) {
    const audio = this.game.audio;
    if (this.resumeT > 0) {
      // 3, 2, 1 후 다시 시작 (갑자기 시작해서 놓치지 않게)
      if (--this.resumeT === 0) {
        this.paused = false;
        this.clock.resume();
      } else if (this.resumeT % 30 === 0) audio.tone({ freq: 1320, dur: 0.05, vol: 0.08 });
      return;
    }
    if (input.anyPressed(['ArrowUp', 'KeyW'])) {
      this.pauseSel = (this.pauseSel + PAUSE_ITEMS.length - 1) % PAUSE_ITEMS.length;
      audio.sfx('select');
    }
    if (input.anyPressed(['ArrowDown', 'KeyS'])) {
      this.pauseSel = (this.pauseSel + 1) % PAUSE_ITEMS.length;
      audio.sfx('select');
    }
    if (input.anyPressed(['Escape', 'KeyP'])) this.pauseSel = 0;
    if (input.confirm() || input.anyPressed(['Escape', 'KeyP'])) {
      audio.sfx('select');
      if (this.pauseSel === 0) {
        this.resumeT = 90;
      } else {
        this.music.stop();
        this.clock.resume();
        this.paused = false;
        if (this.pauseSel === 1) this.game.changeScene(() => new PlayScene(this.game, this.opts), 'circle');
        else this.game.changeScene(() => new TitleScene(this.game), 'fade');
      }
    }
  }

  // ---------- 그리기 ----------
  render(ctx, alpha) {
    const W = CONFIG.WIDTH;
    const t = this.songTime;
    const f = this.frame;
    const beat = this.song.beatSec;
    this.stage.renderBack(ctx, f / 60, f);
    this.stage.renderFloor(ctx);

    // 구간 알림 띠 (캐릭터 뒤, 노트를 가리지 않음)
    if (this.banner) {
      const b = this.banner;
      const k = Math.min(1, b.t / 10);
      const out = b.t > 130 ? (b.t - 130) / 20 : 0;
      const bx = Math.round(-W + k * W + out * W);
      drawPanel(ctx, bx + 4, 122, W - 8, 18, b.panel);
      KText.draw(ctx, b.text, bx + W / 2, 124, C(b.color), { align: 'center', font: 'b', outline: C('1') });
    }

    // 캐릭터 발밑 조명 + 캐릭터
    this.dancers.forEach((d, i) => {
      const p = this.performers[i];
      const big = d.scale > 1;
      const lvl = p.fever ? 8 : 4 + Math.round(this.stage.pulse * 3);
      this.stage.renderSpot(ctx, d.x, d.feetY, big ? 26 : 15, p.fever ? '9' : 'a', lvl);
      d.render(ctx, t, beat, alpha, f);
    });

    // 레인
    this.highways.forEach((h) => h.render(ctx, t, this.approach, f, beat));
    this.particles.render(ctx);

    if (this.opts.mode === 'personal') this.renderPersonalHud(ctx);
    else this.renderTogetherHud(ctx);
    this.renderProgress(ctx, t);

    // 카운트다운 3 · 2 · 1 · GO
    const bar = this.song.barSec;
    if (this.state === 'play' && t < 0.3 && t >= -bar) {
      const i = Math.floor((t + bar) / beat);
      const label = ['3', '2', '1', 'GO!'][Math.min(3, i)];
      const ph = ((t + bar) / beat) % 1;
      const s = ph < 0.15 ? 5 : 4;
      BitmapFont.draw(ctx, label, W / 2, 50 - (s - 4) * 2, C(i >= 3 ? '9' : 'a'), { align: 'center', scale: s, outline: C('1') });
    }

    if (this.state === 'intro') this.renderIntro(ctx);
    if (this.state === 'outro' && this.t > 4) {
      const k = Math.min(1, this.t / 12);
      KText.draw(ctx, 'FINISH!', W / 2, 36 - Math.round((1 - k) * 30), C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    }
    if (this.paused) this.renderPause(ctx);
  }

  // 함께 모드: 이름표, 점수판, 1등 왕관
  renderTogetherHud(ctx) {
    const lead = this.leaderIndex();
    this.highways.forEach((h, i) => {
      const p = this.performers[i];
      const cx = Math.round(h.centerX);
      const nameW = KText.width(p.name, 's');
      // 이름표
      KText.draw(ctx, p.name, cx, 5, p.color, { align: 'center', font: 'b', outline: C('1') });
      if (i === lead) ctx.drawImage(SPR.crown, Math.round(cx - nameW / 2) - 8, 9);
      // 점수판 (발 아래)
      const sc = String(this.scoreShown[i]).padStart(7, '0');
      drawPanel(ctx, cx - 31, 167, 62, 14, i === lead ? 'red' : 'dark');
      BitmapFont.draw(ctx, sc, cx, 170, i === lead ? C('9') : C('a'), { align: 'center', scale: 2 });
    });
  }

  // 개인 화면: 오른쪽 점수판
  renderPersonalHud(ctx) {
    const p = this.performers[0];
    const x = 214;
    drawPanel(ctx, x, 12, 100, 156, 'dark');
    KText.draw(ctx, `P${p.index + 1} ${p.name}`, x + 50, 16, p.color, { align: 'center', font: 'b', outline: C('1') });
    KText.draw(ctx, 'SCORE', x + 8, 30, C('k'), { font: 's' });
    BitmapFont.draw(ctx, String(this.scoreShown[0]).padStart(7, '0'), x + 50, 44, C('9'), { align: 'center', scale: 2, outline: C('1') });
    const g = p.liveGrade; // 지금까지의 정확도로 예상 등급
    KText.draw(ctx, 'RANK', x + 8, 58, C('k'), { font: 's' });
    if (g) KText.draw(ctx, g.grade, x + 24, 70, C(g.color), { align: 'center', font: 'b', scale: 2, outline: C('1') });
    else KText.draw(ctx, '-', x + 24, 70, C('j'), { align: 'center', font: 'b', scale: 2 });
    KText.draw(ctx, 'COMBO', x + 56, 58, C('k'), { font: 's' });
    BitmapFont.draw(ctx, String(p.combo), x + 56, 74, p.fever ? C('9') : C('a'), { scale: 2 });
    KText.draw(ctx, `최대 ${p.maxCombo}`, x + 56, 84, C('j'), { font: 'n' });
    const rows = [['PERFECT', 'perfect', '9'], ['GREAT', 'great', 'h'], ['GOOD', 'good', 'e'], ['MISS', 'miss', 'j']];
    rows.forEach(([lab, k, col], i) => {
      const y = 100 + i * 15;
      KText.draw(ctx, lab, x + 8, y, C(col), { font: 's' });
      BitmapFont.draw(ctx, String(p.counts[k]), x + 92, y + 2, C('a'), { align: 'right', scale: 2 });
    });
    KText.draw(ctx, '← ↑ → 또는 A S D', CONFIG.LAYOUT_PERSONAL.X + 42, 160, C('a'), { align: 'center', font: 's', outline: C('1') });
  }

  leaderIndex() {
    if (this.performers.length < 2) return -1;
    let best = -1;
    let bs = 0;
    this.performers.forEach((p, i) => {
      if (p.score > bs) {
        bs = p.score;
        best = i;
      }
    });
    return best;
  }

  // 맨 위 곡 진행 막대 (구간마다 눈금, 코러스는 금색)
  renderProgress(ctx, t) {
    const W = CONFIG.WIDTH;
    const k = Math.max(0, Math.min(1, t / this.song.duration));
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 4);
    this.song.bars.forEach((b, i) => {
      const x = Math.floor((i / this.song.bars.length) * W);
      const x2 = Math.floor(((i + 1) / this.song.bars.length) * W);
      ctx.fillStyle = C(b.fever ? '7' : '2');
      ctx.fillRect(x, 1, x2 - x, 2);
    });
    const fx = Math.round(k * W);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, 1, fx, 2);
    ctx.fillStyle = C('9');
    ctx.fillRect(0, 1, fx, 1);
    ctx.fillStyle = C('b');
    ctx.fillRect(Math.max(0, fx - 1), 0, 2, 4);
  }

  // 곡 소개 카드
  renderIntro(ctx) {
    // 개인 화면은 오른쪽 점수판(x 214~)을 가리지 않게 왼쪽으로
    const W = this.opts.mode === 'personal' ? 214 : CONFIG.WIDTH;
    const k = Math.min(1, this.t / 14);
    const y = Math.round(26 - (1 - k) * 60);
    drawPanel(ctx, W / 2 - 100, y, 200, 92, 'red');
    KText.draw(ctx, SONG.title, W / 2, y + 1, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    KText.draw(ctx, SONG.artist, W / 2, y + 35, C('k'), { align: 'center', font: 's' });
    const stars = '★'.repeat(this.diff.stars) + '☆'.repeat(5 - this.diff.stars);
    KText.draw(ctx, `${this.diff.label} ${stars}`, W / 2, y + 48, C('8'), { align: 'center', font: 's' });
    KText.draw(ctx, `BPM ${SONG.bpm} · 노트 ${this.chart.length}개`, W / 2, y + 61, C('a'), { align: 'center', font: 's' });
    if (this.t > 100 && !this.audioReady && this.t % 40 < 28) {
      drawPanel(ctx, W / 2 - 80, y + 96, 160, 18, 'dark');
      KText.draw(ctx, '아무 키나 누르면 시작!', W / 2, y + 98, C('9'), { align: 'center', font: 's' });
    }
    KText.draw(ctx, '칩이 아래 키에 닿는 순간 눌러!', W / 2, y + 75, C('a'), { align: 'center', font: 's' });
  }

  renderPause(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = ctx.createPattern(Transition.patterns[13], 'repeat');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    if (this.resumeT > 0) {
      const n = Math.ceil(this.resumeT / 30);
      BitmapFont.draw(ctx, String(n), W / 2, 60, C('9'), { align: 'center', scale: 5, outline: C('1') });
      KText.draw(ctx, '준비!', W / 2, 96, C('a'), { align: 'center', font: 'b', outline: C('1') });
      return;
    }
    drawPanel(ctx, W / 2 - 70, 40, 140, 100, 'default');
    KText.draw(ctx, '일시정지', W / 2, 46, C('9'), { align: 'center', font: 'b', outline: C('1') });
    PAUSE_ITEMS.forEach((it, i) => {
      const sel = i === this.pauseSel;
      KText.draw(ctx, sel ? `▶ ${it}` : it, W / 2, 66 + i * 16, sel ? C('9') : C('k'), { align: 'center', font: 's', outline: C('1') });
    });
    KText.draw(ctx, '↑↓ 선택 · Space 확인', W / 2, 120, C('j'), { align: 'center', font: 's' });
  }
}
