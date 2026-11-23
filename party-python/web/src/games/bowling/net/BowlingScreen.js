// =============================================================
// 잭팟 볼링 — 화면 (멀티플레이)
//
// 원본 js/scenes/play.js · result.js 를 "각자 자기 레인에서 동시에" 에 맞게 옮긴 것.
//  - 내 레인: 위치(←→) → 방향 멈추기(Space) → 힘 멈추기(Space) → 굴러가는 동안 스핀(←→)
//  - 던지면 기다리지 않고 바로 굴린다. 핀 물리(sim/rules.js 의 Rack)는 서버와 같은 씨앗 · 같은 계산이라
//    서버 판정과 똑같이 쓰러진다. 스핀 입력이 끝나면 투구 값을 서버로 보내고,
//    서버가 알려 준 결과("roll" 사건)로 점수를 적는다(혹시 다르면 서버 결과대로 핀을 고쳐 놓는다).
//  - 다른 사람의 점수는 서버 상태로 위쪽 전광판과 왼쪽 목록에 보여 준다.
// 레인 · 핀 · 전광판 · 효과 · 소리는 원본 그리기 코드를 그대로 쓴다(view/, audio/).
// =============================================================
import { ANIMAL_ORDER } from '../../../shared/animals.js';
import { AudioManager } from '../audio/audio.js';
import {
  CONFIG, DEFAULT_CONFIG, Rack, aimPhase0, frameState, makeRng, runningScore, speedOf, throwSeed,
} from '../sim/rules.js';
import { BitmapFont } from '../view/font.js';
import { DITHER, drawCard, drawNameCard } from '../view/hud.js';
import {
  drawAlley, drawBall3D, drawLane3D, drawMasking, drawPinIndicator, drawPinsAndBall, drawSweeper, initBowlSprites, proj,
} from '../view/lane3d.js';
import { C } from '../view/palette.js';
import { ParticleSystem } from '../view/particles.js';
import { drawMonitor, strikeName } from '../view/scoreboard.js';
import { KEYCAP_CACHE, SPR, drawStanding, getKeycap, initSprites, loadCharacterImages } from '../view/sprites.js';
import { KText, drawPanel } from '../view/ui.js';

const SWEEP_TIME = DEFAULT_CONFIG.FLOW.SWEEP_TIME; // 스위퍼 한 번 (내려옴 → 쓸기 → 올라감)
const SWEEP_MID = DEFAULT_CONFIG.FLOW.SWEEP_MID;   // 이때 핀을 치우거나 새로 세움
const MAX_SPIN = DEFAULT_CONFIG.RULES.MAX_SPIN_FRAMES;
const FORCE_BEFORE = 0.25;   // 제한 시간이 이만큼 남으면 지금 게이지 값으로 던진다(초)
const WAIT_LIMIT = 240;      // 서버 결과를 이만큼(프레임) 기다려도 안 오면 서버 상태로 다시 맞춘다

// 동물별 이름표 · 공 색 (원본 characters.js 의 색. 파일 이름은 동물 id 와 같다)
const COLOR_OF = { bear: 'e', cat: 'q', duck: 't', tiger: '8', shiba: 'p' };

// 조작키 (누구나 같은 키)
const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  skill: ['Space', 'Enter', 'ArrowUp'],
};
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

const round = (v, k) => Math.round(v * k) / k;

export class BowlingScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.cfg = DEFAULT_CONFIG;
    this.N = this.opt.frames || DEFAULT_CONFIG.FRAMES;
    this.seed = this.opt.seed || 0;
    this.golds = this.opt.golds || [];
    this.meId = me ? me.id : null;
    // 참가자: 원본의 고정 5명 대신 이 판에 들어온 사람들 (그림 = 대기실에서 고른 동물)
    this.players = players.map((p, i) => {
      const sprite = COLOR_OF[p.character] ? p.character : ANIMAL_ORDER[(p.index ?? i) % ANIMAL_ORDER.length];
      return {
        id: p.id, name: p.name, index: i, def: { sprite, color: COLOR_OF[sprite] || 'e' },
        rolls: [], bonus: 0, strikes: 0, spares: 0, done: false,
        n: 0, x: 0,         // (나만 씀) 다음 투구 번호 · 마지막으로 선 위치
      };
    });
    this.me = this.players.find((p) => p.id === this.meId) || null;
    this.laneNo = this.me ? this.me.index + 1 : 1;

    this.rack = new Rack(this.cfg, Math.random);
    this.lane = { up: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], gold: this.golds[0] ? this.golds[0][0] : -1 }; // 던지기 전 핀 배치
    this.rack.setUp(this.lane.up, this.lane.gold);
    this.aimAt = 0;
    this.deadline = Infinity;
    // 지금 투구 상태: wait(차례 기다림) | aim | power | roll | show | sweep | done
    this.shot = { state: 'wait', t: 0, startX: 0, aimPhase: 0, angle: 0, power: 0, powerT: 0, spinLog: [], sent: false, result: null };
    this.sweep = { t: SWEEP_TIME, mode: 'clear' };
    this.drop = 0;          // 새 핀 내려오는 연출
    this.anim = null;       // 전광판 애니메이션
    this.banner = null;
    this.caption = null;    // AI 해설 자막
    this.verdict = null;    // AI 총평
    this.results = null;    // 최종 결과(서버)
    this.shake = 0;
    this.frame = 0;
    this.clackCD = 0;
    this.muteNotice = 0;
    this.synced = false;
    this.particles = new ParticleSystem();
    this.audio = new AudioManager();
    this.down = new Set();
    this.pressed = new Set();
    this._destroyed = false;
    this._ready = false;
    this._buildDom();
  }

  // ---------------- 준비 · 정리 ----------------
  _buildDom() {
    const root = document.createElement('div');
    root.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#120a1c;overflow:hidden;';
    const canvas = document.createElement('canvas');
    canvas.width = CONFIG.WIDTH;
    canvas.height = CONFIG.HEIGHT;
    canvas.style.cssText = 'display:block;flex:none;image-rendering:pixelated;';
    root.appendChild(canvas);
    this.container.appendChild(root);
    this.root = root;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this._onKeyDown = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (BLOCK.has(e.code)) e.preventDefault();
      this.audio.unlock();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    };
    this._onKeyUp = (e) => this.down.delete(e.code);
    this._onBlur = () => this.down.clear();
    this._onPointer = () => this.audio.unlock();
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('resize', this._onResize);
    root.addEventListener('pointerdown', this._onPointer);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.container);
    }
    this._fit();
  }

  // 정수배로만 확대 (픽셀이 찌그러지지 않게), container 크기에 맞춤
  _fit() {
    const w = this.root.clientWidth || CONFIG.WIDTH * 2;
    const h = this.root.clientHeight;
    const auto = !h || h < CONFIG.HEIGHT;       // 높이가 정해지지 않은 container 면 너비만 본다
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / CONFIG.WIDTH, auto ? Infinity : h / CONFIG.HEIGHT))));
    this.canvas.style.width = `${CONFIG.WIDTH * s}px`;
    this.canvas.style.height = `${CONFIG.HEIGHT * s}px`;
  }

  async init() {
    // 픽셀 폰트를 먼저 불러와야 한글이 제대로 그려짐 (최대 3초 대기)
    try {
      const url = new URL('../assets/fonts/Galmuri11-Bold.woff2', import.meta.url).href;
      this._font = new FontFace('BowlingGalmuri11', `url(${url})`, { weight: 'bold' });
      document.fonts.add(this._font);
      await Promise.race([
        Promise.all([
          this._font.load(),
          document.fonts.load('bold 12px BowlingGalmuri11'),
          document.fonts.load('10px Galmuri9'),
          document.fonts.load('15px Galmuri14'),
        ]),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (e) {
      console.warn('[bowling] 폰트 로딩 실패, 기본 글꼴 사용', e);
    }
    await loadCharacterImages();
    if (this._destroyed) return;
    KText.clear();
    KEYCAP_CACHE.clear();
    const defs = this.players.map((p) => p.def);
    initSprites(defs);
    initBowlSprites(defs);
    this._ready = true;
    this.audio.playBgm('game');
    this.anim = { type: 'welcome', t: 0, dur: 130, text: '잭팟 볼링장', sub: `LANE ${this.laneNo} · ${this.N}프레임 · ${this.players.length}명` };
    this._last = performance.now();
    this._acc = 0;
    const loop = (ts) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      let dt = ts - this._last;
      this._last = ts;
      if (dt > 250) dt = 250; // 탭 전환 후 폭주 방지
      this._acc += dt;
      while (this._acc >= CONFIG.STEP_MS) {
        this.update();
        this._acc -= CONFIG.STEP_MS;
      }
      this.render(this.ctx);
    };
    this._raf = requestAnimationFrame(loop);
  }

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.audio.dispose();
    if (this._font) document.fonts.delete(this._font);
    KText.clear();
    KEYCAP_CACHE.clear();
    DITHER.cache.clear();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }

  // ---------------- 입력 ----------------
  anyDown(codes) {
    return codes.some((c) => this.down.has(c));
  }

  anyPressed(codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  /** 원본 Input.solo() 와 같은 모양 */
  input() {
    return { left: this.anyDown(KEYS.left), right: this.anyDown(KEYS.right), skillPressed: this.anyPressed(KEYS.skill) };
  }

  total(p) {
    return runningScore(p.rolls, this.N) + p.bonus;
  }

  // ---------------- 진행 ----------------
  update() {
    const audio = this.audio;
    this.frame++;
    if (this.pressed.has('KeyM')) {
      audio.toggleMute();
      this.muteNotice = 90;
    }
    if (this.muteNotice > 0) this.muteNotice--;
    if (this.clackCD > 0) this.clackCD--;
    if (this.drop > 0) this.drop--;
    this.particles.update();
    if (this.anim && ++this.anim.t > this.anim.dur) this.anim = null;
    if (this.banner && ++this.banner.t > 80) this.banner = null;
    if (this.caption && ++this.caption.t > 170) this.caption = null;

    const snap = this.net.snap;
    if (snap) this.applySnap(snap);
    for (const ev of this.net.takeEvents()) {
      if (ev.type === 'say') this.caption = { text: ev.text, ai: ev.source === 'gemini', t: 0 };
      else if (ev.type === 'verdict') this.verdict = ev;
      else if (ev.type === 'roll') this.onRoll(ev);
    }

    if (this.results) {
      // 최종 결과 화면: 색종이
      if (this.frame % 4 === 0) {
        const cols = [C('9'), C('8'), C('6'), C('h'), C('q'), C('b')];
        this.particles.add(Math.random() * CONFIG.WIDTH, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 2);
      }
    } else if (this.me) this.updateShot(this.input());
    this.pressed.clear();
  }

  /** 서버 상태 반영: 다른 사람 점수, 최종 결과, (처음 · 어긋났을 때) 내 레인 */
  applySnap(snap) {
    for (const p of this.players) {
      const row = snap.players && snap.players[p.id];
      if (!row) continue;
      if (p !== this.me || snap.results) {
        // 내 점수는 내 화면에서 핀이 쓰러진 뒤에 적는다(서버 상태가 조금 먼저 오므로)
        p.rolls = row.rolls;
        p.bonus = row.bonus;
        p.strikes = row.strikes;
        p.spares = row.spares;
      }
      if (p !== this.me) p.done = row.done;
    }
    if (snap.verdict && !this.verdict) this.verdict = snap.verdict;
    if (snap.results && !this.results) {
      this.results = snap.results;
      this.resultT = this.frame;
      this.particles.clear();
      this.anim = null;
      this.audio.playBgm('result');
      this.audio.sfx('win');
    }
    if (!this.synced && this.me && snap.me) this.sync(snap);
  }

  /** 내 레인을 서버 상태대로 다시 만든다 (처음 들어왔을 때 · 다시 접속했을 때 · 결과가 안 올 때) */
  sync(snap) {
    const m = snap.me;
    const row = snap.players[this.me.id];
    const me = this.me;
    this.synced = true;
    me.n = m.n;
    me.x = m.x;
    me.rolls = row.rolls;
    me.bonus = row.bonus;
    me.strikes = row.strikes;
    me.spares = row.spares;
    me.done = m.done;
    this.lane = { up: m.up, gold: m.gold };
    this.rack.setUp(m.up, m.gold);
    this.aimAt = m.aimAt;
    this.deadline = m.deadline;
    this.shot.state = m.done ? 'done' : 'wait';
    this.shot.t = 0;
  }

  // 내 차례 시작
  beginTurn() {
    const p = this.me;
    this.shot = {
      state: 'aim', t: 0, startX: p.x, aimPhase: aimPhase0(this.seed, p.n), angle: 0, power: 0, powerT: 0,
      spinLog: [], sent: false, result: null, settleT: 0, wait: 0,
    };
    const fs = frameState(p.rolls, this.N);
    if (fs.ball === 0) {
      this.banner = { text: `${fs.frame + 1}프레임`, sub: '내 차례!', t: 0, color: p.def.color };
      this.audio.sfx('select');
    }
  }

  /** 공 굴리기 시작 (내가 던졌거나, 서버가 알려 준 투구를 재생하거나) */
  launch(x, angle, power) {
    const s = this.shot;
    const p = this.me;
    s.startX = x;
    s.angle = angle;
    s.power = power;
    s.standBefore = this.rack.standing;
    const gold = this.rack.pins.find((q) => q.gold);
    s.goldPin = gold && gold.up && !gold.gone ? gold : null;
    this.rack.rng = makeRng(throwSeed(this.seed, p.n)); // 서버와 같은 씨앗 → 핀이 똑같이 튄다
    this.rack.launch(x, angle, speedOf(this.cfg, power));
    p.x = x;
    s.settleT = 0;
    s.wait = 0;
    s.state = 'roll';
    s.t = 0;
    this.audio.sfx(power > 0.85 ? 'power' : 'thud');
  }

  /** 서버가 보낸 투구 결과 */
  onRoll(ev) {
    const p = this.me;
    if (!p || ev.n !== p.n) return;
    const s = this.shot;
    if (s.state === 'roll' && s.sent && !ev.auto) {
      s.result = ev; // 내가 보낸 투구의 판정
      return;
    }
    // 서버가 대신 던졌다(제한 시간) → 서버가 정한 값으로 처음부터 굴린다
    this.rack.setUp(this.lane.up, this.lane.gold);
    this.shot = { state: 'roll', t: 0, startX: ev.x, aimPhase: 0, angle: ev.angle, power: ev.power, powerT: 0, spinLog: ev.spin || [], sent: true, result: ev };
    this.launch(ev.x, ev.angle, ev.power);
  }

  updateShot(inp) {
    const s = this.shot;
    const p = this.me;
    const audio = this.audio;
    const snap = this.net.snap;
    s.t++;
    if (s.state === 'wait') {
      if (snap && snap.phase === 'play' && this.net.now() >= this.aimAt) this.beginTurn();
    } else if (s.state === 'aim') {
      // 위치 옮기기 + 방향 화살표가 좌우로 흔들림
      const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      s.startX = Math.max(-CONFIG.START_RANGE, Math.min(CONFIG.START_RANGE, s.startX + dx * CONFIG.MOVE_SPEED));
      s.aimPhase += CONFIG.AIM_SPEED;
      s.angle = Math.sin(s.aimPhase) * CONFIG.AIM_MAX;
      const forced = this.net.now() >= this.deadline - FORCE_BEFORE; // 제한 시간 → 지금 값으로
      if ((inp.skillPressed && s.t > 12) || forced) {
        // 서버로 보낼 값이므로 소수 자리를 정해 둔다(양쪽이 정확히 같은 수로 계산하게)
        s.startX = round(s.startX, 100);
        s.angle = round(s.angle, 10000);
        s.state = 'power';
        s.powerT = 0;
        s.t = 0;
        audio.sfx('lock');
      }
    } else if (s.state === 'power') {
      // 힘 게이지가 오르내림 (0 → 100% → 0 …)
      s.powerT++;
      const u = (s.powerT / (CONFIG.POWER_PERIOD / 2)) % 2;
      s.power = 1 - Math.abs(1 - u);
      const forced = this.net.now() >= this.deadline - FORCE_BEFORE;
      if ((inp.skillPressed && s.powerT > 3) || forced) this.launch(s.startX, s.angle, round(s.power, 1000));
    } else if (s.state === 'roll') {
      const b = this.rack.ball;
      let spin = 0;
      if (!s.sent) {
        // 스핀을 넣을 수 있는 동안은 입력을 기록하고, 끝나면 투구 값을 서버로 보낸다
        const open = !b.gone && !b.gutter && b.spin > 0 && b.y < CONFIG.LANE.HEAD_Y - 4 && s.spinLog.length < MAX_SPIN;
        if (open) {
          spin = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
          s.spinLog.push(spin);
        } else {
          this.net.throwBall(p.n, s.startX, s.angle, s.power, s.spinLog);
          s.sent = true;
        }
      } else spin = s.spinLog[s.t - 1] || 0;
      const ev = this.rack.step(spin);
      if (spin && b.spin > 0 && !b.gutter && b.y < CONFIG.LANE.HEAD_Y - 4 && s.t % 3 === 0) {
        const q = proj(b.x, b.y);
        this.particles.add(q.x - spin * 4, q.y - 2, -spin * 0.5, 0.2, 14, C('h'), 1);
      }
      // 굴러가는 소리: 핀에 가까워질수록 촘촘해짐 (두구두구…)
      const near = Math.max(0, Math.min(1, b.y / CONFIG.LANE.HEAD_Y));
      const gap = Math.max(3, Math.round(9 - near * 6));
      if (s.t % gap === 0 && !b.gone && b.y < CONFIG.LANE.HEAD_Y) audio.sfx('tick');
      if (ev.pinHits) {
        if (this.clackCD === 0) {
          audio.sfx('clack');
          this.clackCD = 4;
        }
        const q = proj(b.x, Math.max(b.y, CONFIG.LANE.HEAD_Y));
        this.particles.burst(q.x, q.y - 8, 4 * ev.pinHits, [C('b'), C('k'), C('6')], 1.4, 18, 1);
        this.shake = Math.min(8, this.shake + ev.pinHits * 2); // 핀이 와르르 → 화면 흔들림
      }
      if (ev.gutter) audio.sfx('miss');
      if (b.gone) s.settleT++;
      if ((b.gone && this.rack.settled) || s.settleT > CONFIG.SETTLE_TIME) {
        if (s.result) this.countPins(s.result);
        else if (++s.wait > WAIT_LIMIT && snap && snap.me) this.sync(snap); // 결과가 안 온다 → 서버 상태로
      }
    } else if (s.state === 'show') {
      this.rack.step(0); // 핀이 마저 굴러가게
      if (s.t >= s.showTime) this.afterShow();
    } else if (s.state === 'sweep') {
      const sw = this.sweep;
      const next = s.result.next;
      sw.t++;
      if (sw.t === 4) audio.sfx('deal');
      if (sw.t === SWEEP_MID) {
        // 서버가 알려 준 다음 핀 배치 (새로 세우기 / 쓰러진 핀만 치우기)
        this.rack.setUp(next.up, next.gold);
        if (sw.mode === 'reset') {
          this.drop = 14;
          audio.sfx('drop');
        }
      }
      if (sw.t >= SWEEP_TIME) {
        this.aimAt = s.result.aimAt;
        this.deadline = s.result.deadline;
        this.beginTurn();
      }
    }
  }

  // 공이 들어가고 핀이 멈춤 → 서버 판정대로 점수 적기 + 전광판 연출
  countPins(res) {
    const s = this.shot;
    const p = this.me;
    const audio = this.audio;
    // 내 화면의 핀과 서버 판정이 다르면(있어서는 안 되지만) 서버 결과대로 고친다
    const mine = this.rack.upMask();
    if (mine.some((v, i) => v !== res.up[i])) {
      console.warn('[bowling] 화면과 서버 판정이 달라 서버 결과로 맞춤', mine, res.up);
      this.rack.pins.forEach((q, i) => {
        if (!res.up[i] && q.up && !q.gone) Object.assign(q, { up: false, fall: 1 });
      });
    }
    const knocked = res.knocked;
    p.rolls = res.rolls;
    p.bonus = res.bonus;
    p.strikes = res.strikes;
    p.spares = res.spares;
    p.done = res.done;
    p.n = res.n + 1;
    if (res.next) this.lane = { up: res.next.up, gold: res.next.gold };
    const head = proj(0, CONFIG.LANE.HEAD_Y + 8);
    const sub = `${p.name} · ${knocked}핀`;
    let anim = null;
    if (res.kind === 'strike') {
      anim = { type: 'strike', text: strikeName(res.streak), sub: p.name };
      this.particles.explode(head.x, head.y - 6, true);
      this.shake = 10;
      // 볼러 머리 위로 색종이
      const bx = proj(s.startX, -8).x + 16;
      for (let i = 0; i < 26; i++) this.particles.add(bx + (Math.random() - 0.5) * 30, 120, (Math.random() - 0.5) * 2, -1.5 - Math.random() * 1.5, 60, C(['9', '5', 'h', 'e', 'q', 'b'][i % 6]), 2, 0.06);
      audio.sfx('jackpot');
    } else if (res.kind === 'spare') {
      anim = { type: 'spare', text: '스페어!', sub: p.name };
      this.particles.burst(head.x, head.y - 6, 24, [C('h'), C('g'), C('b')], 1.6, 34, 1);
      audio.sfx('coin');
    } else if (res.kind === 'gutter') {
      anim = { type: 'gutter', text: '거터…', sub: p.name };
    } else if (res.kind === 'split') {
      anim = { type: 'split', text: '스플릿!', sub };
      audio.sfx('warning');
    } else if (knocked >= 7) audio.sfx('chip');
    // 잭팟 핀
    if (res.jackpot) {
      const bonus = this.opt.jackpotBonus || CONFIG.JACKPOT_BONUS;
      const extra = `잭팟 핀 +${bonus}`;
      if (anim) anim.extra = extra;
      else anim = { type: 'jackpot', text: '잭팟 핀!', sub, extra: `+${bonus}점` };
      const pin = s.goldPin || this.rack.pins[0];
      const g = proj(pin.x, pin.y);
      for (let i = 0; i < 14; i++) this.particles.add(g.x, g.y - 6, (Math.random() - 0.5) * 1.8, -0.8 - Math.random(), 50, C(i % 3 ? '9' : 't'), 2, 0.05);
      audio.sfx('golden');
    }
    if (anim) this.anim = { ...anim, t: 0, dur: anim.type === 'jackpot' ? 80 : 110, color: p.index };
    s.showTime = anim ? Math.min(this.anim.dur, 100) : 50;
    s.state = 'show';
    s.t = 0;
  }

  // 결과 보여 준 뒤: 스위퍼(쓰러진 핀 치우기 / 새로 세우기) 또는 끝
  afterShow() {
    const s = this.shot;
    if (s.result.done) {
      s.state = 'done';
      this.rack.ball = null;
      return;
    }
    this.sweep = { t: 0, mode: s.result.next.reset ? 'reset' : 'clear' };
    s.state = 'sweep';
    s.t = 0;
  }

  // ---------------- 그리기 ----------------
  render(ctx) {
    if (!this._ready) return;
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    if (this.results) this.renderResult(ctx);
    else this.renderPlay(ctx);
    if (this.muteNotice > 0) {
      const txt = this.audio.muted ? '소리 끔' : '소리 켬';
      drawPanel(ctx, W - 60, CONFIG.HEIGHT - 26, 54, 20, 'dark');
      KText.draw(ctx, txt, W - 33, CONFIG.HEIGHT - 22, C('a'), { align: 'center', font: 's' });
    }
  }

  renderPlay(ctx) {
    const W = CONFIG.WIDTH;
    const s = this.shot;
    const p = this.me;
    if (this.shake > 0) this.shake -= 0.5;
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.round((Math.random() - 0.5) * this.shake * 0.6), Math.round((Math.random() - 0.5) * this.shake * 0.4));
    drawLane3D(ctx, this.frame);
    drawMasking(ctx, this.frame, this.laneNo);
    drawPinsAndBall(ctx, this.rack, p ? p.index : 0, this.drop);
    if (s.state === 'sweep') drawSweeper(ctx, this.sweep.t / SWEEP_TIME);
    if (p) this.renderBowler(ctx);
    this.particles.render(ctx);
    ctx.restore();
    this.renderSidePanels(ctx);
    const frameNo = p ? Math.min(this.N - 1, frameState(p.rolls, this.N).frame) : 0;
    drawMonitor(ctx, {
      players: this.players, cur: p && s.state !== 'done' ? p.index : -1, frameNo, anim: this.anim, frame: this.frame,
      laneNo: this.laneNo, frames: this.N,
    });
    // 차례 안내
    if (this.banner && this.banner.t < 70) {
      const b = this.banner;
      const slide = Math.max(0, 8 - b.t) * 10;
      drawCard(ctx, W / 2 - 50 + slide, 116, 100, 30, '1', b.color);
      KText.draw(ctx, b.text, W / 2 + slide, 118, C(b.color), { align: 'center', font: 'b', outline: C('1') });
      KText.draw(ctx, b.sub, W / 2 + slide, 132, C('a'), { align: 'center', font: 'n' });
    }
    // 제한 시간이 5초 아래로 남으면 숫자로 알림
    if (p && (s.state === 'aim' || s.state === 'power')) {
      const left = this.deadline - this.net.now();
      if (left <= 5 && this.frame % 30 < 22) BitmapFont.draw(ctx, String(Math.max(0, Math.ceil(left))), W / 2, 122, C('5'), { align: 'center', scale: 2, outline: C('1') });
    }
    if (p && s.state === 'done') {
      drawCard(ctx, W / 2 - 62, 116, 124, 30, '1', '9');
      KText.draw(ctx, '내 게임 끝!', W / 2, 118, C('9'), { align: 'center', font: 'b', outline: C('1') });
      KText.draw(ctx, '다른 레인을 기다리는 중', W / 2, 132, C('a'), { align: 'center', font: 'n' });
    }
    this.renderCaption(ctx);
  }

  // AI 해설 자막 (원본에는 자막 자리가 없어서 화면 아래에 작은 줄로 보여 준다). AI 가 쓴 줄에는 "AI" 표시
  renderCaption(ctx) {
    const c = this.caption;
    if (!c || !c.text) return;
    const W = CONFIG.WIDTH;
    const tw = KText.width(c.text, 'n');
    const badge = c.ai ? 13 : 0;
    const w = Math.min(W - 4, tw + badge + 10);
    const x = Math.round(W / 2 - w / 2);
    const y = CONFIG.HEIGHT - 15;
    drawCard(ctx, x, y, w, 14, '1', '3');
    ctx.fillStyle = C('1');
    ctx.fillRect(x + 3, y + 2, w - 6, 1);
    if (c.ai) {
      ctx.fillStyle = C('g');
      ctx.fillRect(x + 4, y + 3, 11, 8);
      BitmapFont.draw(ctx, 'AI', x + 6, y + 5, C('b'));
    }
    KText.draw(ctx, c.text, x + 5 + badge, y + 1, C('a'), { font: 'n' });
  }

  // 볼러 + 들고 있는 공 + 조준 화살표
  renderBowler(ctx) {
    const s = this.shot;
    const p = this.me;
    const holding = s.state === 'aim' || s.state === 'power';
    if (holding) {
      // 조준 도우미: 스핀 없이 굴렸을 때 공이 갈 길을 핀 앞까지 옅게 (거터면 빨강)
      for (let k = 42; k <= CONFIG.LANE.HEAD_Y; k += 3) {
        const gx = s.startX + s.angle * k;
        const q = proj(gx, k);
        ctx.fillStyle = C(Math.abs(gx) > CONFIG.LANE.HALF ? '5' : 'k');
        ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
      // 방향 화살표 (원근 점선, 멈추면 실선)
      const locked = s.state === 'power';
      for (let k = 4; k <= 40; k += locked ? 1 : 2.5) {
        const q = proj(s.startX + s.angle * k, k);
        ctx.fillStyle = locked ? C('8') : C('9');
        ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
      const tip = proj(s.startX + s.angle * 40, 40);
      ctx.fillStyle = locked ? C('8') : C('9');
      ctx.fillRect(Math.round(tip.x) - 1, Math.round(tip.y) + 1, 3, 1);
      ctx.fillRect(Math.round(tip.x), Math.round(tip.y), 1, 1);
    }
    // 볼러: 공 오른쪽에 서서 (던진 뒤엔 그 자리에서 지켜봄)
    const standX = s.state === 'wait' || s.state === 'done' ? p.x : s.startX;
    const bx = proj(standX, -8).x;
    const sp = SPR.players[p.index];
    const happy = this.anim && (this.anim.type === 'strike' || this.anim.type === 'spare') && this.anim.t < 60;
    const sad = this.anim && this.anim.type === 'gutter';
    const hop = happy ? Math.round(Math.abs(Math.sin(this.anim.t / 5)) * 4) : 0;
    const img = sad ? sp.ghost : sp.frames[((this.frame / 18) | 0) % 2];
    drawStanding(ctx, img, Math.round(bx + 16), CONFIG.HEIGHT + 3 - hop);
    if (holding) drawBall3D(ctx, { x: s.startX, y: -9 }, p.index);
  }

  // 왼쪽: 선수 목록 (얼굴 · 이름 · 점수) / 오른쪽: 내 이름 · 핀 표시판 · 조작키 · 힘/스핀
  renderSidePanels(ctx) {
    const s = this.shot;
    const p = this.me;
    // 왼쪽 선수 목록 — 다른 사람들의 지금 점수
    const n = this.players.length;
    const rowH = 20;
    const y0 = 77 + Math.floor((100 - n * rowH) / 2);
    const best = Math.max(...this.players.map((q) => this.total(q)));
    this.players.forEach((q, i) => {
      const y = y0 + i * rowH;
      const on = q === p;
      drawCard(ctx, 0, y, 66, rowH - 1, on ? '7' : '1', on ? '9' : q.def.color);
      ctx.fillStyle = C(on ? '7' : '1'); // 반짝 줄은 글자와 겹치니 지움
      ctx.fillRect(3, y + 2, 56, 1);
      ctx.drawImage(SPR.players[q.index].face, 1, y);
      KText.draw(ctx, q.name, 21, y, C(q.def.color), { font: 'n' });
      // 아랫줄: 점수 (오른쪽, 1등은 금색) + 다 친 사람은 END
      const sc = this.total(q);
      if (q.done) BitmapFont.draw(ctx, 'END', 22, y + 11, C('j'));
      BitmapFont.draw(ctx, String(sc), 62, y + 11, C(sc === best && sc > 0 ? '9' : 'b'), { align: 'right' });
    });
    if (!p) return;
    // 오른쪽: 나
    const x0 = 256;
    drawCard(ctx, x0, 77, 64, 101, '1', '3');
    drawNameCard(ctx, x0 + 2, 79, 60, { def: p.def, name: p.name, index: p.index, place: null }, this.frame);
    const fs = frameState(p.rolls, this.N);
    const ballNo = fs.done ? '끝' : `${fs.frame + 1}프레임 ${Math.min(fs.ball, 2) + 1}구`;
    KText.draw(ctx, ballNo, x0 + 32, 96, C('a'), { align: 'center', font: 'n', outline: C('1') });
    drawPinIndicator(ctx, x0 + 32, 110, this.rack);
    // 조작키 — 누르고 있는 키가 밝게
    const held = [this.anyDown(KEYS.left), this.anyDown(KEYS.skill), this.anyDown(KEYS.right)];
    const caps = ['<', '^', '>'].map((k, j) => getKeycap(k, j === 1 ? 'strike' : 'plain', held[j]));
    const tw = caps.reduce((a, c) => a + c.width, 0);
    let kx = Math.round(x0 + 32 - tw / 2);
    caps.forEach((c) => {
      ctx.drawImage(c, kx, 128);
      kx += c.width;
    });
    const hint = s.state === 'aim' ? (this.frame % 120 < 60 ? '←→ 위치' : 'Space=방향') : s.state === 'power' ? 'Space=힘' : s.state === 'roll' ? '←→ 스핀!' : '';
    if (hint) KText.draw(ctx, hint, x0 + 32, 145, C('9'), { align: 'center', font: 'n', outline: C('1') });
    // 힘 · 스핀 게이지 (글자와 막대가 겹치지 않게)
    const bar = (label, k, col, y) => {
      KText.draw(ctx, label, x0 + 4, y - 3, C('k'), { font: 'n' });
      ctx.fillStyle = C('o');
      ctx.fillRect(x0 + 25, y, 35, 7);
      ctx.fillStyle = C(col);
      ctx.fillRect(x0 + 26, y + 1, Math.round(33 * k), 5);
      ctx.fillStyle = C('w');
      ctx.fillRect(x0 + 26, y + 1, Math.round(33 * k), 1);
    };
    const pw = s.state === 'power' || s.state === 'roll' || s.state === 'show' ? s.power : 0;
    bar('힘', pw, pw > 0.85 ? '5' : pw > 0.5 ? '9' : 'e', 160);
    const b = this.rack.ball;
    const spin = s.state === 'roll' && b ? b.spin / CONFIG.SPIN_BUDGET : s.state === 'aim' || s.state === 'power' ? 1 : 0;
    bar('스핀', spin, 'h', 170);
  }

  // 최종 순위 (원본 result.js): 합계 점수 순, 같으면 스트라이크 · 스페어 많은 순 + AI 총평
  renderResult(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.frame - this.resultT;
    drawAlley(ctx, t);
    this.particles.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, -3, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const rows = this.results;
    const rowH = 26;
    const y0 = 32;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.players.find((pp) => pp.id === r.playerId);
      if (!p) return;
      const st = r.stats || {};
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 12;
      const x = 14 - slide; // 왼쪽에서 들어옴
      const y = y0 + i * rowH;
      drawCard(ctx, x, y, 292, rowH - 3, r.rank === 1 ? '7' : '2', r.rank === 1 ? '9' : '3');
      BitmapFont.draw(ctx, String(r.rank), x + 13, y + 6, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      drawNameCard(ctx, x + 26, y + 3, 84, { def: p.def, name: p.name, index: p.index, place: null }, t);
      if (r.rank === 1) ctx.drawImage(SPR.crown, x + 32, y);
      KText.draw(ctx, `${r.score}점`, x + 116, y + 4, C('9'), { font: 'b', outline: C('1') });
      // 스트라이크 · 스페어 · 잭팟 (아이콘처럼 한 줄 · 글자 간격 넉넉하게)
      KText.draw(ctx, `X ${st.strikes || 0}`, x + 166, y + 4, C('5'), { font: 's', outline: C('1') });
      KText.draw(ctx, `/ ${st.spares || 0}`, x + 196, y + 4, C('h'), { font: 's', outline: C('1') });
      if (st.bonus) KText.draw(ctx, `잭팟+${st.bonus}`, x + 226, y + 5, C('9'), { font: 'n', outline: C('1') });
      if (p === this.me) KText.draw(ctx, '나', x + 286, y + 4, C('e'), { font: 'b', align: 'right' });
    });
    // AI 총평: 한 줄 총평 → 1등에게 → 꼴찌에게 차례로
    const v = this.verdict;
    if (v && v.headline) {
      const lines = [v.headline, v.mvp, v.cheer].filter(Boolean);
      const text = lines[Math.floor(t / 150) % lines.length];
      const y = CONFIG.HEIGHT - 15;
      drawCard(ctx, 2, y, W - 4, 14, '1', 'g');
      ctx.fillStyle = C('1');
      ctx.fillRect(5, y + 2, W - 14, 1);
      KText.draw(ctx, 'AI 총평', 6, y + 1, C('h'), { font: 'n' });
      KText.draw(ctx, text, 50, y + 1, C('a'), { font: 'n' });
    }
  }
}
