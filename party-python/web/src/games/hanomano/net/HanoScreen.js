// =============================================================
// 하노마노 — 화면 (멀티플레이)
//
// 판정 · 카드 · 차례 · 순위는 서버가 정한다. 여기서는
//  - 서버가 보낸 상태(누가 몇 장, 펼쳐진 카드, 차례)를 원본과 같은 테이블 화면으로 그리고,
//  - 사건(뒤집기 · 종 · 다시 모으기 · 해설)에 맞춰 원본의 연출과 소리를 내고,
//  - 내 키 입력(Z 뒤집기 · Space 종)을 서버로 보낸다.
// 그리기 코드는 원본 js/scenes/play.js · result.js 를 옮긴 것이다.
// 자리는 차례 순서를 유지한 채, 내 자리가 항상 아래쪽 첫 자리에 오도록 돌려서 보여 준다.
// =============================================================
import { CARD_H, CARD_W, cardBack, cardFace, drawBell } from '../gfx/cards.js';
import { C, CHARACTER_COLOR, DARK_OF } from '../gfx/palette.js';
import { ParticleSystem } from '../gfx/particles.js';
import { boldFontUrl, buildFace, crownSprite, loadMiniImages } from '../gfx/sprites.js';
import { BOLD_FAMILY, BitmapFont, KText } from '../gfx/text.js';
import { DITHER, clearUiCache, drawCard, drawNameCard, drawPanel, getKeycap } from '../gfx/ui.js';
import { CONFIG } from '../sim/rules.js';
import { HanoAudio } from './HanoAudio.js';

const W = 320;
const H = 180;
const STEP_MS = 1000 / 60;      // 연출은 원본처럼 60분의 1초 단위로 센다
const ANIMALS = ['shiba', 'tiger', 'duck', 'bear', 'cat'];
const KEY_FLIP = 'KeyZ';
const KEY_BELL = 'Space';

// 자리 (블록 왼쪽 위). 인원에 따라 쓰는 자리 — 원본 그대로
const SEATS = [
  { x: 4, y: 118 },   // 0 왼쪽 아래
  { x: 110, y: 118 }, // 1 가운데 아래
  { x: 216, y: 118 }, // 2 오른쪽 아래
  { x: 216, y: 16 },  // 3 오른쪽 위
  { x: 4, y: 16 },    // 4 왼쪽 위
];
const SEAT_ORDER = { 1: [1], 2: [0, 2], 3: [1, 3, 4], 4: [0, 2, 3, 4], 5: [0, 1, 2, 3, 4] };
const BELL = { x: 160, y: 80 };

const CSS = `
.hn-root { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #120a1c; overflow: hidden; }
.hn-root > canvas { display: block; flex: none; image-rendering: pixelated; image-rendering: crisp-edges; }
`;

export class HanoScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.rules = { ...CONFIG.RULES, ...(this.opt.rules || {}) };
    this.flow = { ...CONFIG.FLOW, ...(this.opt.flow || {}) };
    this.meId = me ? me.id : null;

    // 자리: 서버가 정한 차례 순서(order) 그대로, 내가 첫 자리에 오도록 돌린다
    const order = Array.isArray(this.opt.order) && this.opt.order.length ? this.opt.order : players.map((p) => p.id);
    const n = order.length;
    const myIdx = Math.max(0, order.indexOf(this.meId));
    const slots = SEAT_ORDER[n] || SEAT_ORDER[5];
    this.seats = order.map((id, i) => {
      const p = players.find((x) => x.id === id) || { id, name: id, index: i };
      const character = ANIMALS.includes(p.character) ? p.character : ANIMALS[(p.index ?? i) % ANIMALS.length];
      return {
        id, name: p.name || id, character, colorKey: CHARACTER_COLOR[character], color: C(CHARACTER_COLOR[character]),
        seat: SEATS[slots[(i - myIdx + n) % n]], isMe: id === this.meId,
        face: null,          // 얼굴 아이콘(그림을 불러온 뒤 만든다)
        fly: 0,              // 뒤집은 카드가 날아가는 중(남은 프레임)
        hold: [],            // 날아가는 동안 보여 줄, 뒤집기 전의 펼친 카드
        lastShow: [],
      };
    });
    this.byId = new Map(this.seats.map((s) => [s.id, s]));

    this.frame = 0;
    this.particles = new ParticleSystem();
    this.confetti = new ParticleSystem();
    this.fx = [];            // 날아가는 카드 연출
    this.msg = null;         // 가운데 안내 { text, color, sub, t }
    this.sayLine = null;     // AI 해설 한 줄 { text, ai, who, t }
    this.bellShake = 0;
    this.bellHand = null;    // 종을 친 사람 얼굴 { seat, t }
    this.reveal = null;      // 종을 친 순간 펼쳐져 있던 카드 + 판정 { tops, why, t }
    this.shake = 0;
    this.muteNotice = 0;
    this.dealT = 0;
    this.finalT = 0;
    this.prevPhase = null;
    this.lastSec = null;
    this.results = null;
    this.verdict = null;
    this.down = { flip: false, bell: false };
    this.ready = false;      // 그림 · 글꼴을 다 불러왔는지
    this._destroyed = false;

    this._buildDom();
    this.audio = new HanoAudio();
    this.audio.playBgm('game');
    this._bindInput();
    this._load();

    this._last = performance.now();
    this._acc = 0;
    const loop = (ts) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      let dt = ts - this._last;
      this._last = ts;
      if (dt > 250) dt = 250;          // 탭 전환 후 폭주 방지
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
    clearTimeout(this._loadTimer);
    this.audio.destroy();
    if (this._fontFace && document.fonts) document.fonts.delete(this._fontFace);
    this.root.remove();
    this.styleEl.remove();
  }

  // ---------------- 준비 ----------------
  _buildDom() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    this.root = document.createElement('div');
    this.root.className = 'hn-root';
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.root.appendChild(this.canvas);
    this.container.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.autoHeight = this.container.clientHeight === 0;
    this._onResize = () => this._fit();
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this.container);
    }
    this._fit();
  }

  // container 크기에 맞춰 정수배로만 확대 (픽셀이 찌그러지지 않게)
  _fit() {
    const w = this.root.clientWidth || W * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / W, h / H))));
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${H * s}px`;
    if (this.autoHeight) this.root.style.height = `${H * s}px`;
  }

  /** 얼굴 그림과 글꼴을 불러온다. 다 되면(또는 3초가 지나면) 그리기 시작 */
  _load() {
    const jobs = [];
    jobs.push(loadMiniImages().then((imgs) => {
      if (this._destroyed) return;
      for (const s of this.seats) s.face = buildFace(imgs[s.character]);
    }));
    try {
      if (typeof FontFace !== 'undefined' && document.fonts) {
        this._fontFace = new FontFace(BOLD_FAMILY, `url(${boldFontUrl()}) format('woff2')`);
        document.fonts.add(this._fontFace);
        jobs.push(this._fontFace.load());
        // 공용 글꼴(web/src/fonts.css 의 Galmuri9 · Galmuri14)도 그리기 전에 불러 둔다
        jobs.push(document.fonts.load('10px Galmuri9', '가'));
        jobs.push(document.fonts.load('15px Galmuri14', '가'));
      }
    } catch (err) {
      console.warn('[hanomano] 글꼴을 불러오지 못함', err);
    }
    const start = () => {
      if (this.ready || this._destroyed) return;
      KText.clear();           // 글꼴이 오기 전에 만들어진 글씨가 있으면 버린다
      clearUiCache();
      this.ready = true;
    };
    Promise.all(jobs.map((j) => Promise.resolve(j).catch(() => null))).then(start);
    this._loadTimer = setTimeout(start, 3000);
  }

  _bindInput() {
    this._onKeyDown = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.audio.unlock();
      if (e.code === KEY_BELL || e.code === KEY_FLIP) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyM') {
        this.audio.toggleMute();
        this.muteNotice = 90;
      } else if (e.code === KEY_FLIP) {
        this.down.flip = true;
        this._pressFlip();
      } else if (e.code === KEY_BELL) {
        this.down.bell = true;
        this._pressBell();
      }
    };
    this._onKeyUp = (e) => {
      if (e.code === KEY_FLIP) this.down.flip = false;
      if (e.code === KEY_BELL) this.down.bell = false;
    };
    this._onBlur = () => {
      this.down.flip = false;
      this.down.bell = false;
    };
    this._onPointer = () => this.audio.unlock();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('pointerdown', this._onPointer);
  }

  // ---------------- 입력 ----------------
  _pressFlip() {
    const snap = this.net.snap;
    if (!snap || snap.phase !== 'play' || !this.meId || snap.turn !== this.meId) return;
    this.net.flip();
  }

  _pressBell() {
    const snap = this.net.snap;
    if (!snap || snap.phase !== 'play' || !this.meId) return;
    const mine = (snap.players || []).find((p) => p.id === this.meId);
    if (mine && mine.lock > this.net.now()) {
      this.audio.sfx('miss');        // 손 얼얼 — 아직 종을 못 친다
      return;
    }
    this.audio.sfx('tap');           // 눌렀다는 표시만 먼저(판정은 서버가 한다)
    this.net.bell();
  }

  // ---------------- 서버 상태에서 읽는 값 ----------------
  _data(id) {
    const snap = this.net.snap;
    const d = snap && snap.players ? snap.players.find((p) => p.id === id) : null;
    return d || { id, deck: this.opt.each || 0, pile: 0, show: [], lock: 0, correct: 0, wrong: 0, connected: true };
  }

  /** 남은 시간(초) */
  _timeLeft() {
    const snap = this.net.snap;
    if (!snap) return this.rules.TIME_LIMIT;
    if (typeof snap.endAt === 'number') return Math.max(0, snap.endAt - this.net.now());
    return snap.timeLeft ?? 0;
  }

  // ---------------- 진행(연출) ----------------
  _update() {
    this.frame++;
    if (this.muteNotice > 0) this.muteNotice--;
    if (this.bellShake > 0) this.bellShake--;
    if (this.shake > 0) this.shake--;
    if (this.reveal && ++this.reveal.t > 80) this.reveal = null;
    if (this.bellHand && ++this.bellHand.t > 24) this.bellHand = null;
    if (this.msg && ++this.msg.t > 90) this.msg = null;
    if (this.sayLine && ++this.sayLine.t > 210) this.sayLine = null;
    for (const f of this.fx) f.t++;
    this.fx = this.fx.filter((f) => f.t <= f.dur);
    this.particles.update();

    for (const ev of this.net.takeEvents()) this._onEvent(ev);

    const snap = this.net.snap;
    const phase = snap ? snap.phase : 'intro';
    if (phase !== this.prevPhase) {
      if (phase === 'deal') {
        this.dealT = 0;
        this.audio.sfx('go');
      } else if (phase === 'final') {
        this.finalT = 0;
        this.audio.playBgm('result');
        this.audio.sfx('win');
      }
      this.prevPhase = phase;
    }
    if (snap) {
      if (!this.results && snap.results) this.results = snap.results;
      if (!this.verdict && snap.verdict) this.verdict = snap.verdict;
    }

    if (phase === 'deal') {
      // 나눠주는 연출: 카드가 자리로 휙휙
      this.dealT++;
      if (this.dealT % 3 === 0 && this.dealT < 60) {
        const p = this.seats[(this.dealT / 3) % this.seats.length];
        this._flyCard(BELL.x - CARD_W / 2, BELL.y - CARD_H / 2, p.seat.x + 38, p.seat.y + 22, null, 14, 0.4);
        this.audio.sfx('deal');
      }
    }
    if (phase === 'play' || phase === 'collect' || phase === 'wrong') {
      // 마지막 10초는 1초마다 '삑'
      const sec = Math.ceil(this._timeLeft());
      if (this.lastSec !== null && sec !== this.lastSec && sec > 0 && sec <= 10) this.audio.sfx('countdown');
      this.lastSec = sec;
    }
    // 뒤집는 카드 착지
    for (const s of this.seats) {
      if (s.fly > 0 && --s.fly <= 0) this.audio.sfx('flip');
    }
    if (phase === 'final' || phase === 'done') {
      this.finalT++;
      if (this.finalT % 4 === 0) {
        const cols = [C('9'), C('8'), C('6'), C('d'), C('q'), C('b')];
        this.confetti.add(Math.random() * W, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 2);
      }
      this.confetti.update();
    }
  }

  _onEvent(ev) {
    const audio = this.audio;
    const p = ev.playerId ? this.byId.get(ev.playerId) : null;
    if (ev.type === 'go') {
      this._say('같은 과일이 딱 5개면 종!', '9');
      audio.sfx('go');
    } else if (ev.type === 'flip' && p) {
      // 카드가 덱에서 내 앞으로 뒤집히며 날아간다(8프레임). 그동안은 뒤집기 전 카드를 보여 준다
      p.hold = p.fly > 0 ? p.hold : p.lastShow.slice();
      p.fly = 8;
      this._flyCard(p.seat.x + 38, p.seat.y + 22, p.seat.x + 2, p.seat.y + 4, ev.card, 8, 0);
    } else if (ev.type === 'ring' && p) {
      this._onRing(ev, p);
    } else if (ev.type === 'reshuffle') {
      this._say('카드를 다시 모아서 계속!', 'h');
      audio.sfx('deal');
    } else if (ev.type === 'end') {
      this._say(ev.text || '게임 끝!', '9');
      audio.sfx('timeup');
    } else if (ev.type === 'final') {
      if (ev.results) this.results = ev.results;
    } else if (ev.type === 'say') {
      this.sayLine = { text: ev.text, ai: ev.source === 'gemini', who: ev.who || '', t: 0 };
    } else if (ev.type === 'verdict') {
      this.verdict = { headline: ev.headline, mvp: ev.mvp, cheer: ev.cheer };
    }
  }

  // 종을 침 (원본 ring())
  _onRing(ev, p) {
    const audio = this.audio;
    this.bellShake = 16;
    this.bellHand = { seat: p, t: 0 };
    audio.sfx('bell');
    this.particles.ring(BELL.x, BELL.y - 6, 2, C('9'), 14);
    this.particles.text(BELL.x + 30, BELL.y - 10, '딩!', C('9'), { kind: 'k', life: 30 });
    this.shake = 8;
    this.reveal = { tops: ev.tops || [], why: { ok: !!ev.ok, fruit: ev.fruit }, t: 0 };
    for (const s of this.seats) s.fly = 0;
    if (ev.ok) {
      // 성공: 펼친 카드가 우르르 날아옴
      let fly = 0;
      for (const q of this.seats) {
        const count = Math.min(6, (ev.piles && ev.piles[q.id]) || 0);
        for (let k = 0; k < count; k++) {
          this._flyCard(q.seat.x + 2, q.seat.y + 4, p.seat.x + 38, p.seat.y + 22, null, 18 + k * 2, 0.15 + fly * 0.04);
          fly++;
        }
      }
      this._say(`${p.name} 종! +${ev.got || 0}장`, '9', ev.text);
      audio.sfx('jackpot');
      this.particles.burst(BELL.x, BELL.y - 10, 24, [C('9'), C('b'), C('8'), p.color], 2.2, 30, 1, 0.04);
    } else {
      // 실패: 다른 사람에게 1장씩 + 손 얼얼
      for (const id of ev.to || []) {
        const q = this.byId.get(id);
        if (q) this._flyCard(p.seat.x + 36, p.seat.y + 22, q.seat.x + 36, q.seat.y + 22, null, 18, 0.3);
      }
      this._say(`${p.name} 틀림! ${ev.gave ? `-${ev.gave}장` : '손 얼얼'}`, '5', ev.text);
      audio.sfx('bust');
    }
  }

  _say(text, color, sub = null) {
    this.msg = { text, color, sub, t: 0 };
  }

  // 날아가는 카드 연출 (card 가 있으면 앞면으로 뒤집히며 감)
  _flyCard(x0, y0, x1, y1, card, dur, delay) {
    this.fx.push({ x0, y0, x1, y1, card, dur, t: -Math.round(delay * dur) });
  }

  // ---------------- 그리기 ----------------
  _render() {
    const ctx = this.ctx;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, H);
    if (!this.ready) return;
    const snap = this.net.snap;
    const phase = snap ? snap.phase : 'intro';
    if (phase === 'final' || phase === 'done') {
      this._renderResult(ctx);
    } else {
      this._renderPlay(ctx, snap, phase);
    }
    if (this.muteNotice > 0) {
      const txt = this.audio.muted ? '소리 끔' : '소리 켬';
      drawPanel(ctx, W - 60, H - 26, 54, 20, 'dark');
      KText.draw(ctx, txt, W - 33, H - 22, C('a'), { align: 'center', font: 's' });
    }
  }

  _renderPlay(ctx, snap, phase) {
    ctx.save();
    if (this.shake > 0) ctx.translate(Math.round(Math.sin(this.shake * 2.3) * Math.min(2, this.shake / 3)), 0);
    this._renderTable(ctx, this._timeLeft());
    if (phase === 'intro' || !snap) {
      this._renderRules(ctx, snap);
      ctx.restore();
      return;
    }
    this.seats.forEach((p, i) => this._renderSeat(ctx, p, i, snap, phase));
    // 종 + 종 친 사람 얼굴
    const pressed = this.bellHand && this.bellHand.t < 6;
    drawBell(ctx, BELL.x, BELL.y, this.bellShake, pressed);
    if (this.bellHand && this.bellHand.seat.face) {
      const dy = Math.min(6, this.bellHand.t);
      ctx.drawImage(this.bellHand.seat.face, BELL.x - 9, BELL.y - 30 + dy);
    }
    // 날아가는 카드
    for (const f of this.fx) {
      if (f.t < 0) continue;
      const k = f.t / f.dur;
      const e = 1 - (1 - k) * (1 - k);
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * e - Math.sin(k * Math.PI) * 10;
      const img = f.card && k > 0.5 ? cardFace(f.card) : cardBack();
      const sx = f.card ? Math.abs(Math.cos(k * Math.PI)) : 1; // 뒤집히는 모습
      const w = Math.max(2, Math.round(CARD_W * sx));
      ctx.drawImage(img, Math.round(x + (CARD_W - w) / 2), Math.round(y), w, CARD_H);
    }
    this.particles.render(ctx);
    this._renderMessage(ctx, phase);
    // 차례 리본 · 다음 차례 표시는 맨 위에 (다른 그림에 안 가려지게)
    if (phase === 'play') this.seats.forEach((p) => this._renderTurnTag(ctx, p, snap));
    ctx.restore();
    if (phase === 'end' && this.net.now() - snap.since > 20 / 60) {
      drawCard(ctx, W / 2 - 70, 46, 140, 26, '6', '9');
      KText.draw(ctx, '게임 끝!', W / 2, 49, C('9'), { align: 'center', font: 'L', outline: C('1') });
    }
  }

  // 가운데 안내 상자: 판정 결과(규칙으로 만든 설명) + 그 옆에 AI 해설 한 줄. 아무것도 없으면 조작 설명
  _renderMessage(ctx, phase) {
    const msg = this.msg && !(this.msg.t > 70 && this.msg.t % 4 < 2) ? this.msg : null;
    const say = this.sayLine && !(this.sayLine.t > 190 && this.sayLine.t % 4 < 2) ? this.sayLine : null;
    if (!msg && !say) {
      if (!this.msg && !this.sayLine && phase === 'play') {
        const hint = this.meId ? 'Z 뒤집기 · Space 종!' : '관전 중';
        KText.draw(ctx, hint, W / 2, 97, C('k'), { align: 'center', font: 'n', outline: C('1') });
      }
      return;
    }
    const rows = [];           // { text, font, color, h, ai }
    if (msg) {
      rows.push({ text: msg.text, font: 'b', color: C(msg.color), h: 13 });
      if (msg.sub) rows.push({ text: msg.sub, font: 'n', color: C('a'), h: 11 });
    }
    if (say) {
      let text = say.who ? `${say.who}: ${say.text}` : say.text;
      if (KText.width(text, 'n') > W - 40) text = say.text;
      rows.push({ text, font: 'n', color: C('q'), h: 11, ai: say.ai });
    }
    let tw = 0;
    for (const r of rows) tw = Math.max(tw, KText.width(r.text, r.font) + (r.ai ? 14 : 0));
    tw = Math.min(W - 4, tw + 14);
    const h = 4 + rows.reduce((s, r) => s + r.h, 0);
    const my = h <= 17 ? 96 : Math.max(78, 116 - h); // 아래 자리 이름표를 가리지 않게
    drawCard(ctx, Math.round(W / 2 - tw / 2), my, tw, h, '1', msg ? msg.color : 'q');
    let y = my + 2;
    for (const r of rows) {
      const w = KText.width(r.text, r.font);
      const cx = W / 2 + (r.ai ? 7 : 0);
      KText.draw(ctx, r.text, cx, y, r.color, { align: 'center', font: r.font });
      if (r.ai) {
        // AI 가 쓴 줄에는 작은 "AI" 표시
        const bx = Math.round(cx - w / 2 - 14);
        ctx.fillStyle = C('q');
        ctx.fillRect(bx, y + 2, 11, 9);
        BitmapFont.draw(ctx, 'AI', bx + 2, y + 4, C('1'));
      }
      y += r.h;
    }
  }

  // 카지노 테이블 (초록 펠트 + 금테) + 위쪽 제목·시간
  _renderTable(ctx, timeLeft) {
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, H);
    // 뒤쪽 샹들리에 불빛 (천천히 흔들림)
    for (let i = 0; i < 6; i++) {
      const x = Math.round(30 + i * 52 + Math.sin(this.frame / 50 + i) * 3);
      ctx.fillStyle = DITHER.get(ctx, 't', 2);
      ctx.fillRect(x - 10, 0, 20, 14);
      ctx.fillStyle = C(this.frame % 40 < 20 === (i % 2 === 0) ? '9' : '8');
      ctx.fillRect(x - 1, 2, 3, 3);
    }
    // 펠트 (타원)
    const cx = W / 2;
    const cy = 90;
    for (let y = -62; y <= 62; y++) {
      const half = Math.round(Math.sqrt(1 - (y / 63) ** 2) * 150);
      ctx.fillStyle = C('1');
      ctx.fillRect(cx - half - 3, cy + y, half * 2 + 6, 1);
      ctx.fillStyle = C('8');
      ctx.fillRect(cx - half - 2, cy + y, half * 2 + 4, 1);
      ctx.fillStyle = C('c');
      ctx.fillRect(cx - half, cy + y, half * 2, 1);
    }
    ctx.fillStyle = DITHER.get(ctx, 'd', 2);
    ctx.fillRect(cx - 140, cy - 55, 280, 110);
    // 펠트 위 무늬 (가운데 금색 원)
    for (let a = 0; a < 90; a++) {
      const ang = (a / 90) * Math.PI * 2;
      ctx.fillStyle = C('8');
      ctx.fillRect(Math.round(cx + Math.cos(ang) * 32), Math.round(BELL.y + 6 + Math.sin(ang) * 16), 1, 1);
    }
    // 제목 + 시간
    KText.draw(ctx, '하노마노', cx, 14, C('9'), { align: 'center', font: 'L', outline: C('1') });
    const s = Math.max(0, Math.ceil(timeLeft));
    const tt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const urgent = timeLeft <= 10 && this.frame % 30 < 15;
    KText.draw(ctx, tt, cx, 33, urgent ? C('5') : C('a'), { align: 'center', font: 'b', outline: C('1') });
  }

  // 시작 전 '하는 법' 화면
  _renderRules(ctx, snap) {
    ctx.fillStyle = DITHER.get(ctx, 'o', 13);
    ctx.fillRect(0, 0, W, H);
    drawCard(ctx, 6, 4, W - 12, 172, '1', '8');
    KText.draw(ctx, '하노마노 하는 법', W / 2, 7, C('9'), { align: 'center', font: 'b', outline: C('1') });
    const step = (n, text, y, col = 'a') => {
      ctx.fillStyle = C('8');
      ctx.fillRect(14, y + 1, 11, 11);
      ctx.fillStyle = C('1');
      ctx.fillRect(15, y + 2, 9, 9);
      BitmapFont.draw(ctx, String(n), 20, y + 4, C('9'), { align: 'center' });
      KText.draw(ctx, text, 30, y, C(col), { font: KText.width(text, 's') > W - 44 ? 'n' : 's' });
    };
    step(1, '내 차례가 오면 Z 키로 카드를 한 장 뒤집어요', 22);
    step(2, '같은 과일이 딱 5개가 되면 Space 로 종!', 36, '9');
    // 예시: 체리 2 + 체리 3 = 5 → 종!  /  체리 2 + 레몬 3 → 치면 안 됨
    const ex = (x, a, b, ok) => {
      ctx.drawImage(cardFace(a), x, 52);
      ctx.drawImage(cardFace(b), x + 36, 52);
      KText.draw(ctx, ok ? '5개 → 종!' : '과일이 달라요', x + 36, 93, C(ok ? 'e' : '5'), { align: 'center', font: 'n' });
      // O / X 표시
      ctx.fillStyle = C(ok ? 'e' : '5');
      if (ok) {
        for (let a2 = 0; a2 < 40; a2++) {
          const ang = (a2 / 40) * Math.PI * 2;
          ctx.fillRect(Math.round(x + 82 + Math.cos(ang) * 7), Math.round(70 + Math.sin(ang) * 7), 2, 2);
        }
      } else {
        for (let k = -6; k <= 6; k++) {
          ctx.fillRect(x + 82 + k, 70 + k, 2, 2);
          ctx.fillRect(x + 82 + k, 70 - k, 2, 2);
        }
      }
    };
    ex(40, [0, 2], [0, 3], true);
    ex(180, [0, 2], [1, 3], false);
    step(3, '맞으면 펼쳐진 카드를 전부 가져가요', 106, 'e');
    step(4, '틀리면 모두에게 1장씩 주고 3초 동안 종 금지', 120, '5');
    step(5, '2분 30초 뒤 카드가 제일 많은 사람이 1등!', 134);
    KText.draw(ctx, 'Z = 뒤집기(내 차례) · Space = 종 · M = 소리', W / 2, 148, C('k'), { align: 'center', font: 'n' });
    const until = snap && typeof snap.until === 'number' ? snap.until : null;
    const left = until === null ? 0 : Math.max(0, Math.ceil(until - this.net.now()));
    if (this.frame % 40 < 28) {
      KText.draw(ctx, until === null ? '곧 시작합니다!' : `곧 시작합니다! (${left})`, W / 2, 160, C('9'), { align: 'center', font: 's', outline: C('1') });
    }
  }

  // 자리 하나: 펼친 카드 + 이름표 + 남은 카드 + 조작키
  _renderSeat(ctx, p, i, snap, phase) {
    const { x, y } = p.seat;
    const d = this._data(p.id);
    const now = this.net.now();
    const myTurn = phase === 'play' && snap.turn === p.id && d.deck > 0;
    const col = p.colorKey;
    drawCard(ctx, x, y, 100, 60, '2', myTurn ? (this.frame % 20 < 10 ? '9' : 'b') : DARK_OF[col] || '3');
    // 펼친 카드 (맨 위 한 장 + 밑에 쌓인 두께)
    //  종을 친 직후에는 그 순간의 카드를 잠깐 보여 주고, 정답 과일 카드는 반짝 테두리
    if (p.fly <= 0) p.lastShow = d.show || [];
    const pile = p.fly > 0 ? p.hold : d.show || [];
    const R = this.reveal;
    const revealing = R && R.t < 70;
    const shown = revealing ? R.tops[i] : pile[pile.length - 1];
    const depth = revealing ? 0 : Math.min(3, pile.length - 1);
    for (let k = depth; k > 0; k--) ctx.drawImage(cardFace(pile[pile.length - 1 - k]), x + 2 + k, y + 4 + k);
    if (shown) {
      ctx.drawImage(cardFace(shown), x + 2, y + 4);
      const hit = revealing && shown[0] === R.why.fruit;
      if (hit && R.t % 12 < 8) {
        ctx.fillStyle = C(R.why.ok ? '9' : '5');
        ctx.fillRect(x + 1, y + 3, CARD_W + 2, 2);
        ctx.fillRect(x + 1, y + 3 + CARD_H, CARD_W + 2, 2);
        ctx.fillRect(x + 1, y + 3, 2, CARD_H + 2);
        ctx.fillRect(x + 1 + CARD_W, y + 3, 2, CARD_H + 2);
      }
    } else {
      ctx.fillStyle = DITHER.get(ctx, 'i', 6);
      ctx.fillRect(x + 4, y + 6, CARD_W - 4, CARD_H - 4);
    }
    // 이름표
    drawNameCard(ctx, x + 36, y + 2, 62, { color: col, name: p.name, face: p.face });
    // 남은 카드 (뒷면 더미 + 숫자)
    const back = cardBack();
    const n = d.deck;
    for (let k = Math.min(3, n) - 1; k >= 0; k--) ctx.drawImage(back, 0, 0, CARD_W, CARD_H, x + 38 + k, y + 21 - k, 10, 13);
    KText.draw(ctx, `${n}장`, x + 54, y + 21, n ? C('a') : C('5'), { font: 'b', outline: C('1') });
    if (myTurn && snap.turnTime > 0) {
      // 자동 뒤집기까지 남은 시간
      const k = Math.max(0, Math.min(1, 1 - (now - snap.turnSince) / snap.turnTime));
      ctx.fillStyle = C('1');
      ctx.fillRect(x + 38, y + 35, 58, 3);
      ctx.fillStyle = C('9');
      ctx.fillRect(x + 39, y + 36, Math.round(56 * k), 1);
    }
    // 조작키 (내 자리: Z = 뒤집기, 금색 Space = 종) / 다른 사람: 종을 맞힌 횟수
    if (p.isMe) {
      const caps = [getKeycap('Z', 'plain', this.down.flip), getKeycap('Space', 'strike', this.down.bell)];
      const tw = caps.reduce((s, c) => s + c.width, 0) + 1;
      let kx = Math.round(x + 67 - tw / 2);
      caps.forEach((c) => {
        ctx.drawImage(c, kx, y + 40);
        kx += c.width + 1;
      });
    } else if (d.connected === false) {
      KText.draw(ctx, '연결 끊김', x + 67, y + 43, C('j'), { align: 'center', font: 'n' });
    } else {
      KText.draw(ctx, `맞힘 ${d.correct || 0} · 틀림 ${d.wrong || 0}`, x + 67, y + 43, C('k'), { align: 'center', font: 'n' });
    }
    // 종 잠김 (틀려서 손 얼얼)
    const lock = (d.lock || 0) - now;
    if (lock > 0) {
      ctx.fillStyle = DITHER.get(ctx, '7', 10);
      ctx.fillRect(x + 36, y + 39, 62, 19);
      KText.draw(ctx, `손 얼얼 ${Math.ceil(lock)}`, x + 67, y + 42, C('5'), { align: 'center', font: 'b', outline: C('1') });
    }
  }

  // '차례!' 리본 (지금 뒤집을 사람) + '다음' 꼬리표 (그다음 사람)
  _renderTurnTag(ctx, p, snap) {
    const { x, y } = p.seat;
    const top = y < 90; // 위쪽 자리면 리본을 아래에
    const n = this.seats.length;
    const turn = this.seats.findIndex((s) => s.id === snap.turn);
    if (turn < 0) return;
    const cur = this.seats[turn];
    if (cur === p && this._data(p.id).deck > 0) {
      const bob = Math.round(Math.abs(Math.sin(this.frame / 8)));
      const ry = top ? y + 59 + bob : y - 9 - bob;
      drawCard(ctx, x + 2, ry, 36, 14, '9', '8');
      KText.draw(ctx, '차례!', x + 20, ry, C('1'), { align: 'center', font: 's' });
      return;
    }
    // 다음 차례
    let next = null;
    for (let k = 1; k <= n; k++) {
      const q = this.seats[(turn + k) % n];
      if (this._data(q.id).deck > 0) {
        next = q;
        break;
      }
    }
    if (next === p && next !== cur) {
      const ry = top ? y + 60 : y - 8;
      ctx.fillStyle = C('i');
      ctx.fillRect(x + 2, ry, 28, 11);
      ctx.fillStyle = C('1');
      ctx.fillRect(x + 3, ry + 1, 26, 9);
      KText.draw(ctx, '다음', x + 16, ry, C('k'), { align: 'center', font: 'n' });
    }
  }

  // 최종 순위: 카드가 많은 순서 (같으면 종을 많이 맞힌 순) + AI 총평 — 원본 result.js
  _renderResult(ctx) {
    const t = this.finalT;
    this._renderTable(ctx, 0);
    ctx.fillStyle = DITHER.get(ctx, 'o', 9);
    ctx.fillRect(0, 0, W, H);
    this.confetti.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, -3, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    const rows = this.results || [];
    const rowH = rows.length >= 5 ? 22 : 26;   // 5명이면 총평 자리를 위해 줄을 조금 좁힌다
    const y0 = 32;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.byId.get(r.playerId);
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 12;
      const x = 14 + slide;
      const y = y0 + i * rowH;
      const pad = rowH >= 26 ? 3 : 1;
      drawCard(ctx, x, y, 292, rowH - 3, r.rank === 1 ? '7' : '2', r.rank === 1 ? '9' : '3');
      BitmapFont.draw(ctx, String(r.rank), x + 13, y + pad + 3, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      drawNameCard(ctx, x + 26, y + pad, 84, { color: p ? p.colorKey : 'k', name: r.name, face: p ? p.face : null });
      if (r.rank === 1) ctx.drawImage(crownSprite(), x + 32, y + pad - 3);
      const st = r.stats || {};
      // 카드 수 (뒷면 그림 + 숫자)
      ctx.drawImage(cardBack(), 0, 0, CARD_W, CARD_H, x + 120, y + pad + 1, 11, 14);
      KText.draw(ctx, `${st.cards ?? r.score}장`, x + 135, y + pad + 1, C('9'), { font: 'b', outline: C('1') });
      KText.draw(ctx, `맞힘 ${st.correct ?? 0} · 틀림 ${st.wrong ?? 0}`, x + 218, y + pad + 2, C('k'), { align: 'center', font: 'n' });
      if (r.playerId === this.meId) KText.draw(ctx, '나', x + 280, y + pad + 1, C('e'), { align: 'right', font: 'b', outline: C('1') });
    });
    // AI 총평 (서버의 AI 가 답을 줬을 때만)
    const v = this.verdict;
    const vy = y0 + rows.length * rowH;
    if (v && v.headline && t > 15 + rows.length * 12 && vy + 36 <= H) {
      drawCard(ctx, 14, vy, 292, Math.min(38, H - vy - 2), '1', 'q');
      ctx.fillStyle = C('q');
      ctx.fillRect(19, vy + 4, 11, 9);
      BitmapFont.draw(ctx, 'AI', 21, vy + 6, C('1'));
      KText.draw(ctx, '총평', 33, vy + 1, C('q'), { font: 'n' });
      KText.draw(ctx, v.headline, W / 2 + 14, vy + 1, C('9'), { align: 'center', font: 's' });
      if (v.mvp) KText.draw(ctx, KText.fit(`1등 · ${v.mvp}`, 280, 'n'), W / 2, vy + 13, C('a'), { align: 'center', font: 'n' });
      if (v.cheer) KText.draw(ctx, KText.fit(`응원 · ${v.cheer}`, 280, 'n'), W / 2, vy + 23, C('k'), { align: 'center', font: 'n' });
    }
  }
}
