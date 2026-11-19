// =============================================================
// PingpongScreen — 잭팟 탁구왕 화면 (서버가 보낸 상태를 그린다)
//
// - 판정 · 점수 · 진행은 모두 서버(또는 시험용 진행기)가 한다. 여기서는 누르고 있는 키만 보낸다.
// - 그림은 원본 js/match.js 의 render(홀 · 탁구대 · 선수 · 공 · 점수판 · 조작키 띠)를 그대로 옮겼다.
// - 서버 상태는 초당 30번 온다. 공은 두 상태 사이를 같은 물리식(sim/rules.js Ball.step)으로 이어 그려
//   60Hz 이상 화면에서도 매끄럽게 보인다(화면은 서버보다 INTERP_DELAY 만큼 늦게 그린다).
// - 내 캐릭터는 항상 화면 왼쪽에 보인다(오른쪽 자리를 받았으면 화면만 좌우로 뒤집는다).
// =============================================================
import { CONFIG, LOGIC_FPS } from '../sim/config.js';
import { Ball } from '../sim/rules.js';
import { C, PALETTE } from './palette.js';
import { BitmapFont, KText, drawPanel, dimScreen, loadFonts } from './text.js';
import { loadSprites, characterOf, CHARACTER_COLORS, drawFaceChip, getKeycap } from './sprites.js';
import { Hall } from './hall.js';
import { ParticleSystem } from './particles.js';
import { AudioManager } from './audio.js';
import { BallView, PaddlerView } from './views.js';

const W = CONFIG.WIDTH;
const H = CONFIG.HEIGHT;
const STEP_MS = 1000 / 60;
/** 화면이 서버보다 늦게 그리는 시간(초). 이 사이에 다음 상태가 도착해 그 사이를 이어 그릴 수 있다 */
const INTERP_DELAY = 0.08;
/** 해설 한 줄을 보여 주는 시간(프레임) */
const SAY_FRAMES = 240;

/** 키보드 → 조작 비트 (1 후진, 2 전진, 4 치기). 내 캐릭터는 항상 왼쪽이므로 → 가 전진(탁구대 쪽)이다 */
const KEY_BITS = {
  ArrowLeft: 1, KeyA: 1,
  ArrowRight: 2, KeyD: 2,
  Space: 4, Enter: 4, ArrowUp: 4, KeyZ: 4,
};
const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

/** 득점 이유(서버 코드) → 화면 글씨 (원본 문구) */
const REASON_TEXT = {
  serveFault: '서브 실수', ownCourt: '내 코트', smash: '스매시!', unreturned: '못 받음',
  net: '네트!', missed: '놓침', out: '아웃!',
};
const POPUPS = {
  oops: { text: '앗!', color: 'j' },
  nice: { text: '나이스!', color: 'e' },
  smash: { text: '스매시!', color: '9' },
};

export class PingpongScreen {
  /** @param ctx { session, run, players: [{id, name, index, character}], me: {id}, options } */
  constructor(container, ctx) {
    this.session = ctx.session;
    this.run = ctx.run;
    this.options = ctx.options || {};
    this.meId = ctx.me && ctx.me.id;
    this.players = new Map(ctx.players.map((p) => {
      const ch = characterOf(p);
      return [p.id, { id: p.id, name: p.name, character: ch, color: C(CHARACTER_COLORS[ch]), spr: null, isMe: p.id === this.meId }];
    }));

    // ---- 캔버스 (320×180 을 정수 배율로 확대) ----
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
    this.g = this.canvas.getContext('2d', { alpha: false });
    this.g.imageSmoothingEnabled = false;
    this.autoHeight = container.clientHeight === 0;
    this._onResize = () => this._fit();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();

    // ---- 화면 상태 ----
    this.audio = new AudioManager();
    this.hall = null;                 // 글꼴 · 그림을 불러온 뒤 만든다
    this.particles = new ParticleSystem();
    this.ballView = new BallView();
    this.fighters = [new PaddlerView(0), new PaddlerView(1)];
    this.frame = 0;                   // 화면 쪽 프레임(연출용)
    this.snap = null;                 // 서버가 보낸 가장 최근 상태
    this.buf = [];                    // 이번 라운드 경기 상태 기록 [{ t(서버 시각), data }]
    this.queue = [];                  // 아직 화면에 반영하지 않은 사건 [{ at, ev }]
    this.sceneKey = '';
    this.matchIdx = 0;                // 내가 보는 경기 번호
    this.playing = false;             // 내가 이 경기의 선수인가(쉬는 사람은 관전)
    this.flip = false;                // 화면을 좌우로 뒤집어 그리는가(내가 오른쪽 자리일 때)
    this.vm = null;                   // 지금 그릴 경기 상태
    this.banner = null;               // 가운데 알림 { text, sub, color, t, serve }
    this.say = null;                  // 해설 { text, who, ai, t }
    this.verdict = null;              // AI 총평 { headline, mvp, cheer }
    this.shake = 0;
    this.rallyPop = 0;
    this.muteNotice = 0;
    this.sceneT = 0;
    this.held = 0;                    // 지금 누르고 있는 키 비트
    this.sentHeld = 0;
    this.pressHit = false;
    this._destroyed = false;
    this._raf = 0;

    // ---- 세션 구독 ----
    const last = this.session.lastState;
    if (last && last.run === this.run && last.data) this._onState(last.data);
    this._off = [
      this.session.on('game.state', (m) => { if (m && m.run === this.run && m.data) this._onState(m.data); }),
      this.session.on('game.event', (m) => { if (m && m.run === this.run && m.data) this._onEvent(m.data); }),
    ];

    // ---- 키보드 ----
    this._keyDown = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (PREVENT.has(e.code)) e.preventDefault();
      this.audio.unlock();
      if (e.repeat) return;
      if (e.code === 'KeyM') {
        this.audio.toggleMute();
        this.muteNotice = 90;
      }
      const bit = KEY_BITS[e.code];
      if (!bit) return;
      this._keys.add(e.code);
      if (bit === 4) this.pressHit = true;
      this._readKeys();
    };
    this._keyUp = (e) => {
      this._keys.delete(e.code);
      this._readKeys();
    };
    this._blur = () => {
      this._keys.clear();
      this._readKeys();
    };
    this._mouse = () => this.audio.unlock();
    this._keys = new Set();
    window.addEventListener('keydown', this._keyDown);
    window.addEventListener('keyup', this._keyUp);
    window.addEventListener('blur', this._blur);
    window.addEventListener('mousedown', this._mouse);
    // 대기실에서 이미 클릭했으므로 소리를 바로 켤 수 있다 (안 되면 첫 키 입력 때 켜진다)
    try { this.audio.unlock(); } catch (e) { /* 무시 */ }
  }

  /** 글꼴 · 캐릭터 그림을 불러온 뒤 그리기 시작 */
  async init() {
    const [, sprites] = await Promise.all([loadFonts(), loadSprites()]);
    if (this._destroyed) return;
    this.sprites = sprites;
    for (const p of this.players.values()) p.spr = sprites.players[p.character];
    this.hall = new Hall();
    this._applySides();
    let last = performance.now();
    let acc = 0;
    const loop = (now) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      acc += Math.min(250, now - last);   // 탭 전환 후 폭주 방지
      last = now;
      while (acc >= STEP_MS) {
        this._tick();
        acc -= STEP_MS;
      }
      this._render();
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    for (const off of this._off) off();
    this._off = [];
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    window.removeEventListener('keydown', this._keyDown);
    window.removeEventListener('keyup', this._keyUp);
    window.removeEventListener('blur', this._blur);
    window.removeEventListener('mousedown', this._mouse);
    this.audio.dispose();
    this.root.remove();
  }

  // 창 크기에 맞춰 정수배로만 확대 (픽셀이 찌그러지지 않게)
  _fit() {
    const w = this.root.clientWidth || W * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / W, h / H))));
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${H * s}px`;
    if (this.autoHeight) this.root.style.height = `${H * s}px`;
  }

  _readKeys() {
    let bits = 0;
    for (const code of this._keys) bits |= KEY_BITS[code] || 0;
    this.held = bits;
  }

  // ------------------------------------------------------------
  // 서버 → 화면
  // ------------------------------------------------------------
  _onState(data) {
    if (this.snap && typeof data.now === 'number' && data.now < this.snap.now) return;   // 늦게 온 옛 상태
    const roundChanged = !this.snap || this.snap.round !== data.round;
    this.snap = data;
    if (data.verdict) this.verdict = data.verdict;
    if (roundChanged) {
      this.buf = [];
      this._applySides();
    }
    if (data.phase === 'fight' && data.duels && data.duels.length) {
      const t = data.startAt + data.simFrame / LOGIC_FPS;   // 이 상태가 나타내는 서버 시각
      const lastBuf = this.buf[this.buf.length - 1];
      if (!lastBuf || t > lastBuf.t) this.buf.push({ t, data });
      if (this.buf.length > 8) this.buf.shift();
    }
  }

  _onEvent(ev) {
    if (ev.type === 'verdict') {
      this.verdict = { headline: ev.headline, mvp: ev.mvp, cheer: ev.cheer };
      return;
    }
    // 화면이 서버보다 조금 늦게 그리므로, 사건도 그만큼 늦춰서 공 위치와 맞춘다
    this.queue.push({ at: this.session.now() + INTERP_DELAY * 0.6, ev });
    if (this.queue.length > 300) this.queue.splice(0, this.queue.length - 300);
  }

  /** 이번 라운드에 내가 볼 경기와 좌우 자리를 정한다 */
  _applySides() {
    const s = this.snap;
    const matches = (s && s.matches) || [];
    let idx = matches.findIndex((m) => m.a === this.meId || m.b === this.meId);
    this.playing = idx >= 0;
    if (idx < 0) idx = 0;                     // 쉬는 사람은 첫 경기를 관전
    this.matchIdx = idx;
    const m = matches[idx];
    this.flip = !!m && m.b === this.meId;
    if (!m) return;
    const ids = this.flip ? [m.b, m.a] : [m.a, m.b];
    ids.forEach((id, i) => {
      const p = this.players.get(id);
      const f = this.fighters[i] = new PaddlerView(i);
      if (p) {
        f.name = p.name;
        f.color = p.color;
        f.spr = p.spr;
      }
    });
  }

  /** 서버 쪽 자리(0 왼쪽 / 1 오른쪽) → 화면 자리 */
  _side(side) {
    return this.flip ? 1 - side : side;
  }

  // ------------------------------------------------------------
  // 60분의 1초마다
  // ------------------------------------------------------------
  _tick() {
    this.frame++;
    this.sceneT++;
    if (this.muteNotice > 0) this.muteNotice--;
    if (this.shake > 0) this.shake--;
    if (this.rallyPop > 0) this.rallyPop--;
    if (this.say && ++this.say.t > SAY_FRAMES) this.say = null;
    if (this.banner) this.banner.t++;
    const s = this.snap;
    if (!s || !this.hall) return;

    const key = `${s.phase}:${s.round}`;
    if (key !== this.sceneKey) this._enterScene(key, s);

    // 때가 된 사건을 화면에 반영
    const now = this.session.now();
    while (this.queue.length && this.queue[0].at <= now) this._applyEvent(this.queue.shift().ev);

    if (s.phase === 'fight') this._updateFight(now);
    else this.hall.update(this.frame, W / 2 + Math.sin(this.frame / 90) * 40);
    this.particles.update();
    if (s.phase === 'final' && this.frame % 4 === 0) {
      // 최종 결과: 색종이
      const cols = [C('9'), C('8'), C('5'), C('h'), C('e'), C('p')];
      this.particles.add(Math.random() * W, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 1);
    }
    this._sendInput(s);
  }

  _enterScene(key, s) {
    this.sceneKey = key;
    this.sceneT = 0;
    this.banner = null;
    this.shake = 0;
    this.particles.clear();
    if (s.phase === 'intro') {
      this.vm = null;
      this.queue = [];
      this.say = null;
      this.audio.playBgm('lobby');
      this.audio.sfx('select');
    } else if (s.phase === 'fight') {
      this.hall.excite = 0;
      this.audio.playBgm('game');
      this.audio.sfx('start');
    } else if (s.phase === 'result') {
      this.audio.playBgm('lobby');
    } else if (s.phase === 'final' || s.phase === 'done') {
      this.hall.excite = 99999;
      this.audio.playBgm('result');
      this.audio.sfx('win');
    }
  }

  /** 누르고 있는 키가 바뀌었으면 서버로 보낸다 (경기 중인 선수만) */
  _sendInput(s) {
    if (s.phase !== 'fight' || !this.playing) {
      this.sentHeld = 0;
      this.pressHit = false;
      return;
    }
    if (this.held === this.sentHeld && !this.pressHit) return;
    const data = { k: 'in', held: this.held };
    if (this.pressHit) data.press = ['hit'];
    this.session.sendInput(data);
    this.sentHeld = this.held;
    this.pressHit = false;
  }

  /** 지금 그릴 경기 상태(vm)를 서버 상태 두 개 사이에서 계산한다 */
  _updateFight(now) {
    const buf = this.buf;
    if (!buf.length) return;
    const rt = now - INTERP_DELAY;                 // 지금 그릴 서버 시각
    let i = buf.length - 1;
    while (i > 0 && buf[i].t > rt) i--;
    const A = buf[i];
    const B = buf[i + 1] || null;
    const a = A.data.duels[this.matchIdx];
    const b = B ? B.data.duels[this.matchIdx] : null;
    if (!a) return;
    const u = B ? Math.max(0, Math.min(1, (rt - A.t) / (B.t - A.t))) : 0;
    const late = B ? 0 : Math.max(0, Math.min(6, Math.floor((rt - A.t) * LOGIC_FPS)));   // 다음 상태가 아직 안 왔을 때
    const pos = ballBetween(a, b, u, late);
    const fx = (x) => (this.flip ? W - x : x);

    const bv = this.ballView;
    bv.x = fx(pos.x);
    bv.y = pos.y;
    bv.state = a.ball.state;
    bv.fast = a.ball.fast;
    bv.chance = a.ball.chance;
    bv.lastHitter = this._side(a.ball.lastHitter);
    bv.tick();

    const src = this.flip ? ['right', 'left'] : ['left', 'right'];
    const pts = this.flip ? [a.pts[1], a.pts[0]] : a.pts;
    this.vm = {
      frame: this.frame, state: a.state, stateT: a.stateT, rally: a.rally, pts,
      serverSide: this._side(a.server), winner: a.winner === null ? null : this._side(a.winner),
      ball: bv,
    };
    this.fighters.forEach((f, k) => {
      const pa = a[src[k]];
      const pb = b ? b[src[k]] : pa;
      f.x = fx(pa.x + (pb.x - pa.x) * u);
      f.vx = this.flip ? -pa.vx : pa.vx;
      f.state = pa.state;
      f.chargeT = pa.chargeT;
      f.swingT = pa.swingT;
      f.shot = pa.shot;
      f.pts = pts[k];
      f.tick(this.vm);
    });
    this.hall.update(this.frame, bv.state === 'held' ? W / 2 : bv.x);
  }

  /** 서버가 알려 준 사건 → 소리 · 불티 · 알림 */
  _applyEvent(ev) {
    if (ev.type === 'say') {
      if (ev.match === null || ev.match === undefined || ev.match === this.matchIdx) {
        this.say = { text: ev.text, who: ev.who || '해설자', ai: ev.source === 'gemini', t: 0 };
      }
      return;
    }
    if (ev.match !== this.matchIdx || !this.snap || this.snap.phase !== 'fight') return;
    const audio = this.audio;
    const fx = (x) => (this.flip ? W - x : x);
    switch (ev.type) {
      case 'serve':
        this.banner = { text: `${this.fighters[this._side(ev.side)].name} 서브`, color: 'a', t: 0, serve: true };
        break;
      case 'toss':
      case 'swing':
        audio.sfx('swing');
        break;
      case 'smashReady':
        audio.sfx('smashReady');
        break;
      case 'bounce':
        audio.sfx('pong');
        break;
      case 'net':
        audio.sfx('net');
        break;
      case 'floor':
        audio.sfx('floor');
        break;
      case 'hit': {
        // 손맛: 칠 때마다 작은 고리 + 불티, 스매시는 번쩍 고리 + 흔들림
        const x = fx(ev.x);
        const y = ev.y;
        const f = this.fighters[this._side(ev.side)];
        if (ev.shot === 'serve') this.banner = null;
        else this.rallyPop = 8;
        if (ev.popup && POPUPS[ev.popup]) f.popup = { ...POPUPS[ev.popup], t: 0 };
        audio.sfx('paddle', ev.smash ? 1 : 0);
        if (ev.smash) {
          this.shake = 10;
          this.particles.burst(x, y, 20, [C('9'), C('b'), C('8')], 2.2, 16, 1);
          this.particles.ring(x, y, 1.8, C('9'), 12);
          this.particles.ring(x, y, 3, C('b'), 8);
          this.hall.excite = Math.max(this.hall.excite, 40);
        } else {
          this.particles.burst(x, y, 6, [C('b'), C('k')], 1, 10, 1);
          this.particles.ring(x, y, 0.9, C('b'), 6);
        }
        // 랠리가 길어지면 관중 환호
        if (ev.rally >= 6 && ev.rally % 6 === 0) {
          this.hall.excite = Math.max(this.hall.excite, 50);
          audio.sfx('point');
        }
        break;
      }
      case 'point': {
        const side = this._side(ev.side);
        const f = this.fighters[side];
        this.hall.excite = ev.reason === 'smash' || ev.rally >= 8 ? 90 : 40;
        audio.sfx('point');
        this.particles.text(f.x, CONFIG.FLOOR_Y - 70, '+1', C('9'), { life: 50, scale: 2 });
        this.banner = { text: `${f.name} 득점!`, sub: REASON_TEXT[ev.reason] || '', color: side === 0 ? '5' : 'h', t: 0 };
        break;
      }
      case 'end': {
        const side = this._side(ev.winner);
        const w = this.fighters[side];
        this.hall.excite = 200;
        this.banner = { text: '게임 셋!', sub: `${w.name} 승리 (${ev.pts[ev.winner]}:${ev.pts[1 - ev.winner]})`, color: '9', t: 0 };
        audio.sfx('win');
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------
  // 그리기
  // ------------------------------------------------------------
  _render() {
    const ctx = this.g;
    ctx.fillStyle = PALETTE.o;
    ctx.fillRect(0, 0, W, H);
    const s = this.snap;
    if (!s || !this.hall) {
      BitmapFont.draw(ctx, 'LOADING', W / 2, 86, C('j'), { align: 'center' });
      return;
    }
    if (s.phase === 'fight' && this.vm) this._renderFight(ctx, s);
    else if (s.phase === 'result') this._renderRoundResult(ctx, s);
    else if (s.phase === 'final' || s.phase === 'done') this._renderFinal(ctx, s);
    else this._renderIntro(ctx, s);
    if (this.muteNotice > 0) {
      const txt = this.audio.muted ? '소리 끔' : '소리 켬';
      drawPanel(ctx, W - 60, H - 26, 54, 20, 'dark');
      KText.draw(ctx, txt, W - 33, H - 22, C('a'), { align: 'center', font: 's' });
    }
  }

  // ---- 경기 (원본 Match.render) ----
  _renderFight(ctx, s) {
    const vm = this.vm;
    ctx.save();
    if (this.shake > 0) {
      const m = Math.min(2, Math.ceil(this.shake / 4));
      ctx.translate(Math.round((Math.random() * 2 - 1) * m), Math.round((Math.random() * 2 - 1) * m));
    }
    this.hall.renderBack(ctx, this.frame, 1);
    this.hall.renderTable(ctx);
    this.fighters.forEach((f) => f.render(ctx, vm));
    this.ballView.render(ctx);
    this.hall.renderNet(ctx);
    this.particles.render(ctx);
    ctx.restore();
    this._renderHUD(ctx, s, vm);
    this._renderKeyBar(ctx);
    this._renderOverlay(ctx, s, vm);
  }

  /** 한 점만 더 따면 이기는 쪽(화면 자리). 없으면 -1 */
  _matchPoint(pts) {
    const G = this.options.gamePoints || CONFIG.GAME_POINTS;
    const cap = this.options.deuceCap || CONFIG.DEUCE_CAP;
    for (let i = 0; i < 2; i++) {
      const p = pts[i];
      const o = pts[1 - i];
      if ((p + 1 >= G && p + 1 - o >= 2) || p + 1 >= cap) return i;
    }
    return -1;
  }

  // 위: 이름 + 큰 점수 + 서브 표시
  _renderHUD(ctx, s, vm) {
    const G = this.options.gamePoints || CONFIG.GAME_POINTS;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, 30);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, 30, W, 1);
    const mp = vm.state === 'end' ? -1 : this._matchPoint(vm.pts);
    const deuce = vm.pts[0] >= G - 1 && vm.pts[1] >= G - 1 && vm.pts[0] === vm.pts[1];
    this.fighters.forEach((f, i) => {
      const left = i === 0;
      if (f.spr) {
        const face = f.spr.portrait;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left ? 1 : W - 35, 1, 34, 28);
        ctx.clip();
        if (left) ctx.drawImage(face, 18 - Math.round(face.width / 2), 6);
        else {
          ctx.translate(W * 2 - 36, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(face, W - 18 - Math.round(face.width / 2), 6);
        }
        ctx.restore();
      }
      const nameX = left ? 38 : W - 38;
      KText.draw(ctx, f.name, nameX, 1, f.color, { align: left ? 'left' : 'right', font: 'b', outline: C('1') });
      if (vm.serverSide === i && vm.state !== 'end') {
        // 서브권: 금색 꼬리표 (공 그림 + 서브)
        const tw = KText.width('서브', 's') + 14;
        const sx = left ? nameX : nameX - tw;
        ctx.fillStyle = C('8');
        ctx.fillRect(sx, 16, tw, 13);
        ctx.fillStyle = C('1');
        ctx.fillRect(sx + 1, 17, tw - 2, 11);
        ctx.fillStyle = C('b');
        ctx.fillRect(sx + 3, 20, 5, 5);
        ctx.fillStyle = C('w');
        ctx.fillRect(sx + 4, 21, 2, 2);
        KText.draw(ctx, '서브', sx + 10, 15, C('9'), { font: 's' });
      }
      // 점수 (크게). 매치포인트인 쪽은 금색으로 깜빡인다
      const col = mp === i && this.frame % 30 < 20 ? C('9') : C('a');
      BitmapFont.draw(ctx, String(f.pts), left ? W / 2 - 14 : W / 2 + 14, 4, col, { align: 'center', scale: 4, outline: C('1') });
    });
    BitmapFont.draw(ctx, ':', W / 2, 6, C('8'), { align: 'center', scale: 3 });

    // 점수판 바로 아래 띠: 해설 한 줄(있을 때) 또는 기다리는 선수 · 옆 경기
    const said = this._renderSay(ctx);
    if (!said) this._renderWaiting(ctx, s);
    // 그 아래: 듀스 / 매치포인트 / 랠리 카운터
    const tags = [];
    if (deuce) tags.push(['듀스', '5']);
    else if (mp >= 0) tags.push(['매치포인트', '9']);
    if (vm.state === 'rally' && vm.rally >= 3) tags.push([`랠리 ${vm.rally}`, vm.rally >= 10 ? '8' : 'a']);
    let ty = said ? 46 : 31;
    for (const [txt, col] of tags) {
      const tw = KText.width(txt, 's') + 10;
      const pop = this.rallyPop > 4 && txt.startsWith('랠리') ? 1 : 0;
      ctx.fillStyle = C('8');
      ctx.fillRect(Math.round(W / 2 - tw / 2), ty, tw, 14);
      ctx.fillStyle = C('o');
      ctx.fillRect(Math.round(W / 2 - tw / 2) + 1, ty, tw - 2, 13);
      KText.draw(ctx, txt, W / 2, ty - 1 - pop, C(col), { align: 'center', font: 's' });
      ty += 14;
    }
  }

  /** 해설 한 줄 (점수판 아래 띠). AI 가 쓴 줄에는 작은 "AI" 표시를 붙인다. 그렸으면 true */
  _renderSay(ctx, y = 31) {
    const say = this.say;
    if (!say || !say.text) return false;
    if (say.t > SAY_FRAMES - 16 && say.t % 4 < 2) return true;    // 사라질 때 깜빡임
    ctx.fillStyle = C('o');
    ctx.fillRect(0, y, W, 14);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, y + 14, W, 1);
    const whoW = KText.width(say.who, 'n');
    const textW = KText.width(say.text, 'n');
    const badge = say.ai ? 13 : 0;
    let x = Math.max(3, Math.round((W - (whoW + 6 + textW + badge)) / 2));
    KText.draw(ctx, say.who, x, y + 1, C('9'), { font: 'n' });
    x += whoW + 6;
    KText.draw(ctx, say.text, x, y + 1, C('a'), { font: 'n' });
    if (say.ai) {
      const bx = Math.min(W - 12, x + textW + 4);
      ctx.fillStyle = C('h');
      ctx.fillRect(bx, y + 3, 10, 9);
      BitmapFont.draw(ctx, 'AI', bx + 2, y + 5, C('1'));
    }
    return true;
  }

  // 기다리는 선수들: 왼쪽 위에 얼굴, 오른쪽 위에 옆 경기 점수(또는 라운드)
  _renderWaiting(ctx, s) {
    if (!this.vm || this.vm.state === 'intro') return;
    const faces = (s.resting || []).map((id) => this.players.get(id)).filter((p) => p && p.spr);
    if (faces.length) {
      const bw = 26 + faces.length * 17;
      ctx.fillStyle = C('o');
      ctx.fillRect(0, 31, bw, 18);
      ctx.fillStyle = C('8');
      ctx.fillRect(0, 49, bw, 1);
      KText.draw(ctx, '대기', 3, 32, C('j'), { font: 'n' });
      faces.forEach((p, i) => drawFaceChip(ctx, p.spr, 24 + i * 17, 32, p.color));
    }
    let next = `라운드 ${s.round}/${s.rounds}`;
    const other = (s.matches || []).findIndex((m, i) => i !== this.matchIdx);
    if (other >= 0 && s.duels[other]) {
      const m = s.matches[other];
      const d = s.duels[other];
      const na = (this.players.get(m.a) || {}).name || '';
      const nb = (this.players.get(m.b) || {}).name || '';
      next = `옆 경기 ${na} ${d.pts[0]}:${d.pts[1]} ${nb}`;
    }
    const tw = KText.width(next, 'n') + 8;
    ctx.fillStyle = C('o');
    ctx.fillRect(W - tw, 31, tw, 14);
    ctx.fillStyle = C('8');
    ctx.fillRect(W - tw, 45, tw, 1);
    KText.draw(ctx, next, W - 4, 32, C('k'), { font: 'n', align: 'right' });
  }

  // 아래: 내 조작키 (게임 내내 표시)
  _renderKeyBar(ctx) {
    const y0 = 156;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, y0, W, H - y0);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, y0, W, 1);
    if (!this.playing) {
      KText.draw(ctx, '관전 중 · 이번 라운드는 쉽니다', W / 2, y0 + 5, C('j'), { align: 'center', font: 'b' });
      return;
    }
    const f = this.fighters[0];           // 내 캐릭터는 항상 왼쪽
    const caps = [
      ['<', '후진', 'back', !!(this.held & 1)],
      ['Space', '치기', 'strike', !!(this.held & 4)],
      ['>', '전진', 'fwd', !!(this.held & 2)],
    ];
    if (f.spr) drawFaceChip(ctx, f.spr, 4, y0 + 4, f.color);
    let cx = 22;
    for (const [lab, mean, tone, down] of caps) {
      const cap = getKeycap(lab, tone, down);
      ctx.drawImage(cap, cx, y0 + 3);
      cx += cap.width + 1;
      KText.draw(ctx, mean, cx, y0 + 5, C(tone === 'strike' ? '9' : 'a'), { font: 's' });
      cx += KText.width(mean, 's') + 3;
    }
    const divX = Math.max(cx + 2, 228);
    ctx.fillStyle = C('3');
    ctx.fillRect(divX, y0 + 3, 1, 20);
    KText.draw(ctx, '꾹→떼기 스매시', divX + 5, y0 + 1, C('9'), { font: 'n' });
    KText.draw(ctx, 'M 소리', divX + 5, y0 + 12, C('j'), { font: 'n' });
  }

  _renderOverlay(ctx, s, vm) {
    if (vm.state === 'intro') {
      KText.draw(ctx, `ROUND ${s.round}`, W / 2, 32, C('a'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
      drawPanel(ctx, W / 2 - 112, 68, 224, 58, 'dark');
      KText.draw(ctx, '톡 = 드라이브 (빠르고 낮게)', W / 2, 71, C('a'), { align: 'center', font: 's' });
      KText.draw(ctx, '꾹 → 떼기 = 스매시 (찬스볼에!)', W / 2, 84, C('9'), { align: 'center', font: 's' });
      KText.draw(ctx, '전진 + 톡 = 드롭 (짧게)', W / 2, 97, C('h'), { align: 'center', font: 's' });
      KText.draw(ctx, '후진 + 톡 = 로브 (높고 깊게)', W / 2, 110, C('e'), { align: 'center', font: 's' });
      return;
    }
    const b = this.banner;
    if (!b) return;
    if (b.serve) {
      if (vm.state === 'serve' && b.t < 70 && b.t % 20 < 15) {
        const tw = KText.width(b.text, 'b') + 14;
        drawPanel(ctx, Math.round(W / 2 - tw / 2), 62, tw, 17, 'dark');
        KText.draw(ctx, b.text, W / 2, 63, C('a'), { align: 'center', font: 'b' });
      }
      return;
    }
    if (vm.state !== 'point' && vm.state !== 'end') return;
    const pop = Math.min(1, b.t / 6);
    if (pop < 0.3) return;
    drawPanel(ctx, W / 2 - 90, 60, 180, b.sub ? 40 : 24, 'dark');
    KText.draw(ctx, b.text, W / 2, 63, C(b.color), { align: 'center', font: 'b', outline: C('1') });
    if (b.sub) KText.draw(ctx, b.sub, W / 2, 80, C('a'), { align: 'center', font: 's' });
  }

  // ---- 대진 안내 ----
  _renderIntro(ctx, s) {
    this.hall.renderBack(ctx, this.frame, 1);
    dimScreen(ctx, W, H, 10);
    KText.draw(ctx, `ROUND ${s.round} / ${s.rounds}`, W / 2, -1, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const matches = s.matches || [];
    const rowH = 30;
    let y = 40;
    matches.forEach((m, i) => {
      const a = this.players.get(m.a);
      const b = this.players.get(m.b);
      const mine = this.playing && i === this.matchIdx;
      drawPanel(ctx, 30, y, W - 60, rowH - 3, mine ? 'red' : 'dark');
      if (a && a.spr) drawFaceChip(ctx, a.spr, 38, y + 5, a.color);
      if (b && b.spr) drawFaceChip(ctx, b.spr, W - 54, y + 5, b.color);
      if (a) KText.draw(ctx, a.name, 58, y + 6, a.color, { font: 'b', outline: C('1') });
      if (b) KText.draw(ctx, b.name, W - 58, y + 6, b.color, { font: 'b', outline: C('1'), align: 'right' });
      BitmapFont.draw(ctx, 'VS', W / 2, y + 9, mine ? C('9') : C('j'), { align: 'center', scale: 2, outline: C('1') });
      y += rowH;
    });
    const resting = (s.resting || []).map((id) => (this.players.get(id) || {}).name).filter(Boolean);
    if (resting.length) {
      KText.draw(ctx, `이번 라운드 관전: ${resting.join(', ')}`, W / 2, y + 2, C('k'), { align: 'center', font: 's', outline: C('1') });
      y += 16;
    }
    const left = Math.max(0, Math.ceil(s.startAt - this.session.now()));
    const me = this.playing ? '← 후진 · → 전진 · Space 치기 (톡 / 꾹)' : '이번 라운드는 쉬면서 관전합니다';
    KText.draw(ctx, me, W / 2, 138, C('a'), { align: 'center', font: 's', outline: C('1') });
    if (this.frame % 40 < 30) KText.draw(ctx, `${left}초 뒤 시작 · 3점 먼저!`, W / 2, 156, C('9'), { align: 'center', font: 's', outline: C('1') });
  }

  /** 지금까지 순위: 이긴 횟수 → 득실차 순 (서버 점수와 같은 순서) */
  _standingRows(s) {
    const rows = [...this.players.values()].map((p) => ({ p, st: (s.standings || {})[p.id] || { wins: 0, scored: 0, conceded: 0, score: 0 } }));
    rows.sort((x, y) => y.st.score - x.st.score);
    return rows;
  }

  // ---- 라운드 결과 ----
  _renderRoundResult(ctx, s) {
    this.hall.renderBack(ctx, this.frame, 1);
    dimScreen(ctx, W, H, 10);
    KText.draw(ctx, `ROUND ${s.round} 결과`, W / 2, -1, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const results = s.roundResults || [];
    let y = 34;
    for (const r of results) {
      const a = this.players.get(r.a);
      const b = this.players.get(r.b);
      drawPanel(ctx, 30, y, W - 60, 22, 'dark');
      if (a) KText.draw(ctx, a.name, 40, y + 4, r.winner === r.a ? C('9') : C('j'), { font: 'b', outline: C('1') });
      if (b) KText.draw(ctx, b.name, W - 40, y + 4, r.winner === r.b ? C('9') : C('j'), { font: 'b', outline: C('1'), align: 'right' });
      BitmapFont.draw(ctx, `${r.pts[0]} : ${r.pts[1]}`, W / 2, y + 6, C('a'), { align: 'center', scale: 2, outline: C('1') });
      y += 24;
    }
    KText.draw(ctx, '지금까지', W / 2, y + 1, C('k'), { align: 'center', font: 'n' });
    y += 13;
    this._standingRows(s).forEach((row, i) => {
      const yy = y + i * 12;
      if (yy > H - 13) return;
      const diff = row.st.scored - row.st.conceded;
      KText.draw(ctx, `${i + 1}. ${row.p.name}`, 84, yy, row.p.isMe ? C('e') : C('a'), { font: 'n' });
      KText.draw(ctx, `${row.st.wins}승 · 득실 ${diff > 0 ? '+' : ''}${diff}`, 236, yy, C('t'), { font: 'n', align: 'right' });
    });
  }

  // ---- 최종 결과 (원본 ResultScene 의 순위표) + AI 총평 ----
  _renderFinal(ctx, s) {
    const t = this.sceneT;
    this.hall.renderBack(ctx, this.frame, 1);
    dimScreen(ctx, W, H, 9);
    this.particles.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, -3, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    KText.draw(ctx, '점수', 296, 12, C('e'), { font: 'n', align: 'right' });
    const rows = s.results || [];
    const rowH = 22;
    const y0 = 25;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.players.get(r.playerId);
      const y = y0 + i * rowH;
      const st = r.stats || {};
      const diff = (st.scored || 0) - (st.conceded || 0);
      drawPanel(ctx, 16, y, W - 32, rowH - 2, r.rank === 1 ? 'red' : 'dark');
      BitmapFont.draw(ctx, String(r.rank), 32, y + 5, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      const jump = r.rank === 1 ? Math.abs(Math.round(Math.sin(t / 8) * 2)) : 0;
      if (p && p.spr) {
        const face = p.spr.portrait;
        const fh = Math.min(17, face.height);
        ctx.drawImage(face, 0, 0, face.width, fh, Math.round(64 - face.width / 2), y + 2 - jump, face.width, fh);
        if (r.rank === 1) ctx.drawImage(this.sprites.crown, 62, y - 1 - jump);
      }
      KText.draw(ctx, r.name, 86, y + 3, p ? p.color : C('a'), { font: 'b', outline: C('1') });
      KText.draw(ctx, `${st.wins || 0}승 · 득실 ${diff > 0 ? '+' : ''}${diff}`, 212, y + 3, C('a'), { font: 'b', align: 'center' });
      KText.draw(ctx, String(r.score), 296, y + 3, C('e'), { font: 'b', align: 'right' });
    });
    // AI 총평 (서버가 보내 준 경우에만)
    const v = this.verdict;
    if (v && v.headline) {
      const y = 137;
      drawPanel(ctx, 16, y, W - 32, 42, 'dark');
      ctx.fillStyle = C('h');
      ctx.fillRect(22, y + 4, 40, 11);
      KText.draw(ctx, 'AI 총평', 24, y + 3, C('1'), { font: 'n' });
      KText.draw(ctx, v.headline, 66, y + 3, C('9'), { font: 'n' });
      if (v.mvp) KText.draw(ctx, `1등에게: ${v.mvp}`, 24, y + 15, C('a'), { font: 'n' });
      if (v.cheer) KText.draw(ctx, `응원: ${v.cheer}`, 24, y + 27, C('k'), { font: 'n' });
    }
  }
}

// =============================================================
// 서버 상태 두 개(a → b) 사이의 공 위치.
//  공이 날아가는 중이면 같은 물리식(Ball.step)으로 a 에서부터 프레임 단위로 진행해 본다.
//  그렇게 간 위치가 b 와 맞으면(그 사이에 누가 치지 않았으면) 그 길을 따라 그리고,
//  아니면(타격 · 서브처럼 방향이 바뀐 경우) 두 위치를 곧게 잇는다.
//  b 가 아직 안 왔으면 a 에서 late 프레임만큼 미리 진행한 위치를 쓴다.
// =============================================================
function ballFrom(snapBall) {
  const ball = new Ball(CONFIG);
  ball.x = ball.px = snapBall.x;
  ball.y = ball.py = snapBall.y;
  ball.vx = snapBall.vx;
  ball.vy = snapBall.vy;
  ball.rest = snapBall.rest;
  ball.netHit = snapBall.netHit;
  return ball;
}

function stepped(snapBall, frames) {
  const ball = ballFrom(snapBall);
  const whole = Math.floor(frames);
  for (let i = 0; i < whole; i++) ball.step();
  const frac = frames - whole;
  if (frac <= 0) return { x: ball.x, y: ball.y };
  ball.step();
  return { x: ball.px + (ball.x - ball.px) * frac, y: ball.py + (ball.y - ball.py) * frac };
}

const moving = (ball) => ball.state === 'flight' || ball.state === 'dead';

function ballBetween(a, b, u, late) {
  const pa = a.ball;
  if (!b) {
    if (late > 0 && moving(pa) && a.hitstop === 0 && a.slow === 0) return stepped(pa, late);
    return { x: pa.x, y: pa.y };
  }
  const pb = b.ball;
  const n = pb.ticks - pa.ticks;
  if (moving(pa) && moving(pb) && n > 0 && n <= 12) {
    if (b._pathFrom !== a.frame) {
      // 이 두 상태 사이를 물리식으로 이을 수 있는지 한 번만 확인해 둔다
      const end = stepped(pa, n);
      b._pathFrom = a.frame;   // 앞 상태 자체가 아니라 번호만 적어 둔다(옛 상태가 메모리에 남지 않게)
      b._pathOk = Math.abs(end.x - pb.x) < 0.6 && Math.abs(end.y - pb.y) < 0.6;
    }
    if (b._pathOk) return stepped(pa, u * n);
  }
  return { x: pa.x + (pb.x - pa.x) * u, y: pa.y + (pb.y - pa.y) * u };
}
