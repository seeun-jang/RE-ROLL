// =============================================================
// Game.js — 게임 본체: 캔버스/확대, 고정 60FPS 루프, 씬 전환, 일시정지, 음소거
//
//   멀티플레이판: 장면은 서버가 알려주는 진행 상태(phase)에 맞춰 넘어간다
//   대기 → 대진 안내 → 대결(카운트다운 → 경기) → 라운드 결과 → … → 최종 결과
//   (한 사람이 멈출 수 없으므로 일시정지는 없다)
// =============================================================
import { Input, KEYMAP } from './Input.js';
import { AudioEngine } from './Audio.js';
import { Background } from '../scene/Background.js';
import { drawPixelFade, drawCircleWipe } from '../ui/Transitions.js';
import { drawText } from '../ui/PixelFont.js';
import { drawPanel, Button, drawIcon } from '../ui/UIKit.js';
import { createRng } from '../util.js';
import { PAL } from '../palette.js';
import { NetWaitScene, NetIntroScene, NetRoundResultScene, NetFinalScene } from '../net/NetScenes.js';
import { NetFightScene } from '../net/NetFightScene.js';

/** CPU 가 없는 멀티플레이에서 원본 대결 장면이 부르는 CPU 자리를 채우는 빈 객체 */
const NO_CPU = Object.freeze({ reset() {}, observe() {}, update() { return null; }, lastDecision: null, pending: false });

const MUTE_RECT = { x: 309, y: 169, w: 10, h: 10 };

export class Game {
  /**
   * @param {HTMLElement} container
   * @param {object} options start()에 전달된 옵션
   * @param {object} cfg 병합된 설정
   * @param {Assets} assets
   */
  constructor(container, options, cfg, assets) {
    this.container = container;
    this.options = options;
    this.cfg = cfg;
    this.assets = assets;
    this.W = cfg.SCREEN.W;
    this.H = cfg.SCREEN.H;
    this.rng = createRng(cfg.MATCH.SEED ^ 0x5eed);
    this.frame = 0; // 전체 로직 프레임 카운터 (UI 깜빡임 등)
    this.destroyed = false;
    this.paused = false;
    this.debug = !!options.debug;
    this.finished = false;
    this.pendingAutoPause = false;
    // 컨테이너 높이가 정해져 있지 않으면(내용에 따라 늘어나는 div) 가로 폭만으로 배율을 정한다
    this.autoHeight = container.clientHeight === 0;

    this.buildDom();
    this.input = new Input(this.wrap, this.canvas, { W: this.W, H: this.H });
    this.input.onAnyInput = () => this.audio.unlock();
    this.input.attach();

    this.audio = new AudioEngine({ muted: !!options.muted, volume: options.volume ?? 0.6 });
    this.bg = new Background({ rng: createRng(cfg.MATCH.SEED + 99) });

    // 서버와의 연결(NetLink). 판정·점수·진행은 모두 여기서 온다
    this.net = options.net;
    this.cpuController = NO_CPU;
    this._netKey = null;          // 지금 장면이 나타내는 '진행 상태:라운드'
    this.session = this.newSession();

    // 씬/전환
    this.scene = null;
    this.transition = null; // { type, t, len, next, switched, color }

    // 일시정지 메뉴 버튼
    this.pauseButtons = [
      new Button({ x: 110, y: 78, w: 100, h: 18, label: '계속하기', font: 'm', style: 'default' }),
      new Button({ x: 110, y: 100, w: 100, h: 18, label: this.audio.muted ? '소리 켜기' : '소리 끄기', font: 'm', style: 'default' }),
    ];
    this.pauseFocus = 0;

    this._vis = () => {
      if (document.hidden) this.autoPause();
    };
    this._blur = () => this.autoPause();
    document.addEventListener('visibilitychange', this._vis);
    window.addEventListener('blur', this._blur);

    this.setScene(new NetWaitScene(this));

    this.last = performance.now();
    this.acc = 0;
    this._loop = (now) => this.loop(now);
    this.raf = requestAnimationFrame(this._loop);
  }

  // ---------------- DOM / 확대 ----------------
  buildDom() {
    const wrap = document.createElement('div');
    wrap.className = 'palm-push-root';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'application');
    wrap.setAttribute('aria-label', '손바닥 밀치기 게임');
    Object.assign(wrap.style, {
      position: 'relative',
      width: '100%',
      height: this.autoHeight ? `${this.H}px` : '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: PAL.ink,
      outline: 'none',
      overflow: 'hidden',
      userSelect: 'none',
      touchAction: 'none',
    });
    const canvas = document.createElement('canvas');
    canvas.width = this.W;
    canvas.height = this.H;
    Object.assign(canvas.style, {
      imageRendering: 'pixelated',
      display: 'block',
      cursor: 'default',
    });
    // 일부 브라우저 대비
    canvas.style.setProperty('image-rendering', 'crisp-edges');
    canvas.style.setProperty('image-rendering', 'pixelated');
    wrap.appendChild(canvas);
    this.container.appendChild(wrap);
    this.wrap = wrap;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;

    this.applyScale();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.applyScale());
      this.ro.observe(this.container);
    } else {
      this._resize = () => this.applyScale();
      window.addEventListener('resize', this._resize);
    }
    // 호스트 페이지에서 사용자가 다른 곳에 포커스를 두고 있으면 빼앗지 않는다
    const active = document.activeElement;
    if (!active || active === document.body || this.container.contains(active)) wrap.focus({ preventScroll: true });
    // 게임 영역이 포커스를 잃으면 눌린 키를 지우고 (대결 중이면) 일시정지
    this._focusout = () => {
      this.input && this.input.clearAll();
      this.autoPause();
    };
    wrap.addEventListener('focusout', this._focusout);
    wrap.addEventListener('pointerdown', () => wrap.focus({ preventScroll: true }));
  }

  // 정수배 확대 (nearest-neighbor) — 컨테이너에 들어가는 가장 큰 정수배
  applyScale() {
    const S = this.cfg.SCREEN;
    let scale = this.options.scale;
    if (!scale) {
      const cw = this.container.clientWidth || this.W * 4;
      const ch = this.autoHeight ? Infinity : this.container.clientHeight || Infinity;
      scale = Math.floor(Math.min(cw / this.W, ch / this.H));
    }
    scale = Math.max(1, Math.min(S.MAX_SCALE, scale | 0));
    this.scale = scale;
    this.canvas.style.width = `${this.W * scale}px`;
    this.canvas.style.height = `${this.H * scale}px`;
    if (this.autoHeight) this.wrap.style.height = `${this.H * scale}px`;
  }

  // ---------------- 참가자 ----------------
  newSession() {
    // options.players: [{ id, name, lookId, isMe }]
    const players = (this.options.players || []).map((p, index) => ({ ...p, index }));
    return { players, current: 0, entries: [] };
  }
  playerById(id) {
    return this.session.players.find((p) => p.id === id) || { id, name: String(id), lookId: 'shiba', index: 0 };
  }
  get me() {
    return this.session.players.find((p) => p.isMe) || null;
  }
  /** 원본 대결 장면이 '왼쪽 선수'로 쓰는 값 (대결 장면이 직접 정한다) */
  get currentPlayer() {
    return this._viewPlayer || this.session.players[0];
  }

  /**
   * 서버가 알려준 진행 상태에 맞는 장면으로 옮긴다.
   * 늦게 들어오거나 다시 접속해도 같은 규칙으로 현재 장면을 찾아간다.
   */
  _netSync() {
    const s = this.net.snap;
    if (!s || this.transition) return;
    const stage = s.phase === 'countdown' || s.phase === 'fight' ? 'fight' : s.phase === 'done' ? 'final' : s.phase;
    const key = `${stage}:${s.round}`;
    if (key === this._netKey) return;
    let next = null;
    if (stage === 'intro') next = new NetIntroScene(this);
    else if (stage === 'fight') next = new NetFightScene(this);
    else if (stage === 'result') next = new NetRoundResultScene(this);
    else if (stage === 'final') next = new NetFinalScene(this);
    if (!next) return;
    this._netKey = key;
    if (this.scene instanceof NetWaitScene) this.setScene(next);
    else this.goto(next, stage === 'final' ? 'wipe' : 'fade');
  }

  // ---------------- 씬 전환 ----------------
  setScene(scene) {
    if (this.scene && this.scene.exit) this.scene.exit();
    this.scene = scene;
    if (scene.enter) scene.enter();
  }

  /**
   * 전환 효과와 함께 씬 변경
   * @param {object} scene 새 씬
   * @param {'fade'|'wipe'} type 픽셀 페이드 / 원형 와이프
   */
  goto(scene, type = 'fade', opts = {}) {
    if (this.transition) return;
    this.transition = {
      type,
      t: 0,
      len: this.cfg.FLOW.TRANSITION_FRAMES,
      next: scene,
      switched: false,
      cx: opts.cx ?? 160,
      cy: opts.cy ?? 90,
    };
  }

  // ---------------- 일시정지 ----------------
  get canPause() {
    return !!(this.scene && this.scene.pausable && !this.transition);
  }

  pause() {
    if (!this.canPause || this.paused) return;
    this.paused = true;
    this.pauseFocus = 0;
    this.audio.play('pause');
    this.audio.pauseAll();
    this.input.clearAll();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.audio.resumeAll();
    this.input.clearAll();
    this.last = performance.now();
  }

  autoPause() {
    if (this.canPause) this.pause();
    else this.pendingAutoPause = true; // 화면 전환 중이면 대결이 시작될 때 멈춘다
  }

  toggleMute() {
    const m = this.audio.toggleMute();
    this.pauseButtons[1].label = m ? '소리 켜기' : '소리 끄기';
    return m;
  }

  // ---------------- 루프 ----------------
  loop(now) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this._loop);
    const stepMs = 1000 / this.cfg.SCREEN.LOGIC_FPS;
    let delta = now - this.last;
    this.last = now;
    if (delta > 250) delta = 250; // 탭 전환 후 복귀 시 폭주 방지
    this.acc += delta;
    let steps = 0;
    while (this.acc >= stepMs && steps < 5) {
      this.step();
      this.acc -= stepMs;
      steps++;
    }
    if (steps >= 5) this.acc = 0;
    this.render();
  }

  // 로직 1프레임
  step() {
    const input = this.input;
    this.frame++;

    if (input.wasPressed(KEYMAP.mute)) this.toggleMute();
    if (input.wasPressed(KEYMAP.debug)) this.debug = !this.debug;
    const p = input.pointer;
    if (p.clicked && this.hit(MUTE_RECT, p.x, p.y)) {
      this.toggleMute();
      p.clicked = false;
    }

    if (this.paused) {
      this.updatePauseMenu();
      input.endFrame();
      return;
    }
    if (this.pendingAutoPause) {
      if (input.hasFocus() && document.hasFocus() && !document.hidden) this.pendingAutoPause = false;
      else if (this.canPause) {
        this.pendingAutoPause = false;
        this.pause();
        input.endFrame();
        return;
      }
    }
    if (input.wasPressed(KEYMAP.pause) && this.canPause) {
      this.pause();
      input.endFrame();
      return;
    }

    // 전환 진행
    const tr = this.transition;
    if (tr) {
      tr.t++;
      if (!tr.switched && tr.t >= tr.len / 2) {
        tr.switched = true;
        this.setScene(tr.next);
      }
      if (tr.t >= tr.len) this.transition = null;
    }

    this._netSync();
    this.bg.update(1, this.scene && this.scene.bgState ? this.scene.bgState() : {});
    // 전환의 앞쪽 절반(덮는 중)에는 이전 씬을 멈춰 둔다
    if (this.scene && (!tr || tr.switched)) this.scene.update(1);
    input.endFrame();
  }

  hit(r, x, y) {
    return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  updatePauseMenu() {
    const input = this.input;
    const btns = this.pauseButtons;
    if (input.anyPressed(['ArrowUp', 'KeyW'])) {
      this.pauseFocus = (this.pauseFocus + btns.length - 1) % btns.length;
      this.audio.play('select');
    }
    if (input.anyPressed(['ArrowDown', 'KeyS'])) {
      this.pauseFocus = (this.pauseFocus + 1) % btns.length;
      this.audio.play('select');
    }
    const p = input.pointer;
    let clicked = -1;
    btns.forEach((b, i) => {
      b.hover = b.contains(p.x, p.y);
      if (b.hover && p.pressedNow) this.pauseFocus = i;
      b.focused = i === this.pauseFocus;
      b.pressed = b.hover && p.down;
      if (b.hover && p.clicked) clicked = i;
    });
    if (input.wasPressed(KEYMAP.pause)) {
      this.resume();
      return;
    }
    if (input.anyPressed(['Enter', 'Space'])) clicked = this.pauseFocus;
    if (clicked === 0) {
      this.audio.play('confirm');
      this.resume();
    } else if (clicked === 1) {
      this.toggleMute();
      this.audio.play('select');
    }
  }

  // ---------------- 그리기 ----------------
  render() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 0, this.W, this.H);
    if (this.scene) this.scene.draw(ctx);

    // 전환 효과
    const tr = this.transition;
    if (tr) {
      const half = tr.len / 2;
      const prog = tr.t < half ? tr.t / half : 1 - (tr.t - half) / half;
      if (tr.type === 'wipe') drawCircleWipe(ctx, prog, tr.cx, tr.cy, PAL.ink);
      else drawPixelFade(ctx, prog, PAL.ink);
    }

    if (this.paused) this.drawPause(ctx);

    // 게임 영역에 포커스가 없으면 키 입력을 받지 않으므로 안내
    if (!this.input.hasFocus() && !this.paused && Math.floor(this.frame / 30) % 2 === 0) {
      drawText(ctx, '화면을 클릭하면 조작할 수 있어요', 160, 2, { font: 's', color: PAL.sand, outline: PAL.ink, align: 'center' });
    }

    // 음소거 아이콘 (항상 오른쪽 아래)
    drawIcon(ctx, this.audio.muted ? 'mute' : 'speaker', MUTE_RECT.x + 1, MUTE_RECT.y + 1, this.audio.muted ? PAL.slate : PAL.white);
  }

  drawPause(ctx) {
    drawPixelFade(ctx, 0.55, PAL.ink);
    drawPanel(ctx, 96, 46, 128, 98, 'dark');
    drawText(ctx, '일시정지', 160, 54, { font: 'l', color: PAL.sand, align: 'center', shadow: PAL.ink });
    for (const b of this.pauseButtons) b.draw(ctx, this.frame);
    drawText(ctx, 'Esc: 계속  M: 소리', 160, 126, { font: 's', color: PAL.silver, align: 'center', outline: PAL.ink });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.scene && this.scene.exit) this.scene.exit();
    this.input.detach();
    this.audio.destroy();
    this.wrap.removeEventListener('focusout', this._focusout);
    document.removeEventListener('visibilitychange', this._vis);
    window.removeEventListener('blur', this._blur);
    if (this.ro) this.ro.disconnect();
    if (this._resize) window.removeEventListener('resize', this._resize);
    if (this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
  }
}
