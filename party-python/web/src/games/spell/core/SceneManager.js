// ============================================================
// 씬 관리자 (스택 구조)
//   change() : 화면 전환 효과와 함께 씬 교체 (타이틀 → 설정 → 튜토리얼 → 전투 → 결과)
//   push()/pop() : 일시정지 같은 오버레이 씬
// 전환 효과: 'fade' = 베이어 디더 픽셀 페이드, 'wipe' = 원형 와이프
// ============================================================
import { BAYER4 } from './Renderer.js';
import { C } from '../data/palette.js';

export class Scene {
  constructor(game) {
    this.game = game;
    this.name = '';
  }
  enter(_params) {}
  exit() {}
  update(_dt) {}
  render(_r) {}
  onPointerDown(_p) {}
  onPointerMove(_p) {}
  onPointerUp(_p) {}
  onKeyDown(_e) {}
  /** 외부(호스트)에서 일시정지를 요청했을 때 — 전투 씬이 메뉴를 띄우는 데 사용 */
  onHostPause() {}
}

export class SceneManager {
  constructor(game) {
    this.game = game;
    this.registry = new Map();
    this.stack = [];
    this.transition = null;
    this._pending = null;
    this._mask = null;
  }

  register(name, SceneClass) {
    this.registry.set(name, SceneClass);
  }

  get top() {
    return this.stack[this.stack.length - 1] || null;
  }

  get busy() {
    return !!this.transition;
  }

  _create(name) {
    const Cls = this.registry.get(name);
    if (!Cls) throw new Error(`등록되지 않은 씬: ${name}`);
    const scene = new Cls(this.game);
    scene.name = name;
    return scene;
  }

  _replace(name, params) {
    while (this.stack.length) this.stack.pop().exit();
    const scene = this._create(name);
    this.stack.push(scene);
    scene.enter(params || {});
    this.game.events.emit('scene', { name });
  }

  /** 씬 교체 */
  change(name, params = {}, { transition = 'fade', duration = 0.45 } = {}) {
    // 전환 중 요청은 버리지 않고 마지막 것만 기억했다가 전환이 끝나면 실행
    if (this.transition) {
      this._pending = { name, params, opts: { transition, duration } };
      return;
    }
    if (!transition || !this.stack.length) {
      this._replace(name, params);
      if (transition) this.transition = { type: transition, phase: 'in', t: 0, duration: duration / 2 };
      return;
    }
    this.transition = { type: transition, phase: 'out', t: 0, duration: duration / 2, name, params };
  }

  push(name, params = {}) {
    const scene = this._create(name);
    this.stack.push(scene);
    scene.enter(params);
    return scene;
  }

  pop() {
    const s = this.stack.pop();
    s?.exit();
    return s;
  }

  update(dt) {
    const tr = this.transition;
    if (tr) {
      tr.t += dt;
      if (tr.t >= tr.duration) {
        if (tr.phase === 'out') {
          this._replace(tr.name, tr.params);
          tr.phase = 'in';
          tr.t = 0;
        } else {
          this.transition = null;
          if (this._pending) {
            const p = this._pending;
            this._pending = null;
            this.change(p.name, p.params, p.opts);
          }
        }
      }
    }
    // 전환이 덮고 있는 동안(out 단계)에는 로직을 멈춘다
    if (!tr || tr.phase === 'in') this.top?.update(dt);
  }

  render(r) {
    for (const s of this.stack) s.render(r);
    const tr = this.transition;
    if (tr) {
      const p = Math.min(1, tr.t / tr.duration);
      const cover = tr.phase === 'out' ? p : 1 - p; // 0 = 다 보임, 1 = 다 가림
      if (tr.type === 'wipe') this._drawWipe(r, cover);
      else this._drawFade(r, cover);
    }
  }

  dispatch(method, evt) {
    if (this.transition && this.transition.phase === 'out') return;
    const top = this.top;
    if (top && typeof top[method] === 'function') top[method](evt);
  }

  // 픽셀 페이드: 베이어 행렬 순서대로 점점 덮는다
  _drawFade(r, cover) {
    r.dither(0, 0, r.W, r.H, C.ink, cover);
  }

  // 원형 와이프: 2px 블록 단위 원 바깥을 덮는다
  _drawWipe(r, cover) {
    if (!this._mask) {
      this._mask = document.createElement('canvas');
      this._mask.width = r.W;
      this._mask.height = r.H;
    }
    const m = this._mask.getContext('2d');
    m.globalCompositeOperation = 'source-over';
    m.fillStyle = C.ink;
    m.fillRect(0, 0, r.W, r.H);
    const maxR = Math.hypot(r.W / 2, r.H / 2) + 4;
    const radius = Math.floor(maxR * (1 - cover));
    const cx = r.W / 2, cy = r.H / 2, B = 2;
    for (let y = 0; y < r.H; y += B) {
      const dy = y + B / 2 - cy;
      if (Math.abs(dy) > radius) continue;
      const half = Math.floor(Math.sqrt(radius * radius - dy * dy) / B) * B;
      m.clearRect(Math.round(cx - half), y, half * 2, B);
    }
    r.ctx.drawImage(this._mask, 0, 0);
  }
}

// 다른 모듈에서 디더 행렬을 쓸 수 있게 다시 내보낸다
export { BAYER4 };
