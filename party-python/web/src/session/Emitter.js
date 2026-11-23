/** 아주 작은 이벤트 발행기. on() 은 구독 해제 함수를 돌려준다. */
export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    const set = this._handlers.get(type);
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(type, data) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[session] '${type}' 처리 중 오류`, err);
      }
    }
  }

  clear() {
    this._handlers.clear();
  }
}
