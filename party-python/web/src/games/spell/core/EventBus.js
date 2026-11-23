// ============================================================
// 아주 작은 이벤트 버스 — 모듈 간 결합을 줄이고,
// 통합 게임(호스트)이 미니게임 이벤트를 구독할 수 있게 한다.
// ============================================================

export class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  /** 구독. 해제 함수를 돌려준다. */
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (e) => {
      off();
      fn(e);
    });
    return off;
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[EventBus] '${type}' 핸들러 오류`, err);
        }
      }
    }
    // '*' 구독자는 모든 이벤트를 받는다 (디버그/로깅/통합용)
    const any = this._handlers.get('*');
    if (any && type !== '*') {
      for (const fn of [...any]) {
        try {
          fn({ type, payload });
        } catch (err) {
          console.error(`[EventBus] '*' 핸들러 오류 (${type})`, err);
        }
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}
