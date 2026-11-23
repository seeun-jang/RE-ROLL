// =====================================================
// FightScreen: 매직 파이트 나이트 화면 (리그전)
//  - 판정은 서버가 한다. 여기서는 서버 상태를 그리고, 누르고 있는 키만 서버로 보낸다.
//  - 경기 장면은 BoutView(원본 링 · 선수 · 중계 UI), 그 밖의 장면(대진 안내 · 라운드 결과 · 최종 순위)은
//    원본 중계 패널 · 글씨 코드로 여기서 그린다.
//  - 원본 game.js 처럼 로직 60FPS 고정 + 320×180 캔버스를 정수 배율로만 확대한다.
// =====================================================
import { CONFIG, KEYS, BITS } from '../config.js';
import { boldFontUrl } from '../assets.js';
import { PALETTE, C } from '../orig/palette.js';
import { loadCharacterImages, initSprites, SPR } from '../orig/sprites.js';
import { KText, drawPanel } from '../orig/ui.js';
import { drawBroadcastPanel, drawTag } from '../orig/ui-broadcast.js';
import { Transition } from '../orig/transition.js';
import { Ring } from '../orig/ring.js';
import { AudioManager } from '../orig/audio.js';
import { BoutView, charIndex } from './BoutView.js';

const W = CONFIG.WIDTH;
const H = CONFIG.HEIGHT;
const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
const FONTS = ['bold 12px Galmuri11', '15px Galmuri14', '10px Galmuri9'];

let assetsReady = null; // 그림 · 글꼴은 한 번만 불러온다

function loadAssets() {
  if (!assetsReady) {
    assetsReady = (async () => {
      try {
        // 굵은 Galmuri11 은 페이지에 없어서 이 게임이 직접 등록한다
        const face = new FontFace('Galmuri11', `url(${boldFontUrl()})`, { weight: 'bold' });
        await face.load();
        document.fonts.add(face);
        await Promise.all(FONTS.map((f) => document.fonts.load(f, '가A1')));
      } catch (err) {
        console.warn('[fight] 글꼴을 불러오지 못함(기본 글꼴로 그립니다)', err);
      }
      await loadCharacterImages();
      initSprites();
      if (!Transition.patterns) Transition.buildPatterns();
    })();
  }
  return assetsReady;
}

export class FightScreen {
  constructor(container, { net, players, me }) {
    this.container = container;
    this.net = net;
    this.meId = me ? me.id : null;
    this.byId = Object.fromEntries(players.map((p) => [p.id, p]));
    this.order = players.map((p) => p.id);

    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'relative', width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: PALETTE.o, overflow: 'hidden',
    });
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.display = 'block';
    this.canvas.style.setProperty('image-rendering', 'crisp-edges');
    this.canvas.style.setProperty('image-rendering', 'pixelated');
    this.root.appendChild(this.canvas);
    container.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.autoHeight = container.clientHeight === 0;

    this.audio = new AudioManager();
    this.held = new Set();      // 누르고 있는 키(code)
    this.pressBuf = [];         // 방금 새로 누른 동작 이름
    this.sentHeld = 0;
    this.muteNotice = 0;

    this.view = null;           // 지금 그리는 경기
    this.viewKey = '';
    this.matchIndex = -1;
    this.mine = false;
    this.mirror = false;
    this.lastSnap = null;
    this.verdict = null;
    this.bgRing = null;         // 경기가 아닐 때 배경으로 쓰는 링
    this.frame = 0;
    this.ready = false;
    this._destroyed = false;

    this._down = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (PREVENT.has(e.code)) e.preventDefault();
      this.audio.unlock();
      if (e.repeat) return;
      this.held.add(e.code);
      if (e.code === 'KeyM') {
        this.audio.toggleMute();
        this.muteNotice = 90;
      }
      for (const name in KEYS) if (KEYS[name].includes(e.code)) this.pressBuf.push(name);
    };
    this._up = (e) => this.held.delete(e.code);
    this._blur = () => this.held.clear();
    this._mouse = () => this.audio.unlock();
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
    window.addEventListener('mousedown', this._mouse);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
  }

  async init() {
    await loadAssets();
    if (this._destroyed) return;
    this.ready = true;
    this.bgRing = new Ring();
    let last = performance.now();
    let acc = 0;
    const loop = (now) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      let dt = now - last;
      last = now;
      if (dt > 250) dt = 250; // 탭 전환 후 폭주 방지
      acc += dt;
      while (acc >= CONFIG.STEP_MS) {
        this._tick();
        acc -= CONFIG.STEP_MS;
      }
      this._render(acc / CONFIG.STEP_MS);
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
    window.removeEventListener('mousedown', this._mouse);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    // 소리 정리: 배경음 예약 타이머와 오디오 장치
    this.audio.stopBgm();
    if (this.audio.timer) clearInterval(this.audio.timer);
    this.audio.timer = null;
    if (this.audio.ctx) this.audio.ctx.close().catch(() => {});
    this.audio.ctx = null;
    this.root.remove();
  }

  // 정수배로만 확대 (픽셀이 찌그러지지 않게)
  _fit() {
    const w = this.root.clientWidth || W * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / W, h / H))));
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${H * s}px`;
    if (this.autoHeight) this.root.style.height = `${H * s}px`;
  }

  // ---------------- 입력 ----------------
  _bits() {
    let bits = 0;
    for (const name in KEYS) if (KEYS[name].some((k) => this.held.has(k))) bits |= BITS[name];
    return bits;
  }

  /** 조작 바에 보여 줄 '누르고 있는 키' [왼쪽, 펀치, 오른쪽, 가드] */
  _heldKeys() {
    const b = this._bits();
    return [!!(b & 1), !!(b & 4), !!(b & 2), !!(b & 8)];
  }

  _sendInput(phase) {
    if (phase !== 'fight' || !this.mine) {
      this.pressBuf = [];
      this.sentHeld = 0;
      return;
    }
    let bits = this._bits();
    let press = this.pressBuf;
    this.pressBuf = [];
    if (this.mirror) {
      // 화면을 뒤집어 보고 있으므로 서버에는 왼쪽 · 오른쪽을 바꿔 보낸다
      bits = (bits & 12) | ((bits & 1) << 1) | ((bits & 2) >> 1);
      press = press.map((p) => (p === 'left' ? 'right' : p === 'right' ? 'left' : p));
    }
    if (bits !== this.sentHeld || press.length) {
      this.sentHeld = bits;
      this.net.input(bits, press);
    }
  }

  // ---------------- 진행 ----------------
  _tick() {
    this.frame++;
    if (this.muteNotice > 0) this.muteNotice--;
    if (this.bgRing) this.bgRing.update(this.frame);
    const s = this.net.snap;
    if (!s) return;
    // 사건: 지금 보고 있는 경기의 것만 화면에 반영한다
    for (const ev of this.net.takeEvents()) {
      if (ev.type === 'verdict') this.verdict = { headline: ev.headline, mvp: ev.mvp, cheer: ev.cheer };
      else if (this.view && ev.match === this.matchIndex) this.view.onEvent(ev);
    }
    if (s !== this.lastSnap) {
      this.lastSnap = s;
      this._sync(s);
    }
    if (s.verdict && !this.verdict) this.verdict = s.verdict;
    if (this.view) this.view.tick();
    this._sendInput(s.phase);
    this.audio.playBgm(s.phase === 'fight' ? 'game' : s.phase === 'final' || s.phase === 'done' ? 'result' : 'lobby');
  }

  /** 서버 상태에 맞는 경기 장면을 준비하고 상태를 넣는다 */
  _sync(s) {
    if (!s.round || !s.matches || !s.matches.length) return;
    // 내 경기(쉬는 라운드면 첫 경기를 관전)
    let index = s.matches.findIndex((m) => m.red === this.meId || m.blue === this.meId);
    const mine = index >= 0;
    if (!mine) index = 0;
    const key = `r${s.round}m${index}`;
    const m = s.matches[index];
    if (this.viewKey !== key) {
      const mirror = mine && m.blue === this.meId;
      const left = this.byId[mirror ? m.blue : m.red];
      const right = this.byId[mirror ? m.red : m.blue];
      if (!left || !right) return;
      this.view = new BoutView(left, right, {
        mirror, mine, label: `ROUND ${s.round}`, audio: this.audio, heldKeys: () => this._heldKeys(),
      });
      this.viewKey = key;
      this.matchIndex = index;
      this.mine = mine;
      this.mirror = mirror;
      this.sentHeld = 0;
    }
    if (s.phase !== 'intro' && s.bouts && s.bouts[index]) this.view.apply(s.bouts[index]);
  }

  // ---------------- 그리기 ----------------
  _render(alpha) {
    const ctx = this.ctx;
    ctx.fillStyle = PALETTE.o;
    ctx.fillRect(0, 0, W, H);
    const s = this.net.snap;
    if (!this.ready || !s) {
      ctx.fillStyle = PALETTE.a;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('준비 중…', W / 2, H / 2);
      return;
    }
    if (s.phase === 'fight' && this.view && this.view.got) {
      this.view.render(ctx, alpha);
      if (!this.mine) drawTag(ctx, W / 2 - 50, 31, 100, 14, '9', '이번 라운드는 관전', '1', 'b');
    } else {
      // 배경: 어둡게 한 링
      const ring = this.view ? this.view.ring : this.bgRing;
      ring.renderBack(ctx, this.frame);
      ring.renderFront(ctx, this.frame);
      ctx.fillStyle = ctx.createPattern(Transition.patterns[11], 'repeat');
      ctx.fillRect(0, 0, W, H);
      if (s.phase === 'intro') this._renderLineup(ctx, s);
      else if (s.phase === 'result') this._renderRoundResult(ctx, s);
      else if (s.phase === 'final' || s.phase === 'done') this._renderFinal(ctx, s);
    }
    if (this.muteNotice > 0) {
      const txt = this.audio.muted ? '소리 끔' : '소리 켬';
      drawPanel(ctx, W - 60, H - 26, 54, 20, 'dark');
      KText.draw(ctx, txt, W - 33, H - 22, C('a'), { align: 'center', font: 's' });
    }
  }

  _face(id) {
    const p = this.byId[id];
    return SPR.players[charIndex(p && p.character)].face;
  }

  _name(id) {
    const p = this.byId[id];
    return p ? p.name : id;
  }

  // 이름: 내 이름은 금색
  _nameColor(id) {
    return C(id === this.meId ? '9' : 'a');
  }

  // 대진 안내
  _renderLineup(ctx, s) {
    drawBroadcastPanel(ctx, W / 2 - 80, 4, 160, 24, '9');
    KText.draw(ctx, `ROUND ${s.round} / ${s.rounds}`, W / 2, 4, C('a'), { align: 'center', font: 'L', outline: C('1') });
    s.matches.forEach((m, i) => {
      const y = 36 + i * 32;
      const mine = m.red === this.meId || m.blue === this.meId;
      drawBroadcastPanel(ctx, 30, y, 260, 26, mine ? '9' : '6');
      ctx.drawImage(this._face(m.red), 38, y + 4);
      KText.draw(ctx, this._name(m.red), 60, y + 5, this._nameColor(m.red), { font: 'b', outline: C('1') });
      KText.draw(ctx, 'VS', W / 2, y + 3, C(this.frame % 40 < 30 ? '5' : '9'), { align: 'center', font: 'L', outline: C('1') });
      KText.draw(ctx, this._name(m.blue), 262, y + 5, this._nameColor(m.blue), { font: 'b', align: 'right', outline: C('1') });
      ctx.drawImage(this._face(m.blue), 266, y + 4);
    });
    let y = 36 + s.matches.length * 32 + 2;
    if (s.resting && s.resting.length) {
      const txt = `${s.resting.map((id) => this._name(id)).join(', ')} — 이번 라운드는 쉬며 관전`;
      KText.draw(ctx, txt, W / 2, y, C('k'), { align: 'center', font: 's', outline: C('1') });
      y += 16;
    }
    drawBroadcastPanel(ctx, 4, 134, 312, 42, '9');
    KText.draw(ctx, '←→ 이동 (상대 쪽 톡톡 = 대시) · ↓ 가드', W / 2, 135, C('a'), { align: 'center', font: 's' });
    KText.draw(ctx, 'Space 톡 = 잽 · 꾹 눌렀다 떼기 = 강펀치', W / 2, 148, C('a'), { align: 'center', font: 's' });
    KText.draw(ctx, '내 선수는 항상 왼쪽 · 맞기 직전에 가드 = 카운터', W / 2, 161, C('9'), { align: 'center', font: 's' });
  }

  // 순위표 한 줄들 (승수 → 점수 순)
  _standingRows(s) {
    const ids = [...this.order];
    ids.sort((a, b) => (s.standings[b].score - s.standings[a].score));
    return ids.map((id) => ({ id, st: s.standings[id] }));
  }

  // 라운드 결과
  _renderRoundResult(ctx, s) {
    drawBroadcastPanel(ctx, W / 2 - 80, 2, 160, 22, '9');
    KText.draw(ctx, `ROUND ${s.round} 결과`, W / 2, 1, C('a'), { align: 'center', font: 'L', outline: C('1') });
    (s.roundResults || []).forEach((r, i) => {
      const y = 28 + i * 18;
      const loser = r.winner === r.red ? r.blue : r.red;
      drawBroadcastPanel(ctx, 30, y, 260, 16, '9');
      ctx.drawImage(SPR.crown, 36, y + 6);
      KText.draw(ctx, `${this._name(r.winner)} 승 (${r.byKO ? 'KO' : '판정'})`, 46, y + 1, this._nameColor(r.winner), { font: 'b' });
      KText.draw(ctx, `${this._name(loser)} 패`, 284, y + 1, C(loser === this.meId ? '9' : 'j'), { font: 'b', align: 'right' });
    });
    const y0 = 28 + Math.max(1, (s.roundResults || []).length) * 18 + 4;
    this._renderTable(ctx, s, y0, 13);
  }

  _renderTable(ctx, s, y0, rowH) {
    const rows = this._standingRows(s);
    drawBroadcastPanel(ctx, 30, y0, 260, 14 + rows.length * rowH + 2, '6');
    KText.draw(ctx, '순위', 38, y0, C('k'), { font: 's' });
    KText.draw(ctx, '승-패 (KO)', 200, y0, C('k'), { font: 's', align: 'right' });
    KText.draw(ctx, '점수', 284, y0, C('k'), { font: 's', align: 'right' });
    rows.forEach((row, i) => {
      const y = y0 + 13 + i * rowH;
      KText.draw(ctx, `${i + 1}`, 38, y, C('9'), { font: 'b' });
      KText.draw(ctx, this._name(row.id), 54, y, this._nameColor(row.id), { font: 'b' });
      KText.draw(ctx, `${row.st.wins}-${row.st.losses} (${row.st.kos})`, 200, y, C('a'), { font: 'b', align: 'right' });
      KText.draw(ctx, String(row.st.score), 284, y, C('9'), { font: 'b', align: 'right' });
    });
  }

  // 최종 순위 + AI 총평
  _renderFinal(ctx, s) {
    drawBroadcastPanel(ctx, W / 2 - 70, 2, 140, 22, '9');
    KText.draw(ctx, '최종 순위', W / 2, 1, C('9'), { align: 'center', font: 'L', outline: C('1') });
    const res = s.results || [];
    const rowH = res.length > 4 ? 17 : 19;
    res.forEach((r, i) => {
      const y = 27 + i * rowH;
      drawBroadcastPanel(ctx, 20, y, 280, rowH - 1, r.rank === 1 ? '9' : '6');
      KText.draw(ctx, `${r.rank}등`, 27, y + 1, C(r.rank === 1 ? '9' : 'k'), { font: 'b', outline: C('1') });
      ctx.drawImage(this._face(r.playerId), 52, y - 1);
      if (r.rank === 1) ctx.drawImage(SPR.crown, 58, y - 3);
      KText.draw(ctx, r.name, 74, y + 1, this._nameColor(r.playerId), { font: 'b', outline: C('1') });
      KText.draw(ctx, `${r.stats.wins}승 ${r.stats.losses}패 KO ${r.stats.kos}`, 236, y + 1, C('a'), { font: 's', align: 'right' });
      KText.draw(ctx, String(r.score), 294, y + 1, C('9'), { font: 'b', align: 'right', outline: C('1') });
    });
    // AI 총평 (서버가 보내 주면 보인다)
    const v = this.verdict;
    if (v && v.headline) {
      const y = 27 + res.length * rowH + 2;
      const lines = [v.headline, v.mvp, v.cheer].filter(Boolean);
      const room = Math.max(1, Math.min(lines.length, Math.floor((H - y - 3) / 13)));
      drawBroadcastPanel(ctx, 20, y, 280, 2 + room * 13 + 1, '9');
      drawTag(ctx, 26, y + 2, 44, 13, '9', 'AI 총평', '1', 'n');
      for (let i = 0; i < room; i++) {
        KText.draw(ctx, lines[i], 76, y + 1 + i * 13, C(i === 0 ? '9' : 'a'), { font: 'b' });
      }
    }
  }
}
