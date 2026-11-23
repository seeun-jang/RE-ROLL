// =============================================================
// 실거리 사격 — 화면 (멀티플레이)
//
// 표적 · 명중 판정 · 점수 · 탄알집은 서버가 진행한다. 여기서는
//  - 서버가 보내 주는 상태(net.snap)를 그리고: 내 사로는 2배로 크게, 다른 사람 사로는 옆에 좁게(명중 수 · 점수),
//  - 키보드로 정한 "누르고 있는 조준 키 / 발사"를 서버로 보낸다.
//  - 내 조준점은 답을 기다리지 않고 같은 규칙(sim/rules.js 의 aimStep · swayOf)으로 먼저 움직여 그린다(예측).
//    키를 놓고 잠시 지나면 서버가 알려 준 자리로 살짝 맞춘다. 맞았는지는 서버가 보낸 사건(shot)만 쓴다.
// 그림 · 소리 · 연출은 원본(js/scenes/play.js · result.js · range-view.js)을 옮긴 것이다.
// =============================================================
import { ANIMAL_ORDER } from '../../../shared/animals.js';
import { DEFAULT_CONFIG, DOWN, LEFT, RIGHT, UP } from '../sim/config.js';
import { aimStep, gradeOf, swayAmp, swayOf } from '../sim/rules.js';
import { AudioManager } from './audio.js';
import {
  BOLD_FAMILY, BitmapFont, C, CHARACTER_COLORS, DARK_OF, DITHER, KText, ParticleSystem,
  buildCrown, buildFace, buildProne, drawCard, drawGradeBadge, drawKeyCluster, drawNameCard, drawPanel,
  imageToCanvas, loadCharacterImages, resetGfxCaches,
} from './gfx.js';
import {
  RANGE, buildTargetSprites, drawAmmo, drawBerm, drawCamo, drawProne, drawRangeBg, drawRifle, drawSandbags, drawTarget,
} from './rangeView.js';

const W = 320;
const H = 180;
const STEP_MS = 1000 / 60;      // 화면 로직 60 FPS 고정 (원본과 같음)
const ZOOM_W = 128;             // 내 사로(2배 확대)의 화면 폭
const KEY_BITS = {
  ArrowLeft: LEFT, KeyA: LEFT, ArrowRight: RIGHT, KeyD: RIGHT,
  ArrowUp: UP, KeyW: UP, ArrowDown: DOWN, KeyS: DOWN,
};
const FIRE_KEYS = ['Space', 'Enter', 'KeyZ'];
const KEY_CAPS = { up: '^', left: '<', down: 'v', right: '>', fire: 'SP' }; // SP = Space

const CSS = `
.lf-root { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #120a1c; overflow: hidden; }
.lf-root canvas { flex: none; image-rendering: pixelated; image-rendering: crisp-edges; }
`;

export class RangeScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.cfg = { ...DEFAULT_CONFIG, ...((options && options.config) || {}) };
    this.caster = (options && options.caster) || '통제관';
    this.meId = me ? me.id : null;
    this.players = players.map((p, i) => {
      const character = CHARACTER_COLORS[p.character] ? p.character : ANIMAL_ORDER[(p.index ?? i) % ANIMAL_ORDER.length];
      return { id: p.id, name: p.name, slot: i, character, color: CHARACTER_COLORS[character] || 'e', isMe: p.id === this.meId };
    });
    this.hasMe = this.players.some((p) => p.isMe);
    this.lanes = this._makeLanes();
    this.fx = {};                 // 사로별 연출 { flash, shake, msg }
    for (const p of this.players) this.fx[p.id] = { flash: 0, shake: 0, msg: null };

    this._buildDom();
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.targetSpr = buildTargetSprites(this.cfg.DISTANCES);
    this.crown = buildCrown();
    this.art = {};                // 동물 id → { face, prone }
    this._buildArt({});
    this.audio = new AudioManager();
    this.particles = new ParticleSystem();
    this.confetti = new ParticleSystem();

    // 내 조준(예측)
    this.pred = { ax: 0, ay: this.cfg.AIM_START_Y, kick: 0, still: 0 };
    this.held = 0;                // 누르고 있는 조준 키(비트)
    this.down = new Set();        // 누르고 있는 키 코드
    this.fireHeld = false;
    this.cooldown = 0;
    this.heldChangedAt = -999;
    this.firedAt = -999;
    this.synced = false;          // 서버 조준점을 한 번이라도 받았는지

    this.frame = 0;
    this.lastSnap = null;
    this.tower = null;            // 통제관 방송 { text, source, t }
    this.verdict = null;
    this.muteNotice = 0;
    this.seen = { tPhase: null, k: -1, phase: null };
    this._destroyed = false;

    this._onKeyDown = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.audio.unlock();
      const code = e.code;
      if (KEY_BITS[code] || FIRE_KEYS.includes(code)) e.preventDefault();
      if (e.repeat) return;
      if (code === 'KeyM') {
        this.audio.toggleMute();
        this.muteNotice = 90;
      }
      if (!this.hasMe) return;
      if (KEY_BITS[code]) {
        this.down.add(code);
        this._syncHeld();
      } else if (FIRE_KEYS.includes(code)) {
        this.fireHeld = true;
        this._tryFire();
      }
    };
    this._onKeyUp = (e) => {
      if (KEY_BITS[e.code]) {
        this.down.delete(e.code);
        this._syncHeld();
      } else if (FIRE_KEYS.includes(e.code)) this.fireHeld = false;
    };
    this._onBlur = () => {
      this.down.clear();
      this.fireHeld = false;
      this._syncHeld();
    };
    this._onPointer = () => this.audio.unlock();
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('pointerdown', this._onPointer);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
    try { this.audio.unlock(); } catch (e) { /* 첫 입력 때 켜진다 */ }
    this.audio.playBgm('game');
    this._loadAssets();

    this._last = performance.now();
    this._acc = 0;
    const loop = (ts) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      let dt = ts - this._last;
      this._last = ts;
      if (dt > 250) dt = 250;     // 탭 전환 후 폭주 방지
      this._acc += dt;
      while (this._acc >= STEP_MS) {
        this._update();
        this._acc -= STEP_MS;
      }
      try {
        this._render();
      } catch (err) {
        if (!this._renderErr) console.error('[livefire] 그리기 오류', err);
        this._renderErr = true;
      }
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('pointerdown', this._onPointer);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.audio.close();
    if (this._boldFace) {
      try { document.fonts.delete(this._boldFace); } catch (e) { /* 지원하지 않는 브라우저 */ }
    }
    resetGfxCaches();
    this.root.remove();
    this.styleEl.remove();
  }

  // ---------------- 준비 ----------------
  _buildDom() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    this.root = document.createElement('div');
    this.root.className = 'lf-root';
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.root.appendChild(this.canvas);
    this.container.appendChild(this.root);
    this.autoHeight = this.container.clientHeight === 0;
  }

  // container 크기에 맞춰 정수배로만 확대 (픽셀이 찌그러지지 않게)
  _fit() {
    const cw = this.root.clientWidth || W * 2;
    const ch = this.autoHeight ? Infinity : this.root.clientHeight || H * 2;
    const s = Math.max(1, Math.floor(Math.min(cw / W, ch / H)));
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${H * s}px`;
    if (this.autoHeight) this.root.style.height = `${H * s}px`;
  }

  // 글꼴(굵은 Galmuri11)과 캐릭터 그림을 불러온다. 다 오기 전에도 화면은 돈다(오면 다시 만든다).
  _loadAssets() {
    const redo = () => {
      if (!this._destroyed) resetGfxCaches();
    };
    try {
      const url = new URL('../assets/Galmuri11-Bold.woff2', import.meta.url).href;
      const face = new FontFace(BOLD_FAMILY, `url(${url}) format('woff2')`);
      face.load().then((f) => {
        if (this._destroyed) return;
        document.fonts.add(f);
        this._boldFace = f;
        redo();
      }).catch(() => { /* 없으면 보통 굵기로 보인다 */ });
      for (const css of ['10px Galmuri9', '12px Galmuri11', '15px Galmuri14']) document.fonts.load(css, '가').then(redo).catch(() => {});
    } catch (e) { /* FontFace 를 못 쓰는 환경 */ }
    loadCharacterImages().then((imgs) => {
      if (!this._destroyed) this._buildArt(imgs);
    });
  }

  _buildArt(imgs) {
    for (const p of this.players) {
      const mini = imageToCanvas(imgs[p.character]);
      this.art[p.character] = { face: buildFace(mini), prone: buildProne(mini) };
    }
  }

  // 사로 칸 배치: x · w(화면 폭) · s(확대) · top(화면 y) · crop(사로 그림에서 잘라낼 위쪽)
  //  내 사로는 2배로 크게, 나머지는 좁게(최대 64). 남는 오른쪽에는 순위표를 그린다.
  _makeLanes() {
    const n = this.players.length;
    if (!this.hasMe) {
      const w = Math.min(RANGE.COL_W, Math.floor(W / n));
      const x0 = Math.round((W - n * w) / 2);
      this.lanesEnd = W;
      return this.players.map((p, i) => ({ x: x0 + i * w, w, s: 1, top: RANGE.VIEW_Y, crop: 0 }));
    }
    const ow = Math.min(RANGE.COL_W, Math.floor((W - ZOOM_W) / Math.max(1, n - 1)));
    let x = 0;
    const lanes = this.players.map((p) => {
      const L = p.isMe ? { x, w: ZOOM_W, s: 2, top: 15, crop: 16 } : { x, w: ow, s: 1, top: RANGE.VIEW_Y, crop: 0 };
      x += L.w;
      return L;
    });
    this.lanesEnd = x;
    return lanes;
  }

  // 사로 그림 좌표 (lx: 0~64, ly: 0~96) → 화면 좌표
  _toScreen(p, lx, ly) {
    const L = this.lanes[p.slot];
    return { x: L.x + L.w / 2 + L.s * (lx - RANGE.COL_W / 2), y: L.top + L.s * (ly - L.crop) };
  }

  // ---------------- 입력 ----------------
  _syncHeld() {
    let bits = 0;
    for (const code of this.down) bits |= KEY_BITS[code];
    if (bits === this.held) return;
    this.held = bits;
    this.heldChangedAt = this.frame;
    this.net.held(bits);
  }

  _tryFire() {
    const s = this.net.snap;
    if (!s || s.phase !== 'fire' || !this.hasMe) return;
    const lane = s.lanes[this.meId];
    if (!lane || this.cooldown > 0 || lane.reload > 0) return;
    if (lane.mag === 0) {
      this.audio.sfx('dry');
      return;
    }
    this.net.fire(this.held);
    // 반응이 느려 보이지 않게 총소리 · 불꽃 · 반동은 바로 (맞았는지는 서버 답을 기다린다)
    this.cooldown = this.cfg.FIRE_COOLDOWN;
    this.firedAt = this.frame;
    const a = this._myAim(s);
    this.pred.kick += this.cfg.RECOIL;
    this.fx[this.meId].flash = 6;
    this.audio.sfx('rifle');
    this.audio.sfx('casing');
    const me = this.players.find((p) => p.isMe);
    const sp = this._toScreen(me, RANGE.COL_W / 2 + a.x, a.y);
    this.particles.add(sp.x + 4, sp.y + 8, 1.2 + Math.random() * 0.6, -1.4, 26, C('8'), 2, 0.15); // 탄피
  }

  // 지금 내 조준점 (예측한 자리 + 호흡 흔들림 + 반동)
  _myAim(s) {
    const ph = s && s.me ? s.me.ph : 0;
    const est = s ? (this.net.now() - s.startAt) * this.cfg.FPS : 0;
    const moving = s && ['brief', 'fire', 'cease'].includes(s.phase);
    const sw = moving ? swayOf(est, ph, swayAmp(this.pred.still, this.cfg)) : { sx: 0, sy: 0 };
    return { x: this.pred.ax + sw.sx, y: this.pred.ay - this.pred.kick + sw.sy };
  }

  // ---------------- 서버 상태 · 사건 ----------------
  _applySnap(s) {
    const first = !this.lastSnap;
    this.lastSnap = s;
    if (s.tower && !this.tower) this.tower = { text: s.tower.text, source: s.tower.source, t: 200 }; // 다시 접속
    if (s.verdict) this.verdict = s.verdict;
    // 표적이 올라오는 소리
    if (s.tPhase === 'rise' && (this.seen.tPhase !== 'rise' || this.seen.k !== s.k) && !first) this.audio.sfx('popup');
    this.seen.tPhase = s.tPhase;
    this.seen.k = s.k;
    if (s.phase !== this.seen.phase) {
      if ((s.phase === 'final' || s.phase === 'done') && !first) this.audio.sfx('win');
      if (s.phase === 'final' || s.phase === 'done') this.audio.playBgm('result');
      this.seen.phase = s.phase;
    }
    // 내 조준점을 서버 값에 맞춘다: 처음에는 그대로, 그 뒤에는 키를 놓고 잠시 지났을 때만 살짝
    const m = s.me;
    if (!m) return;
    if (!this.synced) {
      this.synced = true;
      Object.assign(this.pred, { ax: m.ax, ay: m.ay, kick: m.kick, still: m.still });
      return;
    }
    if (this.held === 0 && m.held === 0 && this.frame - this.heldChangedAt > 20) {
      this.pred.ax += (m.ax - this.pred.ax) * 0.35;
      this.pred.ay += (m.ay - this.pred.ay) * 0.35;
      this.pred.still = m.still;
    }
    if (this.frame - this.firedAt > 25) this.pred.kick = m.kick;
  }

  _handleEvent(e) {
    if (e.type === 'tower' || e.type === 'say') {
      this.tower = { text: e.text, source: e.type === 'say' ? e.source : 'script', t: 0 };
      this.audio.sfx('radio');
      if (e.type === 'tower' && e.text.includes('조정간')) this.audio.sfx('lock'); // 조정간 딸깍
    } else if (e.type === 'verdict') {
      this.verdict = { headline: e.headline, mvp: e.mvp, cheer: e.cheer };
    } else if (e.type === 'dry') {
      this.audio.sfx('dry');
    } else if (e.type === 'shot') {
      const p = this.players.find((pp) => pp.id === e.playerId);
      if (!p) return;
      const fx = this.fx[p.id];
      const sp = this._toScreen(p, RANGE.COL_W / 2 + e.x, e.y);
      if (!p.isMe) {
        fx.flash = 6;
        this.audio.sfx('far');
      } else if (this.frame - this.firedAt > 40) {
        fx.flash = 6;             // 내가 누른 기억이 없는 발사(다시 접속 직후 등)
        this.audio.sfx('rifle');
      }
      if (e.hit) {
        fx.shake = 6;
        fx.msg = { text: e.streak >= 2 ? `${e.streak}연속!` : '명중!', color: e.streak >= 3 ? '8' : '9', t: 0 };
        this.particles.burst(sp.x, sp.y, p.isMe ? 10 : 5, [C('b'), C('9'), C('k')], 1.1, 18, 1);
        // 표적 밑 흙먼지 (뒤로 넘어가면서)
        const D = this.cfg.DISTANCES[e.dist];
        const tg = this.lastSnap && this.lastSnap.target;
        if (D && tg) {
          const base = this._toScreen(p, RANGE.COL_W / 2 + tg.x, D.y);
          this.particles.burst(base.x, base.y - 1, p.isMe ? 8 : 4, [C('m'), C('n'), C('l')], 0.7, 24, 1, -0.02);
        }
        if (p.isMe) this.audio.sfx('ping');
      } else {
        if (e.y > 20) this.particles.burst(sp.x, sp.y, p.isMe ? 6 : 3, [C('m'), C('n'), C('l')], 0.6, 20, 1, -0.02);
        fx.msg = { text: '빗나감', color: 'k', t: 0 };
      }
      if (e.reload && p.isMe) this.audio.sfx('reload');
    }
  }

  // ---------------- 매 프레임(60분의 1초) ----------------
  _update() {
    this.frame++;
    const s = this.net.snap;
    if (s && s !== this.lastSnap) this._applySnap(s);
    for (const e of this.net.takeEvents()) this._handleEvent(e);
    if (this.cooldown > 0) this.cooldown--;
    if (this.muteNotice > 0) this.muteNotice--;
    if (this.tower) this.tower.t++;
    for (const p of this.players) {
      const fx = this.fx[p.id];
      if (fx.flash > 0) fx.flash--;
      if (fx.shake > 0) fx.shake--;
      if (fx.msg && ++fx.msg.t > 45) fx.msg = null;
    }
    // 내 조준점 예측: 서버와 같은 규칙으로 한 프레임
    if (this.hasMe && s && ['brief', 'fire', 'cease'].includes(s.phase)) aimStep(this.pred, this.held, this.cfg);
    this.particles.update();
    // 최종 순위 화면의 색종이
    if (s && s.results) {
      if (this.frame % 4 === 0) {
        const cols = [C('9'), C('8'), C('6'), C('h'), C('q'), C('b')];
        this.confetti.add(Math.random() * W, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 2);
      }
      this.confetti.update();
    }
  }

  // ---------------- 그리기 ----------------
  _render() {
    const ctx = this.ctx;
    const s = this.net.snap;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, H);
    if (!s) {
      drawCamo(ctx, this.frame);
      KText.draw(ctx, '서버를 기다리는 중…', W / 2, 82, C('a'), { align: 'center', font: 'b', outline: C('1') });
      return;
    }
    if (s.results) {
      this._renderFinal(ctx, s);
    } else {
      for (const p of this.players) this._renderLane(ctx, p, s);
      this._renderSide(ctx, s);
      this.particles.render(ctx);
      this._renderTower(ctx, s);
    }
    if (this.muteNotice > 0) {
      drawPanel(ctx, W - 60, H - 26, 54, 20);
      KText.draw(ctx, this.audio.muted ? '소리 끔' : '소리 켬', W - 33, H - 22, C('a'), { align: 'center', font: 's' });
    }
  }

  // 이 사로에서 지금 표적이 얼마나 올라와 있나 (0~1) — 서버 상태로 계산
  _riseFor(s, lane) {
    if (s.phase !== 'fire' || !s.target) return 0;
    const R = this.cfg.RISE_TIME;
    if (lane.hitK === s.k) return Math.max(0, 1 - lane.fallT / R);
    return { gap: 0, rise: s.tT / R, up: 1, fall: 1 - s.tT / R }[s.tPhase] || 0;
  }

  // 통제관 한 줄: [AI] 표시 + 글자. 그린 뒤의 x 를 돌려준다
  _drawCasterLine(ctx, x, y, tower, color) {
    if (tower.source === 'gemini') {
      ctx.fillStyle = C('9');
      ctx.fillRect(x, y + 3, 11, 8);
      BitmapFont.draw(ctx, 'AI', x + 2, y + 5, C('1'));
      x += 14;
    }
    KText.draw(ctx, tower.text, x, y, color, { font: 's' });
    return x;
  }

  // 위: 통제탑 방송 + 표적 번호
  _renderTower(ctx, s) {
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 14);
    ctx.fillStyle = C('c');
    ctx.fillRect(0, 13, W, 1);
    // 확성기 아이콘
    const on = this.tower && this.tower.t < 90;
    ctx.fillStyle = C(on && this.frame % 16 < 8 ? '9' : 'j');
    ctx.fillRect(4, 5, 3, 4);
    ctx.fillRect(7, 3, 2, 8);
    KText.draw(ctx, this.caster, 12, 1, C('j'), { font: 'n' });
    const tx = 16 + KText.width(this.caster, 'n');
    if (this.tower) this._drawCasterLine(ctx, tx, 1, this.tower, on ? C('9') : C('k'));
    const info = s.phase === 'fire' ? `표적 ${Math.min(s.k + 1, s.total)}/${s.total}` : s.phase === 'brief' ? '준비' : '사격 끝';
    const iw = KText.width(info, 'n');
    ctx.fillStyle = C('1');
    ctx.fillRect(W - iw - 8, 0, iw + 8, 13);
    KText.draw(ctx, info, W - 4, 1, C('a'), { font: 'n', align: 'right' });
  }

  _renderLane(ctx, p, s) {
    const cfg = this.cfg;
    const L = this.lanes[p.slot];
    const lane = s.lanes[p.id];
    if (!lane) return;
    const fx = this.fx[p.id];
    const art = this.art[p.character] || {};
    const zoom = L.s > 1;
    const wide = L.w >= 60;
    const viewH = 129 - L.top;
    if (!zoom && wide) drawNameCard(ctx, L.x + 2, 15, L.w - 4, { color: p.color, name: p.name, face: art.face });
    else if (!zoom) {
      // 좁은 칸: 얼굴 + 이름 (넘치면 줄임)
      drawCard(ctx, L.x + 1, 15, L.w - 2, 17, p.color, DARK_OF[p.color] || '3');
      if (art.face) ctx.drawImage(art.face, L.x + 2, 15);
      let nm = p.name;
      while (KText.width(nm, 'n') > L.w - 24 && nm.length > 1) nm = nm.slice(0, -1);
      KText.draw(ctx, nm, L.x + 21, 18, C('1'), { font: 'n' });
    }
    // 사로 그림 (칸 밖으로 안 나가게 자름) — 사로 좌표계로 옮겨서 그림
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x, L.top, L.w, viewH);
    ctx.clip();
    const sh = fx.shake > 0 ? ((fx.shake & 1) ? 1 : -1) : 0;
    ctx.translate(L.x + L.w / 2 - (L.s * RANGE.COL_W) / 2 + sh, L.top - L.s * (L.crop + RANGE.VIEW_Y));
    ctx.scale(L.s, L.s);
    drawRangeBg(ctx, 0, this.frame, p.slot * RANGE.COL_W);
    const tg = s.target;
    const rise = this._riseFor(s, lane);
    const hitNow = lane.hitK === s.k && s.phase === 'fire';
    for (const d of [250, 200, 100]) {
      const D = cfg.DISTANCES[d];
      if (!D) continue;
      if (tg && tg.dist === d) drawTarget(ctx, this.targetSpr, 0, tg, D, rise, hitNow && lane.fallT < 6, hitNow);
      drawBerm(ctx, 0, d, D, wide);
    }
    drawSandbags(ctx, 0);
    // 조준: 내 사로는 예측한 자리, 다른 사로는 서버가 알려 준 자리
    const a = p.isMe ? this._myAim(s) : { x: lane.aim[0], y: lane.aim[1] };
    drawRifle(ctx, 0, a.x, a.y, fx.flash);
    if (!zoom && wide) {
      // 사로 번호
      ctx.fillStyle = C('1');
      ctx.fillRect(49, RANGE.VIEW_Y + 85, 13, 10);
      ctx.fillStyle = C('a');
      ctx.fillRect(50, RANGE.VIEW_Y + 86, 11, 8);
      BitmapFont.draw(ctx, String(p.slot + 1), 55, RANGE.VIEW_Y + 88, C('1'), { align: 'center' });
    }
    ctx.restore();

    // ---- 여기부터 화면 좌표 (확대해도 글씨는 그대로) ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x, L.top, L.w, viewH);
    ctx.clip();
    const cx = L.x + L.w / 2;
    // 명중 / 빗나감: 하늘 쪽에 어두운 띠 + 글자 (표적을 안 가림)
    if (fx.msg) {
      const font = wide ? 'b' : 'n';
      const tw = KText.width(fx.msg.text, font);
      const ty = L.top + 2 - Math.max(0, 4 - fx.msg.t);
      ctx.fillStyle = C('1');
      ctx.fillRect(Math.round(cx - tw / 2 - 3), ty, tw + 6, 14);
      KText.draw(ctx, fx.msg.text, cx, ty, C(fx.msg.color), { align: 'center', font });
    }
    // 탄알집 교체: 사로 아래쪽에 작은 띠 + 진행 막대
    if (lane.reload > 0) {
      const by = L.top + viewH - 22 - (zoom ? 14 : 0);
      ctx.fillStyle = C('1');
      ctx.fillRect(L.x + 3, by, L.w - 6, 18);
      KText.draw(ctx, wide ? '탄알집 교체' : '교체', cx, by, C('9'), { align: 'center', font: 'n' });
      const prog = 1 - lane.reload / cfg.RELOAD_TIME;
      ctx.fillStyle = C('2');
      ctx.fillRect(L.x + 6, by + 13, L.w - 12, 3);
      ctx.fillStyle = C('9');
      ctx.fillRect(L.x + 6, by + 13, Math.round((L.w - 12) * prog), 3);
    }
    // 확대한 내 사로: 이름 꼬리표 (오른쪽 아래) · 준비 중에는 조작 안내 (왼쪽 아래)
    if (zoom) {
      const tag = `${p.name} · 나`;
      const tw = KText.width(tag, 'n');
      const tx = L.x + L.w - tw - 8;
      ctx.fillStyle = C('1');
      ctx.fillRect(tx, L.top + viewH - 12, tw + 8, 12);
      ctx.fillStyle = C(p.color);
      ctx.fillRect(tx, L.top + viewH - 12, 2, 12);
      KText.draw(ctx, tag, tx + 5, L.top + viewH - 12, C(p.color), { font: 'n' });
      if (s.phase === 'brief') {
        const tip = '방향키 조준 · Space 발사';
        const w2 = KText.width(tip, 'n');
        ctx.fillStyle = C('1');
        ctx.fillRect(Math.round(cx - w2 / 2 - 3), L.top + 16, w2 + 6, 13);
        KText.draw(ctx, tip, cx, L.top + 16, C('a'), { align: 'center', font: 'n' });
      }
    }
    // 끝나면 등급 발표
    if (s.phase === 'cease' && s.t > cfg.GRADE_AT) {
      const g = gradeOf(lane.hits, cfg);
      const my = L.top + Math.round(viewH / 2) - 20;
      ctx.fillStyle = DITHER.get(ctx, 'o', 8);
      ctx.fillRect(L.x, L.top, L.w, viewH);
      KText.draw(ctx, `${lane.hits}/${s.total}`, cx, my, C('b'), { align: 'center', font: 'b', outline: C('1') });
      drawGradeBadge(ctx, cx, my + 18, g, L.w - 8);
    }
    ctx.restore();
    if (p.isMe) {
      ctx.fillStyle = C('9');
      ctx.fillRect(L.x, L.top, 1, viewH);
      ctx.fillRect(L.x + L.w - 1, L.top, 1, viewH);
    }
    // 아래 정보줄: 남은 탄 (탄알집) · 예비 탄알집 · 명중 수
    ctx.fillStyle = C('1');
    ctx.fillRect(L.x, 129, L.w, 13);
    ctx.fillStyle = C('2');
    ctx.fillRect(L.x + L.w - 1, 129, 1, 13);
    drawAmmo(ctx, L.x + 2, 131, lane.mag, cfg.MAG_SIZE);
    for (let i = 0; i < lane.spare; i++) {
      ctx.fillStyle = C('j');
      ctx.fillRect(L.x + 33 + i * 4, 130, 3, 8);
      ctx.fillStyle = C('k');
      ctx.fillRect(L.x + 33 + i * 4, 130, 3, 1);
    }
    const hitTxt = wide ? `명중 ${lane.hits}` : String(lane.hits);
    KText.draw(ctx, hitTxt, L.x + L.w - 2, 128, C('9'), { font: 'n', align: 'right' });
    // 명중 기록판: 표적 20개 — 맞힘 초록 · 놓침 빨강 · 지금 표적 깜빡 · 아직 회색
    const st = L.w >= 62 ? 3 : 2;
    const recW = s.total * st + 3 * (st === 2 ? 1 : 0);
    let rx = Math.round(L.x + (L.w - recW) / 2);
    for (let k = 0; k < s.total; k++) {
      if (st === 2 && k > 0 && k % 5 === 0) rx++;
      let col = '2';
      if (k < lane.rec.length) col = lane.rec[k] === '1' ? 'e' : '6';
      else if (k === s.k && s.phase === 'fire') col = lane.hitK === k ? 'e' : this.frame % 30 < 15 ? '9' : '2';
      ctx.fillStyle = C(col);
      ctx.fillRect(rx + k * st, 139, 2, 2);
    }
    // 맨 아래: 나는 조작키 + 점수, 다른 사람은 엎드려 쏴 모습 + 점수
    if (p.isMe) {
      const inp = {
        left: this.held & LEFT, right: this.held & RIGHT, up: this.held & UP, down: this.held & DOWN, fire: this.fireHeld,
      };
      drawKeyCluster(ctx, L.x + L.w / 2, 142, KEY_CAPS, inp, L.x, L.x + L.w);
      KText.draw(ctx, `${lane.score}점`, L.x + L.w - 3, 163, C('9'), { font: 'b', align: 'right', outline: C('1') });
    } else {
      drawProne(ctx, L.x + L.w / 2, 172, art.prone, fx.flash);
      BitmapFont.draw(ctx, String(lane.score), L.x + 3, 147, C('k'));
    }
  }

  // 사로 오른쪽에 남는 자리: 얼룩무늬 + 순위표 (2~3명일 때)
  _renderSide(ctx, s) {
    const x0 = this.lanesEnd;
    const w = W - x0;
    if (w <= 0) return;
    drawCamo(ctx, this.frame, x0, 14, w, H - 14);
    if (w < 60) return;
    drawPanel(ctx, x0 + 3, 18, w - 6, 20 + this.players.length * 13);
    KText.draw(ctx, '지금 순위', x0 + w / 2, 20, C('9'), { align: 'center', font: 'n' });
    const rows = this.players.map((p) => ({ p, lane: s.lanes[p.id] || { score: 0, hits: 0, shots: 0 } }));
    rows.sort((a, b) => b.lane.score - a.lane.score || b.lane.hits - a.lane.hits || a.lane.shots - b.lane.shots);
    rows.forEach((row, i) => {
      const y = 33 + i * 13;
      const col = row.p.isMe ? C('9') : C('a');
      let nm = row.p.name;
      while (KText.width(nm, 'n') > w - 44 && nm.length > 1) nm = nm.slice(0, -1);
      BitmapFont.draw(ctx, String(i + 1), x0 + 8, y + 4, col);
      KText.draw(ctx, nm, x0 + 15, y, col, { font: 'n' });
      BitmapFont.draw(ctx, String(row.lane.score), x0 + w - 8, y + 4, col, { align: 'right' });
    });
    if (w >= 120) {
      const y = 44 + this.players.length * 13;
      const lines = ['명중 10점 + 빠르면 최대 +5', '가만히 조준하면 덜 흔들림', '탄알 20발 · 10발마다 교체'];
      lines.forEach((t, i) => KText.draw(ctx, t, x0 + w / 2, y + i * 12, C('k'), { align: 'center', font: 'n', outline: C('1') }));
    }
  }

  // 최종 순위 (원본 result.js) + AI 총평
  _renderFinal(ctx, s) {
    const cfg = this.cfg;
    const t = this.frame;
    drawCamo(ctx, t);
    this.confetti.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, -3, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const rowH = 22;
    const y0 = 32;
    const medal = ['9', 'k', '8'];
    s.results.forEach((r, i) => {
      const p = this.players.find((pp) => pp.id === r.playerId) || { name: r.name, color: 'e', character: '' };
      const art = this.art[p.character] || {};
      const st = r.stats || {};
      const x = 14;
      const y = y0 + i * rowH;
      drawCard(ctx, x, y, 292, rowH - 3, r.rank === 1 ? '7' : '2', r.rank === 1 ? '9' : '3');
      BitmapFont.draw(ctx, String(r.rank), x + 13, y + 4, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      drawNameCard(ctx, x + 26, y + 1, 84, { color: p.color, name: r.name, face: art.face });
      if (r.rank === 1) ctx.drawImage(this.crown, x + 32, y - 2);
      KText.draw(ctx, `${r.score}점`, x + 116, y + 2, C('9'), { font: 'b', outline: C('1') });
      KText.draw(ctx, `명중 ${st.hits ?? 0}발`, x + 160, y + 3, C('a'), { font: 'n', outline: C('1') });
      drawGradeBadge(ctx, x + 233, y + 2, gradeOf(st.hits ?? 0, cfg), 48);
      if (r.playerId === this.meId) KText.draw(ctx, '나', x + 284, y + 3, C('9'), { align: 'right', font: 'n', outline: C('1') });
    });
    // 아래: AI 총평(오면) 또는 통제관의 마지막 한마디
    const by = y0 + s.results.length * rowH + 2;
    const v = this.verdict;
    if (v && v.headline) {
      ctx.fillStyle = DITHER.get(ctx, 'o', 12);
      ctx.fillRect(14, by, 292, H - by - 1);
      ctx.fillStyle = C('9');
      ctx.fillRect(18, by + 4, 11, 8);
      BitmapFont.draw(ctx, 'AI', 20, by + 6, C('1'));
      KText.draw(ctx, `총평 · ${v.headline}`, 33, by + 1, C('9'), { font: 'n', outline: C('1') });
      if (H - by >= 24 && v.mvp) KText.draw(ctx, `1등에게 · ${v.mvp}`, 33, by + 12, C('a'), { font: 'n', outline: C('1') });
      if (H - by >= 35 && v.cheer) KText.draw(ctx, `응원 · ${v.cheer}`, 33, by + 23, C('e'), { font: 'n', outline: C('1') });
    } else if (this.tower) {
      KText.draw(ctx, this.caster, 18, by + 2, C('j'), { font: 'n', outline: C('1') });
      this._drawCasterLine(ctx, 24 + KText.width(this.caster, 'n'), by + 2, this.tower, C('a'));
    }
  }
}
