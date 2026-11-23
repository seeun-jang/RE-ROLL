// =============================================================
// 잭팟 인형뽑기 — 화면 (멀티플레이)
//
// 기계(인형 · 집게 · 점수)는 서버가 진행한다(참가자마다 기계 하나). 여기서는
//  - 서버가 보내 주는 내 기계 상태(net.snap.me)를 원본의 '개인 화면'(유리 2배 확대 + 오른쪽 정보판)으로 그리고,
//  - ← → (A/D) 로 누르고 있는 방향, Space(↑/↓) 로 내리기를 서버로 보낸다.
// 집게의 좌우 이동만 기다리지 않고 바로 보여 준다(예측). 무엇을 집었는지 · 점수는 서버 상태만 쓴다.
// 코인을 다 쓰면 아직 하는 사람의 기계를 관전한다(서버가 snap.watch 로 보내 준다).
// 그림 · 글자 · 효과 · 소리는 원본 코드를 옮긴 모듈(gfx · clawView · particles · audio)을 그대로 쓴다.
// =============================================================
import { DEFAULT_CONFIG as CONFIG } from '../sim/config.js';
import { AudioManager } from './audio.js';
import { buildPlushSprites, drawArcade, drawCoinIcon, drawGlass, drawGlassLabels, drawWonRow } from './clawView.js';
import {
  BitmapFont, KText, buildCrown, buildFace, charColor, clearTextCaches, drawCard, drawNameCard, drawPanel,
  drawPixelRing, getKeycap, loadBoldFont, loadMiniImages,
} from './gfx.js';
import { C } from './palette.js';
import { ParticleSystem } from './particles.js';

const W = CONFIG.BASE.WIDTH;
const H = CONFIG.BASE.HEIGHT;
const B = CONFIG.BOX;
const STEP_MS = 1000 / 60;      // 화면 효과는 원본처럼 60분의 1초 단위로 움직인다
const GX = 6;                   // 2배 확대한 유리의 화면 위치
const GY = 6;
const PX = 130;                 // 오른쪽 정보판 왼쪽 끝
const LEFT_KEYS = ['ArrowLeft', 'KeyA'];
const RIGHT_KEYS = ['ArrowRight', 'KeyD'];
const DROP_KEYS = ['Space', 'ArrowUp', 'ArrowDown'];
const SAY_FRAMES = 210;         // 해설 자막이 떠 있는 시간(3.5초)

const CSS = `
.claw-root { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #120a1c; overflow: hidden; }
.claw-root canvas { display: block; flex: none; image-rendering: pixelated; image-rendering: crisp-edges; }
`;

export class ClawScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.types = this.opt.types || CONFIG.PRIZE_TYPES;
    this.coinsMax = this.opt.coins ?? CONFIG.COINS;
    this.moveTime = this.opt.moveTime ?? CONFIG.MOVE_TIME;
    this.intro = this.opt.intro ?? CONFIG.RULES.INTRO_TIME;
    this.meId = me ? me.id : null;
    this.players = players.map((p) => ({
      id: p.id, name: p.name, index: p.index, character: p.character, color: charColor(p.character), face: null,
      isMe: p.id === this.meId,
    }));
    this.byId = new Map(this.players.map((p) => [p.id, p]));

    this._buildDom();
    this.audio = new AudioManager();
    this.particles = new ParticleSystem();
    this.ready = false;         // 글꼴 · 그림이 준비됐는지
    this.PLUSH = null;
    this.crown = null;
    this.boldFace = null;

    // 서버 상태 → 화면용
    this.lastSnap = null;
    this.viewId = null;         // 지금 유리에 그리는 기계의 주인
    this.prevView = null;       // 바로 전 상태(사이를 이어 그리려고 둔다)
    this.curView = null;
    this.prevAt = 0;
    this.curAt = 0;
    this.wonCount = {};         // 다른 사람이 뽑은 개수(늘면 그 줄이 반짝)
    this.rowFlash = {};

    // 내 입력 · 예측
    this.held = { left: false, right: false, drop: false };
    this.sentDir = 0;
    this.predOn = false;
    this.predX = B.HOME_X;
    this.xOff = 0;

    // 효과
    this.frame = 0;
    this.msg = null;            // 유리 위 꼬리표 { text, color, t, big }
    this.flash = 0;             // 획득하면 JACKPOT 글자가 번쩍
    this.gold = 0;              // 황금곰이면 더 오래 번쩍
    this.shake = 0;
    this.say = null;            // 해설 자막 { text, ai, who, t }
    this.verdict = null;        // AI 총평 { headline, mvp, cheer }
    this.muteNotice = 0;
    this.done = new Set();
    this._destroyed = false;

    this._onKeyDown = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.audio.unlock();
      const code = e.code;
      if (LEFT_KEYS.includes(code) || RIGHT_KEYS.includes(code) || DROP_KEYS.includes(code)) e.preventDefault();
      if (code === 'KeyM' && !e.repeat) {
        this.audio.toggleMute();
        this.muteNotice = 90;
      }
      if (!this.meId) return;
      if (LEFT_KEYS.includes(code)) this.held.left = true;
      if (RIGHT_KEYS.includes(code)) this.held.right = true;
      if (DROP_KEYS.includes(code) && !e.repeat) {
        this.held.drop = true;
        this._sendDrop();
      }
    };
    this._onKeyUp = (e) => {
      if (LEFT_KEYS.includes(e.code)) this.held.left = false;
      if (RIGHT_KEYS.includes(e.code)) this.held.right = false;
      if (DROP_KEYS.includes(e.code)) this.held.drop = false;
    };
    this._onBlur = () => {
      this.held.left = false;
      this.held.right = false;
      this.held.drop = false;
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
    try {
      this.audio.unlock();
    } catch (e) {
      // 첫 입력 때 켜진다
    }
    this.audio.playBgm('game');
    this._load();

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
      this._render();
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
    if (this.boldFace && document.fonts) document.fonts.delete(this.boldFace);
    this.boldFace = null;
    clearTextCaches();
    this.root.remove();
    this.styleEl.remove();
  }

  // 글꼴 · 캐릭터 그림을 불러온 뒤 인형 · 얼굴 그림을 만든다 (최대 3초 기다림)
  async _load() {
    let minis = {};
    const fonts = document.fonts
      ? [document.fonts.load('10px Galmuri9'), document.fonts.load('15px Galmuri14')]
      : [];
    const bold = loadBoldFont().then((face) => {
      if (this._destroyed) {
        if (face && document.fonts) document.fonts.delete(face);
        return;
      }
      this.boldFace = face;
      clearTextCaches();          // 늦게 도착해도 다음 프레임부터 굵은 글씨로 다시 그린다
    });
    const images = loadMiniImages().then((m) => {
      minis = m;
    });
    try {
      await Promise.race([
        Promise.all([bold, images, ...fonts]),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (e) {
      console.warn('[claw] 글꼴/그림 로딩 실패, 기본으로 진행', e);
    }
    if (this._destroyed) return;
    clearTextCaches();
    this.PLUSH = buildPlushSprites();
    this.crown = buildCrown();
    for (const p of this.players) p.face = buildFace(minis[p.character] || null);
    this.ready = true;
  }

  _buildDom() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    this.root = document.createElement('div');
    this.root.className = 'claw-root';
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.root.appendChild(this.canvas);
    this.container.appendChild(this.root);
    this.autoHeight = this.container.clientHeight === 0;
    // 유리 안은 작은 캔버스에 그린 뒤 2배로 확대한다 (정수배라 픽셀 그대로)
    this.glassBuf = document.createElement('canvas');
    this.glassBuf.width = B.W;
    this.glassBuf.height = B.H;
  }

  // 칸 크기에 맞춰 정수배로만 확대 (장치 픽셀 기준 → 125% · 150% 배율에서도 픽셀이 고르다)
  _fit() {
    const dpr = window.devicePixelRatio || 1;
    const maxW = this.root.clientWidth || W * 2;
    const maxH = this.autoHeight ? Infinity : this.root.clientHeight || H * 2;
    const s = Math.max(1, Math.floor(Math.min((maxW * dpr) / W, (maxH * dpr) / H)));
    this.canvas.style.width = `${(W * s) / dpr}px`;
    this.canvas.style.height = `${(H * s) / dpr}px`;
    if (this.autoHeight) this.root.style.height = this.canvas.style.height;
  }

  _once(key, fn) {
    if (this.done.has(key)) return;
    this.done.add(key);
    fn();
  }

  // ---------------- 입력 ----------------
  _dir() {
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  }

  _playing() {
    const s = this.net.snap;
    return !!s && s.phase === 'play';
  }

  _sendDir() {
    if (!this.meId || !this._playing()) return;
    const dir = this._dir();
    if (dir === this.sentDir) return;
    this.sentDir = dir;
    this.net.dir(dir);
  }

  _sendDrop() {
    if (!this.meId || !this._playing()) return;
    const s = this.net.snap;
    if (!s.me || s.me.claw.state !== 'move') return;
    this.sentDir = this._dir();
    this.net.drop(this.sentDir);
  }

  // ---------------- 서버 상태 → 화면 ----------------
  _onSnap(s) {
    // 유리에 그릴 기계: 내 것, 코인을 다 썼으면 관전 대상
    let id = this.meId;
    let view = s.me || null;
    if (s.watch && (!view || (view.coins === 0 && view.claw.state === 'idle'))) {
      id = s.watch.id;
      view = s.watch.view;
    }
    if (id !== this.viewId) {
      this.viewId = id;
      this.prevView = null;
    } else this.prevView = this.curView;
    this.prevAt = this.curAt;
    this.curView = view;
    this.curAt = performance.now() / 1000;      // 도착한 시각(내 컴퓨터 시계) — 두 상태 사이를 이어 그리는 데만 쓴다
    if (s.verdict) this.verdict = s.verdict;
    // 다른 사람이 인형을 뽑으면 그 줄이 반짝
    for (const [pid, row] of Object.entries(s.players || {})) {
      const n = row.won.length;
      if (this.wonCount[pid] !== undefined && n > this.wonCount[pid] && pid !== this.meId) this.rowFlash[pid] = 40;
      this.wonCount[pid] = n;
    }
  }

  _handleEvent(e) {
    const audio = this.audio;
    if (e.type === 'say') {
      this.say = { text: e.text || '', ai: e.source === 'gemini', who: e.who || this.opt.caster || '', t: 0 };
    } else if (e.type === 'verdict') {
      this.verdict = { headline: e.headline, mvp: e.mvp, cheer: e.cheer };
    } else if (e.type === 'coin') audio.sfx('chip');
    else if (e.type === 'drop') audio.sfx('whoosh');
    else if (e.type === 'grab') {
      audio.sfx('clack');
      this.msg = { text: '집었다!', color: 'a', t: 0 };
      this._sparkle();
    } else if (e.type === 'miss') {
      this.msg = { text: '헛손질…', color: 'j', t: 0 };
      this._sparkle();
    } else if (e.type === 'slip') {
      this.msg = { text: '미끄러짐!', color: '5', t: 0 };
      audio.sfx('miss');
    } else if (e.type === 'won') {
      const gold = e.prize === 'gold';
      this.msg = { text: gold ? `황금곰! +${e.value}` : `획득! +${e.value}`, color: gold ? '9' : 'e', t: 0, big: gold };
      audio.sfx(gold ? 'jackpot' : 'coin');
      this.flash = 60;
      if (gold) {
        this.gold = 90;
        this.shake = 12;
      }
      const cx = GX + (B.HOLE_W * 2) / 2;
      const cy = GY + B.H * 2;
      this.particles.burst(cx, cy, gold ? 30 : 14, gold ? [C('9'), C('8'), C('b')] : [C('9'), C('e'), C('b')], gold ? 1.8 : 1.2, 30, gold ? 2 : 1, 0.04);
    }
  }

  // 집는 순간 반짝 (집게 끝)
  _sparkle() {
    const v = this.curView;
    if (!v || this.viewId !== this.meId) return;
    this.particles.add(GX + v.claw.x * 2, GY + (v.claw.y + 9) * 2, 0, -0.3, 12, C('b'), 1);
  }

  // ---------------- 60분의 1초마다 ----------------
  _update() {
    this.frame++;
    this.particles.update();
    if (this.shake > 0) this.shake--;
    if (this.flash > 0) this.flash--;
    if (this.gold > 0) this.gold--;
    if (this.muteNotice > 0) this.muteNotice--;
    if (this.msg && ++this.msg.t > 70) this.msg = null;
    if (this.say && ++this.say.t > SAY_FRAMES) this.say = null;
    for (const k of Object.keys(this.rowFlash)) if (--this.rowFlash[k] <= 0) delete this.rowFlash[k];

    const s = this.net.snap;
    if (s && s !== this.lastSnap) {
      this.lastSnap = s;
      this._onSnap(s);
    }
    for (const e of this.net.takeEvents()) this._handleEvent(e);
    if (!s) return;

    // 진행에 따른 소리
    const gt = this.net.now() - s.startAt;
    if (s.phase === 'intro') {
      if (gt >= -this.intro + 0.5) this._once('coin1', () => this.audio.sfx('coin'));
      if (gt >= -this.intro + 1.0) this._once('coin2', () => this.audio.sfx('coin'));
    } else if (s.phase === 'play') {
      this._once('start', () => {
        if (gt < 2) this.audio.sfx('start');
      });
    } else if (s.phase === 'end') {
      this._once('end', () => this.audio.sfx('win'));
    } else if (s.results) {
      this._once('final', () => {
        this.audio.playBgm('result');
        this.audio.sfx('win');
        this.particles.clear();
      });
      // 결과 화면: 색종이
      if (this.frame % 4 === 0) {
        const cols = [C('9'), C('8'), C('6'), C('h'), C('q'), C('b')];
        this.particles.add(Math.random() * W, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 2);
      }
    }

    // 내 입력 보내기 + 집게 좌우 이동 예측
    this._sendDir();
    const me = s.me;
    if (me && s.phase === 'play' && me.claw.state === 'move') {
      if (!this.predOn) {
        this.predOn = true;
        this.predX = me.claw.x;
      }
      const dir = this._dir();
      this.predX = Math.max(B.HOME_X, Math.min(B.MAX_X, this.predX + dir * CONFIG.CLAW.MOVE));
      const diff = me.claw.x - this.predX;
      if (dir === 0 && me.dir === 0) this.predX += Math.abs(diff) < 0.1 ? diff : diff * 0.25;   // 멈춰 있으면 서버 위치로 맞춘다
      else if (Math.abs(diff) > 8) this.predX = me.claw.x;                                      // 너무 벌어지면 서버 위치로
      this.xOff = 0;
    } else {
      if (this.predOn && me) this.xOff = this.predX - me.claw.x;      // 내려가기 시작할 때 튀지 않게 조금씩 서버 위치로
      this.predOn = false;
      this.xOff *= 0.8;
      if (Math.abs(this.xOff) < 0.05) this.xOff = 0;
    }
  }

  // 그릴 기계 만들기: 바로 전 상태와 지금 상태 사이를 이어 그린다 (서버는 초당 30번 보낸다)
  _machine() {
    const v = this.curView;
    if (!v) return null;
    const p = this.prevView;
    const span = this.curAt - this.prevAt;
    let k = 1;
    if (p && span > 0 && span < 0.2) k = Math.max(0, Math.min(1, (performance.now() / 1000 - this.curAt) / span));
    const mix = (a, b) => a + (b - a) * k;
    const claw = { ...v.claw, grab: null };
    if (p) {
      claw.x = mix(p.claw.x, v.claw.x);
      claw.y = mix(p.claw.y, v.claw.y);
      claw.open = mix(p.claw.open, v.claw.open);
    }
    const mine = this.viewId === this.meId;
    if (mine) {
      if (this.predOn) claw.x = this.predX;
      else claw.x += this.xOff;
    }
    const before = new Map();
    if (p) for (const row of p.prizes) before.set(row[0], row);
    const prizes = v.prizes.map(([id, ti, x, y]) => {
      const type = this.types[ti];
      const old = before.get(id);
      const P = CONFIG.PRIZES[type] || { r: 7 };
      const out = { id, type, r: P.r, x: old ? mix(old[2], x) : x, y: old ? mix(old[3], y) : y };
      if (id === v.claw.grab) {
        // 잡힌 인형은 집게를 따라간다
        out.x = claw.x;
        out.y = claw.y + 9 + P.r - 2;
        claw.grab = out;
      }
      return out;
    });
    return { claw, prizes, mine };
  }

  // ---------------- 그리기 ----------------
  _render() {
    const ctx = this.ctx;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, H);
    const s = this.net.snap;
    if (!this.ready || !s) {
      BitmapFont.draw(ctx, 'LOADING...', W / 2, H / 2 - 2, C('9'), { align: 'center' });
      return;
    }
    if (s.results && (s.phase === 'final' || s.phase === 'done')) this._renderFinal(ctx, s);
    else this._renderPlay(ctx, s);
    if (this.muteNotice > 0) {
      const txt = this.audio.muted ? '소리 끔' : '소리 켬';
      drawPanel(ctx, W - 60, H - 26, 54, 20, 'dark');
      KText.draw(ctx, txt, W - 33, H - 22, C('a'), { align: 'center', font: 's' });
    }
  }

  // 유리 위 글자: 어두운 꼬리표 위에
  _drawMsg(ctx, cx, y, msg, w) {
    const font = msg.big ? 's' : 'n';
    const tw = Math.min(w, KText.width(msg.text, font) + 8);
    const yy = Math.round(y - Math.min(4, msg.t / 4));
    ctx.fillStyle = C(msg.color);
    ctx.fillRect(Math.round(cx - tw / 2), yy, tw, msg.big ? 15 : 12);
    ctx.fillStyle = C('1');
    ctx.fillRect(Math.round(cx - tw / 2) + 1, yy + 1, tw - 2, msg.big ? 13 : 10);
    KText.draw(ctx, msg.text, cx, yy + 1, C(msg.color), { align: 'center', font });
  }

  // 옮기는 남은 시간: 시계 그림 + 숫자
  _drawTimer(ctx, xr, y, claw) {
    if (claw.state !== 'move') return;
    const sec = Math.max(0, Math.ceil((this.moveTime - claw.t) / 60));
    const urgent = sec <= 3 && this.frame % 20 < 10;
    const txt = `${sec}초`;
    const tw = KText.width(txt, 'n') + 13;
    ctx.fillStyle = C('1');
    ctx.fillRect(xr - tw, y, tw, 11);
    drawPixelRing(ctx, xr - tw + 5, y + 5, 3, C(urgent ? '5' : '9'));
    ctx.fillStyle = C(urgent ? '5' : '9');
    ctx.fillRect(xr - tw + 5, y + 3, 1, 3);
    KText.draw(ctx, txt, xr - 2, y, C(urgent ? '5' : '9'), { font: 'n', align: 'right' });
  }

  _drawKeys(ctx, cx, y) {
    const labels = ['<', 'Space', '>'];
    const held = [this.held.left, this.held.drop, this.held.right];
    const caps = labels.map((l, j) => getKeycap(l, j === 1 ? 'strike' : 'plain', !!held[j]));
    const tw = caps.reduce((s2, c) => s2 + c.width, 0) + 2;
    let kx = Math.round(cx - tw / 2);
    caps.forEach((c) => {
      ctx.drawImage(c, kx, y);
      kx += c.width + 1;
    });
  }

  // 해설 자막 (말하는 인물 + AI 가 쓴 줄이면 작은 'AI' 표시) — 오른쪽 정보판 가운데 두 줄
  _drawSay(ctx, x, y, w) {
    const say = this.say;
    if (say.t > SAY_FRAMES - 16 && say.t % 4 < 2) return;      // 사라질 때 깜빡임
    ctx.fillStyle = C('2');
    ctx.fillRect(x, y, w, 25);
    ctx.fillStyle = C('9');
    ctx.fillRect(x, y, 2, 25);
    let tx = x + 5;
    KText.draw(ctx, say.who, tx, y, C('9'), { font: 'n' });
    tx += KText.width(say.who, 'n') + 4;
    if (say.ai) {
      ctx.fillStyle = C('h');
      ctx.fillRect(tx, y + 3, 11, 7);
      BitmapFont.draw(ctx, 'AI', tx + 2, y + 4, C('1'));
      tx += 14;
    }
    // 첫 줄은 이름 옆 남은 칸에, 나머지는 둘째 줄에
    const first = KText.wrap(say.text, 'n', x + w - 3 - tx, 1)[0] || '';
    const rest = say.text.slice(first.length).trim();
    KText.draw(ctx, first, tx, y, C('a'), { font: 'n' });
    if (rest) KText.draw(ctx, KText.fit(rest, 'n', w - 8), x + 5, y + 12, C('a'), { font: 'n' });
  }

  // 플레이 화면 (원본 '개인 화면'): 왼쪽에 기계 유리를 2배로, 오른쪽에 내 정보 + 다른 사람 기록
  _renderPlay(ctx, s) {
    const f = this.frame;
    const me = this.byId.get(this.meId) || this.players[0];
    const mine = s.me || null;
    const m = this._machine();
    const playing = s.phase === 'play';
    const owner = this.byId.get(this.viewId) || me;
    const watching = !!m && !m.mine;

    ctx.save();
    if (this.shake > 0) ctx.translate(this.shake % 2 ? 2 : -2, 0);
    drawArcade(ctx, f);
    // 유리 테두리 (기계 몸체 느낌)
    drawCard(ctx, 2, 2, B.W * 2 + 8, B.H * 2 + 8, '7', owner.color);
    if (m) {
      // 2배 확대 유리
      const g = this.glassBuf.getContext('2d');
      g.clearRect(0, 0, B.W, B.H);
      drawGlass(g, this.PLUSH, 0, 0, m, f, playing);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.glassBuf, 0, 0, B.W, B.H, GX, GY, B.W * 2, B.H * 2);
      drawGlassLabels(ctx, GX, GY, 2);
      if (playing) this._drawTimer(ctx, GX + B.W * 2 - 2, 10, m.claw);
    }
    if (this.msg && !watching) this._drawMsg(ctx, GX + B.W, 34, this.msg, 110);
    if (watching) {
      // 코인을 다 써서 다른 사람 기계를 보는 중
      const txt = `관전: ${KText.fit(owner.name, 'n', 60)}`;
      const tw = KText.width(txt, 'n') + 8;
      ctx.fillStyle = C('1');
      ctx.fillRect(GX + 2, GY + 12, tw, 12);
      KText.draw(ctx, txt, GX + 6, GY + 12, C(owner.color), { font: 'n' });
    } else if (mine && mine.coins === 0 && mine.claw.state === 'idle' && s.phase !== 'intro') {
      ctx.fillStyle = C('1');
      ctx.fillRect(30, 70, 68, 14);
      KText.draw(ctx, '코인 끝', 64, 71, C('k'), { align: 'center', font: 's' });
    }

    // 오른쪽 패널
    const px = PX;
    ctx.fillStyle = C('1');
    ctx.fillRect(px - 2, 0, W - px + 2, H);
    KText.draw(ctx, '잭팟 인형뽑기', px + 2, 1, C('9'), { font: 'b' });
    const flash = this.flash > 0 && f % 6 < 3;
    BitmapFont.draw(ctx, 'JACKPOT', W - 4, 4, this.gold > 0 ? C(f % 6 < 3 ? 'b' : '5') : flash ? C('b') : C('8'), { align: 'right' });
    drawNameCard(ctx, px + 2, 16, 98, { color: me.color, name: me.name, face: me.face, place: null }, f, this.crown);
    const row = (s.players && s.players[this.meId]) || { score: 0, coins: this.coinsMax, won: [] };
    const coins = mine ? mine.coins : row.coins;
    const score = mine ? mine.score : row.score;
    const wonIdx = mine ? mine.won : row.won;
    // 코인 · 점수
    drawCoinIcon(ctx, px + 104, 20);
    BitmapFont.draw(ctx, `X${coins}`, px + 113, 21, coins ? C('9') : C('i'), { scale: 2 });
    KText.draw(ctx, `${score}점`, W - 4, 34, C('9'), { font: 'L', align: 'right', outline: C('1') });
    KText.draw(ctx, '뽑은 인형', px + 2, 38, C('k'), { font: 'n' });
    // 뽑은 인형 (큰 그림으로 줄 세움)
    wonIdx.slice(-8).forEach((ti, i) => {
      const img = this.PLUSH[this.types[ti]];
      if (img) ctx.drawImage(img, px + 2 + i * 22 - Math.round((img.width - 14) / 2), 52);
    });
    if (!wonIdx.length) KText.draw(ctx, '아직 없음', px + 2, 54, C('i'), { font: 'n' });
    // 해설 자막이 있으면 점수 안내 자리에 보여 준다
    if (this.say) this._drawSay(ctx, px + 1, 70, W - px - 4);
    else {
      const P = this.opt.prizes || CONFIG.PRIZES;
      KText.draw(ctx, `황금곰 ${P.gold.value} · 주사위 ${P.dice.value} · 인형 ${P.bear.value} · 칩 ${P.chip.value}`, px + 2, 72, C('j'), { font: 'n' });
      KText.draw(ctx, '←→ 옮기기 · Space 내리기 · M 소리', px + 2, 84, C('i'), { font: 'n' });
    }
    this._drawKeys(ctx, px + 94, 97);
    // 다른 사람 기록
    let y = 120;
    for (const q of this.players) {
      if (q.id === this.meId) continue;
      const r = (s.players && s.players[q.id]) || { score: 0, coins: 0, won: [], done: false };
      ctx.fillStyle = this.rowFlash[q.id] && f % 6 < 3 ? C('4') : C('2');
      ctx.fillRect(px + 1, y, W - px - 4, 13);
      if (q.face) ctx.drawImage(q.face, px + 2, y - 2);
      KText.draw(ctx, KText.fit(q.name, 'n', 42), px + 21, y + 1, C(q.color), { font: 'n' });
      drawWonRow(ctx, this.PLUSH, px + 66, y + 3, r.won.map((ti) => this.types[ti]), 6);
      BitmapFont.draw(ctx, r.done ? 'END' : `X${r.coins}`, px + 123, y + 4, r.done ? C('i') : C('9'));
      KText.draw(ctx, `${r.score}점`, W - 5, y + 1, C('a'), { font: 'n', align: 'right' });
      y += 14;
    }
    this.particles.render(ctx);
    ctx.restore();

    if (s.phase === 'intro') {
      drawCard(ctx, W / 2 - 104, 46, 208, 86, '7', '9');
      KText.draw(ctx, '코인을 넣는 중…', W / 2, 50, C('9'), { align: 'center', font: 'b', outline: C('1') });
      KText.draw(ctx, `한 사람 ${this.coinsMax}번 도전!`, W / 2, 65, C('a'), { align: 'center', font: 's' });
      KText.draw(ctx, '← → 집게 옮기기 · Space 내리기', W / 2, 82, C('t'), { align: 'center', font: 'n' });
      KText.draw(ctx, `${Math.round(this.moveTime / 60)}초 안에 안 내리면 저절로 내려갑니다`, W / 2, 94, C('k'), { align: 'center', font: 'n' });
      KText.draw(ctx, '모두 같은 인형 · 가운데를 집을수록 안 미끄러져요', W / 2, 106, C('k'), { align: 'center', font: 'n' });
      KText.draw(ctx, '점수 → 뽑은 개수 → 황금곰 순으로 순위', W / 2, 118, C('k'), { align: 'center', font: 'n' });
    }
    if (s.phase === 'end') {
      drawCard(ctx, W / 2 - 60, 74, 120, 26, '6', '9');
      KText.draw(ctx, '영업 종료!', W / 2, 77, C('9'), { align: 'center', font: 'L', outline: C('1') });
    }
  }

  // 최종 결과 (원본 결과 화면): 점수 순 + 뽑은 인형 줄줄이 + 아래에 AI 총평
  _renderFinal(ctx, s) {
    const t = this.frame;
    drawArcade(ctx, t);
    this.particles.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, -3, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const rows = s.results;
    const rowH = 22;
    const y0 = 32;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      const p = this.byId.get(r.playerId) || { color: 'h', name: r.name, face: null };
      const x = 14;
      const y = y0 + i * rowH;
      drawCard(ctx, x, y, 292, rowH - 3, r.rank === 1 ? '7' : '2', r.rank === 1 ? '9' : '3');
      BitmapFont.draw(ctx, String(r.rank), x + 13, y + 4, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      drawNameCard(ctx, x + 26, y + 1, 84, { color: p.color, name: r.name, face: p.face, place: null }, t, this.crown);
      if (r.rank === 1 && this.crown) ctx.drawImage(this.crown, x + 32, y - 2);
      if (r.playerId === this.meId) KText.draw(ctx, '나', x + 4, y + 6, C('9'), { align: 'center', font: 'n', outline: C('1') });
      KText.draw(ctx, `${r.score}점`, x + 116, y + 2, C('9'), { font: 'b', outline: C('1') });
      // 뽑은 인형 줄줄이 (최대 7개, 넘치면 +N)
      const won = (r.stats && r.stats.won) || [];
      const shown = won.slice(0, won.length > 7 ? 6 : 7);
      shown.forEach((type, k) => {
        const img = this.PLUSH[type];
        if (img) ctx.drawImage(img, x + 160 + k * 17 - Math.floor((img.width - 14) / 2), y + 1 + Math.floor((17 - img.height) / 2));
      });
      if (won.length > 7) KText.draw(ctx, `+${won.length - 6}`, x + 160 + 6 * 17 + 2, y + 3, C('9'), { font: 'n' });
      if (!won.length) KText.draw(ctx, '빈손…', x + 160, y + 3, C('j'), { font: 'n' });
    });
    // AI 총평 (도착했을 때만)
    const v = this.verdict || s.verdict;
    if (v && v.headline) {
      ctx.fillStyle = C('1');
      ctx.fillRect(0, 144, W, 36);
      ctx.fillStyle = C('4');
      ctx.fillRect(0, 144, W, 1);
      const tag = 'AI 총평';
      const tw = KText.width(tag, 'n') + 6;
      ctx.fillStyle = C('h');
      ctx.fillRect(8, 147, tw, 11);
      KText.draw(ctx, tag, 11, 146, C('1'), { font: 'n' });
      KText.draw(ctx, KText.fit(v.headline, 'n', W - tw - 24), 8 + tw + 5, 146, C('9'), { font: 'n' });
      if (v.mvp) KText.draw(ctx, KText.fit(`1등에게: ${v.mvp}`, 'n', W - 16), 8, 157, C('a'), { font: 'n' });
      if (v.cheer) KText.draw(ctx, KText.fit(`응원: ${v.cheer}`, 'n', W - 16), 8, 168, C('e'), { font: 'n' });
    } else if (this.say) {
      // 총평이 없으면 마지막 해설 한 줄
      this._drawSay(ctx, 66, 150, 188);
    }
  }
}
