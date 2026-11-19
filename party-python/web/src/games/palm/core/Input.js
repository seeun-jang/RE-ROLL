// =============================================================
// Input.js — 키보드 + 마우스(포인터) 입력
//   - 키 상태는 로직 프레임 단위로 샘플링한다.
//   - 한 프레임보다 짧게 톡 친 키도 놓치지 않도록, 눌린 순간(pressed)을 따로 기록한다.
//   - 키보드 하나를 돌려 쓰는 게임이라 플레이어 조작 키는 항상 같다 (A/D/J/K/L).
// =============================================================

// 게임에서 쓰는 키 — 브라우저 기본 동작(스크롤 등)을 막는다
const GAME_KEYS = new Set([
  'KeyA', 'KeyD', 'KeyJ', 'KeyK', 'KeyL', 'KeyM', 'Escape', 'Enter', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'Backquote',
]);

export const KEYMAP = {
  back: 'KeyA',
  forward: 'KeyD',
  push: 'KeyJ',
  feint: 'KeyK',
  hold: 'KeyL',
  pause: 'Escape',
  mute: 'KeyM',
  debug: 'Backquote',
};

export class Input {
  /**
   * @param {HTMLElement} focusTarget 게임 컨테이너 (포커스 관리용)
   * @param {HTMLCanvasElement} canvas 포인터 좌표 계산용
   * @param {{W:number,H:number}} screen 내부 해상도
   */
  constructor(focusTarget, canvas, screen) {
    this.target = focusTarget;
    this.canvas = canvas;
    this.screen = screen;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.enabled = true;
    this.pointer = { x: -1, y: -1, inside: false, down: false, clicked: false, pressedNow: false };
    this.onAnyInput = null; // 첫 입력 시 오디오 잠금 해제 콜백

    this._kd = (e) => this.handleKeyDown(e);
    this._ku = (e) => this.handleKeyUp(e);
    this._blur = () => this.clearAll();
    this._pm = (e) => this.handlePointer(e, 'move');
    this._pd = (e) => this.handlePointer(e, 'down');
    this._pu = (e) => this.handlePointer(e, 'up');
    this._pl = () => {
      this.pointer.inside = false;
    };
  }

  attach() {
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', this._blur);
    this.canvas.addEventListener('pointermove', this._pm);
    this.canvas.addEventListener('pointerdown', this._pd);
    window.addEventListener('pointerup', this._pu);
    this.canvas.addEventListener('pointerleave', this._pl);
  }

  detach() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('blur', this._blur);
    this.canvas.removeEventListener('pointermove', this._pm);
    this.canvas.removeEventListener('pointerdown', this._pd);
    window.removeEventListener('pointerup', this._pu);
    this.canvas.removeEventListener('pointerleave', this._pl);
    this.clearAll();
  }

  // 게임 영역(컨테이너)이 포커스를 가지고 있을 때만 키를 처리한다 —
  // 다른 화면에 끼워 넣었을 때 호스트 페이지의 키 입력(스페이스 스크롤 등)을 빼앗지 않도록
  hasFocus() {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    return !!a && !!this.target && (a === this.target || this.target.contains(a));
  }

  // 다른 입력창(텍스트 입력 등)에 타이핑 중이면 무시 (shadow DOM 안의 입력창도 고려)
  isTypingTarget(e) {
    const t = typeof e.composedPath === 'function' ? e.composedPath()[0] || e.target : e.target;
    if (!t || t === document.body) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  handleKeyDown(e) {
    if (!this.enabled || !GAME_KEYS.has(e.code)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // 브라우저 단축키(Ctrl+D 등)는 건드리지 않음
    if (!this.hasFocus() || this.isTypingTarget(e)) return;
    e.preventDefault();
    if (this.onAnyInput) this.onAnyInput();
    if (e.repeat) {
      // 키 반복은 "새로 누름"이 아니지만, 포커스 이동 등으로 상태가 지워졌다면 다시 눌린 것으로 복구
      this.down.add(e.code);
      return;
    }
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  }

  handleKeyUp(e) {
    if (!GAME_KEYS.has(e.code)) return;
    if (this.down.has(e.code)) this.released.add(e.code);
    this.down.delete(e.code);
  }

  handlePointer(e, kind) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * this.screen.W);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * this.screen.H);
    const p = this.pointer;
    p.x = x;
    p.y = y;
    p.inside = x >= 0 && y >= 0 && x < this.screen.W && y < this.screen.H;
    if (kind === 'down') {
      if (this.onAnyInput) this.onAnyInput();
      p.down = true;
      p.pressedNow = true;
      if (this.target && this.target.focus) this.target.focus({ preventScroll: true });
    } else if (kind === 'up') {
      if (p.down && p.inside) p.clicked = true;
      p.down = false;
    }
  }

  clearAll() {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
    this.pointer.down = false;
  }

  // 한 로직 프레임이 끝날 때 호출 — "이번 프레임에 눌림" 기록을 비운다
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.pointer.clicked = false;
    this.pointer.pressedNow = false;
  }

  // 누르고 있는가? (이번 프레임에 눌렀다 뗀 짧은 입력도 포함)
  isDown(code) {
    return this.down.has(code) || this.pressed.has(code);
  }
  wasPressed(code) {
    return this.pressed.has(code);
  }
  wasReleased(code) {
    return this.released.has(code);
  }
  anyPressed(codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  // 메뉴 "결정" 입력
  confirmPressed() {
    return this.anyPressed(['Enter', 'Space', 'KeyJ']);
  }

  // 플레이어(왼쪽, 오른쪽을 바라봄) 조작 → InputFrame (자기 기준: D = 앞으로)
  playerFrame() {
    const back = this.isDown(KEYMAP.back);
    const fwd = this.isDown(KEYMAP.forward);
    return {
      lean: (fwd ? 1 : 0) - (back ? 1 : 0),
      pushDown: this.isDown(KEYMAP.push),
      feintPressed: this.wasPressed(KEYMAP.feint),
      holdDown: this.isDown(KEYMAP.hold),
    };
  }
}
