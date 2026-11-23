// =============================================================
// 교수님 몰래 댄스! — 화면 (멀티플레이)
//
// 판정(걸림 · 점수 · 피버)과 교수님 움직임은 서버가 한다. 여기서는
//  - 서버 상태(net.snap)와 사건을 원본 그림 코드(gfx/classView.js 등)로 그리고
//  - 내가 누르고 있는 춤 키를 보낸다 (Z = 큰 춤, X = 작은 춤)
// 그리기는 원본 js/scenes/play.js · result.js 의 render 를 옮긴 것이다.
// 내 캐릭터의 춤 동작만 서버를 기다리지 않고 바로 보여 준다(예측). 점수 · 걸림은 서버 값만 쓴다.
// =============================================================
import { AudioManager } from '../audio/audio.js';
import { applyServerConfig, CHARACTER_DEFS, CHARACTER_ORDER, CONFIG, KEYS } from '../config.js';
import {
  BOARD_LINES, drawBoardText, drawChalkBg, drawDesk, drawRoom, drawTeacher, drawWalkOut, initTeacherSprites,
  PROF_H, ROOM,
} from '../gfx/classView.js';
import { BitmapFont } from '../gfx/font.js';
import { C } from '../gfx/palette.js';
import { ParticleSystem } from '../gfx/particles.js';
import { getKeycap, initSprites, loadCharacterImages, SPR } from '../gfx/sprites.js';
import { DITHER, drawCard, drawNameCard, KText } from '../gfx/ui.js';

const FPS = 60;
const STEP = 1 / FPS;
const BOLD_FONT_URL = new URL('../assets/fonts/Galmuri11-Bold.woff2', import.meta.url).href;
/** 교수님 대사가 말풍선에 떠 있는 시간(프레임) */
const SAY_FRAMES = 150;

export class SneakyScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    applyServerConfig(options);
    this.meId = me ? me.id : null;

    // 학생(자리 순서 = 참가자 순서). 그림은 대기실에서 고른 동물에 맞춘다.
    this.players = players.map((p, i) => {
      const animal = CHARACTER_DEFS[p.character] ? p.character : CHARACTER_ORDER[(p.index ?? i) % CHARACTER_ORDER.length];
      return {
        id: p.id, slot: i, index: i, def: CHARACTER_DEFS[animal], name: p.name, isMe: p.id === this.meId,
        mode: 'none', danceT: 0, recover: 0, punishT: 0, strikes: 0, out: false, outT: 0,
        fever: 0, score: 0, msg: null, place: null,
      };
    });
    this.byId = new Map(this.players.map((p) => [p.id, p]));
    this.me = this.byId.get(this.meId) || null;
    this.colX0 = Math.round((CONFIG.WIDTH - this.players.length * ROOM.COL_W) / 2);

    // 교수님(서버 상태를 비춘 것) — 원본 Teacher 와 같은 모양이라 drawTeacher 를 그대로 쓴다
    this.teacher = {
      state: 'write', t: 0, dur: 160, x: 160, planned: false,
      get watching() {
        if (this.state === 'look') return true;
        if (this.state === 'turn') return this.t / this.dur >= CONFIG.SEE_FROM;
        return false;
      },
      get facing() {
        if (this.state === 'turn') return this.t / this.dur;
        if (this.state === 'look') return 1;
        if (this.state === 'back') return 1 - this.t / this.dur;
        return 0;
      },
    };

    this.phase = 'intro';
    this.frame = 0;
    this.left = CONFIG.CLASS_TIME;
    this.line = 0;
    this.catchFx = null;   // { slot, t } 교수님이 가리킴
    this.dark = 0;         // 교수님이 반을 볼 때 교실이 어두워지는 정도
    this.sweep = 0;        // 훑어보는 눈빛 위치
    this.shake = 0;
    this.say = null;       // { text, source, t } 교수님 말풍선 대사
    this.verdict = null;   // AI 총평
    this.results = null;
    this.finalT = 0;
    this.introLeft = CONFIG.FLOW.INTRO_TIME;
    this.muteNotice = 0;
    this.particles = new ParticleSystem();
    this.confetti = new ParticleSystem();
    this.audio = new AudioManager();

    // 내 입력
    this.keys = new Set();
    this.heldBig = false;
    this.heldSmall = false;
    this._sent = { big: false, small: false };
    this.localRecover = 0;

    this._buildDom();
    this._destroyed = false;
    this._ready = false;
    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onBlur = () => {
      this.keys.clear();
      this._syncKeys();
    };
    this._onResize = () => this._fit();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._fit();
    try { this.audio.unlock(); } catch (e) { /* 소리 없이 진행 */ }
    this.audio.playBgm('game');

    this._load().then(() => {
      if (this._destroyed) return;
      this._ready = true;
      this._last = performance.now();
      this._acc = 0;
      const loop = (now) => {
        if (this._destroyed) return;
        this._raf = requestAnimationFrame(loop);
        this._acc += Math.min(0.25, (now - this._last) / 1000);
        this._last = now;
        while (this._acc >= STEP) {
          this._update();
          this._acc -= STEP;
        }
        this._render(this.ctx);
      };
      this._raf = requestAnimationFrame(loop);
    });
  }

  /** 픽셀 글꼴 · 캐릭터 그림을 불러온 뒤 스프라이트를 만든다 (원본 main.js) */
  async _load() {
    try {
      if (typeof FontFace !== 'undefined' && document.fonts) {
        // 굵은 Galmuri11 은 페이지에 없어서 이 게임이 직접 불러온다
        this._boldFace = new FontFace('Galmuri11', `url(${BOLD_FONT_URL})`, { weight: 'bold' });
        document.fonts.add(this._boldFace);
        await this._boldFace.load().catch(() => {});
      }
      await Promise.race([
        Promise.all([
          document.fonts.load('12px Galmuri11'),
          document.fonts.load('bold 12px Galmuri11'),
          document.fonts.load('10px Galmuri9'),
          document.fonts.load('15px Galmuri14'),
        ]),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (e) {
      console.warn('[sneaky] 폰트 로딩 실패, 기본 글꼴 사용', e);
    }
    KText.clear();
    DITHER.cache.clear();
    await loadCharacterImages();
    initSprites(this.players.map((p) => p.def.sprite));
    initTeacherSprites();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    if (this._boldFace && document.fonts) document.fonts.delete(this._boldFace);
    this.audio.destroy();
    KText.clear();
    DITHER.cache.clear();
    this.root.remove();
  }

  // ------------------------------------------------------------
  _buildDom() {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'relative', width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: '#120a1c', overflow: 'hidden',
    });
    const canvas = document.createElement('canvas');
    canvas.width = CONFIG.WIDTH;
    canvas.height = CONFIG.HEIGHT;
    canvas.style.setProperty('image-rendering', 'crisp-edges');
    canvas.style.setProperty('image-rendering', 'pixelated');
    canvas.style.display = 'block';
    root.appendChild(canvas);
    this.container.appendChild(root);
    this.root = root;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.autoHeight = this.container.clientHeight === 0;
  }

  /** container 크기에 맞춰 정수배로만 확대 (픽셀이 찌그러지지 않게) */
  _fit() {
    const W = CONFIG.WIDTH, H = CONFIG.HEIGHT;
    const w = this.root.clientWidth || W * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(CONFIG.MAX_SCALE, Math.floor(Math.min(w / W, h / H))));
    this.canvas.style.width = `${W * s}px`;
    this.canvas.style.height = `${H * s}px`;
    if (this.autoHeight) this.root.style.height = `${H * s}px`;
  }

  // ------------------------------------------------------------
  // 입력
  // ------------------------------------------------------------
  _key(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.altKey || e.metaKey) return;
    try { this.audio.unlock(); } catch (err) { /* 소리 없이 진행 */ }
    if (e.code === KEYS.mute) {
      if (down && !e.repeat) {
        this.audio.toggleMute();
        this.muteNotice = 90;
      }
      return;
    }
    if (!KEYS.big.includes(e.code) && !KEYS.small.includes(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    this._syncKeys();
  }

  /** 누르고 있는 키가 바뀌면 서버로 보낸다 */
  _syncKeys() {
    this.heldBig = KEYS.big.some((k) => this.keys.has(k));
    this.heldSmall = KEYS.small.some((k) => this.keys.has(k));
    if (!this.me || this._destroyed) return;
    const active = this.phase === 'intro' || this.phase === 'play';
    const big = this.heldBig && active;
    const small = this.heldSmall && active;
    if (big === this._sent.big && small === this._sent.small) return;
    this._sent = { big, small };
    this.net.dance(big, small);
  }

  // ------------------------------------------------------------
  // 서버 사건 → 연출 (원본 update / updateStudent 의 효과 부분)
  // ------------------------------------------------------------
  colCx(p) {
    return this.colX0 + p.slot * ROOM.COL_W + ROOM.COL_W / 2;
  }

  _handleEvent(e) {
    const audio = this.audio;
    switch (e.type) {
      case 'teacher':
        if (e.state === 'tell') audio.sfx('ahem');
        else if (e.state === 'turn') audio.sfx('turn');
        break;
      case 'caught':
        for (const id of e.ids || []) {
          const p = this.byId.get(id);
          if (!p) continue;
          const out = (e.out || []).includes(id);
          p.msg = out ? { text: '복도로 나가!', color: '5', t: 0 } : { text: `걸렸다! -${e.penalty}`, color: '5', t: 0 };
          this.catchFx = { slot: p.slot, t: 0 };
          this.particles.burst(this.colCx(p), 100, 14, [C('5'), C('9'), C('b')], 1.6, 24, 1);
        }
        this.shake = 8;
        audio.sfx('caught');
        break;
      case 'fever': {
        const p = this.byId.get(e.id);
        if (p) p.msg = { text: `피버 ×${e.mult}`, color: '9', t: 0 };
        audio.sfx('coin');
        break;
      }
      case 'say':
        this.say = { text: String(e.text || '').slice(0, 30), source: e.source, t: 0 };
        break;
      case 'verdict':
        this.verdict = { headline: e.headline, mvp: e.mvp, cheer: e.cheer };
        break;
      case 'end':
        audio.setMusicLevel(1, 0.3);
        audio.sfx('chime');
        audio.sfx('win');
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------
  // 한 프레임(1/60초): 서버 상태를 화면용 값으로 옮긴다
  // ------------------------------------------------------------
  _update() {
    const s = this.net.snap;
    const audio = this.audio;
    this.frame++;
    if (this.shake > 0) this.shake--;
    if (this.muteNotice > 0) this.muteNotice--;
    this.particles.update();
    if (this.catchFx && ++this.catchFx.t > 60) this.catchFx = null;
    if (this.say && ++this.say.t > SAY_FRAMES) this.say = null;
    for (const p of this.players) if (p.msg && ++p.msg.t > 60) p.msg = null;
    for (const e of this.net.takeEvents()) this._handleEvent(e);
    if (!s) return;

    const prevPhase = this.phase;
    this.phase = s.phase === 'done' ? 'final' : s.phase;
    if (this.phase !== prevPhase) this._syncKeys();
    // 마지막 상태를 받은 뒤 지난 시간만큼 이어서 그린다(초당 30번 오는 상태 사이를 메운다)
    const ahead = this.phase === 'play' ? Math.max(0, Math.min(6, (this.net.now() - s.now) * FPS)) : 0;
    this.introLeft = Math.max(0, s.startAt - this.net.now());
    const prevLeft = this.left;
    this.left = Math.max(0, s.left - ahead);
    this.line = s.line || 0;
    if (s.verdict && !this.verdict) this.verdict = s.verdict;
    if (s.results) this.results = s.results;

    // 교수님
    const tc = this.teacher;
    const st = s.teacher || {};
    tc.state = st.state || 'write';
    tc.dur = Math.max(1, st.dur || 1);
    tc.t = Math.min(tc.dur, (st.t || 0) + ahead);
    tc.x = st.x ?? 160;
    tc.planned = !!st.planned;

    // 학생
    for (const row of s.students || []) {
      const p = this.byId.get(row.id);
      if (!p) continue;
      p.punishT = row.punish;
      p.strikes = row.strikes;
      p.out = row.out;
      p.outT = row.outFrames + (row.out ? ahead : 0);
      p.fever = row.fever;
      p.score = row.score;
      p.mode = row.mode;
      p.recover = row.recover;
    }

    if (this.phase === 'final') {
      this._updateFinal();
      return;
    }
    if (this.phase === 'end') {
      // 수업 끝! 다 같이 신나게 (점수는 그대로)
      for (const p of this.players) {
        if (p.out) continue;
        p.mode = 'big';
        p.danceT++;
        p.punishT = 0;
        const r = (this.results || []).find((x) => x.playerId === p.id);
        p.place = r ? r.rank : null;
      }
      return;
    }
    if (this.phase !== 'play') return;

    // 내 춤은 누르는 즉시 보여 준다(예측). 벌서기 · 복도행은 서버 상태를 따른다.
    const me = this.me;
    if (me && !me.out && me.punishT === 0) {
      if (this.heldBig) {
        me.mode = 'big';
        this.localRecover = CONFIG.BIG_RECOVER;
      } else if (this.localRecover > 0) {
        this.localRecover--;
        me.mode = 'recover';
        me.recover = this.localRecover;
      } else me.mode = this.heldSmall ? 'small' : 'none';
    } else this.localRecover = 0;

    // 낌새가 오면 음악이 뚝 줄고, 반을 보는 동안엔 거의 꺼짐 (긴장감)
    const lv = tc.state === 'write' ? 1 : tc.state === 'tell' ? 0.35 : tc.state === 'back' ? 0.6 : 0.12;
    audio.setMusicLevel(lv, tc.state === 'tell' ? 0.08 : 0.25);
    this.dark += ((tc.watching ? 1 : 0) - this.dark) * 0.2;
    if (tc.state === 'look') this.sweep = Math.sin(tc.t / 14);
    // 쓰는 동안 분필 소리와 가루 (멈추면 낌새가 눈에 보임)
    if (tc.state === 'write') {
      if (this.frame % 9 === 0) audio.sfx('chalk');
      if (this.frame % 5 === 0) {
        this.particles.add(tc.x + 14, ROOM.TEACHER_FOOT - PROF_H + 1, (Math.random() - 0.5) * 0.3, 0.3, 20, C('b'), 1);
      }
    }
    for (const p of this.players) {
      if (p.out || p.punishT > 0) continue;
      if (p.mode !== 'none') p.danceT++;
      if ((p.mode === 'small' || p.mode === 'big') && p.danceT % (p.mode === 'big' ? 10 : 18) === 0) {
        // 음표
        this.particles.add(this.colCx(p) + (Math.random() - 0.5) * 20, 92, (Math.random() - 0.5) * 0.4, -0.5, 30, C(p.def.color), 2);
        audio.sfx('step');
      }
    }
    for (const mark of [180, 120, 60]) if (prevLeft > mark && this.left <= mark) audio.sfx('countdown');
  }

  _updateFinal() {
    if (this.finalT === 0) {
      this.audio.setMusicLevel(1);
      this.audio.playBgm('result');
    }
    this.finalT++;
    if (this.finalT % 4 === 0) {
      const cols = [C('9'), C('8'), C('6'), C('h'), C('q'), C('b')];
      this.confetti.add(Math.random() * CONFIG.WIDTH, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 2);
    }
    this.confetti.update();
  }

  // ------------------------------------------------------------
  // 그리기 (원본 PlayScene.render)
  // ------------------------------------------------------------
  _render(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = '#120a1c';
    ctx.fillRect(0, 0, W, CONFIG.HEIGHT);
    if (this.phase === 'final') {
      this._renderFinal(ctx);
      this._renderMute(ctx);
      return;
    }
    const sh = this.shake ? (this.frame % 2 ? 1 : -1) : 0;
    ctx.save();
    ctx.translate(sh, 0);
    drawRoom(ctx, this.frame, this.left, CONFIG.CLASS_TIME);
    const tc = this.teacher;
    const k = tc.state === 'write' ? Math.min(1, tc.t / Math.max(1, tc.dur)) : 1;
    // 칠판: 다 쓴 줄(최근 2줄) + 지금 쓰는 줄
    const n = BOARD_LINES.length;
    const done = [];
    for (let i = Math.max(0, this.line - 2); i < this.line; i++) done.push(BOARD_LINES[i % n]);
    drawBoardText(ctx, done, BOARD_LINES[this.line % n], k);
    drawTeacher(ctx, tc, this.frame, !!this.catchFx);
    this._renderTell(ctx);
    for (const p of this.players) drawDesk(ctx, this.colCx(p), p, this.frame);
    this._renderGaze(ctx);
    for (const p of this.players) drawWalkOut(ctx, this.colCx(p), p, this.frame);
    this._renderBubble(ctx);
    this.particles.render(ctx);
    for (const p of this.players) this._renderHud(ctx, p);
    ctx.restore();
    this._renderTop(ctx);
    if (this.phase === 'intro') {
      drawCard(ctx, W / 2 - 96, 54, 192, 56, '1', '9');
      KText.draw(ctx, '수업 시작!', W / 2, 57, C('9'), { align: 'center', font: 'b' });
      KText.draw(ctx, '교수님이 칠판 볼 때만 춤추기', W / 2, 70, C('a'), { align: 'center', font: 's' });
      KText.draw(ctx, '흠흠 · 분필 멈춤 = 돌아볼 낌새!', W / 2, 83, C('5'), { align: 'center', font: 'n' });
      KText.draw(ctx, `Z 큰 춤 · X 작은 춤 (꾹)  ${Math.ceil(this.introLeft)}`, W / 2, 95, C('e'), { align: 'center', font: 'n' });
    }
    if (this.phase === 'end') {
      drawCard(ctx, W / 2 - 64, 66, 128, 26, '6', '9');
      KText.draw(ctx, '수업 끝!', W / 2, 69, C('9'), { align: 'center', font: 'L', outline: C('1') });
    }
    this._renderMute(ctx);
  }

  _renderMute(ctx) {
    if (this.muteNotice <= 0) return;
    const txt = this.audio.muted ? '소리 끔' : '소리 켬';
    drawCard(ctx, CONFIG.WIDTH - 60, CONFIG.HEIGHT - 26, 54, 20, '1', '3');
    KText.draw(ctx, txt, CONFIG.WIDTH - 33, CONFIG.HEIGHT - 23, C('a'), { align: 'center', font: 's' });
  }

  // 교수님 말풍선: 낌새(흠흠 / …?) · AI/기본 대사 · 걸렸을 때(거기 너!)
  _renderBubble(ctx) {
    const tc = this.teacher;
    const x = Math.round(tc.x) + 12;
    const y = ROOM.TEACHER_FOOT - PROF_H - 2;
    let text = null;
    let col = '1';
    let ai = false;
    // 낌새는 게임에 꼭 필요한 신호라 대사보다 먼저 보여 준다
    if (this.phase === 'play' && tc.state === 'tell') text = tc.t % 40 < 20 ? '흠흠…' : '…?';
    else if (this.say) {
      text = this.say.text;
      ai = this.say.source === 'gemini';
      if (this.catchFx) col = '6';
    } else if (this.catchFx) {
      text = '거기 너!';
      col = '6';
    }
    if (!text) return;
    // 긴 대사는 작은 글꼴로
    const font = KText.width(text, 's') > 170 ? 'n' : 's';
    const w = KText.width(text, font) + 12 + (ai ? 11 : 0);
    const bx = Math.max(2, Math.min(CONFIG.WIDTH - w - 2, x + 6));
    drawCard(ctx, bx, y, w, 18, 'b', col === '6' ? '6' : 'k');
    ctx.fillStyle = C('1');
    ctx.fillRect(bx + 2, y + 17, 5, 3);
    ctx.fillStyle = C('b');
    ctx.fillRect(bx + 3, y + 16, 3, 3);
    if (ai) {
      // AI 가 쓴 대사 표시
      ctx.fillStyle = C('g');
      ctx.fillRect(bx + 4, y + 5, 11, 8);
      BitmapFont.draw(ctx, 'AI', bx + 6, y + 6, C('b'));
    }
    KText.draw(ctx, text, bx + (ai ? 11 : 0) + (w - (ai ? 11 : 0)) / 2, y + (font === 'n' ? 3 : 2), C(col), { align: 'center', font });
  }

  // 낌새: 머리 위 '?' 깜빡 + 긴장선 (분필도 멈춤)
  _renderTell(ctx) {
    const tc = this.teacher;
    if (tc.state !== 'tell' || this.phase !== 'play') return;
    const hx = Math.round(tc.x);
    const hy = ROOM.TEACHER_FOOT - PROF_H;
    if (this.frame % 16 < 11) {
      ctx.fillStyle = C('1');
      ctx.fillRect(hx - 4, hy - 16, 9, 13);
      KText.draw(ctx, '?', hx, hy - 17, C('9'), { align: 'center', font: 'b' });
    }
    // 머리 양옆 긴장선
    ctx.fillStyle = C('5');
    const o = this.frame % 8 < 4 ? 0 : 1;
    ctx.fillRect(hx - 14 - o, hy + 4, 4, 1);
    ctx.fillRect(hx - 13 - o, hy + 9, 4, 1);
    ctx.fillRect(hx + 11 + o, hy + 4, 4, 1);
    ctx.fillRect(hx + 10 + o, hy + 9, 4, 1);
  }

  // 반을 보는 동안: 교실이 어두워지고 교수님 눈빛(조명)이 학생들을 훑음 · 걸리면 그 학생에게 딱 멈춤
  _renderGaze(ctx) {
    if (this.dark < 0.05 || this.phase !== 'play') return;
    const W = CONFIG.WIDTH;
    // 책상 윗부분까지만 살짝 어둡게 (명패 · 이름표는 그대로 잘 보이게)
    ctx.fillStyle = DITHER.get(ctx, 'o', Math.round(this.dark * 2));
    ctx.fillRect(0, 14, W, ROOM.DESK_TOP - 14);
    const tc = this.teacher;
    let tx = W / 2 + this.sweep * (this.players.length * ROOM.COL_W) * 0.45;
    if (this.catchFx) {
      const p = this.players.find((q) => q.slot === this.catchFx.slot);
      if (p) tx = this.colCx(p);
    }
    const ex = Math.round(tc.x);
    const ey = ROOM.TEACHER_FOOT - PROF_H + 11;
    ctx.fillStyle = DITHER.get(ctx, this.catchFx ? '5' : 't', Math.round(2 + this.dark * 2));
    ctx.beginPath();
    ctx.moveTo(ex - 3, ey);
    ctx.lineTo(ex + 3, ey);
    ctx.lineTo(tx + 26, ROOM.DESK_TOP + 2);
    ctx.lineTo(tx - 26, ROOM.DESK_TOP + 2);
    ctx.closePath();
    ctx.fill();
  }

  _renderTop(ctx) {
    const W = CONFIG.WIDTH;
    ctx.fillStyle = C('1');
    ctx.fillRect(0, 0, W, 14);
    ctx.fillStyle = C('c');
    ctx.fillRect(0, 13, W, 1);
    KText.draw(ctx, '교수님 몰래 댄스!', 4, 1, C('9'), { font: 'b' });
    // 교수님이 지금 AI(Gemini) 수업 계획대로 움직이는 중이면 작은 꼬리표
    if (this.teacher.planned && this.phase === 'play') {
      const tag = 'AI 수업 계획';
      const tw = KText.width(tag, 'n') + 6;
      ctx.fillStyle = C('g');
      ctx.fillRect(118, 1, tw, 11);
      KText.draw(ctx, tag, 121, 1, C('b'), { font: 'n' });
    }
    const sec = Math.ceil(this.left / FPS);
    KText.draw(ctx, this.phase === 'end' ? '수업 끝' : `수업 끝까지 ${sec}초`, W - 4, 1, sec <= 10 && this.frame % 30 < 15 ? C('5') : C('a'), { font: 's', align: 'right' });
  }

  _renderHud(ctx, p) {
    const cx = this.colCx(p);
    const x0 = cx - 32;
    drawNameCard(ctx, x0 + 2, 140, 60, { def: p.def, name: p.name, index: p.index, place: this.phase === 'end' ? p.place : null }, this.frame);
    if (p.msg) {
      const y = Math.round(78 - Math.min(6, p.msg.t / 4));
      const tw = KText.width(p.msg.text, 'n') + 8;
      ctx.fillStyle = C(p.msg.color);
      ctx.fillRect(Math.round(cx - tw / 2), y, tw, 12);
      ctx.fillStyle = C('1');
      ctx.fillRect(Math.round(cx - tw / 2) + 1, y + 1, tw - 2, 10);
      KText.draw(ctx, p.msg.text, cx, y + 1, C(p.msg.color), { align: 'center', font: 'n' });
    }
    if (p.punishT > 0 && !p.out) BitmapFont.draw(ctx, String(Math.ceil(p.punishT / FPS)), cx, 86, C('5'), { align: 'center', outline: C('1') });
    if (!p.isMe) return;
    // 내 자리 표시 + 조작키 (항상 표시): Z = 큰 춤, X = 작은 춤
    ctx.fillStyle = C('9');
    ctx.fillRect(x0 + 2, 157, 60, 1);
    const caps = [getKeycap('Z', 'fwd', this.heldBig), getKeycap('X', 'strike', this.heldSmall)];
    const tw = caps.reduce((s, c) => s + c.width, 0) + 1;
    let kx = Math.round(cx - tw / 2);
    for (const c of caps) {
      ctx.drawImage(c, kx, 159);
      kx += c.width + 1;
    }
  }

  // ------------------------------------------------------------
  // 최종 결과 (원본 ResultScene.render) + AI 총평
  // ------------------------------------------------------------
  _renderFinal(ctx) {
    const W = CONFIG.WIDTH;
    const t = this.finalT;
    drawChalkBg(ctx, t);
    this.confetti.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, 1, C('9'), { align: 'center', font: 'L', outline: C('1') });
    KText.draw(ctx, '걸림', 186, 19, C('k'), { font: 'n', align: 'center', outline: C('1') });
    KText.draw(ctx, '최고 피버', 236, 19, C('k'), { font: 'n', align: 'center', outline: C('1') });
    const rows = this.results || [];
    const rowH = 26;
    const y0 = 32;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.byId.get(r.playerId);
      if (!p) return;
      const st = r.stats || {};
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 12;
      const x = 14 + slide;
      const y = y0 + i * rowH;
      drawCard(ctx, x, y, 292, rowH - 3, r.rank === 1 ? '7' : '2', r.rank === 1 ? '9' : '3');
      BitmapFont.draw(ctx, String(r.rank), x + 13, y + 6, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      drawNameCard(ctx, x + 26, y + 3, 84, { def: p.def, name: p.name, index: p.index, place: null }, t);
      if (r.rank === 1) ctx.drawImage(SPR.crown, x + 32, y);
      KText.draw(ctx, `${r.score}점`, x + 116, y + 4, C('9'), { font: 'b', outline: C('1') });
      // 걸린 횟수 (경고 카드) · 최고 피버 · 복도행
      for (let k = 0; k < CONFIG.MAX_STRIKES; k++) {
        ctx.fillStyle = C('1');
        ctx.fillRect(x + 162 + k * 7, y + 5, 6, 10);
        ctx.fillStyle = k < (st.caught || 0) ? C(k === CONFIG.MAX_STRIKES - 1 ? '6' : '9') : C('i');
        ctx.fillRect(x + 163 + k * 7, y + 6, 4, 8);
      }
      KText.draw(ctx, st.out ? '복도행' : `피버 ×${st.maxFever}`, x + 196, y + 5, st.out ? C('5') : C('e'), { font: 'n' });
      if (p.isMe) KText.draw(ctx, '나', x + 280, y + 4, C('9'), { align: 'right', font: 'b', outline: C('1') });
    });
    // AI 총평: 맨 아래 줄에 한 줄씩 번갈아 보여 준다 (총평 · 1등에게 · 꼴찌에게)
    const v = this.verdict;
    if (v && v.headline) {
      const lines = [v.headline, v.mvp, v.cheer].filter(Boolean);
      const text = lines[Math.floor(t / 150) % lines.length];
      const by = CONFIG.HEIGHT - 15;
      ctx.fillStyle = C('1');
      ctx.fillRect(0, by - 1, W, 15);
      ctx.fillStyle = C('g');
      ctx.fillRect(3, by + 1, 40, 11);
      KText.draw(ctx, 'AI 총평', 6, by + 1, C('b'), { font: 'n' });
      KText.draw(ctx, text, 47, by + 1, C('a'), { font: 'n' });
    }
  }
}
