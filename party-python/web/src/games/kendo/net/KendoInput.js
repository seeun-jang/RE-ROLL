// =============================================================
// 검도 키보드 입력 — 원본 engine/input.js 와 같은 쓰임새(down / pressed / beginTick)에,
// 화면을 닫을 때 키 이벤트를 떼어 낼 수 있게 dispose() 를 더했다.
// 일시정지·디버그·건너뛰기 같은 원본 전용 키는 없다(항상 안 눌린 것으로 본다).
// =============================================================
const BINDINGS = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  men: ['KeyZ'],
  kote: ['KeyX'],
  do: ['KeyC'],
  kiai: ['ShiftLeft', 'ShiftRight'],
  block: ['Space'],
};
const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

export class KendoInput {
  constructor() {
    this.held = new Set();
    this.buffer = new Set();
    this.pressedNow = new Set();
    this.anyPressed = false;
    this.onFirstInput = null;
    this.onKey = null;       // (code) => {}  — 음소거 등 화면 쪽 단축키
    this._down = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (this.onFirstInput) this.onFirstInput();
      if (e.repeat) return;
      this.held.add(e.code);
      this.buffer.add(e.code);
      if (this.onKey) this.onKey(e.code);
    };
    this._up = (e) => this.held.delete(e.code);
    this._blur = () => this.held.clear();
    this._mouse = () => { if (this.onFirstInput) this.onFirstInput(); };
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._blur);
    window.addEventListener('mousedown', this._mouse);
  }

  dispose() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._blur);
    window.removeEventListener('mousedown', this._mouse);
  }

  /** 로직 틱 시작 때 호출 — 그동안 모인 눌림을 이번 틱의 pressed 로 확정 */
  beginTick() {
    this.pressedNow = this.buffer;
    this.anyPressed = this.buffer.size > 0;
    this.buffer = new Set();
  }

  down(action) {
    const keys = BINDINGS[action];
    return !!keys && keys.some((k) => this.held.has(k));
  }

  pressed(action) {
    const keys = BINDINGS[action];
    return !!keys && keys.some((k) => this.pressedNow.has(k));
  }

  consume(action) {
    for (const k of BINDINGS[action] || []) this.pressedNow.delete(k);
  }
}
