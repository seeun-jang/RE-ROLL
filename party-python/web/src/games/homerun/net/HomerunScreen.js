// =============================================================
// 잭팟 홈런 더비 — 화면 (멀티플레이)
//
// 공 순서 · 던지는 시각 · 맞았는지 · 점수는 서버가 정한다. 여기서는
//  - 서버 시계에 맞춰 와인드업 → 투구 → 타구 연출을 그리고(원본 scenes/play.js 의 그리기 코드),
//  - ← → 로 배트(노란 막대)를 옮기고 Space 로 스윙한 시각 · 배트 위치를 서버로 보낸다.
//  - 기다리지 않고 바로 반응하도록 내 스윙 결과를 같은 규칙(sim/rules.js)으로 미리 그린다.
//    서버가 알려 준 결과와 다르면 서버 것으로 바꾸고, 점수는 서버 값만 쓴다.
// 다른 사람의 점수는 아래 전광판에 작게 보인다.
// =============================================================
import { AudioManager } from '../audio.js';
import { CHARACTERS, characterIndex } from '../characters.js';
import { CONFIG, KEYS } from '../config.js';
import {
  drawBallIcon, drawBroadcastPanel, drawRays, drawTag, drawValue, PITCH_COLOR,
} from '../gfx/broadcast.js';
import {
  batterImg, drawBall, drawBatBar, drawBatter, drawBroadcast, drawFielder, drawFieldView, drawFlightBall,
  drawMitt, drawPitcher, drawRunner, drawZone, fproj, px,
} from '../gfx/fieldView.js';
import { BitmapFont } from '../gfx/font.js';
import { DITHER, drawCard, drawNameCard } from '../gfx/hud.js';
import { C } from '../gfx/palette.js';
import { ParticleSystem } from '../gfx/particles.js';
import { SPR, getKeycap, initSprites, loadCharacterImages } from '../gfx/sprites.js';
import { KText, drawPanel } from '../gfx/ui.js';
import {
  BASE1, BASE_DIST, BATTED, FIELDERS, HIT_LOOK, PLATE_SCALE, hitPoints, makeHit, pitchPos, polar,
} from '../sim/rules.js';
import { Flight, HOLD } from './Flight.js';

const W = CONFIG.WIDTH;
const H = CONFIG.HEIGHT;
const SAY_TIME = 170;       // 해설 자막이 떠 있는 프레임
const CALL_TIME = 80;       // 판정 글자가 떠 있는 프레임 (원본 값)

const CSS = `
.hr-root { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #120a1c; overflow: hidden; }
.hr-root canvas { display: block; flex: none; image-rendering: pixelated; image-rendering: crisp-edges; }
`;

export class HomerunScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    this.opt = options || {};
    this.pitches = this.opt.pitches || [];
    this.meId = me ? me.id : null;
    this.players = players.map((p) => {
      const ci = characterIndex(p.character, p.index ?? 0);
      return { id: p.id, name: p.name, index: ci, def: CHARACTERS[ci], isMe: p.id === this.meId };
    });
    // 내 타석을 그릴 사람(구경만 하는 경우에는 첫 번째 사람 그림을 빌린다)
    this.mine = this.players.find((p) => p.isMe) || this.players[0];
    this.canPlay = this.players.some((p) => p.isMe);

    // 원본 AtBat 중 화면에 필요한 부분 (값은 서버 시계에서 계산한다)
    this.ab = { phase: 'windup', t: 0, tf: 0, batX: 0, swingT: -1, pitch: null };
    this.idx = -1;            // 지금 그리고 있는 공 번호
    this.pred = null;         // 이번 공에 맞은 타구 { hit, at(맞은 시각), pts(서버가 알려 준 점수) }
    this.fl = null;           // 타구 연출
    this.flDone = false;
    this.mittDone = false;    // 미트에 들어간 순간의 처리를 했는지
    this.released = false;
    this.revealed = false;    // 이번 공의 결과 글자가 화면에 나왔는지 (나온 뒤에 점수를 올려 보여 준다)
    this.myCall = null;       // 서버가 알려 준 이번 공 결과
    this.meApplied = false;
    this.call = null;         // 화면 가운데 판정 글자
    this.say = null;          // 해설 자막 { text, source, who, t }
    this.verdict = null;      // AI 총평
    this.flash = 0;
    this.crowd = 0;
    this.frame = 0;
    this.finalT = -1;
    this.muteNotice = 0;
    this.particles = new ParticleSystem();
    this.audio = new AudioManager();
    this.held = new Set();
    this._destroyed = false;
    this._ready = false;

    this._buildDom();
    this._onKeyDown = (e) => this._keyDown(e);
    this._onKeyUp = (e) => this.held.delete(e.code);
    this._onBlur = () => this.held.clear();
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
    try { this.audio.unlock(); } catch (e) { /* 첫 키 입력 때 켜진다 */ }
  }

  // 글꼴 · 그림을 불러온 뒤 그리기를 시작한다
  async init() {
    try {
      // 굵은 픽셀 글꼴(원본 assets/fonts)은 이 게임만 쓰는 이름으로 불러온다 (다른 게임의 글씨가 바뀌지 않게)
      const url = new URL('../assets/fonts/Galmuri11-Bold.woff2', import.meta.url).href;
      this._font = new FontFace('HomerunGalmuri11', `url(${url})`, { weight: 'bold' });
      await this._font.load();
      document.fonts.add(this._font);
      await Promise.race([
        Promise.all([
          document.fonts.load('bold 12px HomerunGalmuri11'),
          document.fonts.load('15px Galmuri14'),
          document.fonts.load('10px Galmuri9'),
        ]),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (e) {
      console.warn('[homerun] 글꼴 로딩 실패, 기본 글꼴 사용', e);
    }
    if (this._destroyed) return;
    KText.clear();
    DITHER.cache.clear();
    await loadCharacterImages();
    if (this._destroyed) return;
    initSprites();
    this._ready = true;
    this.audio.playBgm('game');
    this._last = performance.now();
    this._acc = 0;
    const loop = (ts) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(loop);
      let dt = ts - this._last;
      this._last = ts;
      if (dt > 250) dt = 250; // 탭 전환 후 폭주 방지
      this._acc += dt;
      const step = 1000 / 60;
      while (this._acc >= step) {
        this._update();
        this._acc -= step;
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
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.audio.close();
    if (this._font) {
      try { document.fonts.delete(this._font); } catch (e) { /* 무시 */ }
    }
    KText.clear();
    this.root.remove();
    this.styleEl.remove();
  }

  _buildDom() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    this.root = document.createElement('div');
    this.root.className = 'hr-root';
    this.container.appendChild(this.root);
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.autoHeight = this.container.clientHeight === 0;
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

  // ------------------------------------------------------------ 입력
  _keyDown(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    this.audio.unlock();
    const mine = [...KEYS.left, ...KEYS.right, ...KEYS.swing];
    if (mine.includes(e.code)) e.preventDefault(); // 방향키 · 스페이스로 페이지가 움직이지 않게
    if (e.repeat) return;
    this.held.add(e.code);
    if (e.code === 'KeyM') {
      this.audio.toggleMute();
      this.muteNotice = 90;
    }
    if (KEYS.swing.includes(e.code)) this._swing();
  }

  _down(list) {
    return list.some((c) => this.held.has(c));
  }

  /** 내 남은 기회(이번 공을 던지기 전 기준 — 서버 상태) */
  _chancesNow() {
    const s = this.net.snap;
    const p = s && s.players && s.players[this.mine.id];
    return p ? p.chances : 0;
  }

  // 스윙: 누른 시각과 배트 위치를 서버로 보내고, 같은 규칙으로 결과를 미리 계산해 둔다
  _swing() {
    const s = this.net.snap;
    const ab = this.ab;
    if (!this._ready || !this.canPlay || !s || s.phase !== 'play' || s.idx !== this.idx) return;
    if (ab.phase !== 'pitch' || ab.swingT >= 0 || this._chancesNow() <= 0) return;
    const pt = ab.pitch;
    const t = this.net.now();
    const f = Math.max(1, Math.floor((t - s.releaseAt) * 60 + 0.5));
    if (f > pt.frames + CONFIG.MITT_AFTER - 1) return;
    ab.swingT = f;
    this.net.swing(t, ab.batX);
    this.audio.sfx('whoosh');
    // 배트가 공 자리에 온 순간(6프레임 뒤) 맞았는지 — 서버와 같은 계산
    const contact = f + CONFIG.SWING_CONTACT;
    const dt = contact - pt.frames;
    const dx = ab.batX - pt.tx * PLATE_SCALE;
    if (contact <= pt.frames + CONFIG.MITT_AFTER && Math.abs(dt) <= CONFIG.HIT_DT && Math.abs(dx) <= CONFIG.HIT_DX) {
      this.pred = { hit: makeHit(pt, dt, dx), at: s.releaseAt + contact / 60, pts: null };
    }
  }

  // ------------------------------------------------------------ 서버 사건
  _onEvent(e) {
    if (e.type === 'say') {
      this.say = { text: e.text, source: e.source, who: e.who, t: 0 };
      return;
    }
    if (e.type === 'verdict') {
      this.verdict = e;
      return;
    }
    if (e.idx !== this.idx) return;
    if (e.type === 'contact') {
      // 서버가 정한 타구. 미리 그린 것과 다르면 서버 것으로 바꾼다.
      const old = this.pred;
      const same = old && old.hit.result === e.hit.result && Math.abs(old.hit.dist - e.hit.dist) < 0.01 && Math.abs(old.at - e.at) < 0.001;
      this.pred = { hit: same ? old.hit : e.hit, at: e.at, pts: e.pts };
      if (!same && this.fl) this.fl = null; // 다음 갱신 때 서버 타구로 다시 시작한다
      if (this.ab.swingT < 0) this.ab.swingT = 1;
    } else if (e.type === 'whiff') {
      // 서버 판정은 헛스윙: 미리 그린 타구가 있으면 지운다
      if (this.pred) {
        this.pred = null;
        this.fl = null;
        this.flDone = false;
        this.mittDone = false;
      }
      if (this.ab.swingT < 0) this.ab.swingT = 1;
    } else if (e.type === 'call') {
      this.myCall = e;
      // 화면에 먼저 보여 준 판정(스트라이크 · 볼 · 헛스윙)이 서버와 다르면 고친다
      if (this.mittDone && !this.pred && this.call && this.call.result !== e.result && !BATTED.includes(e.result)) {
        this.call = { result: e.result, pts: 0, t: 0 };
      }
    }
  }

  /** 다시 접속했을 때 서버가 알려 주는 "이번 공에 내가 한 스윙" */
  _applyMe(me) {
    const cur = me && me.cur;
    if (!cur || cur.idx !== this.idx) return;
    this.ab.swingT = cur.f;
    this.ab.batX = cur.x;
    if (cur.hit) this.pred = { hit: cur.hit, at: cur.at, pts: cur.pts };
  }

  // ------------------------------------------------------------ 진행 (1/60초마다)
  _update() {
    this.frame++;
    if (this.flash > 0) this.flash--;
    if (this.crowd > 0) this.crowd--;
    if (this.muteNotice > 0) this.muteNotice--;
    if (this.call) this.call.t++;
    if (this.say) this.say.t++;
    this.particles.update();
    const s = this.net.snap;
    const now = this.net.now();
    const ab = this.ab;

    // 배트 옮기기 (스윙해서 공에 닿을 때까지는 고정 — 서버는 스윙한 순간의 위치로 판정한다)
    const swinging = ab.phase === 'pitch' && ab.swingT >= 0;
    if (this.canPlay && !swinging && s && s.phase !== 'final' && s.phase !== 'done') {
      if (this._down(KEYS.left)) ab.batX -= CONFIG.BAT_SPEED;
      if (this._down(KEYS.right)) ab.batX += CONFIG.BAT_SPEED;
      ab.batX = Math.max(-CONFIG.BAT_RANGE, Math.min(CONFIG.BAT_RANGE, ab.batX));
    }

    if (s && s.phase === 'play' && s.idx !== this.idx && this.pitches[s.idx]) this._newPitch(s);
    for (const e of this.net.takeEvents()) this._onEvent(e);
    if (!s) return;
    if (s.verdict && !this.verdict) this.verdict = s.verdict;

    if (s.phase === 'final' || s.phase === 'done') {
      if (this.finalT < 0) {
        this.finalT = 0;
        this.fl = null;
        this.call = null;
        this.audio.playBgm('result');
        this.audio.sfx('win');
      }
      this.finalT++;
      // 색종이 (원본 결과 화면)
      if (this.finalT % 4 === 0) {
        const cols = [C('9'), C('8'), C('6'), C('h'), C('q'), C('b')];
        this.particles.add(Math.random() * W, -2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, 400, cols[(Math.random() * cols.length) | 0], 2);
      }
      return;
    }
    if (s.phase !== 'play' || this.idx !== s.idx) {
      ab.phase = 'windup';
      ab.t = 0;
      return;
    }
    if (s.me && !this.meApplied) {
      this.meApplied = true;
      this._applyMe(s.me);
    }

    // ---- 이번 공: 서버 시계로 지금 어느 장면인지 계산 ----
    const pt = ab.pitch;
    const fR = (now - s.releaseAt) * 60;             // 공이 손에서 떠난 뒤 프레임
    const mitt = pt.frames + CONFIG.MITT_AFTER;
    // 맞은 순간이 되면 타구 연출 시작
    if (this.pred && !this.fl && !this.flDone && now >= this.pred.at) {
      this.fl = new Flight(this.pred.hit);
      this.mittDone = true;
      if ((now - this.pred.at) * 60 < 6) {
        this.audio.sfx('crack', this.pred.hit.q);
        this.flash = 6;
      }
    }
    if (this.fl) {
      // 맞은 뒤 흐른 시간만큼 연출을 진행 (늦게 들어왔으면 소리 없이 따라잡는다)
      const target = Math.floor((now - this.pred.at) * 60);
      for (let n = 0; n < 900 && this.fl.t < target && !this.fl.done; n++) {
        const quiet = target - this.fl.t > 4;
        for (const cue of this.fl.step()) this._onCue(cue, quiet);
      }
      if (this.fl.done) {
        this.fl = null;
        this.flDone = true;
      }
    }
    if (fR < 0) {
      ab.phase = 'windup';
      ab.t = Math.max(0, Math.floor((now - s.windupAt) * 60));
    } else if (this.fl) {
      ab.phase = 'hit';
    } else if (fR < mitt && !this.flDone) {
      ab.phase = 'pitch';
      ab.tf = fR;
      ab.t = Math.floor(fR);
      if (!this.released) {
        this.released = true;
        if (fR < 6) this.audio.sfx('swish');
      }
    } else {
      ab.phase = 'after';
      ab.t = Math.max(0, Math.floor(fR - mitt));
      if (!this.mittDone) {
        this.mittDone = true;
        this._onMitt(ab.t < 30);
      }
    }
  }

  _newPitch(s) {
    this.idx = s.idx;
    this.ab.pitch = this.pitches[s.idx];
    this.ab.swingT = -1;
    this.ab.phase = 'windup';
    this.ab.t = 0;
    this.pred = null;
    this.fl = null;
    this.flDone = false;
    this.mittDone = false;
    this.released = false;
    this.revealed = false;
    this.myCall = null;
  }

  // 공이 미트에 들어감 (안 맞았을 때): 스트라이크 · 볼 · 헛스윙 판정 글자
  _onMitt(fresh) {
    this.revealed = true;
    if (fresh) this.audio.sfx('mitt');
    if (!this.canPlay || this._chancesNow() <= 0) return; // 기회를 다 쓴 사람은 구경만
    const result = this.ab.swingT >= 0 ? 'miss' : this.ab.pitch.ball ? 'ball' : 'strike';
    if (!fresh) return;
    this.audio.sfx(result === 'ball' ? 'tick' : 'umpire');
    this.call = { result, pts: 0, t: 0 };
  }

  // 타구 연출 중에 일어난 일 (Flight.step 이 알려 준다)
  _onCue(cue, quiet) {
    const audio = this.audio;
    const fl = this.fl;
    const h = fl.hit;
    if (cue === 'safe') {
      if (!quiet) audio.sfx('point');
    } else if (cue === 'catch') {
      if (!quiet) audio.sfx('mitt');
    } else if (cue === 'throw') {
      if (!quiet) audio.sfx('swish');
    } else if (cue === 'out') {
      this.revealed = true;
      this.call = { result: 'ground', pts: 0, t: 0, dist: 0, gold: h.gold };
      if (!quiet) {
        audio.sfx('mitt');
        audio.sfx('umpire');
      }
    } else if (cue === 'shown') {
      this.revealed = true;
      const pts = this.pred && this.pred.pts != null ? this.pred.pts : hitPoints(h);
      this.call = { result: h.result, pts, t: 0, dist: Math.round(h.dist), gold: h.gold };
      if (quiet) return;
      if (h.result === 'hr') {
        audio.sfx('jackpot');
        audio.sfx('cheer');
        this.crowd = 90;
        for (let i = 0; i < 4; i++) {
          const q = fproj(fl.ball.x + (i - 1.5) * 8, fl.ball.z, 12 + i * 3);
          this.particles.burst(q.sx, q.sy, 18, [C('9'), C('5'), C('h'), C('b')], 2.2, 40, 1, 0.04);
        }
      } else if (['triple', 'double', 'single'].includes(h.result)) {
        audio.sfx('cheer');
        audio.sfx('point');
        this.crowd = 40;
      } else if (h.result === 'foul') audio.sfx('miss');
      else audio.sfx('mitt');
    }
  }

  /** 화면에 보일 점수 · 남은 기회: 결과 글자가 나온 뒤에는 서버가 알려 준 새 값 */
  _shown(p) {
    const s = this.net.snap;
    const row = (s && s.players && s.players[p.id]) || { total: 0, chances: CONFIG.CHANCES };
    const c = this.myCall;
    if (p === this.mine && c && this.revealed && s && c.idx === s.idx && s.phase === 'play') return { total: c.total, chances: c.chances };
    return { total: row.total, chances: row.chances };
  }

  // ------------------------------------------------------------ 그리기
  _render() {
    const ctx = this.ctx;
    const s = this.net.snap;
    ctx.fillStyle = C('o');
    ctx.fillRect(0, 0, W, H);
    if (s && (s.phase === 'final' || s.phase === 'done') && s.results) {
      this.renderFinal(ctx, s);
    } else {
      const inField = this.fl && this.fl.t > HOLD;
      if (inField) this.renderField(ctx);
      else this.renderBroadcast(ctx, s);
      this.particles.render(ctx);
      if (this.flash > 0) {
        ctx.fillStyle = DITHER.get(ctx, 'b', this.flash * 2);
        ctx.fillRect(0, 0, W, H);
      }
      if (this.call && this.call.t < CALL_TIME) this.renderCall(ctx);
      this.renderHud(ctx, s);
      this.renderSay(ctx);
      if (!s || s.phase === 'intro') this.renderIntro(ctx, s);
    }
    if (this.muteNotice > 0) {
      const txt = this.audio.muted ? '소리 끔' : '소리 켬';
      drawPanel(ctx, W - 60, H - 26, 54, 20, 'dark');
      KText.draw(ctx, txt, W - 33, H - 22, C('a'), { align: 'center', font: 's' });
    }
  }

  renderBroadcast(ctx, s) {
    const ab = this.ab;
    const playing = !!s && s.phase === 'play' && !!ab.pitch;
    drawBroadcast(ctx, this.frame, this.crowd > 0 && this.frame % 10 < 5 ? 1 : 0);
    // 투수 자세
    let pose = 0;
    if (playing && ab.phase === 'windup') pose = ab.t < 30 ? 0 : ab.t < 50 ? 1 : 2;
    if (playing && (ab.phase === 'pitch' || ab.phase === 'hit')) pose = 3;
    drawPitcher(ctx, pose, this.frame);
    const zone = drawZone(ctx, this.frame, false);
    let swingK = 0;
    if (playing && ab.swingT >= 0 && ab.phase !== 'windup') {
      const since = ab.phase === 'pitch' ? ab.t - ab.swingT : CONFIG.SWING_TIME;
      swingK = Math.min(1, since / CONFIG.SWING_TIME);
    }
    drawBatBar(ctx, ab.batX, swingK > 0 && swingK < 0.6 ? 1 : 0, zone);
    // 공
    if (playing && ab.phase === 'pitch') {
      const k = ab.tf / ab.pitch.frames;
      if (k <= 1.15) drawBall(ctx, pitchPos(ab.pitch, Math.min(1.12, k)), ab.pitch.gold, this.frame);
      if (k > 1) drawMitt(ctx, pitchPos(ab.pitch, 1));
    } else if (playing && ab.phase === 'after' && ab.t < 20 && !this.pred) {
      drawMitt(ctx, pitchPos(ab.pitch, 1));
    } else if (this.fl) {
      // 맞은 공이 하늘로 솟구침
      const k = this.fl.t / HOLD;
      const hit = this.fl.hit;
      const sx = W / 2 + ab.batX + hit.dir * 2.2 * k;
      const sy = 120 - k * (hit.ground ? 10 : 90);
      px(ctx, sx - 1, sy - 1, 3, 3, hit.gold ? '9' : 'b');
    }
    drawBatter(ctx, this.mine.index, swingK, this.frame);
  }

  renderField(ctx) {
    const fl = this.fl;
    // 땅볼은 카메라가 내야로 확대 (송구 · 1루 승부가 잘 보이게)
    //  화면 가운데에 홈~1루~유격수 사이가 오도록 1.7배
    const zk = fl.runner ? Math.min(1, (fl.t - HOLD) / 20) : 0;
    const zoom = 1 + 0.7 * zk;
    const fx = 160 + 36 * zk;
    const fy = 102 + 10 * zk;
    const Z = (sx, sy) => ({ x: 160 + (sx - fx) * zoom, y: 102 + (sy - fy) * zoom });
    ctx.save();
    if (zoom > 1) {
      ctx.translate(160, 102);
      ctx.scale(zoom, zoom);
      ctx.translate(-fx, -fy);
    }
    drawFieldView(ctx, this.frame, this.crowd > 0 && this.frame % 10 < 5 ? 1 : 0);
    // 수비수 (움직이는 한 명 + 나머지)
    for (const f of FIELDERS) {
      if (fl.hit.fielder && f.id === fl.hit.fielder && fl.fielder) continue;
      if (fl.cover && f.id === '1B') continue;
      const q = polar(f.dir, f.r);
      drawFielder(ctx, q.x, q.z, false, this.frame);
    }
    if (fl.cover) drawFielder(ctx, fl.cover.x, fl.cover.z, Math.hypot(fl.cover.x - BASE1.x, fl.cover.z - BASE1.z) > 0.3, this.frame);
    if (fl.fielder) drawFielder(ctx, fl.fielder.x, fl.fielder.z, fl.moving, this.frame);
    // 1루로 뛰는 타자 (캐릭터 색 헬멧)
    if (fl.runner) {
      const k = fl.runner.d / BASE_DIST;
      drawRunner(ctx, this.mine.index, BASE1.x * k, BASE1.z * k, k < 1, this.frame);
    }
    if (fl.ball) drawFlightBall(ctx, fl.ball.x, fl.ball.z, fl.ball.h, fl.hit.gold, fl.trail);
    ctx.restore();
    // 1루 위 판정 글자 (아웃! / 세이프!) — 확대와 상관없이 또렷하게
    if (fl.tag && fl.tag.t < 70) {
      const b0 = fproj(BASE1.x, BASE1.z, 0);
      const b = Z(b0.sx, b0.sy);
      const up = Math.min(6, fl.tag.t);
      const w = KText.width(fl.tag.text, 'b') + 10;
      drawTag(ctx, Math.round(b.x - w / 2), Math.round(b.y) - 34 - up, w, 14, fl.tag.col, fl.tag.text, '1', 'b');
    }
    // 타구 데이터 판 (타구 속도 · 발사각 · 비거리)
    const h = fl.hit;
    const d = fl.ball ? Math.round(Math.hypot(fl.ball.x, fl.ball.z)) : 0;
    // 1루 쪽 플레이를 가리지 않게 오른쪽 아래에 작게
    const x = W - 104;
    const y = 112;
    drawBroadcastPanel(ctx, x, y, 102, 44, h.gold ? '9' : 'h');
    const rows = [['타구 속도', Math.round(h.v0 * 3.6), 'km/h', 'b'], ['발사각', Math.round(h.angle), '도', 'b'], ['비거리', d, 'm', '9']];
    rows.forEach(([k, v, u, col], i) => {
      const yy = y + 2 + i * 14;
      KText.draw(ctx, k, x + 6, yy + 2, C('k'), { font: 'n' });
      drawValue(ctx, x + 99, yy, v, u, col, 'b', 'j');
      if (i < 2) px(ctx, x + 5, yy + 14, 94, 1, '2');
    });
  }

  // 판정 연출: 스트라이크/볼은 존 옆 그래픽 · 안타는 띠 · 홈런은 화면 가득 빛줄기
  //  (결과 이름 · 비거리 · 점수는 규칙대로 그린다. AI 해설 한 줄은 renderSay 가 이 옆에 붙인다)
  renderCall(ctx) {
    const c = this.call;
    const look = HIT_LOOK[c.result];
    const t = c.t;
    if (c.result === 'hr') {
      const k = Math.min(1, t / 10);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 44, W, 62);
      ctx.clip();
      drawRays(ctx, W / 2, 75, 260, this.frame, '6', '7');
      ctx.restore();
      px(ctx, 0, 43, W, 2, '9');
      px(ctx, 0, 105, W, 2, '9');
      const s = k < 1 ? 3 : 2;
      KText.draw(ctx, '홈런!', W / 2, 47 - (s - 2) * 6, C('9'), { align: 'center', font: 'L', outline: C('1'), scale: s });
      const shown = Math.min(c.dist, Math.round((c.dist * t) / 30));
      const sub = `${shown}m  +${Math.round((c.pts * shown) / Math.max(1, c.dist))}점${c.gold ? '  잭팟 ×2!' : ''}`;
      const sw = KText.width(sub, 'b') + 16;
      drawTag(ctx, W / 2 - sw / 2, 88, sw, 15, '1', sub, '9', 'b');
      return;
    }
    const hitLike = ['triple', 'double', 'single', 'fly', 'pop', 'ground', 'foul'].includes(c.result);
    if (hitLike) {
      // 왼쪽에서 밀려 들어오는 띠
      const slide = Math.max(0, 10 - t) * 18;
      const good = ['triple', 'double', 'single'].includes(c.result);
      const w = 150;
      const x = 8 - slide;
      drawBroadcastPanel(ctx, x, 112, w, 34, good ? 'e' : 'j');
      KText.draw(ctx, look.name, x + 10, 113, C(good ? 'e' : 'k'), { font: 'L', outline: C('1') });
      KText.draw(ctx, good ? `+${c.pts}점${c.gold ? ' (잭팟 ×2)' : ''}` : '점수 없음', x + 10, 131, C(good ? '9' : 'j'), { font: 's' });
      return;
    }
    // 스트라이크 · 헛스윙 · 볼: 존 오른쪽에 도장처럼
    const pop = t < 5 ? 5 - t : 0;
    const col = c.result === 'ball' ? 'd' : '6';
    const label = look.name;
    const w = KText.width(label, 'L') + 18 + pop * 2;
    const x = 194 - pop;
    drawBroadcastPanel(ctx, x, 96 - pop, w, 24 + pop * 2, null, col);
    px(ctx, x, 96 - pop, w, 2, c.result === 'ball' ? 'e' : '5');
    KText.draw(ctx, label, x + w / 2, 100, C('b'), { align: 'center', font: 'L', outline: C('1') });
  }

  // 해설 자막 (AI 가 쓴 줄에는 "AI" 표시). 판정 글자가 떠 있으면 그 바로 아래에 붙인다.
  renderSay(ctx) {
    const sy = this.say;
    if (!sy || sy.t >= SAY_TIME || !sy.text) return;
    const ai = sy.source === 'gemini';
    const who = sy.who || '해설';
    const whoW = KText.width(who, 'n') + 8;
    const tw = KText.width(sy.text, 'n');
    const w = Math.min(W - 4, whoW + tw + 10 + (ai ? 13 : 0));
    const c = this.call && this.call.t < CALL_TIME ? this.call.result : null;
    let x = Math.round(W / 2 - w / 2);
    let y = 38;                                   // 평소: 위쪽 가운데 (존 · 공을 가리지 않는 자리)
    if (c === 'hr') y = 108;                      // 홈런 띠 바로 아래
    else if (c && BATTED.includes(c)) {           // 안타 · 아웃 띠 바로 아래
      x = 8;
      y = 146;
    }
    const slide = Math.max(0, 8 - sy.t) * 2;
    y -= slide;
    drawBroadcastPanel(ctx, x, y, w, 13, '9');
    px(ctx, x + 3, y, whoW, 13, '2');
    KText.draw(ctx, who, x + 7, y, C('9'), { font: 'n' });
    KText.draw(ctx, sy.text, x + whoW + 6, y, C('b'), { font: 'n' });
    if (ai) {
      const bx = x + w - 12;
      px(ctx, bx, y + 3, 10, 7, 'h');
      BitmapFont.draw(ctx, 'AI', bx + 2, y + 4, C('1'));
    }
  }

  // 중계 그래픽 (스코어 박스 · 구속판 · 하단 바)
  renderHud(ctx, s) {
    const p = this.mine;
    const ab = this.ab;
    const col = p.def.color;
    const mine = this._shown(p);
    const playing = !!s && s.phase === 'play' && !!ab.pitch;
    // ---- 스코어 박스 (왼쪽 위) ----
    drawBroadcastPanel(ctx, 2, 2, 132, 32, col);
    px(ctx, 5, 2, 129, 12, '2');
    ctx.drawImage(SPR.players[p.index].face, 6, 13);
    KText.draw(ctx, this.canPlay ? '나' : '관전', 7, 1, C(col), { font: 'n', outline: C('1') });
    KText.draw(ctx, p.name, 27, 1, C('b'), { font: 's' });
    if (s && s.count) KText.draw(ctx, `공 ${Math.max(1, s.idx + 1)} / ${s.count}`, 131, 2, C('k'), { font: 'n', align: 'right', outline: C('1') });
    // 기회 = 야구공 아이콘
    const goldPip = CONFIG.CHANCES - 1 - CONFIG.GOLD_AT;
    for (let i = 0; i < CONFIG.CHANCES; i++) {
      const used = i >= mine.chances;
      drawBallIcon(ctx, 27 + i * 8, 18, used ? 'used' : i === goldPip ? 'gold' : 'left');
    }
    // 점수 LED
    px(ctx, 95, 15, 37, 17, 'o');
    drawValue(ctx, 132, 14, mine.total, '점', '9', 'b', 'a');
    // ---- 구속판 (오른쪽 위): 공이 나가면 미끄러져 들어옴 ----
    const pt = ab.pitch;
    if (playing && (ab.phase === 'pitch' || ab.phase === 'after' || ab.phase === 'hit')) {
      const since = ab.phase === 'pitch' ? ab.t : 99;
      const x = W - 78 + Math.max(0, 8 - since) * 10;
      drawBroadcastPanel(ctx, x, 2, 76, 34, pt.gold ? '9' : PITCH_COLOR[pt.typeId]);
      drawValue(ctx, x + 73, 0, pt.kmh, 'km/h', pt.gold ? '9' : 'b', 'L', 'k');
      drawTag(ctx, x + 6, 21, 66, 13, PITCH_COLOR[pt.typeId], pt.name, 'b', 'n');
    }
    if (playing && pt.gold && ab.phase === 'windup') {
      const blink = this.frame % 24 < 16;
      drawBroadcastPanel(ctx, W - 98, 2, 96, 18, '9', blink ? '7' : '1');
      drawBallIcon(ctx, W - 92, 7, 'gold');
      KText.draw(ctx, '잭팟 볼! ×2', W - 46, 4, C('9'), { align: 'center', font: 's' });
    }
    // 기회를 다 썼거나, 내 연출이 먼저 끝나 다른 사람을 기다리는 중
    if (playing && this.canPlay && mine.chances <= 0 && this._chancesNow() <= 0) {
      drawTag(ctx, W / 2 - 62, 52, 124, 13, '2', '기회를 다 썼어요 · 구경 중', 'k', 'n');
    } else if (playing && ab.phase === 'after' && ab.t > 70 && !(this.call && this.call.t < CALL_TIME)) {
      drawTag(ctx, W / 2 - 56, 52, 112, 13, '2', '다른 타자를 기다리는 중', 'k', 'n');
    }
    // ---- 하단 바 ----
    const y0 = H - 22;
    px(ctx, 0, y0, W, 22, '1');
    px(ctx, 0, y0, W, 1, '9');
    px(ctx, 0, y0 + 1, W, 1, '8');
    // 조작키 (왼쪽)
    if (this.canPlay) {
      const labels = ['<', 'SP', '>'];
      const held = [this._down(KEYS.left), this._down(KEYS.swing), this._down(KEYS.right)];
      let x = 4;
      labels.forEach((l, j) => {
        const cap = getKeycap(l, j === 1 ? 'strike' : 'plain', !!held[j]);
        ctx.drawImage(cap, x, y0 + 2);
        x += cap.width;
      });
      KText.draw(ctx, '← → 배트', x + 3, y0 + 1, C('k'), { font: 'n', outline: C('1') });
      KText.draw(ctx, 'Space 스윙', x + 3, y0 + 11, C('9'), { font: 'n', outline: C('1') });
    } else {
      drawTag(ctx, 4, y0 + 5, 40, 13, '2', '관전', 'j', 'b');
    }
    // LED 전광판 (오른쪽): 모든 사람의 얼굴 + 지금 점수 (내 칸은 깜빡)
    const n = this.players.length;
    const bx = W - n * 38 - 2;
    px(ctx, bx - 2, y0 + 3, n * 38 + 2, 18, 'o');
    this.players.forEach((q, i) => {
      const x = bx + i * 38;
      const now = q === p && this.canPlay;
      if (now && this.frame % 30 < 22) {
        px(ctx, x - 1, y0 + 3, 38, 18, '9');
        px(ctx, x, y0 + 4, 36, 16, 'o');
      }
      ctx.drawImage(SPR.players[q.index].face, x, y0 + 3);
      const val = s ? this._shown(q).total : '---';
      KText.draw(ctx, String(val), x + 37, y0 + 4, C(now ? '9' : val === '---' ? 'i' : 'a'), { font: 'b', align: 'right', outline: C('1') });
    });
  }

  // 시작 안내: 하단 자막처럼 밀려 들어오는 이름표 + 캐릭터 크게 (원본 타자 소개 화면)
  renderIntro(ctx, s) {
    const p = this.mine;
    const col = p.def.color;
    const k = Math.min(1, this.frame / 12);
    const x = Math.round(-230 * (1 - k)) + 6;
    // 캐릭터 (2배, 외곽선)
    const img = batterImg(p.index, ((this.frame / 20) | 0) % 2);
    ctx.fillStyle = DITHER.get(ctx, '1', 8);
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 20, W, 128);
    ctx.clip();
    drawRays(ctx, x + 40, 104, 150, this.frame, '2', '1');
    ctx.restore();
    ctx.drawImage(img, x + 40 - img.width, 128 - img.height * 2, img.width * 2, img.height * 2);
    drawBroadcastPanel(ctx, x, 104, 230, 44, col);
    px(ctx, x + 3, 104, 227, 13, col);
    KText.draw(ctx, '모두 같은 공을 동시에!', x + 84, 104, C('1'), { font: 's' });
    KText.draw(ctx, p.name, x + 84, 117, C('b'), { font: 'L', outline: C('1') });
    KText.draw(ctx, `기회 ${CONFIG.CHANCES}번 · 금색 공 ×2`, x + 84, 135, C('9'), { font: 'n', outline: C('1') });
    let kx = x + 166;
    ['<', 'SP', '>'].forEach((l, j) => {
      const cap = getKeycap(l, j === 1 ? 'strike' : 'plain', false);
      ctx.drawImage(cap, kx, 120);
      kx += cap.width - 1;
    });
    // 조작 설명 · 시작까지 남은 시간
    drawBroadcastPanel(ctx, 40, 40, 240, 44, '9');
    KText.draw(ctx, '노란 막대를 공이 올 줄에 맞추고', W / 2, 41, C('b'), { align: 'center', font: 's' });
    KText.draw(ctx, '홈 플레이트에 올 때 Space 로 스윙!', W / 2, 54, C('b'), { align: 'center', font: 's' });
    KText.draw(ctx, '홈런 = 비거리(m) 점 · 볼은 치지 말고 골라내기', W / 2, 69, C('9'), { align: 'center', font: 'n' });
    if (s && s.introUntil) {
      const left = Math.max(0, Math.ceil(s.introUntil - this.net.now()));
      drawTag(ctx, W / 2 - 30, 88, 60, 14, '6', left > 0 ? `${left}초 뒤 시작` : '플레이 볼!', 'b', 'n');
    }
  }

  // 최종 순위 (원본 scenes/result.js) + AI 총평
  renderFinal(ctx, s) {
    const t = Math.max(0, this.finalT);
    drawFieldView(ctx, t);
    ctx.fillStyle = DITHER.get(ctx, 'o', 10);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = DITHER.get(ctx, 'o', 8);
    ctx.fillRect(0, 0, W, H);
    this.particles.render(ctx);
    KText.draw(ctx, '최종 순위', W / 2, 0, C('9'), { align: 'center', font: 'L', outline: C('1') });
    const rows = s.results;
    const rowH = 22;
    const y0 = 20;
    const medal = ['9', 'k', '8'];
    rows.forEach((r, i) => {
      if (t < 15 + i * 12) return;
      const p = this.players.find((pp) => pp.id === r.playerId);
      if (!p) return;
      const st = r.stats || {};
      const slide = Math.max(0, 15 + i * 12 + 10 - t) * 12;
      const x = 14 + slide;
      const y = y0 + i * rowH;
      drawCard(ctx, x, y, 292, rowH - 2, r.rank === 1 ? '7' : '2', r.rank === 1 ? '9' : '3');
      BitmapFont.draw(ctx, String(r.rank), x + 13, y + 5, r.rank <= 3 ? C(medal[r.rank - 1]) : C('a'), { align: 'center', scale: 2, outline: C('1') });
      drawNameCard(ctx, x + 26, y + 2, 84, { def: p.def, name: p.name, index: p.index, place: null }, t);
      if (r.rank === 1) ctx.drawImage(SPR.crown, x + 32, y - 1);
      if (p.isMe) KText.draw(ctx, '나', x + 118, y + 4, C('9'), { align: 'center', font: 'n', outline: C('1') });
      KText.draw(ctx, `${r.score}점`, x + 176, y + 3, C(r.rank === 1 ? '9' : 'a'), { font: 'b', align: 'right', outline: C('1') });
      // 홈런 수 (공 아이콘) · 최장 비거리
      for (let k = 0; k < Math.min(8, st.homeRuns || 0); k++) drawBallIcon(ctx, x + 184 + k * 8, y + 7, 'left');
      if (!st.homeRuns) KText.draw(ctx, `안타 ${st.hits || 0}`, x + 184, y + 4, C('k'), { font: 'n', outline: C('1') });
      if (st.longest) KText.draw(ctx, `${st.longest}m`, x + 286, y + 3, C('a'), { font: 's', align: 'right', outline: C('1') });
    });
    // AI 총평 (서버가 보내 준 경우에만)
    const v = this.verdict;
    const y = 134;
    if (v && v.headline) {
      drawBroadcastPanel(ctx, 14, y, 292, 44, '9');
      drawTag(ctx, 20, y + 2, 46, 13, '9', 'AI 총평', '1', 'n');
      KText.draw(ctx, v.headline, 72, y + 1, C('9'), { font: 's' });
      if (v.mvp) KText.draw(ctx, `MVP  ${v.mvp}`, 22, y + 16, C('b'), { font: 'n' });
      if (v.cheer) KText.draw(ctx, `응원  ${v.cheer}`, 22, y + 29, C('k'), { font: 'n' });
    } else if (t > 60 && t % 40 < 28) {
      KText.draw(ctx, '잠시 뒤 대기실로 돌아갑니다', W / 2, H - 16, C('9'), { align: 'center', font: 's', outline: C('1') });
    }
  }
}
