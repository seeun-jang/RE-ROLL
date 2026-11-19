// =============================================================
// 마법진 그리기 — 화면 (멀티플레이)
//
// 원본 js/scenes/play.js · result.js · game.js 의 그리기 · 연출 코드를 옮긴 것이다.
// 달라진 점: 진행(단계 · 시간) · 점수는 서버 상태(net.snap)만 따른다.
//   - 모두가 같은 마법진을 같은 저주로 각자 자기 종이에 동시에 그린다.
//   - 내 펜이 지나간 점(종이 좌표)을 0.1초마다 모아 서버로 보낸다. 서버가 종이를 다시 그려 채점한다.
//   - 거울 저주 · 흔들 종이는 여기(paperMouse)에서 화면 좌표를 종이 좌표로 바꿀 때 한 번만 적용한다.
//   - 내 종이는 기다리지 않고 바로 그린다(예측). 왼쪽 '마력 게이지'도 예측이고, 점수는 서버가 보낸 값만 쓴다.
// 시간 t 는 원본처럼 "이 단계가 시작된 뒤 지난 프레임(1/60초)" 이며 서버 시계로 계산한다.
// =============================================================
import { AudioManager } from '../audio.js';
import { CONFIG } from '../config.js';
import { BitmapFont, Button, DITHER, KText, drawCard, drawNameCard, drawPanel } from '../gfx/ui.js';
import { ParticleSystem } from '../gfx/particles.js';
import { CHARACTER_COLORS, SPELL_ICON, characterOf, drawBackdrop, drawSpellIcon, drawStanding, loadSprites } from '../gfx/sprites.js';
import { C, PALETTE } from '../palette.js';
import { SHAPES, guideImage, prepareShape, previewImage } from '../shapes.js';
import { Paper, bitsToInk, paperFromInk, scoreDrawing } from '../sketch.js';
import { attachPointer } from './pointer.js';

const PAPER_X = 100;
const PAPER_Y = 28;
const SEND_EVERY = 6;          // 펜 좌표를 보내는 간격(프레임) = 0.1초
const CAPTION_TIME = 4;        // 마법사 대사가 떠 있는 시간(초)
const REVIEW_TURN = 1.6;       // 갤러리에서 감상평 한 사람 분량을 보여 주는 시간(초)

let fontJob = null;
/** 글꼴 준비: 굵은 Galmuri11 은 이 게임 폴더의 파일을 쓰고, 나머지는 페이지(fonts.css)가 이미 불러온다 */
function loadFonts() {
  if (fontJob) return fontJob;
  fontJob = (async () => {
    try {
      const url = new URL('../assets/fonts/Galmuri11-Bold.woff2', import.meta.url).href;
      const face = new FontFace('Galmuri11', `url("${url}")`, { weight: 'bold' });
      document.fonts.add(await face.load());
    } catch (e) {
      console.warn('[sigil] 굵은 글꼴을 불러오지 못해 기본 굵기로 그립니다', e);
    }
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load('bold 12px Galmuri11', '가A1'),
          document.fonts.load('10px Galmuri9', '가A1'),
          document.fonts.load('15px Galmuri14', '가A1'),
        ]),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (e) { /* 기본 글꼴로 그린다 */ }
  })();
  return fontJob;
}

export class SigilScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.shapes = Array.isArray(this.opt.shapes) && this.opt.shapes.length ? this.opt.shapes : SHAPES;
    this.twists = this.opt.twists || CONFIG.TWISTS;
    this.score = this.opt.score || CONFIG.SCORE;
    this.shakeCfg = this.opt.shake || CONFIG.SHAKE;
    this.memoryFrames = Math.round((this.opt.memoryTime ?? CONFIG.MEMORY_TIME) * 60);
    this.players = players.map((p, i) => {
      const char = characterOf(p, i);
      return { id: p.id, name: p.name, char, color: CHARACTER_COLORS[char] };
    });
    this.byId = new Map(this.players.map((p) => [p.id, p]));
    this.meId = me ? me.id : null;
    this.me = this.byId.get(this.meId) || this.players[0];
    this.canPlay = this.byId.has(this.meId);

    this._buildDom();
    this.audio = new AudioManager();
    this.pointer = attachPointer(this.canvas, () => this.audio.unlock());
    this.mouse = this.pointer.mouse;
    this.particles = new ParticleSystem();
    this.doneBtn = new Button('완료', 236, 158, 76, 16);
    this.spr = null;                 // 캐릭터 그림(불러오는 중에는 null)
    this.frame = 0;
    this.t = 0;                      // 이 단계가 시작된 뒤 지난 프레임
    this.time = 0;                   // 화면이 뜬 뒤 지난 시간(초)
    this.phaseKey = '';
    this.onceDone = new Set();
    this.paper = null;               // 내 종이
    this.paperRound = 0;
    this.gold = null;
    this.out = [];                   // 아직 서버로 보내지 않은 점 [x, y, x, y, ...]
    this.cont = false;               // 다음에 보내는 점이 앞 선에 이어지는가
    this.sinceSend = 0;
    this.armed = false;
    this.sentDone = false;
    this.live = 0;                   // 그리는 중 실시간 정확도(예측)
    this.streak = 0;                 // 선 위에서 연속으로 그린 프레임
    this.shown = 0;                  // 채점 숫자 올라가는 연출
    this.icons = [];                 // 마법 발동 때 튀어나오는 모양 아이콘
    this.spell = null;
    this.reveal = null;              // { round, scores, papers } — 이번 라운드 공개된 그림과 점수
    this.reviews = null;             // { round, reviews, at } — AI 감상평
    this.caption = null;             // { text, ai, who, until } — 마법사 대사
    this.verdict = null;
    this.roundShapes = [];           // 지나간 라운드의 모양 번호(최종 표 머리글용)
    this.confirm = false;            // 이번 프레임에 Space / Enter 를 눌렀나
    this.muteNotice = 0;
    this._destroyed = false;

    this._onKey = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.audio.unlock();
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) this.confirm = true;
      }
      if (e.code === 'KeyM' && !e.repeat) {
        this.audio.toggleMute();
        this.muteNotice = 90;
      }
    };
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
    loadFonts().then(() => KText.clear());
    loadSprites(this.players.map((p) => p.char)).then((spr) => {
      if (!this._destroyed) this.spr = spr;
    });
    try { this.audio.unlock(); } catch (e) { /* 첫 입력 때 켜진다 */ }
    this.audio.playBgm('lobby');

    this._last = performance.now();
    this._acc = 0;
    const loop = (now) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      let dt = now - this._last;
      this._last = now;
      if (dt > 250) dt = 250; // 탭 전환 후 폭주 방지
      this._acc += dt;
      while (this._acc >= CONFIG.STEP_MS) {
        this._update();
        this._acc -= CONFIG.STEP_MS;
      }
      try {
        this._render(this.ctx);
      } catch (err) {
        if (!this._renderError) console.error('[sigil] 그리기 오류', err);
        this._renderError = true;
      }
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
    this.pointer.detach();
    this.audio.destroy();
    this.particles.clear();
    this.root.remove();
  }

  _buildDom() {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'relative', width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: PALETTE.o, overflow: 'hidden',
    });
    const canvas = document.createElement('canvas');
    canvas.width = CONFIG.WIDTH;
    canvas.height = CONFIG.HEIGHT;
    canvas.style.setProperty('image-rendering', 'crisp-edges');
    canvas.style.setProperty('image-rendering', 'pixelated');
    canvas.style.display = 'block';
    canvas.style.cursor = 'crosshair';
    root.appendChild(canvas);
    this.container.appendChild(root);
    this.root = root;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.autoHeight = this.container.clientHeight === 0;
  }

  // 칸 크기에 맞춰 정수배로만 확대 (픽셀이 찌그러지지 않게)
  _fit() {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    const w = this.root.clientWidth || W * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(8, Math.floor(Math.min(w / W, h / H))));
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${H * s}px`;
    if (this.autoHeight) this.root.style.height = `${H * s}px`;
  }

  // ------------------------------------------------------------
  // 서버 상태에서 꺼내 쓰는 값
  // ------------------------------------------------------------
  get snap() {
    return this.net.snap;
  }

  get phase() {
    return this.snap ? this.snap.phase : 'intro';
  }

  get shape() {
    const s = this.snap;
    return this.shapes[s && s.shape != null ? s.shape : 0] || this.shapes[0];
  }

  get twist() {
    const s = this.snap;
    return (s && s.twist) || 'none';
  }

  get mult() {
    return this.snap ? this.snap.mult || 1 : 1;
  }

  // 그리기 시간(프레임)
  get drawFrames() {
    const s = this.snap;
    if (s && s.phase === 'draw' && s.drawUntil != null) return Math.max(1, Math.round((s.drawUntil - s.since) * 60));
    return Math.round((this.twist === 'speed' ? this.opt.speedTime ?? CONFIG.SPEED_TIME : this.opt.drawTime ?? CONFIG.DRAW_TIME) * 60);
  }

  // 이번 라운드 내 채점 결과 (서버가 보낸 것)
  get result() {
    const s = this.snap;
    if (!s || !this.reveal || this.reveal.round !== s.round) return null;
    return this.reveal.scores[this.me.id] || null;
  }

  totalOf(id) {
    const s = this.snap;
    return s && s.players && s.players[id] ? s.players[id].total : 0;
  }

  // 흔들 종이: 그리는 동안 종이 위치가 출렁임
  get offset() {
    if (this.phase !== 'draw' || this.twist !== 'shake') return { x: 0, y: 0 };
    const t = this.t;
    return {
      x: Math.round(Math.sin(t / 19) * this.shakeCfg.X + Math.sin(t / 7) * 2),
      y: Math.round(Math.cos(t / 23) * this.shakeCfg.Y),
    };
  }

  // 종이 위의 펜 좌표 (종이 밖이면 null). 거울 저주면 좌우 반대
  //  ※ 입력을 바꾸는 저주(흔들 종이 · 거울)는 여기서만 적용한다. 서버는 이 종이 좌표를 그대로 쓴다.
  paperMouse() {
    const m = this.mouse;
    const o = this.offset;
    let x = m.x - PAPER_X - o.x;
    const y = m.y - PAPER_Y - o.y;
    const S = CONFIG.CANVAS;
    if (x < 0 || y < 0 || x >= S || y >= S) return null;
    if (this.phase === 'draw' && this.twist === 'mirror') x = S - 1 - x;
    return { x, y };
  }

  // 안내선이 보이나
  get guideVisible() {
    if (this.phase === 'draw') return this.twist !== 'memory' || this.t < this.memoryFrames;
    return true;
  }

  /** key 에 해당하는 일을 이 판에서 한 번만 한다 */
  _once(key, fn) {
    if (this.onceDone.has(key)) return;
    this.onceDone.add(key);
    fn();
  }

  // ------------------------------------------------------------
  // 진행 (60분의 1초마다)
  // ------------------------------------------------------------
  _update() {
    this.frame++;
    this.time += 1 / 60;
    this.particles.update();
    this.doneBtn.update();
    if (this.muteNotice > 0) this.muteNotice--;
    for (const ic of this.icons) {
      ic.x += ic.vx;
      ic.y += ic.vy;
      ic.vy += 0.03;
      ic.life--;
    }
    this.icons = this.icons.filter((ic) => ic.life > 0);
    if (this.spell && ++this.spell.t > 90) this.spell = null;

    for (const e of this.net.takeEvents()) this._handleEvent(e);
    const s = this.snap;
    if (s) {
      const now = this.net.now();
      this.t = Math.max(0, Math.floor((now - s.since) * 60));
      const key = `${s.phase}:${s.round}`;
      if (key !== this.phaseKey) {
        this.phaseKey = key;
        this._enterPhase(s);
      }
      if (s.verdict && !this.verdict) this.verdict = s.verdict;
      if (s.phase === 'slot') this._updateSlot();
      else if (s.phase === 'draw') this._updateDraw(s, now);
      else if (s.phase === 'score') this._updateScore(s);
      else if (s.phase === 'gallery') {
        this._ensureReveal(s);
        if (this.t >= 50) this._once(`win:${s.round}`, () => this.audio.sfx('win'));
      } else if (s.phase === 'final' || s.phase === 'done') this._updateFinal();
    }
    this.confirm = false;
    this.pointer.endFrame();
  }

  _handleEvent(e) {
    if (e.type === 'say') {
      this.caption = { text: e.text, ai: e.source === 'gemini', who: e.who || '마법사', until: this.time + CAPTION_TIME };
    } else if (e.type === 'reveal') {
      this._setReveal(e.round, e.scores, e.drawings);
    } else if (e.type === 'review') {
      this.reviews = { round: e.round, reviews: e.reviews || {}, at: this.time };
      this.audio.sfx('select');
    } else if (e.type === 'verdict') {
      this.verdict = { headline: e.headline, mvp: e.mvp, cheer: e.cheer };
    } else if (e.type === 'done') {
      if (e.playerId !== this.me.id) this.audio.sfx('tick');
    }
  }

  /** 공개된 그림(비트 묶음)을 종이 그림으로 바꿔 둔다. 내 그림은 방금 그린 종이를 그대로 쓴다 */
  _setReveal(round, scores, drawings) {
    const shape = this.shapes[this.roundShapes[round - 1] ?? (this.snap ? this.snap.shape : 0)] || this.shape;
    const papers = {};
    for (const p of this.players) {
      if (p.id === this.me.id && this.paper && this.paperRound === round) papers[p.id] = this.paper;
      else papers[p.id] = paperFromInk(bitsToInk((drawings || {})[p.id] || ''), shape, PALETTE['1'], PALETTE['5']);
    }
    this.reveal = { round, scores: scores || {}, papers };
    if (!this.paper || this.paperRound !== round) {
      this.paper = papers[this.me.id];
      this.paperRound = round;
    }
  }

  /** 다시 접속했을 때: 사건(reveal)을 못 받았으면 상태에 실려 온 그림으로 만든다 */
  _ensureReveal(s) {
    if (this.reveal && this.reveal.round === s.round) return;
    const ex = this.net.extra;
    const drawings = s.drawings || (ex.round === s.round ? ex.drawings : null);
    if (!drawings) return;
    const scores = {};
    for (const [id, st] of Object.entries(s.players || {})) scores[id] = (st.rounds || [])[s.round - 1] || null;
    this._setReveal(s.round, scores, drawings);
  }

  _newPaper(round) {
    this.paper = new Paper();
    this.paperRound = round;
    this.gold = null;
    this.out = [];
    this.cont = false;
    this.sinceSend = 0;
    this.sentDone = false;
    this.live = 0;
    this.streak = 0;
  }

  _enterPhase(s) {
    const audio = this.audio;
    if (s.shape != null && s.round >= 1) this.roundShapes[s.round - 1] = s.shape;
    if (s.phase === 'slot') {
      if (s.round > 1) audio.sfx('start');
      this.spell = null;
      this.icons = [];
    } else if (s.phase === 'ready') {
      this._newPaper(s.round);
      audio.sfx('select');
    } else if (s.phase === 'draw') {
      if (this.paperRound !== s.round || !this.paper) this._newPaper(s.round);
      const ex = this.net.extra;
      const ink = (s.me && s.me.ink) || (ex.round === s.round ? ex.ink : null);
      if (ink && !this.paper.inkCount) {
        // 다시 접속: 서버가 기억하는 내 그림으로 되살린다
        this.paper = paperFromInk(bitsToInk(ink), this.shape, PALETTE['1'], PALETTE['5']);
        this.paperRound = s.round;
      }
      this.sentDone = !!(s.players && s.players[this.me.id] && s.players[this.me.id].done);
      this.armed = !this.mouse.down; // 누르고 있던 버튼을 뗀 뒤부터 그려짐
      audio.sfx('go');
    } else if (s.phase === 'score') {
      this._penUp();
      this.shown = 0;
      audio.sfx('lock');
    } else if (s.phase === 'gallery') {
      audio.sfx('flip');
    } else if (s.phase === 'final') {
      audio.sfx('win');
      audio.playBgm('result');
    }
  }

  // 슬롯머신: 마법진 릴 → 저주 릴 순서로 멈춤 (소리 · 꽃가루)
  _updateSlot() {
    const audio = this.audio;
    const t = this.t;
    const r = this.snap.round;
    if ((t < 70 || (t > 70 && t < 110)) && this.frame % 5 === 0) audio.sfx('tick');
    if (t >= 70) this._once(`stop1:${r}`, () => audio.sfx('slotStop'));
    if (t >= 110) {
      this._once(`stop2:${r}`, () => {
        audio.sfx('slotStop');
        if (this.twist !== 'none') audio.sfx('warning');
      });
    }
    if (t >= 125 && this.mult > 1) {
      this._once(`jack:${r}`, () => {
        audio.sfx('jackpot');
        for (let i = 0; i < 40; i++) this.particles.add(40 + Math.random() * 240, -4, (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, 120, C(i % 3 ? '9' : '8'), 2, 0.02);
      });
    }
  }

  _updateDraw(s, now) {
    const audio = this.audio;
    const m = this.mouse;
    const r = s.round;
    if (this.twist === 'memory' && this.t >= this.memoryFrames) this._once(`mem:${r}`, () => audio.sfx('whoosh'));
    const left = this.drawFrames - this.t;
    const sec = Math.ceil(left / 60);
    if (left > 0 && sec <= 3) this._once(`cd:${r}:${sec}`, () => audio.sfx('countdown'));
    const st = s.players && s.players[this.me.id];
    if (st && st.done) this.sentDone = true;
    const open = this.canPlay && !this.sentDone && s.drawUntil != null && now < s.drawUntil;
    if (!open) {
      this._penUp();                  // 시간 끝 · 완료: 남은 점을 마저 보낸다
      return;
    }
    let p = null;
    if (m.down && this.armed) p = this.paperMouse();
    else if (!m.down) this.armed = true;
    if (p) this.inkAt(p);
    else this._penUp();
    if (this.frame % 10 === 0) this.live = scoreDrawing(this.paper, this.shape).accuracy;
    // 0.1초마다 그동안 지나간 점을 서버로
    if (++this.sinceSend >= SEND_EVERY) this._flush();
    // 일찍 끝내기: Space / Enter / 오른쪽 클릭 / 완료 버튼
    const b = this.doneBtn;
    const onBtn = m.pressed && m.x >= b.x && m.x < b.x + b.w && m.y >= b.y && m.y < b.y + b.h;
    if (this.t > 20 && (this.confirm || m.right || onBtn)) {
      b.press();
      this._penUp();
      this.sentDone = true;
      this.net.done();
      audio.sfx('lock');
    }
  }

  /** 모아 둔 점을 서버로 보낸다 */
  _flush() {
    this.sinceSend = 0;
    if (!this.out.length) return;
    this.net.ink(this.out, this.cont);
    this.out = [];
    this.cont = true;                 // 펜을 떼지 않았으면 다음 묶음은 이 선에 이어진다
  }

  /** 펜을 뗐다: 남은 점을 보내고 선을 끊는다 */
  _penUp() {
    if (this.paper) this.paper.end();
    this._flush();
    this.cont = false;
  }

  // 펜 한 번 찍기 + 선 위면 반짝이 / 벗어나면 연기
  inkAt(p) {
    const S = CONFIG.CANVAS;
    const prep = prepareShape(this.shape);
    const ix = Math.max(0, Math.min(S - 1, Math.round(p.x)));
    const iy = Math.max(0, Math.min(S - 1, Math.round(p.y)));
    const on = prep.dist[iy * S + ix] <= this.score.NEAT_RADIUS;
    // 서버와 똑같이 그려지도록 정수 좌표로 찍고, 같은 좌표를 보낸다
    this.paper.stroke(ix, iy, on ? PALETTE['1'] : PALETTE['5']); // 선 위 = 검정 · 벗어나면 밝은 빨강
    this.out.push(ix, iy);
    if (this.twist === 'ghost') return; // 투명 잉크: 반응도 안 보임
    const o = this.offset;
    const sx = PAPER_X + o.x + ix;
    const sy = PAPER_Y + o.y + iy;
    if (on) {
      this.streak++;
      if (this.streak % 3 === 0) this.particles.add(sx, sy, (Math.random() - 0.5) * 0.8, -0.3 - Math.random() * 0.5, 22, C(this.streak % 9 ? this.shape.color : 'b'), 1);
      if (this.streak % 60 === 0) {
        this.particles.text(sx, sy - 8, this.streak >= 180 ? '대단해!' : '좋아!', C('9'), { kind: 'k', life: 40 });
        this.audio.sfx('coin');
      }
    } else {
      if (this.streak > 10) this.audio.sfx('tap');
      this.streak = 0;
      if (this.frame % 6 === 0) this.particles.add(sx, sy, (Math.random() - 0.5) * 0.4, -0.4, 26, C(this.frame % 12 ? 'j' : 'i'), 2);
    }
  }

  _updateScore(s) {
    this._ensureReveal(s);
    const r = this.result;
    if (!r) return;
    if (this.shown < r.total) this.shown = Math.min(r.total, this.shown + 3);
    if (this.t >= 30) this._once(`spell:${s.round}`, () => this.spellEffect());
  }

  _updateFinal() {
    if (this.frame % 4 === 0) {
      const cols = [C('9'), C('8'), C('5'), C('h'), C('e'), C('p')];
      this.particles.add(Math.random() * CONFIG.WIDTH, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 1);
    }
  }

  // 그린 선을 금색으로 칠한 사본 (합성만 사용)
  goldInk() {
    if (this.gold && this.gold.src === this.paper) return this.gold.c;
    const c = document.createElement('canvas');
    c.width = c.height = CONFIG.CANVAS;
    const g = c.getContext('2d');
    g.drawImage(this.paper.canvas, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = C('9');
    g.fillRect(0, 0, c.width, c.height);
    this.gold = { src: this.paper, c };
    return c;
  }

  // 점수에 따라 마법 발동 / 그럭저럭 / 펑!
  spellEffect() {
    const S = this.score;
    const acc = this.result.accuracy;
    const path = prepareShape(this.shape).path;
    const audio = this.audio;
    if (acc >= S.SUCCESS) {
      this.spell = { t: 0, ok: true, icon: SPELL_ICON[this.shape.short] || 'star', color: this.shape.color };
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        this.icons.push({ x: PAPER_X + 60, y: PAPER_Y + 60, vx: Math.cos(a) * (1 + Math.random()), vy: Math.sin(a) * (1 + Math.random()) - 0.6, life: 60 + Math.random() * 20, icon: this.spell.icon, color: i % 3 ? this.shape.color : '9' });
      }
      for (let i = 0; i < path.length; i += 6) {
        const [x, y] = path[i];
        this.particles.add(PAPER_X + x, PAPER_Y + y, (Math.random() - 0.5) * 0.6, -0.4 - Math.random() * 0.6, 50, C(i % 12 ? '9' : 'b'), 1);
      }
      this.particles.ring(PAPER_X + 60, PAPER_Y + 60, 2.2, C('9'), 26);
      audio.sfx('jackpot');
    } else if (acc >= S.OKAY) {
      this.particles.burst(PAPER_X + 60, PAPER_Y + 60, 16, [C(this.shape.color), C('a')], 1.2, 30, 1);
      audio.sfx('coin');
    } else {
      this.spell = { t: 0, ok: false };
      this.particles.burst(PAPER_X + 60, PAPER_Y + 60, 40, [C('i'), C('j'), C('k'), C('1')], 1.8, 60, 3, -0.02);
      audio.sfx('explode');
    }
  }

  // ------------------------------------------------------------
  // 그리기
  // ------------------------------------------------------------
  _render(ctx) {
    const ph = this.phase;
    if (ph === 'final' || ph === 'done') {
      this.renderFinal(ctx);
    } else {
      drawBackdrop(ctx, this.frame);
      this.renderHeader(ctx);
      this.renderLeft(ctx);
      this.renderBoard(ctx);
      this.renderSpellBack(ctx);
      this.renderPaper(ctx);
      this.particles.render(ctx);
      for (const ic of this.icons) drawSpellIcon(ctx, ic.x, ic.y, ic.icon, ic.color, ic.life < 15 && ic.life % 4 < 2);
      if (this.spell && !this.spell.ok && this.spell.t < 60) {
        // 펑! 큰 글자
        const s = this.spell.t;
        KText.draw(ctx, '펑!', PAPER_X + 60, PAPER_Y + 8 - Math.min(6, s / 3), C('j'), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
      }
      this.renderBottom(ctx);
      if (ph === 'intro') this.renderIntro(ctx);
      if (ph === 'slot') this.renderSlot(ctx);
      if (ph === 'gallery') this.renderGallery(ctx);
    }
    if (this.muteNotice > 0) {
      const txt = this.audio.muted ? '소리 끔' : '소리 켬';
      drawPanel(ctx, CONFIG.WIDTH - 60, CONFIG.HEIGHT - 26, 54, 20, 'dark');
      KText.draw(ctx, txt, CONFIG.WIDTH - 33, CONFIG.HEIGHT - 22, C('a'), { align: 'center', font: 's' });
    }
  }

  renderHeader(ctx) {
    const W = CONFIG.WIDTH;
    const s = this.snap;
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 14);
    KText.draw(ctx, '마법진 그리기', 4, 1, C('9'), { font: 'b' });
    if (s && s.round >= 1) {
      const jack = this.mult > 1 ? ' ×2' : '';
      const name = this.phase === 'slot' && this.t < 70 ? '???' : this.shape.name;
      KText.draw(ctx, `라운드 ${s.round}/${s.rounds} · ${name}${jack}`, W - 4, 1, jack && this.frame % 30 < 20 ? C('9') : C('a'), { font: 's', align: 'right' });
    }
    const k = this.phase === 'draw' ? 1 - this.t / this.drawFrames : this.phase === 'ready' ? 1 : 0;
    ctx.fillStyle = C('2');
    ctx.fillRect(0, 13, W, 2);
    ctx.fillStyle = k < 0.25 && this.frame % 20 < 10 ? C('5') : C('9');
    ctx.fillRect(0, 13, Math.round(W * Math.max(0, k)), 2);
  }

  // 가운데 양피지: 안내선 + 그린 그림
  renderPaper(ctx) {
    const S = CONFIG.CANVAS;
    const ph = this.phase;
    const o = this.offset;
    const x = PAPER_X + o.x;
    const y = PAPER_Y + o.y;
    const tw = this.twists[this.twist] || this.twists.none;
    const r = this.result;
    drawCard(ctx, x - 3, y - 3, S + 6, S + 6, 'l', this.twist === 'shake' ? '8' : 'r');
    ctx.fillStyle = C('a');
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = DITHER.get(ctx, 'n', 2);
    ctx.fillRect(x, y, S, S);
    if (ph === 'intro' || ph === 'slot') return;
    const scored = ph === 'score' && this.t > 30 && r;
    const success = scored && r.accuracy >= this.score.SUCCESS;
    if (this.guideVisible) {
      if (ph === 'draw' && this.twist === 'mirror') {
        // 거울 저주: 가운데 거울 줄
        ctx.fillStyle = DITHER.get(ctx, 'h', 6);
        ctx.fillRect(x + S / 2, y, 1, S);
      }
      ctx.drawImage(guideImage(this.shape), x, y);
    } else if (ph === 'draw') {
      KText.draw(ctx, '기억나요?', x + S / 2, y + 2, C('i'), { align: 'center', font: 'n' });
    }
    const hasPaper = this.paper && this.paper.canvas && this.paperRound === (this.snap ? this.snap.round : 0);
    const showInk = ph === 'score' || ph === 'gallery' || (ph === 'draw' && this.twist !== 'ghost');
    if (hasPaper && showInk) {
      ctx.drawImage(this.paper.canvas, x, y);
      if (success && this.frame % 10 < 6) ctx.drawImage(this.goldInk(), x, y);
    }
    if (ph === 'draw' && this.twist === 'ghost') {
      // 투명 잉크: 2초마다 아주 잠깐 비침
      if (this.t % 120 > 112 && hasPaper) ctx.drawImage(this.paper.canvas, x, y);
      KText.draw(ctx, '선이 안 보여요…', x + S / 2, y + S - 13, C('j'), { align: 'center', font: 'n' });
    }
    if (success) {
      ctx.fillStyle = DITHER.get(ctx, '9', this.frame % 20 < 10 ? 3 : 1);
      ctx.fillRect(x, y, S, S);
    }
    // 마우스 펜 커서 (실제 마우스 위치)
    const m = this.mouse;
    if (ph === 'draw' && !this.sentDone && m.inside && m.x >= x && m.x < x + S && m.y >= y && m.y < y + S) {
      const cx = Math.round(m.x);
      const cy = Math.round(m.y);
      ctx.fillStyle = C('1');
      ctx.fillRect(cx - 1, cy - 6, 3, 6);
      ctx.fillStyle = C(this.me.color);
      ctx.fillRect(cx, cy - 5, 1, 4);
      ctx.fillStyle = C('1');
      ctx.fillRect(cx, cy, 1, 1);
      if (this.twist === 'mirror') {
        // 실제로 잉크가 찍히는 자리 (반대편) 를 작은 십자로
        const mx = x + (S - 1 - (cx - x));
        ctx.fillStyle = C('g');
        ctx.fillRect(mx - 2, cy, 5, 1);
        ctx.fillRect(mx, cy - 2, 1, 5);
      }
    }
    if (ph === 'ready') {
      ctx.fillStyle = DITHER.get(ctx, 'o', 8);
      ctx.fillRect(x, y, S, S);
      drawCard(ctx, x + 6, y + 34, S - 12, 52, '2', this.me.color);
      KText.draw(ctx, '모두 준비!', x + S / 2, y + 37, C(this.me.color), { align: 'center', font: 'b', outline: C('1') });
      KText.draw(ctx, tw.name, x + S / 2, y + 52, C(tw.color), { align: 'center', font: 's' });
      if (this.frame % 40 < 28) KText.draw(ctx, '곧 시작합니다', x + S / 2, y + 67, C('a'), { align: 'center', font: 's' });
    }
    if (ph === 'draw' && this.sentDone) {
      drawCard(ctx, x + 14, y + 48, S - 28, 24, '1', 'e');
      KText.draw(ctx, '완료!', x + S / 2, y + 53, C('e'), { align: 'center', font: 'b' });
    }
    // 저주 이름표 (종이 위)
    if (this.twist !== 'none') {
      const w = KText.width(tw.name, 's') + 10;
      drawCard(ctx, PAPER_X + S / 2 - w / 2, 14, w, 14, '1', tw.color);
      KText.draw(ctx, tw.name, PAPER_X + S / 2, 15, C(tw.color), { align: 'center', font: 's' });
    }
    if (scored) {
      const S2 = this.score;
      const label = r.accuracy >= S2.SUCCESS ? '마법 발동!' : r.accuracy >= S2.OKAY ? '그럭저럭!' : '펑! 실패';
      const col = r.accuracy >= S2.SUCCESS ? '9' : r.accuracy >= S2.OKAY ? 'e' : 'j';
      drawCard(ctx, x + 8, y + 32, S - 16, 54, '1', col);
      KText.draw(ctx, label, x + S / 2, y + 35, C(col), { align: 'center', font: 'b' });
      KText.draw(ctx, `${this.shown}점`, x + S / 2, y + 50, C('a'), { align: 'center', font: 'L', outline: C('1') });
      const detail = `정확도 ${r.accuracy}${r.bonus ? ` + 빨리 ${r.bonus}` : ''}${r.mult > 1 ? ` ×${r.mult}` : ''}`;
      KText.draw(ctx, detail, x + S / 2, y + 70, r.mult > 1 ? C('9') : C('k'), { align: 'center', font: 'n' });
    }
  }

  // 마법 발동: 종이 뒤로 돌아가는 빛줄기
  renderSpellBack(ctx) {
    if (!this.spell || !this.spell.ok) return;
    const cx = PAPER_X + 60;
    const cy = PAPER_Y + 60;
    const n = 12;
    // 가운데 칸 안에서만 (양옆 점수판 · 이름표 글씨를 가리지 않게)
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAPER_X - 5, 15, CONFIG.CANVAS + 10, 140);
    ctx.clip();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + this.spell.t / 30;
      const a1 = a0 + Math.PI / n;
      ctx.fillStyle = DITHER.get(ctx, i % 2 ? '9' : this.spell.color, 4);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * 140, cy + Math.sin(a0) * 140);
      ctx.lineTo(cx + Math.cos(a1) * 140, cy + Math.sin(a1) * 140);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  faceOf(p) {
    return this.spr && this.spr.chars[p.char] ? this.spr.chars[p.char].face : null;
  }

  // 왼쪽: 나 + 실시간 마력
  renderLeft(ctx) {
    const p = this.me;
    const ph = this.phase;
    const r = this.result;
    drawCard(ctx, 4, 20, 90, 132, '2', p.color);
    drawNameCard(ctx, 8, 24, 82, { color: p.color, name: p.name, face: this.faceOf(p) });
    const scored = ph === 'score' && this.t > 30 && r;
    const hop = scored && r.accuracy >= this.score.SUCCESS ? Math.round(Math.abs(Math.sin(this.frame / 6)) * 4) : 0;
    const shiver = scored && r.accuracy < this.score.OKAY ? (this.frame % 4 < 2 ? 1 : -1) : 0;
    // 그리는 동안: 잘 그리면 신나서 통통, 못 그리면 땀 · 지팡이 끝 반짝이
    let dHop = 0;
    if (ph === 'draw' && this.twist !== 'ghost') {
      if (this.live >= this.score.SUCCESS) dHop = Math.round(Math.abs(Math.sin(this.frame / 5)) * 3);
      else if (this.live >= this.score.OKAY) dHop = Math.round(Math.abs(Math.sin(this.frame / 9)) * 1);
    }
    if (this.spr && this.spr.chars[p.char]) {
      const img = this.spr.chars[p.char].frames[((this.frame / 16) | 0) % 2];
      drawStanding(ctx, img, 49 + shiver, 92 - hop - dHop);
    }
    if (ph === 'draw') {
      // 지팡이 (오른손 쪽) + 끝 반짝
      ctx.fillStyle = C('1');
      ctx.fillRect(66, 58 - dHop, 2, 16);
      ctx.fillStyle = C('l');
      ctx.fillRect(66, 59 - dHop, 1, 14);
      const tip = this.streak > 0 && this.frame % 6 < 3 ? C('b') : C(this.shape.color);
      ctx.fillStyle = C('1');
      ctx.fillRect(64, 54 - dHop, 6, 5);
      ctx.fillStyle = tip;
      ctx.fillRect(65, 55 - dHop, 4, 3);
      if (this.t > 90 && this.live < this.score.OKAY && this.twist !== 'ghost') {
        // 땀 방울
        const sy = 50 + ((this.frame >> 2) % 8);
        ctx.fillStyle = C('h');
        ctx.fillRect(33, sy, 2, 3);
        ctx.fillStyle = C('b');
        ctx.fillRect(33, sy, 1, 1);
      }
      const sec = Math.max(0, Math.ceil((this.drawFrames - this.t) / 60));
      KText.draw(ctx, `${sec}초`, 49, 92, sec <= 3 ? C('5') : C('a'), { align: 'center', font: 'L', outline: C('1') });
      // 마력 게이지 = 지금까지 그린 정확도
      KText.draw(ctx, '마력', 10, 111, C('q'), { font: 'n' });
      ctx.fillStyle = C('1');
      ctx.fillRect(32, 113, 56, 8);
      if (this.twist === 'ghost') {
        KText.draw(ctx, '???', 60, 111, C('j'), { align: 'center', font: 'n' });
      } else {
        const k = this.live / 100;
        const col = this.live >= this.score.SUCCESS ? '9' : this.live >= this.score.OKAY ? 'e' : 'q';
        ctx.fillStyle = C(col);
        ctx.fillRect(33, 114, Math.round(54 * k), 6);
        ctx.fillStyle = C('w');
        ctx.fillRect(33, 114, Math.round(54 * k), 1);
        // 성공 기준선
        const gx = 33 + Math.round((54 * this.score.SUCCESS) / 100);
        ctx.fillStyle = C('b');
        ctx.fillRect(gx, 112, 1, 10);
        BitmapFont.draw(ctx, String(this.score.SUCCESS), gx, 106, C('9'), { align: 'center' });
        KText.draw(ctx, '발동', 88, 122, C('j'), { font: 'n', align: 'right' });
      }
    } else {
      const status = { intro: '준비', slot: '준비', ready: '준비!', score: '채점', gallery: '감상 시간' }[ph] || '';
      KText.draw(ctx, status, 49, 94, C('9'), { align: 'center', font: 'b', outline: C('1') });
      KText.draw(ctx, `합계 ${this.totalOf(p.id)}점`, 49, 112, C('a'), { align: 'center', font: 'n' });
    }
    KText.draw(ctx, '함께 그리는 중', 49, 136, C('k'), { align: 'center', font: 'n' });
  }

  // 오른쪽: 점수판 (모두의 합계 · 이번 라운드 점수 · 그리는 중인지)
  renderBoard(ctx) {
    const s = this.snap;
    const ph = this.phase;
    drawCard(ctx, 226, 20, 90, 132, '2', '3');
    KText.draw(ctx, '점수판', 271, 22, C('9'), { align: 'center', font: 'b' });
    const sorted = [...this.players].sort((a, b) => this.totalOf(b.id) - this.totalOf(a.id));
    sorted.forEach((p, i) => {
      const y = 36 + i * 23;
      const me = p.id === this.me.id;
      const st = s && s.players ? s.players[p.id] : null;
      const face = this.faceOf(p);
      if (face) ctx.drawImage(face, 230, y + 2);
      // 1줄: 이름 / 2줄: 합계 + 이번 라운드 점수(그리는 중에는 진행 상태)
      const big = KText.width(p.name, 's') <= 60;
      KText.draw(ctx, big ? p.name : KText.fit(p.name, 'n', 62), 250, y, me ? C('9') : C(p.color), { font: big ? 's' : 'n', outline: C('1') });
      KText.draw(ctx, `${st ? st.total : 0}점`, 250, y + 11, C('a'), { font: 'n' });
      if (!st) return;
      if (ph === 'draw') {
        const txt = st.done ? '완료' : st.live == null ? '???' : `${st.live}%`;
        KText.draw(ctx, txt, 312, y + 11, st.done ? C('e') : C('j'), { font: 'n', align: 'right' });
      } else if (ph === 'score' || ph === 'gallery') {
        const last = (st.rounds || [])[s.round - 1];
        if (last) KText.draw(ctx, `+${last.total}`, 312, y + 11, C('e'), { font: 'n', align: 'right' });
      }
    });
  }

  // 아래 줄: 안내 문구 + 완료 버튼 + 마법사 대사(자막)
  renderBottom(ctx) {
    const W = CONFIG.WIDTH;
    const ph = this.phase;
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 155, W, 25);
    const tw = this.twists[this.twist] || this.twists.none;
    const cap = this.caption && this.time < this.caption.until ? this.caption : null;
    const y = cap ? 155 : 160;
    if (ph === 'draw') {
      let msg = this.twist === 'none' ? '누른 채 그리기 · 다 그렸으면 완료 →' : `${tw.name}: ${tw.desc}`;
      let col = this.twist === 'none' ? C('a') : C(tw.color);
      if (this.sentDone) {
        msg = '완료! 다른 마법사를 기다리는 중…';
        col = C('e');
      } else if (this.t >= this.drawFrames) {
        msg = '시간 끝! 채점 중…';
        col = C('9');
      }
      KText.draw(ctx, msg, 6, y, col, { font: KText.width(msg, 's') > 224 ? 'n' : 's' });
      this.doneBtn.render(ctx, !this.sentDone && this.t < this.drawFrames, this.frame);
    } else if (ph === 'ready') {
      KText.draw(ctx, '시작하면 마우스를 누른 채 선을 따라 그리세요', W / 2, y, C('9'), { align: 'center', font: 's' });
    } else if (ph === 'gallery') {
      KText.draw(ctx, '모두의 그림을 감상하는 중…', W / 2, y, C('k'), { align: 'center', font: 's' });
    } else {
      KText.draw(ctx, '선 위로 그리면 반짝! · 빨리 끝내면 보너스', W / 2, y, C('k'), { align: 'center', font: 's' });
    }
    if (cap) this.renderCaption(ctx, cap, 4, 167, ph === 'draw' ? 228 : W - 8);
  }

  // 마법사 대사 한 줄. AI 가 쓴 줄에는 작은 'AI' 표시를 붙인다
  renderCaption(ctx, cap, x, y, maxW) {
    let cx = x;
    if (cap.ai) {
      drawCard(ctx, cx, y + 1, 13, 10, '3', 'q');
      BitmapFont.draw(ctx, 'AI', cx + 3, y + 3, C('b'));
      cx += 15;
    }
    const who = `${cap.who}:`;
    KText.draw(ctx, who, cx, y, C('q'), { font: 'n' });
    cx += KText.width(who, 'n') + 3;
    KText.draw(ctx, KText.fit(cap.text, 'n', Math.max(20, x + maxW - cx)), cx, y, C('a'), { font: 'n' });
  }

  // 시작 안내
  renderIntro(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = DITHER.get(ctx, 'o', 12);
    ctx.fillRect(0, 15, W, 140);
    drawCard(ctx, 40, 26, 240, 118, '1', '9');
    KText.draw(ctx, '마법진 그리기', W / 2, 30, C('9'), { align: 'center', font: 'L', outline: C('1') });
    KText.draw(ctx, '모두 같은 마법진을 동시에 따라 그려요', W / 2, 56, C('a'), { align: 'center', font: 's' });
    KText.draw(ctx, '마우스를 누른 채 그리기 · 다 그리면 완료', W / 2, 71, C('k'), { align: 'center', font: 'n' });
    KText.draw(ctx, '3라운드 · 저주 슬롯머신 · 마지막은 점수 2배', W / 2, 84, C('k'), { align: 'center', font: 'n' });
    const n = this.players.length;
    const x0 = Math.round(W / 2 - (n * 22) / 2) + 2;
    this.players.forEach((p, i) => {
      const face = this.faceOf(p);
      if (face) ctx.drawImage(face, x0 + i * 22, 102);
      if (p.id === this.me.id) KText.draw(ctx, '나', x0 + i * 22 + 9, 121, C('9'), { align: 'center', font: 'n' });
    });
  }

  // 라운드 시작 슬롯머신: [마법진] [저주]
  renderSlot(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    const k = Math.min(1, t / 12);
    const dy = -Math.round((1 - k) * 40);
    const jack = this.mult > 1;
    // 뒤 화면이 삐져나오지 않게 전체를 어둡게 덮음
    ctx.fillStyle = DITHER.get(ctx, 'o', 12);
    ctx.fillRect(0, 15, W, 140);
    drawCard(ctx, 40, 20 + dy, 240, 130, jack ? '7' : '1', jack ? '9' : '8');
    // 위 전구 줄 (깜빡)
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = C((i + (t >> 3)) % 2 ? '9' : '8');
      ctx.fillRect(48 + i * 13, 23 + dy, 3, 2);
    }
    const title = jack ? '잭팟 라운드! 점수 ×2' : `라운드 ${this.snap.round}`;
    KText.draw(ctx, title, W / 2, 27 + dy, jack && t % 20 < 12 ? C('9') : C('a'), { align: 'center', font: 'b', outline: C('1') });
    // 릴 1: 마법진 (같은 난이도 모양들이 돌아감)
    const pool = this.shapes.filter((s) => s.tier === this.shape.tier);
    const s1 = t < 70 ? pool[((t / 4) | 0) % pool.length] : this.shape;
    const bounce1 = t < 70 ? (t % 4) - 2 : t < 76 ? 76 - t : 0;
    drawCard(ctx, 58, 44 + dy, 68, 68, 'a', t >= 70 ? '9' : 'i');
    ctx.save();
    ctx.beginPath();
    ctx.rect(60, 46 + dy, 64, 63);
    ctx.clip();
    ctx.drawImage(previewImage(s1), 62, 48 + dy + bounce1);
    ctx.restore();
    KText.draw(ctx, s1.name, 92, 114 + dy, C(s1.color), { align: 'center', font: 's', outline: C('1') });
    // 릴 2: 저주
    const keys = Object.keys(this.twists);
    const tk = t < 110 ? keys[((t / 4) | 0) % keys.length] : this.twist;
    const tw = this.twists[tk] || this.twists.none;
    const bounce2 = t < 110 ? (t % 4) - 2 : t < 116 ? 116 - t : 0;
    KText.draw(ctx, '저주', 201, 44 + dy, C('j'), { align: 'center', font: 'n' });
    drawCard(ctx, 138, 56 + dy, 126, 30, '2', t >= 110 ? tw.color : 'i');
    ctx.save();
    ctx.beginPath();
    ctx.rect(140, 58 + dy, 122, 26);
    ctx.clip();
    KText.draw(ctx, tw.name, 201, 63 + dy + bounce2, C(tw.color), { align: 'center', font: 'b', outline: C('1') });
    ctx.restore();
    if (t >= 110) {
      KText.draw(ctx, tw.desc, 201, 92 + dy, C('a'), { align: 'center', font: KText.width(tw.desc, 's') > 134 ? 'n' : 's' });
      if (t > 130 && t % 40 < 28) KText.draw(ctx, '모두 함께 시작!', 201, 120 + dy, C('k'), { align: 'center', font: 'n' });
    }
  }

  // 라운드 갤러리: 모두의 그림을 나란히 (점수 높은 순) + AI 감상평
  renderGallery(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.t;
    const s = this.snap;
    const rv = this.reveal && this.reveal.round === s.round ? this.reveal : null;
    drawCard(ctx, 4, 18, 312, 136, '1', '9');
    KText.draw(ctx, `라운드 ${s.round} 갤러리 · ${this.shape.name}`, W / 2, 21, C('9'), { align: 'center', font: 'b' });
    if (!rv) return;
    const scoreOf = (p) => rv.scores[p.id] || { total: 0, accuracy: 0 };
    const list = [...this.players].sort((a, b) => scoreOf(b).total - scoreOf(a).total);
    const n = list.length;
    const step = 62;
    const x0 = Math.round(W / 2 - (n * step) / 2) + 1;
    // 감상평: 서버 상태(다시 접속한 사람용) 또는 방금 받은 사건
    let reviews = s.reviews || null;
    if (!reviews && this.reviews && this.reviews.round === s.round) reviews = this.reviews.reviews;
    const reviewed = reviews ? list.filter((p) => reviews[p.id]) : [];
    const since = this.reviews && this.reviews.round === s.round ? this.time - this.reviews.at : t / 60;
    const active = reviewed.length ? reviewed[Math.floor(Math.max(0, since) / REVIEW_TURN) % reviewed.length] : null;
    list.forEach((p, i) => {
      if (t < 8 + i * 10) return; // 한 장씩 펼쳐짐
      const r = scoreOf(p);
      const x = x0 + i * step;
      const y = 36;
      const best = i === 0;
      const edge = active === p && this.frame % 20 < 14 ? 'h' : best ? '9' : r.accuracy < this.score.OKAY ? 'i' : 'r';
      drawCard(ctx, x, y, 60, 60, 'a', edge);
      ctx.drawImage(guideImage(this.shape), x + 1, y + 1, 58, 58);
      const paper = rv.papers[p.id];
      if (paper && paper.canvas) ctx.drawImage(paper.canvas, x + 1, y + 1, 58, 58);
      if (best && t > 50 && this.spr) ctx.drawImage(this.spr.crown, x + 24, y - 6 - Math.round(Math.abs(Math.sin(t / 8)) * 2));
      if (n > 1 && i === n - 1 && r.accuracy < this.score.OKAY && t > 50) {
        drawCard(ctx, x + 32, y + 44, 26, 13, '7', 'j');
        KText.draw(ctx, '펑!', x + 45, y + 44, C('a'), { align: 'center', font: 'n' });
      }
      const face = this.faceOf(p);
      if (face) ctx.drawImage(face, x + 1, y + 62);
      const big = KText.width(p.name, 's') <= 40;
      KText.draw(ctx, big ? p.name : KText.fit(p.name, 'n', 42), x + 38, y + 63, p.id === this.me.id ? C('9') : C(p.color), { align: 'center', font: big ? 's' : 'n', outline: C('1') });
      KText.draw(ctx, `${r.total}점`, x + 30, y + 78, best ? C('9') : C('a'), { align: 'center', font: 'b' });
    });
    if (active) {
      // AI 감상평 (점수와는 무관): "○○의 그림 → 무엇처럼 보이는지" + 마법사의 한 줄 평
      const rev = reviews[active.id];
      drawCard(ctx, 10, 130, 13, 10, '3', 'q');
      BitmapFont.draw(ctx, 'AI', 13, 132, C('b'));
      const head = `${active.name}의 그림 → ${rev.looksLike || '?'}`;
      KText.draw(ctx, KText.fit(head, 'n', 280), 27, 129, C(active.color), { font: 'n' });
      KText.draw(ctx, KText.fit(`마법사: ${rev.comment || ''}`, 'n', 296), 12, 140, C('a'), { font: 'n' });
    } else if (t > 50) {
      const top = list[0];
      KText.draw(ctx, `최고의 마법사: ${top.name}!`, W / 2, 135, C('9'), { align: 'center', font: 's', outline: C('1') });
    }
  }

  // 최종 결과: 3라운드 합계 점수 순위 (원본 result.js) + AI 총평
  renderFinal(ctx) {
    const W = CONFIG.WIDTH;
    const s = this.snap;
    const t = this.t;
    drawBackdrop(ctx, this.frame);
    this.particles.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, 1, C('9'), { align: 'center', font: 'L', outline: C('1') });
    const rows = (s && s.results) || [];
    const rowH = rows.length > 4 ? 22 : 26;
    const y0 = 32;
    const rounds = s ? s.rounds : 3;
    // 머리글: 합계 · 라운드별 모양
    for (let i = 0; i < rounds; i++) {
      const sh = this.shapes[this.roundShapes[i]];
      const mult = (this.opt.rounds && this.opt.rounds[i] && this.opt.rounds[i].mult) || 1;
      const label = (sh ? sh.short : `${i + 1}R`) + (mult > 1 ? '×2' : '');
      KText.draw(ctx, label, 184 + i * 34, y0 - 13, C(sh ? sh.color : 'k'), { font: 'n', align: 'center', outline: C('1') });
    }
    KText.draw(ctx, '합계', 150, y0 - 13, C('a'), { font: 'n', align: 'right', outline: C('1') });
    KText.draw(ctx, '최고', 300, y0 - 13, C('e'), { font: 'n', align: 'right', outline: C('1') });
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.byId.get(r.playerId) || { name: r.name, color: 'k', char: '' };
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 12;
      const x = 14 + slide;
      const y = y0 + i * rowH;
      const h = rowH - 3;
      const me = r.playerId === this.me.id;
      drawCard(ctx, x, y, 292, h, r.rank === 1 ? '7' : '2', r.rank === 1 ? '9' : me ? 'h' : '3');
      BitmapFont.draw(ctx, String(r.rank), x + 13, y + Math.floor((h - 10) / 2), r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      drawNameCard(ctx, x + 26, y + Math.floor((h - 17) / 2), 84, { color: p.color, name: p.name, face: this.faceOf(p) });
      if (r.rank === 1 && this.spr) ctx.drawImage(this.spr.crown, x + 32, y - 1);
      const ty = y + Math.floor((h - 15) / 2);
      KText.draw(ctx, `${r.score}`, x + 140, ty, C('9'), { font: 'b', outline: C('1'), align: 'right' });
      const stats = r.stats || {};
      (stats.rounds || []).forEach((v, k) => {
        const acc = (stats.accuracy || [])[k] || 0;
        const col = acc >= this.score.SUCCESS ? C('9') : acc >= this.score.OKAY ? C('a') : C('j');
        KText.draw(ctx, String(v), x + 170 + k * 34, ty, col, { font: 's', align: 'center' });
      });
      if (stats.best != null) KText.draw(ctx, `${stats.best}`, x + 286, ty, C('e'), { font: 'b', align: 'right' });
    });
    // 아래: AI 총평(도착했을 때만) 또는 마법사의 마지막 한마디
    const v = this.verdict;
    const by = y0 + Math.max(rows.length, 2) * rowH + 2;
    if (v && v.headline) {
      const step = Math.min(11, Math.floor((CONFIG.HEIGHT - by - 11) / 2));
      drawCard(ctx, 8, by + 1, 13, 10, '3', 'q');
      BitmapFont.draw(ctx, 'AI', 11, by + 3, C('b'));
      KText.draw(ctx, KText.fit(`AI 총평: ${v.headline}`, 'n', 290), 24, by, C('9'), { font: 'n', outline: C('1') });
      if (v.mvp) KText.draw(ctx, KText.fit(`1등에게: ${v.mvp}`, 'n', 300), 10, by + step, C('a'), { font: 'n', outline: C('1') });
      if (v.cheer) KText.draw(ctx, KText.fit(`응원: ${v.cheer}`, 'n', 300), 10, by + step * 2, C('k'), { font: 'n', outline: C('1') });
    } else if (this.caption && this.time < this.caption.until) {
      this.renderCaption(ctx, this.caption, 10, Math.min(by + 4, CONFIG.HEIGHT - 14), W - 20);
    } else if (t > 60 && t % 40 < 28) {
      KText.draw(ctx, '잠시 뒤 대기실로 돌아갑니다', W / 2, Math.min(by + 4, CONFIG.HEIGHT - 15), C('9'), { align: 'center', font: 's', outline: C('1') });
    }
  }
}
