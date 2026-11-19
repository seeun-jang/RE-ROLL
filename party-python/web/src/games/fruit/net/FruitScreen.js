// =============================================================
// 과일자르기 — 화면 (멀티플레이)
//
// 던질 과일 목록과 점수 판정은 서버가 정한다. 여기서는
//  - 목록대로 과일을 그리고(위치는 시각만으로 계산),
//  - 마우스·손 인식으로 그은 칼 선분을 서버로 보내고,
//  - 화면 반응을 위해 같은 식으로 미리 베는 모습을 보여 준다(점수는 서버가 알려 준 값만 쓴다).
// 배경·칼 궤적·효과·소리는 원본 모듈을 그대로 쓴다.
// =============================================================
import { ANIMALS, animalForIndex } from '../../../shared/animals.js';
import { loadAssets } from '../assets/AssetLoader.js';
import { PALETTE } from '../assets/palette.js';
import { drawText } from '../assets/pixelFont.js';
import { createAudio } from '../audio/index.js';
import { BLADE, BOMB_DEF, FRUITS, ITEM_DEFS, JUICE, PHYSICS, TIMING, VIEW } from '../config.js';
import { Background } from '../game/Background.js';
import { Blade } from '../game/Blade.js';
import { Effects } from '../game/effects/Effects.js';
import { Piece } from '../game/entities/Piece.js';
import { ditherRect, drawSprite, makeHalves, quantizeAngle, rand } from '../game/gfx.js';
import { InputManager } from '../input/InputManager.js';
import { DEFAULT_CONFIG, OBJECT_KEYS, distToSegment, posAt } from '../sim/rules.js';

const ITEMS = DEFAULT_CONFIG.ITEMS;
const WARNING_TIME = 10;
const VISUAL = { bomb: BOMB_DEF, double: ITEM_DEFS.double, triple: ITEM_DEFS.triple };
for (const f of FRUITS) VISUAL[f.id] = f;

const CSS = `
.fr-root { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #0b0b14; overflow: hidden; }
.fr-wrap { position: relative; flex: none; }
.fr-wrap canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; cursor: none; touch-action: none; }
.fr-ui { position: absolute; inset: 0; pointer-events: none; font-family: 'Galmuri9', 'Galmuri11', monospace; color: #fff; line-height: 1; }
.fr-ui > div { position: absolute; }
.fr-box { background: rgba(16, 16, 32, 0.82); border: 1em solid #f4f4f4; box-shadow: 0 0 0 1em #101020; padding: 2em 4em; }
.fr-score { left: 5em; top: 5em; min-width: 44em; }
.fr-label { font-size: 7em; color: #ffd75e; }
.fr-value { font-size: 12em; margin-top: 1px; }
.fr-time { left: 50%; top: 5em; transform: translateX(-50%); text-align: center; min-width: 22em; }
.fr-time.warn .fr-value { color: #ff5d5d; }
.fr-buffs { left: 5em; top: 34em; font-size: 1em; }
.fr-buff { display: flex; align-items: center; gap: 3em; margin-bottom: 2em; }
.fr-buff span { font-size: 7em; text-shadow: 1px 1px 0 #101020; }
.fr-bar { width: 40em; height: 4em; background: #101020; border: 1em solid #f4f4f4; }
.fr-bar i { display: block; height: 100%; }
.fr-board { right: 5em; top: 5em; min-width: 70em; }
.fr-row { display: flex; align-items: center; gap: 3em; font-size: 1em; padding: 1em 0; }
.fr-row b { width: 5em; height: 5em; flex: none; }
.fr-row span { font-size: 8em; white-space: nowrap; }
.fr-row .fr-name { flex: 1; overflow: hidden; text-overflow: ellipsis; max-width: 9em; }
.fr-row.me span { color: #ffd75e; }
.fr-cam { left: 5em; bottom: 5em; display: flex; align-items: flex-end; gap: 4em; }
.fr-cam video { width: 44em; height: 33em; object-fit: cover; transform: scaleX(-1); border: 1em solid #f4f4f4; background: #101020; image-rendering: pixelated; }
.fr-cam span { font-size: 7em; text-shadow: 1px 1px 0 #101020, -1px 0 0 #101020, 0 -1px 0 #101020; }
.fr-center { left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; min-width: 190em; padding: 6em 8em; }
.fr-center h2 { font-size: 14em; margin: 0 0 0.5em; color: #ffd75e; font-weight: normal; }
.fr-center p { font-size: 8em; margin: 0.5em 0; line-height: 1.35; white-space: nowrap; }
.fr-center p.dim { color: #b8c0d8; }
.fr-center table { width: 100%; border-collapse: collapse; font-size: 8em; }
.fr-center td { padding: 0.3em 0.4em; text-align: left; white-space: nowrap; }
.fr-center td.num { text-align: right; }
.fr-center tr.win td { color: #ffd75e; }
.fr-center tr.me td:nth-child(2)::after { content: ' (나)'; }
`;

function el(tag, cls, parent) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (parent) parent.appendChild(node);
  return node;
}

export class FruitScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.duration = this.opt.duration ?? 60;
    this.countdown = this.opt.countdown ?? 3;
    this.meId = me ? me.id : null;
    this.players = players.map((p) => {
      const animal = ANIMALS[p.character] || animalForIndex(p.index ?? 0);
      return { id: p.id, name: p.name, color: animal.color, isMe: p.id === this.meId };
    });

    // 던질 물체 목록
    this.objects = (this.opt.objects || []).map((row) => {
      const o = {};
      OBJECT_KEYS.forEach((k, i) => { o[k] = row[i]; });
      o.visual = VISUAL[o.def] || FRUITS[0];
      o.t0 = o.mode === 2 ? null : o.t;      // 던지는 시각 (mode 2 는 아이템을 벤 뒤에 정해진다)
      o.cut = false;
      o.rot0 = rand(-0.5, 0.5);
      o.spin = rand(-PHYSICS.SPIN_MAX, PHYSICS.SPIN_MAX) * (o.kind === 'bomb' ? 0.5 : o.kind === 'item' ? 0.4 : 1);
      o.age0 = rand(0, 1);
      o.cx = 0;
      o.cy = 0;
      return o;
    });
    this.byId = new Map(this.objects.map((o) => [o.id, o]));
    this.live = [];

    // 내 판 상태 (점수는 서버가 알려 준 값)
    this.score = 0;
    this.doubleFrom = -1;
    this.doubleUntil = -1;
    this.triples = [];
    this.lastCut = { x: VIEW.W / 2, y: 70 };
    this.timers = [];           // { at(게임 시각), fn }
    this.outgoing = [];
    this.lastFlush = 0;
    this.done = new Set();      // 한 번만 할 일
    this.lastSnap = null;

    this.assets = null;
    this.pieces = [];
    this.shake = 0;
    this.flash = { color: 12, t: 0, max: 1 };
    this.swingCooldown = 0;
    this.clock = 0;
    this.pop = 0;
    this._destroyed = false;
    this._hud = {};

    this._buildDom();
    this.audio = createAudio();
    this.sfx = this.audio.sfx;
    this.music = this.audio.music;
    this.input = new InputManager(this.canvas);
    this.input.onUserGesture = () => this.audio.engine.unlock();
    this.effects = new Effects();
    this.blade = new Blade();

    this._onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.audio.engine.unlock();
      if (e.code === 'KeyM' && !e.repeat) this.audio.engine.setMuted(!this.audio.engine.muted);
    };
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
    try { this.audio.engine.unlock(); } catch (e) { /* 첫 입력 때 켜진다 */ }
    // 손 인식(카메라)은 바로 켜 본다. 실패해도 마우스로 할 수 있다.
    if (this.meId) this.input.motion.start(this.video);
  }

  async init() {
    this.assets = await loadAssets();
    if (this._destroyed) return;
    this.background = new Background(this.assets);
    this._last = performance.now();
    this._acc = 0;
    const loop = (ts) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(TIMING.MAX_FRAME_DT, (ts - this._last) / 1000);
      this._last = ts;
      this._frame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.music.stop();
    this.input.destroy();
    const ctx = this.audio.engine.ctx;
    if (ctx) ctx.close().catch(() => {});
    this.root.remove();
    this.styleEl.remove();
  }

  // ------------------------------------------------------------
  _buildDom() {
    this.styleEl = el('style', '', document.head);
    this.styleEl.textContent = CSS;
    this.root = el('div', 'fr-root', this.container);
    this.wrap = el('div', 'fr-wrap', this.root);
    this.canvas = el('canvas', '', this.wrap);
    this.canvas.width = VIEW.W;
    this.canvas.height = VIEW.H;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    const ui = el('div', 'fr-ui', this.wrap);
    this.ui = ui;
    const score = el('div', 'fr-box fr-score', ui);
    el('div', 'fr-label', score).textContent = 'SCORE';
    this.scoreEl = el('div', 'fr-value', score);
    this.timeBox = el('div', 'fr-box fr-time', ui);
    this.timeEl = el('div', 'fr-value', this.timeBox);
    this.buffsEl = el('div', 'fr-buffs', ui);
    this.boardEl = el('div', 'fr-box fr-board', ui);
    const cam = el('div', 'fr-cam', ui);
    this.video = el('video', '', cam);
    this.video.muted = true;
    this.video.playsInline = true;
    this.camText = el('span', '', cam);
    this.centerEl = el('div', 'fr-box fr-center', ui);
    this.autoHeight = this.container.clientHeight === 0;
  }

  _fit() {
    const w = this.root.clientWidth || VIEW.W * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / VIEW.W, h / VIEW.H))));
    this.wrap.style.width = `${VIEW.W * s}px`;
    this.wrap.style.height = `${VIEW.H * s}px`;
    this.ui.style.fontSize = `${s}px`;      // 1em = 논리 픽셀 1칸
    if (this.autoHeight) this.root.style.height = `${VIEW.H * s}px`;
  }

  _set(key, node, value) {
    if (this._hud[key] === value) return false;
    this._hud[key] = value;
    node.textContent = value;
    return true;
  }

  _once(key, fn) {
    if (this.done.has(key)) return;
    this.done.add(key);
    fn();
  }

  // ------------------------------------------------------------
  get mult() {
    return this.gt >= this.doubleFrom && this.gt < this.doubleUntil ? ITEMS.DOUBLE_MULT : 1;
  }

  get tripleUntil() {
    let until = -1;
    for (const [a, b] of this.triples) if (this.gt >= a && this.gt < b) until = Math.max(until, b);
    return until;
  }

  _visible(o) {
    if (o.t0 === null) return false;
    if (o.mode === 1) return this.triples.some(([a, b]) => a <= o.t0 && o.t0 < b);
    return true;
  }

  /** 다시 접속했을 때 서버가 알려 주는 내 판 정보 */
  _applyMe(me) {
    for (const id of me.cut || []) {
      const o = this.byId.get(id);
      if (o) o.cut = true;
    }
    this.doubleFrom = me.doubleFrom ?? -1;
    this.doubleUntil = me.doubleUntil ?? -1;
    this.triples = (me.triples || []).map((w) => [w[0], w[1]]);
    for (const [id, act] of Object.entries(me.bursts || {})) this._startBurst(Number(id), act);
  }

  _startBurst(itemId, act) {
    for (const o of this.objects) {
      if (o.mode === 2 && o.group === itemId && act + o.t < this.duration) o.t0 = act + o.t;
    }
  }

  _frame(dt) {
    const s = this.net.snap;
    this.clock += dt;
    if (s && s !== this.lastSnap) {
      this.lastSnap = s;
      if (s.me) this._applyMe(s.me);
      const mine = this.meId && s.players && s.players[this.meId];
      if (mine) this.score = mine.score;
    }
    this.gt = s ? this.net.now() - s.startAt : -999;
    const gt = this.gt;
    const playing = !!s && gt >= 0 && gt < this.duration;

    // 지금 떠 있는 물체
    this.live.length = 0;
    if (s && gt >= 0) {
      for (const o of this.objects) {
        if (o.cut || !this._visible(o)) continue;
        const age = gt - o.t0;
        if (age < 0 || age > o.life) continue;
        const [x, y] = posAt(o, age);
        o.cx = x;
        o.cy = y;
        o.age = age;
        this.live.push(o);
      }
    }

    this._processInput(playing);
    for (const e of this.net.takeEvents()) this._handleEvent(e);
    this._flow(s, gt, playing, dt);

    // 연출 갱신
    this.swingCooldown -= dt;
    this.shake = Math.max(0, this.shake - JUICE.SHAKE_DECAY * dt);
    if (this.flash.t > 0) this.flash.t -= dt;
    const cursor = this.input.cursor;
    this.background.update(dt, cursor.visible ? cursor.x : VIEW.W / 2);
    const due = this.timers.filter((tm) => gt >= tm.at);
    this.timers = this.timers.filter((tm) => gt < tm.at);
    due.forEach((tm) => tm.fn());
    for (const p of this.pieces) p.update(dt);
    this.pieces = this.pieces.filter((p) => p.alive);
    this.effects.update(dt);

    this._render(s, gt);
    this._updateHud(s, gt);
  }

  // ---------------- 입력 → 베기 ----------------
  _processInput(playing) {
    const perfNow = performance.now() / 1000;
    for (const p of this.input.drain()) {
      const seg = this.blade.add(p);
      if (!seg) continue;
      if (seg.speed > BLADE.SWING_SOUND_SPEED && this.swingCooldown <= 0) {
        this.sfx.swing();
        this.swingCooldown = BLADE.SWING_SOUND_COOLDOWN;
      }
      if (!playing || !this.meId || seg.speed < BLADE.MIN_SLICE_SPEED) continue;
      // 이 점이 찍힌 게임 시각 (입력이 한 프레임쯤 늦게 처리되므로 그만큼 과거)
      const t1 = this.gt - Math.max(0, perfNow - p.t);
      const len = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
      if (len <= 0) continue;
      const t0 = t1 - len / seg.speed;
      // 화면 반응용 예측: 서버와 같은 식으로 그 시각의 위치와 비교한다
      for (const o of this.live) {
        if (o.cut) continue;
        const age = t1 - o.t0;
        if (age < 0 || age > o.life) continue;
        const [x, y] = posAt(o, age);
        if (distToSegment(x, y, seg.x0, seg.y0, seg.x1, seg.y1) <= o.r) this._sliceVisual(o, seg.x1 - seg.x0, seg.y1 - seg.y0);
      }
      const r1 = (v) => Math.round(v * 10) / 10;
      const r3 = (v) => Math.round(v * 1000) / 1000;
      this.outgoing.push([r3(t0), r1(seg.x0), r1(seg.y0), r3(t1), r1(seg.x1), r1(seg.y1)]);
    }
    this.blade.update(perfNow);
    if (this.outgoing.length && (perfNow - this.lastFlush >= 0.05 || this.outgoing.length >= 40)) {
      this.lastFlush = perfNow;
      while (this.outgoing.length) this.net.cut(this.outgoing.splice(0, 60));
    }
  }

  /** 베는 모습(조각·과즙·폭발)과 소리. 점수는 건드리지 않는다. */
  _sliceVisual(o, dx, dy) {
    o.cut = true;
    o.cutX = o.cx;
    o.cutY = o.cy;
    const len = Math.hypot(dx, dy) || 1;
    if (o.kind === 'bomb') {
      this.sfx.sliceBomb();
      this.sfx.explode();
      this.effects.explosion(o.cx, o.cy);
      this.shake = JUICE.SHAKE_BOMB;
      this.flash = { color: 12, t: JUICE.FLASH_BOMB, max: JUICE.FLASH_BOMB };
      return;
    }
    const rot = o.rot0 + o.spin * o.age;
    const qa = quantizeAngle(rot);
    const cos = Math.cos(-qa);
    const sin = Math.sin(-qa);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const { halves, normal } = makeHalves(this._image(o), lx, ly, o.visual.flesh);
    const wnx = normal[0] * Math.cos(qa) - normal[1] * Math.sin(qa);
    const wny = normal[0] * Math.sin(qa) + normal[1] * Math.cos(qa);
    const vy = o.vy + PHYSICS.GRAVITY * o.age;
    halves.forEach((img, i) => {
      const sgn = i === 0 ? 1 : -1;
      this.pieces.push(new Piece(
        img, o.cx + wnx * sgn * 2, o.cy + wny * sgn * 2,
        o.vx * 0.6 + wnx * sgn * PHYSICS.HALF_SPLIT_SPEED + (dx / len) * 20,
        Math.min(vy, 0) * 0.4 + wny * sgn * PHYSICS.HALF_SPLIT_SPEED - 20,
        rot, sgn * rand(3, 6),
      ));
    });
    this.effects.juice(o.cx, o.cy, o.visual.juice, JUICE.PARTICLES_FRUIT, dx / len, dy / len);
    this.effects.splat(o.cx + rand(-6, 6), o.cy + rand(-4, 4), o.visual.juice[0]);
    if (o.kind === 'item') {
      this.sfx.sliceItem();
      this.effects.sparkle(o.cx, o.cy, [12, 4, 11]);
      this.effects.ring(o.cx, o.cy, 12, 140, 0.3);
      this.shake = Math.max(this.shake, JUICE.SHAKE_ITEM);
    } else {
      this.sfx.sliceFruit(this.comboShown || 0);
      this.comboShown = (this.comboShown || 0) + 1;
      this.comboShownAt = this.clock;
      this.shake = Math.max(this.shake, JUICE.SHAKE_FRUIT);
    }
  }

  // ---------------- 서버 판정 결과 ----------------
  _handleEvent(e) {
    if (e.type === 'slice') {
      const o = this.byId.get(e.id);
      if (!o) return;
      if (!o.cut) {
        // 예측하지 못한 베기 — 지금 위치에서 베는 모습을 보여 준다
        if (o.t0 === null) o.t0 = this.gt;
        o.age = Math.max(0, this.gt - o.t0);
        [o.cx, o.cy] = posAt(o, Math.min(o.age, o.life));
        this._sliceVisual(o, 1, 0.3);
      }
      this.score = e.score;
      const x = o.cutX ?? VIEW.W / 2;
      const y = o.cutY ?? 70;
      if (e.kind === 'fruit') {
        this.lastCut = { x, y };
        this.effects.popup(`+${e.pts}`, x, y - 10, e.pts > basePoints(o) ? 4 : 12);
      } else if (e.kind === 'bomb') {
        this.effects.popup(e.pts < 0 ? `${e.pts}` : 'BOMB!', x, y - 12, 2, 2);
        this.comboShown = 0;
      } else {
        const act = e.t + ITEMS.ACTIVATE_DELAY;
        if (o.def === 'double') {
          this.doubleFrom = act;
          this.doubleUntil = act + ITEMS.DOUBLE_TIME;
          this.timers.push({ at: act, fn: () => {
            this.sfx.activateDouble();
            this.effects.popup('x2 SCORE!', VIEW.W / 2, 60, 4, 2, 1.2);
            this.flash = { color: 4, t: JUICE.FLASH_ITEM, max: JUICE.FLASH_ITEM };
            this.effects.ring(x, y, 4, 220, 0.4);
          } });
        } else {
          this.triples.push([act, act + ITEMS.TRIPLE_TIME]);
          this._startBurst(o.id, act);
          this.timers.push({ at: act, fn: () => {
            this.sfx.activateTriple();
            this.effects.popup('FRUIT x3!', VIEW.W / 2, 60, 11, 2, 1.2);
            this.flash = { color: 11, t: JUICE.FLASH_ITEM, max: JUICE.FLASH_ITEM };
            this.effects.ring(x, y, 11, 220, 0.4);
          } });
        }
      }
    } else if (e.type === 'combo') {
      this.score = e.score;
      const x = Math.min(VIEW.W - 50, Math.max(50, this.lastCut.x));
      this.effects.popup(`${e.n} COMBO +${e.bonus}`, x, Math.max(30, this.lastCut.y - 22), 4, 2, 1);
      this.sfx.combo(e.n);
    }
  }

  // ---------------- 진행(소리·연출) ----------------
  _flow(s, gt, playing, dt) {
    if (!s) return;
    if (this.comboShown && this.clock - this.comboShownAt > 0.4) this.comboShown = 0;
    if (gt >= -this.countdown && gt < 0) {
      const n = Math.ceil(-gt);
      if (n !== this.shownCount) {
        this.shownCount = n;
        this.pop = 0;
        this.sfx.countdown();
      }
      this.pop += dt;
    } else if (playing) {
      this._once('go', () => {
        if (gt < 1.5) {
          this.sfx.go();
          this.effects.popup('GO!', VIEW.W / 2, 74, 4, 5, 0.7);
        }
        this.music.setHurry(false);
        this.music.play('play');
      });
      const sec = Math.ceil(this.duration - gt);
      if (sec <= WARNING_TIME && sec > 0 && sec !== this.lastTick) {
        this.lastTick = sec;
        this.sfx.tick();
        this._once('hurry', () => this.music.setHurry(true));
      }
    } else if (gt >= this.duration) {
      this._once('timeup', () => {
        this.music.stop();
        if (gt < this.duration + 2) this.sfx.timeUp();
        this.endShown = 0;
      });
      this.endShown = (this.endShown || 0) + dt;
      if (s.results) this._once('final', () => this.sfx.clear());
    }
  }

  // ---------------- 그리기 ----------------
  _image(o) {
    if (o.kind === 'item') return this.assets.frame(o.visual.sprite, o.age0 + o.age, TIMING.ANIM_FPS);
    return this.assets.frame(o.visual.sprite, o.age0 + o.age, TIMING.ANIM_FPS / 4);
  }

  _drawObject(ctx, o) {
    const rot = o.rot0 + o.spin * o.age;
    // 던져질 때 세로로 늘어났다가 원래대로 (스쿼시 & 스트레치)
    const k = Math.exp(-7 * o.age);
    const opts = { rot, sx: 1 - 0.2 * k, sy: 1 + 0.25 * k };
    if (o.kind === 'bomb') {
      drawSprite(ctx, this.assets.frame('bomb', o.age0 + o.age, TIMING.ANIM_FPS / 3), o.cx, o.cy, opts);
      const fx = o.cx + 4.5 * Math.cos(rot) + 8.5 * Math.sin(rot);
      const fy = o.cy + 4.5 * Math.sin(rot) - 8.5 * Math.cos(rot);
      drawSprite(ctx, this.assets.frame('spark', o.age0 + o.age, TIMING.ANIM_FPS * 1.2), fx, fy);
    } else {
      drawSprite(ctx, this._image(o), o.cx, o.cy, opts);
    }
  }

  _render(s, gt) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const day = s ? Math.max(0, Math.min(1, gt / this.duration)) : 0;
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.round(rand(-1, 1) * this.shake), Math.round(rand(-1, 1) * this.shake));
    ctx.fillStyle = PALETTE[0];
    ctx.fillRect(-10, -10, VIEW.W + 20, VIEW.H + 20);
    this.background.drawBack(ctx, day);
    this.effects.drawSplats(ctx);
    for (const p of this.pieces) p.draw(ctx);
    for (const o of this.live) if (!o.cut) this._drawObject(ctx, o);
    this.effects.drawParticles(ctx, this.clock);
    this.background.drawFront(ctx, day);
    this.blade.draw(ctx, performance.now() / 1000, this.mult > 1);
    this.effects.drawPopups(ctx);
    ctx.restore();
    if (this.flash.t > 0) ditherRect(ctx, 0, 0, VIEW.W, VIEW.H, this.flash.color, (this.flash.t / this.flash.max) * 0.7, 2);

    if (s && gt >= -this.countdown && gt < 0 && this.shownCount) {
      const scale = this.pop < 0.08 ? 8 : 6;
      drawText(ctx, String(this.shownCount), VIEW.W / 2, VIEW.H / 2 - (scale * 5) / 2, { color: 12, scale, align: 'center' });
    }
    if (s && gt >= this.duration && !s.results) {
      const scale = (this.endShown || 0) < 0.1 ? 6 : 4;
      drawText(ctx, 'TIME UP!', VIEW.W / 2, VIEW.H / 2 - scale * 2.5, { color: 4, scale, align: 'center' });
    }
    if (s && s.results) ditherRect(ctx, 0, 0, VIEW.W, VIEW.H, 0, 0.5, 1);

    const c = this.input.cursor;
    if (c.visible) {
      const name = c.source === 'motion' ? (c.active ? 'handActive' : 'handIdle') : 'bladeTip';
      drawSprite(ctx, this.assets.get(name).frames[0], c.x, c.y);
    }
  }

  // ---------------- HUD (DOM) ----------------
  _updateHud(s, gt) {
    const m = this.input.motion;
    const camLabel = !this.meId ? '관전 중'
      : m.status === 'ready' ? (m.cursor.visible ? '손 인식 중' : '손을 카메라에 보여 주세요')
        : m.status === 'loading' ? '손 인식 준비 중… (카메라 권한을 허용해 주세요)'
          : m.status === 'error' ? `${m.message} — 마우스로 할 수 있어요` : '마우스로 그어서 베기';
    this._set('cam', this.camText, camLabel);
    const showVideo = m.status === 'ready' ? '' : 'none';
    if (this.video.style.display !== showVideo) this.video.style.display = showVideo;

    const final = !!(s && s.results);
    const intro = !s || gt < -this.countdown;
    const inGame = !!s && !intro && !final;
    const show = (node, on) => {
      const v = on ? '' : 'none';
      if (node.style.display !== v) node.style.display = v;
    };
    show(this.scoreEl.parentNode, inGame && !!this.meId);
    show(this.timeBox, inGame);
    show(this.boardEl, inGame);
    show(this.buffsEl, inGame);
    show(this.centerEl, intro || final);

    if (inGame) {
      this._set('score', this.scoreEl, String(this.score));
      const left = Math.max(0, Math.min(this.duration, Math.ceil(this.duration - Math.max(0, gt))));
      this._set('time', this.timeEl, String(left));
      const warn = gt >= 0 && left <= WARNING_TIME;
      if (this.timeBox.classList.contains('warn') !== warn) this.timeBox.classList.toggle('warn', warn);

      const d = gt < this.doubleUntil && gt >= this.doubleFrom ? Math.ceil(((this.doubleUntil - gt) / ITEMS.DOUBLE_TIME) * 20) : 0;
      const tu = this.tripleUntil;
      const t = tu > 0 ? Math.ceil(((tu - gt) / ITEMS.TRIPLE_TIME) * 20) : 0;
      const key = `${d}:${t}`;
      if (this._hud.buffs !== key) {
        this._hud.buffs = key;
        const bar = (label, v, color) => (v > 0
          ? `<div class="fr-buff"><span>${label}</span><div class="fr-bar"><i style="width:${v * 5}%;background:${color}"></i></div></div>` : '');
        this.buffsEl.innerHTML = bar('점수 x2', d, PALETTE[4]) + bar('과일 x3', t, PALETTE[11]);
      }

      const rows = this.players.map((p) => ({ p, score: p.isMe ? this.score : ((s.players[p.id] || {}).score || 0) }));
      rows.sort((a, b) => b.score - a.score);
      const bkey = rows.map((r) => `${r.p.id}:${r.score}`).join('|');
      if (this._hud.board !== bkey) {
        this._hud.board = bkey;
        this.boardEl.textContent = '';
        for (const r of rows) {
          const row = el('div', `fr-row${r.p.isMe ? ' me' : ''}`, this.boardEl);
          el('b', '', row).style.background = r.p.color;
          el('span', 'fr-name', row).textContent = r.p.name;
          el('span', '', row).textContent = String(r.score);
        }
      }
    }

    if (intro) {
      if (this._hud.center !== 'intro') {
        this._hud.center = 'intro';
        this.centerEl.innerHTML = '<h2>과일자르기</h2>'
          + `<p>${this.duration}초 동안 과일을 베어 점수를 모으세요</p>`
          + '<p>마우스를 누른 채 긋거나</p><p>카메라 앞에서 검지를 빠르게 휘두르세요</p>'
          + '<p>3개 이상 연속으로 베면 콤보 · 폭탄은 -20점</p>'
          + '<p class="dim">모두에게 같은 과일이 나옵니다</p>';
      }
    } else if (final) {
      if (this._hud.center !== 'final') {
        this._hud.center = 'final';
        this.centerEl.textContent = '';
        const winners = s.results.filter((r) => r.isWinner);
        el('h2', '', this.centerEl).textContent = winners.length === 1 ? `${winners[0].name} 우승!` : '공동 우승!';
        const table = el('table', '', this.centerEl);
        for (const r of s.results) {
          const tr = el('tr', `${r.isWinner ? 'win' : ''}${r.playerId === this.meId ? ' me' : ''}`, table);
          el('td', '', tr).textContent = `${r.rank}위`;
          el('td', '', tr).textContent = r.name;
          const st = r.stats || {};
          el('td', '', tr).textContent = `과일 ${st.sliced ?? 0} · 폭탄 ${st.bombs ?? 0} · 최대 콤보 ${st.maxCombo ?? 0}`;
          el('td', 'num', tr).textContent = `${r.score}점`;
        }
      }
    }
  }
}

const POINTS = Object.fromEntries(DEFAULT_CONFIG.FRUITS.map((f) => [f.id, f.points]));
function basePoints(o) {
  return POINTS[o.def] ?? 0;
}
