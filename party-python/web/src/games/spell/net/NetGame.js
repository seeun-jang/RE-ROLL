// =============================================================
// NetGame — 주문 게임(멀티플레이) 조립 지점
//  렌더러·루프·오디오·에셋·장면을 만들고, 서버 진행(net.snap.phase)에 맞춰 장면을 바꾼다.
//  판정은 서버가 한다. 여기서는 화면과 입력(숫자키·클릭·마이크)만 다룬다.
// =============================================================
import { ANIMALS } from '../../../shared/animals.js';
import { MicCapture } from '../../../shared/MicCapture.js';
import { Assets } from '../assets/AssetLoader.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { EventBus } from '../core/EventBus.js';
import { GameLoop } from '../core/GameLoop.js';
import { Renderer } from '../core/Renderer.js';
import { SceneManager } from '../core/SceneManager.js';
import { C } from '../data/palette.js';
import { PixelText } from '../ui/PixelText.js';
import { NetFightScene } from './NetFightScene.js';
import { NetFinalScene, NetIntroScene, NetRoundResultScene, NetWaitScene } from './NetScenes.js';

/** 주문 한 마디는 짧다 → 말이 끝났다고 보는 시간을 줄여 빨리 보낸다 */
const MIC_OPTIONS = { SILENCE_MS: 350, MIN_SPEECH_MS: 150, MAX_MS: 3000, PRE_ROLL_MS: 250 };

export class NetGame {
  /**
   * @param {HTMLElement} container
   * @param {{net:object, players:{id,name,lookId,isMe}[], voice:boolean, rounds:number}} opts
   */
  constructor(container, { net, players, voice, rounds }) {
    this.container = container;
    this.net = net;
    this.players = players;
    this.voice = !!voice;
    this.rounds = rounds || 1;
    this.events = new EventBus();
    this._listeners = [];
    this.destroyed = false;
    this._buildDom();

    this.renderer = new Renderer(this.canvas);
    this.text = new PixelText();
    this.assets = new Assets();
    this.audio = new AudioEngine();
    this.mic = new MicCapture(MIC_OPTIONS);

    this.scenes = new SceneManager(this);
    this.scenes.register('wait', NetWaitScene);
    this.scenes.register('intro', NetIntroScene);
    this.scenes.register('fight', NetFightScene);
    this.scenes.register('result', NetRoundResultScene);
    this.scenes.register('final', NetFinalScene);
    this._viewKey = '';

    this.loop = new GameLoop({ update: (dt) => this._update(dt), render: () => this._render() });
  }

  get me() {
    return this.players.find((p) => p.isMe) || null;
  }

  playerById(id) {
    return this.players.find((p) => p.id === id) || { id, name: '?', lookId: 'shiba', isMe: false };
  }

  /** 참가자를 나타내는 색(캐릭터 대표 색) */
  uiColor(player) {
    const a = player && ANIMALS[player.lookId];
    return a ? a.color : C.white;
  }

  // ---------- DOM ----------
  _buildDom() {
    const root = document.createElement('div');
    root.className = 'stsp-root';
    Object.assign(root.style, {
      position: 'relative', width: '100%', height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: C.ink, overflow: 'hidden',
    });
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    Object.assign(canvas.style, { imageRendering: 'pixelated', display: 'block', outline: 'none', touchAction: 'none' });
    root.appendChild(canvas);
    this.container.appendChild(root);
    this.root = root;
    this.canvas = canvas;
    this.autoHeight = this.container.clientHeight === 0;
  }

  _fit() {
    const w = this.root.clientWidth || 640;
    const h = this.autoHeight ? Infinity : this.root.clientHeight || Infinity;
    this.renderer.fit(w, h);
    if (this.autoHeight) this.root.style.height = this.canvas.style.height;
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push(() => target.removeEventListener(type, fn, opts));
  }

  _bindEvents() {
    this._on(this.canvas, 'pointerdown', (e) => {
      this._pointerDown = true;
      this.audio.unlock();
      this.scenes.dispatch('onPointerDown', this.renderer.toLogical(e.clientX, e.clientY));
    });
    this._on(this.canvas, 'pointermove', (e) => this.scenes.dispatch('onPointerMove', this.renderer.toLogical(e.clientX, e.clientY)));
    this._on(window, 'pointerup', (e) => {
      if (!this._pointerDown) return;
      this._pointerDown = false;
      this.scenes.dispatch('onPointerUp', this.renderer.toLogical(e.clientX, e.clientY));
    });
    this._on(this.canvas, 'contextmenu', (e) => e.preventDefault());
    this._on(window, 'keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.altKey || e.metaKey) return;
      this.audio.unlock();
      if (e.code === 'KeyM') {
        this.audio.setMuted(!this.audio.muted);
        return;
      }
      if (e.code === 'Space') e.preventDefault();
      this.scenes.dispatch('onKeyDown', e);
    });
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this._fit());
      this._ro.observe(this.root);
    }
    this._on(window, 'resize', () => this._fit());
  }

  // ---------- 수명 주기 ----------
  async init() {
    this.renderer.begin(C.ink);
    await Promise.all([this.text.loadFonts(), this.assets.load()]);
    if (this.destroyed) return this;
    this._bindEvents();
    this._fit();
    try {
      this.audio.unlock(); // 대기실에서 이미 클릭했으므로 바로 켤 수 있다(안 되면 첫 입력 때 켜진다)
    } catch (e) { /* 소리 없이 진행 */ }
    if (this.voice && this.me) this.mic.start();
    this.scenes.change('wait', {}, { transition: null });
    this.loop.start();
    return this;
  }

  /** 서버 진행 단계에 맞는 장면으로 바꾼다 */
  _netSync() {
    const s = this.net.snap;
    if (!s) return;
    let view = 'wait';
    if (s.phase === 'intro') view = 'intro';
    else if (s.phase === 'countdown' || s.phase === 'fight') view = 'fight';
    else if (s.phase === 'result') view = 'result';
    else if (s.phase === 'final' || s.phase === 'done') view = 'final';
    const key = view === 'final' ? 'final' : `${view}:${s.round}`;
    if (key === this._viewKey) return;
    this._viewKey = key;
    this.scenes.change(view, { round: s.round }, { transition: 'fade', duration: 0.3 });
  }

  _update(dt) {
    this._netSync();
    this.scenes.update(dt);
    this.renderer.updateShake(dt);
  }

  _render() {
    this.renderer.begin(C.ink);
    this.scenes.render(this.renderer);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    while (this.scenes.stack.length) this.scenes.pop();
    this.mic.stop();
    this.audio.destroy();
    this._listeners.forEach((off) => off());
    this._ro?.disconnect();
    this.root.remove();
    this.events.clear();
  }
}
