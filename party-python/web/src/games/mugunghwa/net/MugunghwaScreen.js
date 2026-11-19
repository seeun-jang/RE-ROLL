// =============================================================
// 무궁화 꽃이 피었습니다 — 화면 (멀티플레이)
//
// 판정(이동·감지·승패·점수)과 음성 인식은 서버가 한다. 여기서는
//  - 서버 상태(net.snap)와 사건을 그리고
//  - 내 입력을 보낸다: 도망자 = 스페이스(누르고 있기), 술래 = 마이크(또는 스페이스 길게)
// 그리기는 원본의 Stage / UI / Player / Particles / ScreenFX 를 그대로 쓴다.
// =============================================================
import { ANIMALS, animalForIndex } from '../../../shared/animals.js';
import { MicCapture, pcmToBase64 } from '../../../shared/MicCapture.js';
import { AssetLoader } from '../assets/AssetLoader.js';
import { C, isLight } from '../assets/palette.js';
import { FX, LOGIC_FPS, MOVE, RULES, SCREEN, TAGGER, TRACK } from '../config.js';
import { AudioManager } from '../engine/Audio.js';
import { ditherRect, rect, shadow, spriteFeet } from '../engine/Draw.js';
import { Particles } from '../engine/Particles.js';
import { PixelText } from '../engine/PixelText.js';
import { ScreenFX } from '../engine/ScreenFX.js';
import { Player } from '../game/entities/Player.js';
import { Stage } from '../game/Stage.js';
import { UI } from '../game/UI.js';

const STEP = 1 / LOGIC_FPS;
const MOVE_KEYS = ['Space', 'ArrowUp', 'Enter'];
/** 문장 사이에 숨을 고르면 말이 끊긴 것으로 본다 → 끝까지 이어서 말해야 인정된다 */
const MIC_OPTIONS = { SILENCE_MS: 500, MIN_SPEECH_MS: 300, MAX_MS: 5000, PRE_ROLL_MS: 250 };
/** 외치는 동안 문구 상자에 글자가 나타나는 속도(초당 글자). 실제 말을 따라가는 것이 아니라 "외치는 중"을 보여 주는 연출이다 */
const SHOW_RATE = 5;
const TAGGER_FOOT = { x: TAGGER.X + 8, y: TAGGER.Y + 32 };

export class MugunghwaScreen {
  constructor(container, { net, players, me, options }) {
    this.container = container;
    this.net = net;
    const cfg = (options && options.config) || {};
    // 서버가 정한 값으로 화면 쪽 설정을 맞춘다 (거리·시간이 서버와 같아야 위치가 맞는다)
    if (cfg.RULES) {
      RULES.TIME_LIMIT = cfg.RULES.TIME_LIMIT;
      RULES.GRACE_TIME = cfg.RULES.GRACE_TIME;
      TRACK.METERS = cfg.RULES.METERS;
    }
    if (cfg.MOVE) Object.assign(MOVE, cfg.MOVE);
    this.score = cfg.SCORE || {};
    this.phraseText = (options && options.phrase) || TAGGER.PHRASE.join('');
    this.minKeyChant = (options && options.minKeyChant) || 1.5;
    this.voice = !!(options && options.voice);
    this.taggerId = options && options.taggerId;
    this.meId = me ? me.id : null;
    this.isTagger = !!this.meId && this.meId === this.taggerId;

    this.info = players.map((p, i) => {
      const animal = ANIMALS[p.character] || animalForIndex(p.index ?? i);
      return { id: p.id, name: p.name, lookId: animal.id, color: animal.color, shade: C.ink, isMe: p.id === this.meId };
    });
    this.infoById = new Map(this.info.map((p) => [p.id, p]));

    this._buildDom();
    this.assets = new AssetLoader().build();
    this.text = new PixelText();
    this.stage = new Stage(this.assets, this.text);
    this.ui = new UI(this.assets, this.text);
    this.particles = new Particles();
    this.fx = new ScreenFX();
    this.audio = new AudioManager();
    this.mic = new MicCapture(MIC_OPTIONS);

    const runners = this.info.filter((p) => p.id !== this.taggerId);
    this.runners = runners.map((p, i) => new Player(p, i, runners.length, this.assets));
    this.runnerById = new Map(this.runners.map((r) => [r.id, r]));
    this.meRunner = this.runnerById.get(this.meId) || null;
    const tInfo = this.infoById.get(this.taggerId) || this.info[0];
    this.taggerInfo = tInfo;
    this.taggerFrames = this.assets.getAnimalFrames(tInfo.lookId);

    // 술래 화면 상태 (서버 상태를 비춘 것 + 연출용 값)
    this.tagger = {
      phase: 'idle', t: 0, shown: 0, popT: 0, chantT: 0, chanting: false, level: 0, line: null, time: 0,
      phrase: TAGGER.PHRASE,
      isFacing: () => this.tagger.phase === 'turning' || this.tagger.phase === 'watching',
    };

    this.time = 0;
    this.darken = 0;
    this.goT = 0;
    this.lastCount = null;
    this.started = false;
    this.endShown = false;
    this.finalShown = false;
    this.note = '';
    this.noteT = 0;
    this.held = false;       // 내가 전진/외치기 키를 누르고 있는지
    this._sentHeld = false;
    this._micSent = { on: false, at: 0 };
    this._listenToken = 0;
    this._destroyed = false;

    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onBlur = () => this._setHeld(false);
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
    if (this.isTagger && this.voice) this.mic.start();

    this._last = performance.now();
    this._acc = 0;
    const frame = (now) => {
      if (this._destroyed) return;
      this._raf = requestAnimationFrame(frame);
      this._acc += Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      while (this._acc >= STEP) {
        this._update(STEP);
        this._acc -= STEP;
      }
      this._render(this.ctx);
    };
    this._raf = requestAnimationFrame(frame);
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
    this.mic.stop();
    this.audio.destroy();
    this.root.remove();
  }

  // ------------------------------------------------------------
  _buildDom() {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'relative', width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: C.ink, overflow: 'hidden',
    });
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN.WIDTH;
    canvas.height = SCREEN.HEIGHT;
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

  _fit() {
    const w = this.root.clientWidth || SCREEN.WIDTH * 2;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    const s = Math.max(1, Math.min(SCREEN.MAX_SCALE, Math.floor(Math.min(w / SCREEN.WIDTH, h / SCREEN.HEIGHT))));
    this.canvas.style.width = `${SCREEN.WIDTH * s}px`;
    this.canvas.style.height = `${SCREEN.HEIGHT * s}px`;
    if (this.autoHeight) this.root.style.height = `${SCREEN.HEIGHT * s}px`;
  }

  // ------------------------------------------------------------
  // 입력
  // ------------------------------------------------------------
  _key(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === 'KeyM') {
      if (down && !e.repeat) this.audio.toggleMute();
      return;
    }
    if (!MOVE_KEYS.includes(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    this._setHeld(down);
  }

  _setHeld(on) {
    this.held = on;
  }

  /** 누르고 있는 상태가 바뀌면 서버로 보낸다 (도망자 = 전진, 술래 = 키로 외치기) */
  _syncHeld(s) {
    if (!this.meId) return;
    const active = s.phase === 'countdown' || s.phase === 'play';
    const want = this.held && active;
    if (want === this._sentHeld) return;
    this._sentHeld = want;
    if (this.isTagger) {
      if (s.phase === 'play' || !want) this.net.chant(want);
      else this._sentHeld = false; // 카운트다운 중에는 외칠 수 없다
    } else {
      this.net.move(want);
    }
  }

  /** 술래: 마이크로 듣고, 말하는 중인지와 외친 말을 서버로 보낸다 */
  _updateMic(s) {
    if (!this.isTagger || !this.voice) return;
    const mic = this.mic;
    const playing = s.phase === 'play';
    if (!playing) {
      if (mic.listening) mic.cancel();
      return;
    }
    if (mic.status !== 'ready') return;
    const now = performance.now();
    const on = mic.speaking;
    if (on !== this._micSent.on || (on && now - this._micSent.at > 150)) {
      this._micSent = { on, at: now };
      this.net.mic(on, Math.min(1, mic.level * 5));
    }
    if (mic.listening) return;
    const token = ++this._listenToken;
    mic.listen().then((clip) => {
      if (!clip || token !== this._listenToken || this._destroyed) return;
      const cur = this.net.snap;
      if (cur && cur.phase === 'play') this.net.voice(pcmToBase64(clip.pcm), clip.rate);
    });
  }

  // ------------------------------------------------------------
  // 서버 사건 → 연출
  // ------------------------------------------------------------
  _say(text, seconds = TAGGER.LINE_DURATION) {
    this.tagger.line = { text: String(text).slice(0, 26), t: seconds };
  }

  _handleEvent(e) {
    const a = this.audio;
    const quiet = this.isTagger; // 술래는 마이크를 쓰므로 소리를 줄인다
    switch (e.type) {
      case 'chant':
        this.tagger.chanting = e.on;
        if (e.on) this.tagger.chantT = 0;
        break;
      case 'heard':
        if (e.ok) this._say(`${this.phraseText}!`, 1.2);
        else {
          this._say(`"${e.text}"…?`, 1.6);
          this.tagger.shown = 0;
          if (!quiet) a.play('fake');
          this.fx.shake(1, 0.08);
        }
        break;
      case 'voiceOff':
        this.note = `음성 인식이 꺼져 있어요 — 스페이스를 ${this.minKeyChant}초 넘게 눌렀다 떼세요`;
        this.noteT = 6;
        break;
      case 'turn':
        a.play('turn');
        a.bgm.pause();
        this.fx.hitStop(FX.HIT_STOP_TURN);
        this.fx.shake(FX.SHAKE_TURN.amp, FX.SHAKE_TURN.time);
        break;
      case 'turnBack':
        if (!quiet) a.play('turnBack');
        if (this.started && !this.endShown) a.bgm.resume();
        this.tagger.shown = 0;
        this.tagger.chantT = 0;
        break;
      case 'caught': {
        const names = [];
        for (const id of e.ids) {
          const p = this.runnerById.get(id);
          if (!p) continue;
          names.push(p.name);
          p.eliminate();
          this.particles.burst(this.stage.laneX(p.lane, p.dist, p.laneCount), this.stage.distToY(p.dist) - 8, p.color);
        }
        a.play('catch');
        this.fx.hitStop(FX.HIT_STOP_CATCH);
        this.fx.shake(FX.SHAKE_CATCH.amp, FX.SHAKE_CATCH.time);
        this._say(names.length > 1 ? `${names.join(', ')} 다 봤어!` : `${names[0]}, 움직였지!`);
        break;
      }
      case 'finish': {
        const p = this.runnerById.get(e.id);
        if (!p) break;
        p.dist = TRACK.METERS;
        p.finish(1, 0);
        a.play('finish');
        this.particles.sparkle(this.stage.laneX(p.lane, p.dist, p.laneCount), this.stage.distToY(p.dist) - 8, 18);
        break;
      }
      case 'end':
        this._onEnd(e.result);
        break;
      default:
        break;
    }
  }

  _onEnd(result) {
    if (this.endShown || !result) return;
    this.endShown = true;
    this.result = result;
    this.audio.bgm.stop();
    this.audio.play(result.reason === 'timeUp' ? 'timeUp' : 'finish');
    if (result.winner === 'runners') this.particles.confetti(160, 60, 40);
  }

  // ------------------------------------------------------------
  // 갱신 (1/60초)
  // ------------------------------------------------------------
  _update(dt) {
    this.time += dt;
    this.fx.update(dt);
    const s = this.net.snap;
    for (const e of this.net.takeEvents()) this._handleEvent(e);
    if (!s) return;
    this._syncHeld(s);
    this._updateMic(s);

    // 카운트다운 소리 / 시작
    if (s.phase === 'countdown') {
      const n = Math.max(1, Math.ceil(s.startAt - this.net.now()));
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.audio.play('count');
      }
    } else if (s.phase === 'play' && !this.started) {
      this.started = true;
      this.goT = 0.8;
      this.audio.play('go');
      if (!this.isTagger) this.audio.bgm.start(); // 술래는 마이크에 배경음이 들어가지 않게 끈다
    }
    if (s.result) this._onEnd(s.result); // 사건을 놓쳤을 때(다시 접속 등) 대비
    if ((s.phase === 'final' || s.phase === 'done') && s.results && !this.finalShown) {
      this.finalShown = true;
      this.audio.play('fanfare');
    }

    // 술래 상태 비추기
    const T = this.tagger;
    const st = s.tagger;
    T.time += dt;
    T.phase = s.phase === 'play' || s.phase === 'end' ? st.phase : 'idle';
    T.t = st.t;
    T.level = st.level;
    T.chanting = st.chanting;
    if (T.popT > 0) T.popT -= dt;
    if (T.line) {
      T.line.t -= dt;
      if (T.line.t <= 0) T.line = null;
    }
    if (s.phase === 'play' && st.phase === 'back' && st.chanting) {
      // 외치는 동안 글자가 하나씩 나타난다(마지막 글자는 돌아볼 때)
      T.chantT += dt;
      const shown = Math.min(T.phrase.length - 1, Math.floor(T.chantT * SHOW_RATE));
      if (shown > T.shown) {
        T.shown = shown;
        T.popT = 0.15;
        if (!this.isTagger) this.audio.play('syllable', { index: shown - 1 });
      }
    } else if (st.phase === 'back' && !st.chanting && T.chantT > 0) {
      // 외치다 멈춤 — 잠깐 뒤 글자가 사라진다
      T.chantT = Math.max(0, T.chantT - dt * 3);
      if (T.chantT === 0) T.shown = 0;
    }

    if (this.fx.hitStopping) return; // 히트 스톱: 세계가 아주 잠깐 멈춤
    if (this.goT > 0) this.goT -= dt;
    if (this.noteT > 0) this.noteT -= dt;
    this.particles.update(dt);
    this.stage.update(dt);
    const facing = T.isFacing();
    this.darken += ((facing ? FX.WATCH_DARKEN : 0) - this.darken) * Math.min(1, dt * 18);
    for (const r of s.runners) {
      const p = this.runnerById.get(r.id);
      if (!p) continue;
      p.applyNet(r);
      p.update(dt, { taggerFacing: facing }, this.particles, this.stage);
    }
  }

  // ------------------------------------------------------------
  // 그리기
  // ------------------------------------------------------------
  _renderTagger(ctx) {
    const T = this.tagger;
    const F = this.taggerFrames;
    const { x, y } = TAGGER_FOOT;
    let img = F.front[Math.floor(T.time * 2) % 2];
    let sx = 1;
    if (T.phase === 'back') img = F.back[T.chanting ? Math.floor(T.time * 8) % 2 : 0];
    else if (T.phase === 'turning') {
      // 휙 돌아보기: 가로로 접혔다 펴진다 (앞 절반은 뒷모습, 뒤 절반은 앞모습)
      const k = Math.min(1, T.t / TAGGER.TURN_TIME);
      img = k < 0.5 ? F.back[0] : F.front[0];
      sx = Math.max(0.2, Math.abs(1 - k * 2));
    } else if (T.phase === 'turnBack') {
      const k = Math.min(1, T.t / TAGGER.TURN_BACK_TIME);
      img = k < 0.5 ? F.front[0] : F.back[0];
      sx = Math.max(0.2, Math.abs(1 - k * 2));
    } else if (T.phase === 'watching') img = F.front[0];
    shadow(ctx, x, y - 1, 14, C.dark);
    spriteFeet(ctx, img, x, y, sx, 1);
    // 돌아볼 때 머리 위 "!" 표시
    if (T.isFacing()) {
      const bob = Math.floor(T.time * 8) % 2;
      const bx = x + 9, by = y - img.height - 6;
      rect(ctx, bx, by - bob, 3, 7, C.ink);
      rect(ctx, bx + 1, by + 1 - bob, 1, 4, C.yellow);
      rect(ctx, bx, by + 8 - bob, 3, 3, C.ink);
      rect(ctx, bx + 1, by + 9 - bob, 1, 1, C.yellow);
    }
  }

  _label(ctx, textStr, cx, y, color) {
    const w = this.text.measure(textStr, 'tiny') + 4;
    const x = Math.round(cx - w / 2);
    rect(ctx, x, y, w, 8, C.ink);
    rect(ctx, x + 1, y + 1, w - 2, 6, color);
    this.text.draw(ctx, textStr, cx, y, { font: 'tiny', color: isLight(color) ? C.ink : C.white, align: 'center' });
  }

  _render(ctx) {
    const s = this.net.snap;
    const { stage, ui, text, fx } = this;
    ctx.imageSmoothingEnabled = false;
    if (!s) {
      rect(ctx, 0, 0, 320, 180, C.ink);
      text.draw(ctx, '서버를 기다리는 중…', 160, 84, { font: 'main', color: C.white, align: 'center' });
      return;
    }
    const T = this.tagger;
    const dusk = Math.min(1, 1 - s.timeLeft / RULES.TIME_LIMIT);
    const lead = this.runners.reduce((m, p) => Math.max(m, p.progress), 0);

    ctx.save();
    ctx.translate(fx.ox, fx.oy);
    stage.renderBackground(ctx, dusk, Math.sin(this.time * 0.25) * 6 + lead * 10);
    stage.renderTree(ctx);
    this._renderTagger(ctx);
    const order = [...this.runners].sort((a, b) => b.dist - a.dist);
    order.forEach((p) => p.render(ctx, stage));
    this.particles.render(ctx);

    ctx.globalAlpha = dusk * FX.DUSK_MAX;
    rect(ctx, -4, -4, 328, 188, C.plum);
    ctx.globalAlpha = this.darken;
    rect(ctx, -4, -4, 328, 188, C.ink);
    ctx.globalAlpha = 1;

    // 이름표 / 말풍선은 어둡게 하지 않음
    order.forEach((p) => p.renderLabel(ctx, stage, text));
    this._label(ctx, `술래 ${this.taggerInfo.name}`, TAGGER_FOOT.x, TAGGER_FOOT.y + 2, this.taggerInfo.color);
    for (const p of this.runners) {
      if (!p.bubble) continue;
      const x = stage.laneX(p.lane, p.dist, p.laneCount);
      const y = stage.distToY(p.dist) - p.frames.idle[0].height - 9;
      ui.bubble(ctx, p.bubble.text, x, y, p.alive ? { color: C.yellow, textColor: C.ink, font: 'tiny' } : { color: C.red, textColor: C.white, font: 'tiny' });
    }
    if (T.line) ui.bubble(ctx, T.line.text, TAGGER_FOOT.x + 26, TAGGER_FOOT.y - 20, { font: 'tiny' });
    ctx.restore();

    // HUD (흔들리지 않음)
    const playing = s.phase === 'play' || s.phase === 'end' || s.phase === 'countdown';
    if (playing) {
      ui.phraseBox(ctx, T, this.time);
      this._progressPanel(ctx);
      ui.timerPanel(ctx, s.timeLeft, T, this.time);
      this._controls(ctx, s);
    }
    this._overlay(ctx, s);
    if (this.audio.muted) {
      rect(ctx, 2, 2, 24, 10, C.ink);
      text.draw(ctx, '음소거', 14, 3, { font: 'tiny', color: C.silver, align: 'center' });
    }
  }

  /** 왼쪽 패널: 도망자별 진행도 */
  _progressPanel(ctx) {
    const { ui, text } = this;
    const players = this.runners;
    const x = 2, y = 62, w = 72, rowH = 18;
    ui.box(ctx, 'panel', x, y, w, 14 + players.length * rowH);
    text.draw(ctx, '진행도', x + w / 2, y + 3, { font: 'small', color: C.yellow, align: 'center' });
    players.forEach((p, i) => {
      const ry = y + 15 + i * rowH;
      text.draw(ctx, p.isMe ? `${p.name} (나)` : p.name, x + 5, ry - 1, { font: 'tiny', color: p.alive ? p.color : C.silver });
      let status = `${p.dist.toFixed(1)}m`, col = C.silver;
      if (p.finished) { status = '도착!'; col = C.yellow; }
      else if (!p.alive) { status = '탈락'; col = C.red; }
      text.draw(ctx, status, x + w - 5, ry - 1, { font: 'tiny', color: col, align: 'right' });
      const bx = x + 5, bw = w - 10;
      rect(ctx, bx, ry + 9, bw, 5, C.ink);
      const fill = Math.round((bw - 2) * p.progress);
      if (fill > 0) {
        rect(ctx, bx + 1, ry + 10, fill, 3, p.alive ? p.color : C.slate);
        rect(ctx, bx + 1, ry + 10, fill, 1, p.alive ? C.white : C.silver);
      }
    });
  }

  /** 아래쪽: 내 조작 안내 (도망자 = 키 캡, 술래 = 마이크 상태) */
  _controls(ctx, s) {
    const { text, stage } = this;
    if (this.meRunner) {
      const p = this.meRunner;
      const cx = stage.laneX(p.lane, 0, p.laneCount);
      const held = this.held;
      const w = 22, h = 10;
      const x = cx - 11, y = TRACK.START_Y + 4 + (held ? 1 : 0);
      rect(ctx, x, y, w, h, C.ink);
      rect(ctx, x + 1, y + 1, w - 2, h - (held ? 2 : 3), held ? p.color : C.silver);
      if (!held) rect(ctx, x + 1, y + h - 2, w - 2, 1, C.slate);
      text.draw(ctx, 'SPC', cx, y + 1, { font: 'tiny', color: C.ink, align: 'center' });
      return;
    }
    if (!this.isTagger) {
      text.draw(ctx, '관전 중', 160, 168, { font: 'small', color: C.silver, outline: C.ink, align: 'center' });
      return;
    }
    // 술래: 마이크 상태 + 소리 크기
    const mic = this.mic;
    let label, color = C.white;
    if (this.noteT > 0) { label = this.note; color = C.yellow; }
    else if (!this.voice) label = `스페이스를 ${this.minKeyChant}초 넘게 눌렀다 떼면 돌아봅니다`;
    else if (mic.status === 'ready') label = s.tagger.phase === 'back' ? `마이크에 "${this.phraseText}"!` : '지켜보는 중… 다시 외치면 뒤돕니다';
    else if (mic.status === 'starting') label = '마이크 연결 중…';
    else { label = `마이크를 쓸 수 없어요 — 스페이스를 ${this.minKeyChant}초 넘게 눌렀다 떼세요`; color = C.yellow; }
    const w = text.measure(label, 'small') + 12;
    this.ui.box(ctx, 'panel', 160 - w / 2, 158, w, 18);
    text.draw(ctx, label, 160, 162, { font: 'small', color, align: 'center' });
    if (this.voice && mic.status === 'ready') {
      const lit = Math.min(5, Math.ceil(Math.min(1, mic.level * 5) * 5));
      for (let i = 0; i < 5; i++) {
        const bh = 3 + i * 2;
        rect(ctx, 160 + w / 2 + 4 + i * 5, 174 - bh, 4, bh, C.ink);
        rect(ctx, 160 + w / 2 + 5 + i * 5, 175 - bh, 2, bh - 1, i < lit ? (mic.speaking ? C.red : C.lime) : C.slate);
      }
    } else if (s.tagger.keyTime > 0) {
      // 키로 외치는 중: 얼마나 눌렀는지
      const k = Math.min(1, s.tagger.keyTime / this.minKeyChant);
      rect(ctx, 160 - 30, 152, 60, 4, C.ink);
      rect(ctx, 160 - 29, 153, Math.round(58 * k), 2, k >= 1 ? C.lime : C.yellow);
    }
  }

  _overlay(ctx, s) {
    const { text, ui } = this;
    const tName = this.taggerInfo.name;
    if (s.phase === 'intro') {
      ditherRect(ctx, 0, 0, 320, 180, C.ink, 0.5);
      ui.box(ctx, 'panel', 40, 30, 240, 120);
      text.draw(ctx, '무궁화 꽃이 피었습니다', 160, 38, { font: 'big', color: C.yellow, outline: C.ink, align: 'center' });
      text.draw(ctx, `술래: ${tName}`, 160, 60, { font: 'big', color: this.taggerInfo.color, outline: C.ink, align: 'center' });
      const lines = this.isTagger
        ? ['당신이 술래!', this.voice ? `마이크에 "${this.phraseText}"를 외치면 돌아봅니다` : `스페이스를 ${this.minKeyChant}초 넘게 눌렀다 떼면 돌아봅니다`,
          '끊지 말고 끝까지! 다시 외치기 시작하면 뒤돕니다', '아무도 결승선에 못 닿게 하면 승리']
        : this.meRunner
          ? ['당신은 도망자!', '스페이스를 누르고 있으면 전진, 떼면 멈춤', '술래가 돌아볼 때 움직이면 탈락 (바로 멈추지 못해요)', '한 명이라도 결승선에 닿으면 도망자 승리']
          : ['관전합니다'];
      lines.forEach((line, i) => text.draw(ctx, line, 160, 82 + i * 13, { font: 'small', color: i === 0 ? C.lime : C.white, align: 'center' }));
      const left = Math.max(0, Math.ceil(s.countdownAt - this.net.now()));
      text.draw(ctx, `${left}초 뒤 시작`, 160, 137, { font: 'tiny', color: C.silver, align: 'center' });
    } else if (s.phase === 'countdown') {
      const left = Math.max(0, s.startAt - this.net.now());
      const c = Math.max(1, Math.ceil(left));
      const k = left - Math.floor(left);
      text.draw(ctx, String(c), 160, 92 - Math.round(k * 4), { font: 'big', color: C.yellow, outline: C.ink, align: 'center', scale: 3 });
      text.draw(ctx, this.isTagger ? '곧 외칠 차례!' : '스페이스를 누르고 있으면 전진, 떼면 멈춤!', 160, 124, { font: 'small', color: C.white, outline: C.ink, align: 'center' });
    } else if (s.phase === 'play' && this.goT > 0) {
      text.draw(ctx, '시작!', 160, 96, { font: 'big', color: C.lime, outline: C.ink, align: 'center', scale: 2 });
    } else if (s.phase === 'end' && s.result) {
      const r = s.result;
      if (r.winner === 'runners') {
        const names = r.finishers.map((id) => (this.infoById.get(id) || {}).name).join(', ');
        ui.banner(ctx, '도망자 승리!', `${names} 도착!`, 'gold');
      } else {
        ui.banner(ctx, '술래 승리!', r.reason === 'timeUp' ? '시간 종료 — 아무도 못 닿았다' : '전원 탈락!', 'alert');
      }
    } else if ((s.phase === 'final' || s.phase === 'done') && s.results) {
      ditherRect(ctx, 0, 0, 320, 180, C.ink, 0.5);
      const rows = s.results;
      const h = 34 + rows.length * 13;
      const y = Math.round(90 - h / 2);
      ui.box(ctx, 'panel', 40, y, 240, h);
      const runnersWin = s.result && s.result.winner === 'runners';
      text.draw(ctx, runnersWin ? '도망자 승리!' : `술래 ${tName} 승리!`, 160, y + 6, { font: 'big', color: C.yellow, outline: C.ink, align: 'center' });
      rows.forEach((row, i) => {
        const ry = y + 28 + i * 13;
        const info = this.infoById.get(row.playerId) || {};
        const st = row.stats || {};
        const detail = st.role === 'tagger' ? `술래 · ${st.caught}명 잡음` : st.finished ? '도착!' : st.eliminated ? `탈락 ${st.meters}m` : `${st.meters}m`;
        const color = row.isWinner ? C.yellow : info.isMe ? C.lime : C.white;
        text.draw(ctx, `${row.rank}위`, 50, ry, { font: 'small', color });
        text.draw(ctx, row.name, 76, ry, { font: 'small', color: info.color || color });
        text.draw(ctx, detail, 200, ry, { font: 'tiny', color: C.silver, align: 'right' });
        text.draw(ctx, `${row.score}점`, 270, ry, { font: 'small', color, align: 'right' });
      });
    }
  }
}
