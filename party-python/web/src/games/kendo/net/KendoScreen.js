// =============================================================
// 검도 — 화면 (멀티플레이 리그전)
//
// 경기 판정은 서버가 한다. 여기서는
//  - 시작 전 30초 동안 원본 그대로 AI 와 연습하고(브라우저 안에서만, 순위와 무관),
//  - 리그전에서는 서버가 보내 주는 경기 상태를 원본 시합 장면에 비춰 그리고,
//  - 키보드 입력(누르고 있는 키 + 새로 누른 키)을 서버로 보낸다.
// 그림·글자·소리·심판·무대는 원본(pk/)을 그대로 쓴다.
// =============================================================
import { PK } from '../pk/full.js';
import { KendoInput } from './KendoInput.js';
import { NetMatchScene, PracticeScene } from './NetMatchScene.js';

const W = PK.CONFIG.SCREEN_W;
const H = PK.CONFIG.SCREEN_H;
const PRACTICE_PROFILE = 'aggressive';     // 연습 상대: 원본 대회 1회전 상대(공격형)
const PRESS = ['men', 'kote', 'do', 'block', 'kiai'];
const DECIDED = { points: '두 판 선취', time: '시간 종료', hantei: '심판 판정' };

let fontReady = false;

export class KendoScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.meId = me ? me.id : null;
    this.names = Object.fromEntries(players.map((p) => [p.id, p.name]));
    this.myName = this.meId ? this.names[this.meId] : '';

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'relative', width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: '#181425', overflow: 'hidden',
    });
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.display = 'block';
    this.canvas.style.setProperty('image-rendering', 'crisp-edges');
    this.canvas.style.setProperty('image-rendering', 'pixelated');
    this.root.appendChild(this.canvas);
    container.appendChild(this.root);
    this.g = this.canvas.getContext('2d', { alpha: false });
    this.autoHeight = container.clientHeight === 0;

    this.input = new KendoInput();
    this.input.onFirstInput = () => PK.Audio.unlock();
    this.input.onKey = (code) => {
      if (code === 'KeyM') PK.Audio.setMuted(!PK.Audio.muted);
    };
    // 원본 코드가 참조하는 전역 게임 객체
    PK.Game = { tick: 0, debug: false, input: this.input, scenes: { busy: false } };

    this.scene = null;           // 지금 그리는 장면 (연습 또는 경기)
    this.sceneKey = '';
    this.matchIndex = -1;
    this.sentHeld = 0;
    this.lastSnap = null;
    this._destroyed = false;

    this._onResize = () => this._fit();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
    try { PK.Audio.unlock(); } catch (e) { /* 첫 입력 때 켜진다 */ }
  }

  async init() {
    if (!fontReady) {
      PK.Font.init();
      await Promise.all([PK.Font.load(), PK.Assets.load()]);
      fontReady = true;
    }
    if (this._destroyed) return;
    let last = performance.now();
    let acc = 0;
    const TICK = PK.CONFIG.TICK_MS;
    const frame = (now) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(frame);
      acc += Math.min(250, now - last);
      last = now;
      let steps = 0;
      while (acc >= TICK && steps < PK.CONFIG.MAX_STEPS_PER_FRAME) {
        this._tick();
        acc -= TICK;
        steps++;
      }
      if (steps >= PK.CONFIG.MAX_STEPS_PER_FRAME) acc = 0;
      this._render();
    };
    this._raf = requestAnimationFrame(frame);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.input.dispose();
    PK.Audio.stopBgm();
    this.root.remove();
  }

  _fit() {
    const w = this.root.clientWidth || W * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / W, h / H))));
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${H * s}px`;
    if (this.autoHeight) this.root.style.height = `${H * s}px`;
  }

  // ------------------------------------------------------------
  _startPractice() {
    this.scene = new PracticeScene({ name: this.myName || '나', profile: PRACTICE_PROFILE, onEnd: () => this._startPractice() });
    this.sceneKey = 'practice';
  }

  /** 서버 상태에 맞는 장면을 준비한다 */
  _syncScene(s) {
    if (s.phase === 'practice') {
      if (this.sceneKey !== 'practice' && this.meId) this._startPractice();
      return;
    }
    if (!s.round) return;
    // 내 경기(쉬는 라운드·관전이면 첫 경기)
    let index = s.matches.findIndex((m) => m.red === this.meId || m.white === this.meId);
    const mine = index >= 0;
    if (!mine) index = 0;
    const key = `r${s.round}m${index}`;
    if (this.sceneKey !== key) {
      const m = s.matches[index];
      if (!m) return;
      this.scene = new NetMatchScene({
        redName: this.names[m.red] || '?', whiteName: this.names[m.white] || '?',
        timeSec: this.opt.timeSec ?? 60, toWin: this.opt.toWin ?? 2,
      });
      this.sceneKey = key;
      this.matchIndex = index;
      this.mySide = !mine ? null : m.red === this.meId ? 'red' : 'white';
      this.sentHeld = 0;
      this.net.takeEvents();           // 지난 라운드의 남은 사건은 버린다
      PK.Audio.playBgm('match');
    }
    const d = s.duels[index];
    if (d && this.scene instanceof NetMatchScene) this.scene.applySnapshot(d);
  }

  _tick() {
    const s = this.net.snap;
    this.input.beginTick();
    PK.Game.tick++;
    if (!s) return;
    if (s !== this.lastSnap) {
      this.lastSnap = s;
      this._syncScene(s);
    }
    if (!this.scene) return;

    if (this.scene instanceof PracticeScene) {
      // 남은 연습 시간을 시계에 보여 준다(연습 중에는 시간 종료가 없다)
      const remain = Math.max(0, s.practiceUntil - this.net.now());
      this.scene.rules.timeLeft = Math.max(2, Math.round(remain * 60) + 1);
      this.scene.update();
      return;
    }

    // 리그전: 서버 사건 → 연출, 내 입력 → 서버
    for (const e of this.net.takeEvents()) {
      if (e.match === this.matchIndex) this.scene.handleEvent(e);
    }
    if (this.mySide && s.phase === 'fight') {
      const I = this.input;
      const held = (I.down('left') ? 1 : 0) | (I.down('right') ? 2 : 0) | (I.down('kiai') ? 4 : 0) | (I.down('block') ? 8 : 0);
      const press = PRESS.filter((k) => I.pressed(k));
      if (held !== this.sentHeld || press.length) {
        this.sentHeld = held;
        this.net.input(held, press);
      }
    }
    this.scene.update();
  }

  // ------------------------------------------------------------
  _render() {
    const g = this.g;
    const COL = PK.COL;
    const F = PK.Font;
    g.imageSmoothingEnabled = false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = COL.outline;
    g.fillRect(0, 0, W, H);
    const s = this.net.snap;
    if (!s) {
      F.draw(g, '서버를 기다리는 중…', 160, 84, { font: 'M', color: COL.white, align: 'center' });
      return;
    }
    if (this.scene) this.scene.render(g);

    if (s.phase === 'practice') {
      const remain = Math.max(0, Math.ceil(s.practiceUntil - this.net.now()));
      if (!this.meId) F.draw(g, '참가자들이 연습 중입니다', 160, 84, { font: 'M', color: COL.white, align: 'center' });
      F.draw(g, `연습 ${remain}초 — 순위에 들어가지 않습니다`, 160, 30, { font: 'S', color: COL.yellow, outline: COL.outline, align: 'center' });
      this._keyHint(g);
    } else if (s.phase === 'intro') {
      this._drawIntro(g, s);
    } else if (s.phase === 'fight') {
      this._drawFightNotes(g, s);
    } else if (s.phase === 'result') {
      this._drawRoundResult(g, s);
    } else if (s.results) {
      this._drawFinal(g, s);
    }
    if (PK.Audio.muted) F.draw(g, '음소거', 160, 24, { font: 'S', color: COL.lgrey, outline: COL.outline, align: 'center' });
  }

  _keyHint(g) {
    PK.Font.draw(g, 'Shift기합 Z머리 X손목 C허리 Space막기', 4, 169, { font: 'S', color: PK.COL.cream, outline: PK.COL.outline });
  }

  _name(id) {
    return this.names[id] || '?';
  }

  _drawIntro(g, s) {
    const COL = PK.COL;
    const F = PK.Font;
    PK.UI.dim(g, 9);
    const rows = s.matches.length + (s.resting.length ? 1 : 0);
    const h = 70 + rows * 14;
    const y0 = Math.round(92 - h / 2);
    PK.UI.box(g, 30, y0, 260, h, 'gold');
    F.draw(g, `${s.round}회전 / 전체 ${s.rounds}회전`, 160, y0 + 6, { font: 'M', color: COL.yellow, align: 'center' });
    let y = y0 + 24;
    for (const m of s.matches) {
      const mine = m.red === this.meId || m.white === this.meId;
      F.draw(g, `홍 ${this._name(m.red)}   VS   백 ${this._name(m.white)}`, 160, y, { font: 'M', color: mine ? COL.white : COL.lgrey, align: 'center' });
      y += 14;
    }
    if (s.resting.length) {
      F.draw(g, `쉬는 사람: ${s.resting.map((id) => this._name(id)).join(', ')}`, 160, y + 1, { font: 'S', color: COL.lgrey, align: 'center' });
      y += 14;
    }
    const my = s.matches.find((m) => m.red === this.meId || m.white === this.meId);
    const where = !this.meId ? '관전 중' : !my ? '이번 회전은 쉽니다 (관전)' : my.red === this.meId ? '나는 홍 — 왼쪽 (→ 가 앞으로)' : '나는 백 — 오른쪽 (← 가 앞으로)';
    F.draw(g, where, 160, y + 3, { font: 'S', color: COL.gold, align: 'center' });
    F.draw(g, `먼저 두 판을 따면 승리 · ${this.opt.timeSec ?? 60}초 · ←→ 이동`, 160, y + 15, { font: 'S', color: COL.cream, align: 'center' });
    F.draw(g, '기합을 모아(45 이상) 알맞은 간격에서 빈틈을 치세요', 160, y + 26, { font: 'S', color: COL.cream, align: 'center' });
    this._keyHint(g);
  }

  _drawFightNotes(g, s) {
    const COL = PK.COL;
    const F = PK.Font;
    this._keyHint(g);
    const notes = [];
    if (this.meId && !this.mySide) notes.push('이번 회전은 쉽니다 — 관전 중');
    else if (!this.meId) notes.push('관전 중');
    const mine = s.duels[this.matchIndex];
    const others = s.duels.filter((d, i) => i !== this.matchIndex);
    if (mine && mine.over && others.some((d) => !d.over)) notes.push('다른 경기가 끝나기를 기다리는 중…');
    // 다른 경기의 현재 점수
    s.matches.forEach((m, i) => {
      if (i === this.matchIndex) return;
      const d = s.duels[i];
      if (d) notes.push(`${this._name(m.red)} ${d.points.red.length} : ${d.points.white.length} ${this._name(m.white)}`);
    });
    notes.forEach((t, i) => F.draw(g, t, 160, 30 + i * 11, { font: 'S', color: i === 0 && notes.length > 1 && (!this.mySide || (mine && mine.over)) ? COL.yellow : COL.lgrey, outline: COL.outline, align: 'center' }));
    F.draw(g, `${s.round}/${s.rounds}회전`, 316, 158, { font: 'S', color: COL.lgrey, outline: COL.outline, align: 'right' });
  }

  _standingRows(s) {
    return Object.entries(s.standings)
      .map(([id, st]) => ({ id, ...st }))
      .sort((a, b) => b.score - a.score);
  }

  _drawRoundResult(g, s) {
    const COL = PK.COL;
    const F = PK.Font;
    PK.UI.dim(g, 9);
    const results = s.roundResults || [];
    const rows = this._standingRows(s);
    const h = 30 + results.length * 13 + 16 + rows.length * 11;
    const y0 = Math.round(92 - h / 2);
    PK.UI.box(g, 30, y0, 260, h, 'gold');
    F.draw(g, `${s.round}회전 결과`, 160, y0 + 6, { font: 'M', color: COL.yellow, align: 'center' });
    let y = y0 + 23;
    for (const r of results) {
      const text = `${this._name(r.red)} ${r.points.red.length} : ${r.points.white.length} ${this._name(r.white)}  →  ${this._name(r.winner)} 승 (${DECIDED[r.decidedBy] || ''})`;
      F.draw(g, text, 160, y, { font: 'S', color: r.winner === this.meId ? COL.gold : COL.white, align: 'center' });
      y += 13;
    }
    F.draw(g, '현재 순위', 160, y + 2, { font: 'S', color: COL.lgrey, align: 'center' });
    y += 15;
    rows.forEach((row, i) => {
      const color = row.id === this.meId ? COL.gold : COL.white;
      F.draw(g, `${i + 1}`, 60, y, { font: 'S', color });
      F.draw(g, this._name(row.id), 76, y, { font: 'S', color });
      F.draw(g, `${row.wins}승 ${row.losses}패 · 한판 ${row.ippons}`, 200, y, { font: 'S', color: COL.lgrey, align: 'right' });
      F.draw(g, `${row.score}점`, 262, y, { font: 'S', color, align: 'right' });
      y += 11;
    });
  }

  _drawFinal(g, s) {
    const COL = PK.COL;
    const F = PK.Font;
    PK.UI.dim(g, 10);
    const rows = s.results;
    const h = 36 + rows.length * 14;
    const y0 = Math.round(92 - h / 2);
    PK.UI.box(g, 30, y0, 260, h, 'gold');
    const winners = rows.filter((r) => r.isWinner);
    F.draw(g, winners.length === 1 ? `${winners[0].name} 우승!` : '공동 우승!', 160, y0 + 7, { font: 'M', color: COL.yellow, align: 'center' });
    rows.forEach((r, i) => {
      const y = y0 + 28 + i * 14;
      const color = r.isWinner ? COL.gold : r.playerId === this.meId ? COL.green : COL.white;
      const st = r.stats || {};
      F.draw(g, `${r.rank}위`, 44, y, { font: 'M', color });
      F.draw(g, r.playerId === this.meId ? `${r.name} (나)` : r.name, 72, y, { font: 'M', color });
      F.draw(g, `${st.wins ?? 0}승 ${st.losses ?? 0}패 · 한판 ${st.ippons ?? 0}`, 222, y + 1, { font: 'S', color: COL.lgrey, align: 'right' });
      F.draw(g, `${r.score}점`, 276, y, { font: 'M', color, align: 'right' });
    });
    this._once('final', () => {
      PK.Audio.stopBgm();
      PK.Audio.sfx('cheer');
    });
  }

  _once(key, fn) {
    this._done = this._done || new Set();
    if (this._done.has(key)) return;
    this._done.add(key);
    fn();
  }
}
