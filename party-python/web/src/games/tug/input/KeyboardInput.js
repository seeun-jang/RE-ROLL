// =============================================================
// KeyboardInput — 키보드 1대로 5명이 동시에 입력하기 위한 키 상태 관리
//
// - 키는 e.code(물리 키 위치) 기준이다. e.key 와 달리 한글 입력기(IME) 상태나
//   Shift/CapsLock 과 무관하게 같은 값이 나오므로 한/영 전환 상태여도 입력이 씹히지 않는다.
// - 각 키의 눌림 상태를 Set 으로 따로 관리 → 여러 명이 동시에 눌러도 서로 영향이 없다.
// - auto-repeat(e.repeat) 및 이미 눌린 키의 keydown 은 무시 → keyup 이 와야 다음 눌림을 받는다.
// - 참고: 저가 키보드의 '키 고스팅/롤오버 한계'(동시에 특정 조합의 키를 누르면 하드웨어가
//   신호를 아예 보내지 않는 현상)는 하드웨어 문제라 소프트웨어로는 고칠 수 없다.
//   기본 키 배치(Q/R/U/P/Space)는 서로 떨어져 있어 이 문제를 최대한 피하도록 고른 것이다.
// =============================================================

/** 현재 시각(ms, performance.now 기준). 모듈 최상위가 아니라 호출 시점에만 전역 접근 */
function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

/** 이벤트의 timeStamp 가 performance.now() 기준 ms 로 쓸 수 있는 값인지 확인 후 반환 */
function eventTime(e) {
  const now = nowMs();
  const ts = e && e.timeStamp;
  // 일부 오래된 브라우저는 timeStamp 를 epoch(ms) 로 주거나 0 을 준다 → 그때는 지금 시각으로 대체
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0 && ts <= now + 1000) return ts;
  return now;
}

/** 텍스트 입력란에 포커스가 있는지 (있으면 게임 입력으로 취급하지 않는다) */
function isEditableFocused(e) {
  const isEditable = (el) => {
    if (!el || typeof el !== 'object') return false;
    const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return el.isContentEditable === true;
  };
  if (e && isEditable(e.target)) return true;
  if (typeof document !== 'undefined' && document && isEditable(document.activeElement)) return true;
  return false;
}

/**
 * 페이지의 다른 조작 요소(버튼·링크·요약 등)에 포커스가 있는지.
 * 있으면 Enter/Space/Escape 는 그 요소의 몫이므로 게임 입력으로 쓰지 않고 기본 동작도 막지 않는다.
 */
function isInteractiveFocused(e) {
  const isInteractive = (el) => {
    if (!el || typeof el !== 'object') return false;
    const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
    if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'OPTION') return true;
    if (tag === 'A' || tag === 'AREA') {
      return typeof el.getAttribute === 'function' ? el.getAttribute('href') !== null : !!el.href;
    }
    const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
    return role === 'button' || role === 'link' || role === 'menuitem' || role === 'checkbox'
      || role === 'radio' || role === 'switch' || role === 'tab' || role === 'option';
  };
  if (e && isInteractive(e.target)) return true;
  if (typeof document !== 'undefined' && document && isInteractive(document.activeElement)) return true;
  return false;
}

export class KeyboardInput {
  /**
   * @param {EventTarget} target 리스너를 걸 대상 (기본 window)
   * @param {{ preventCodes?: string[], accept?: (e: KeyboardEvent) => boolean }} options
   *   preventCodes: preventDefault 할 키 코드 목록
   *   accept: (선택) 이 키 이벤트를 이 게임의 입력으로 받을지 정하는 함수. false 면 무시하고 기본 동작도 막지 않는다
   *           (한 페이지에 게임이 여러 개일 때 포커스가 있는 게임만 입력을 받게 하는 용도)
   */
  constructor(target = (typeof window !== 'undefined' ? window : null), { preventCodes = [], accept = null } = {}) {
    this.target = target;
    this.preventCodes = new Set(preventCodes || []);
    this.accept = typeof accept === 'function' ? accept : null;
    this.down = new Set();     // 현재 눌려있는 키 코드
    this.queue = [];           // 아직 스텝에 반영되지 않은 원시 눌림 이벤트
    this.current = [];         // 이번 고정 스텝의 눌림 이벤트
    this.disposed = false;

    // ---- 리스너 ----
    this._onKeyDown = (e) => {
      if (!e || typeof e.code !== 'string' || !e.code) return;
      // 입력란에 타이핑 중이거나 페이지의 버튼·링크에 포커스가 있으면 게임 입력으로 쓰지 않고 기본 동작도 막지 않는다
      if (!this._accepts(e)) return;
      if (this.preventCodes.has(e.code) && typeof e.preventDefault === 'function') e.preventDefault();
      // auto-repeat 또는 이미 눌린 키의 keydown 은 무시 (keyup 이 와야 다음 입력 인정)
      if (e.repeat || this.down.has(e.code)) return;
      this.down.add(e.code);
      this.queue.push({ code: e.code, timeStamp: eventTime(e) });
    };
    this._onKeyUp = (e) => {
      if (!e || typeof e.code !== 'string' || !e.code) return;
      // 눌림 해제는 입력란 포커스 여부와 상관없이 처리 (눌린 채로 굳는 것 방지)
      this.down.delete(e.code);
      if (!this._accepts(e)) return;
      if (this.preventCodes.has(e.code) && typeof e.preventDefault === 'function') e.preventDefault();
    };
    this._onBlur = () => {
      // 창 포커스를 잃으면 keyup 을 못 받을 수 있으므로 전부 해제
      this.releaseAll();
    };

    if (this.target && typeof this.target.addEventListener === 'function') {
      this.target.addEventListener('keydown', this._onKeyDown);
      this.target.addEventListener('keyup', this._onKeyUp);
      this.target.addEventListener('blur', this._onBlur);
    }
    // target 이 window 가 아니어도 창 blur 는 따로 감지한다
    this.blurTarget = (typeof window !== 'undefined' && window && window !== this.target) ? window : null;
    if (this.blurTarget && typeof this.blurTarget.addEventListener === 'function') {
      this.blurTarget.addEventListener('blur', this._onBlur);
    }
  }

  /** 이 키 이벤트를 게임 입력으로 받을지 (입력란·조작 요소 포커스, accept 콜백 검사) */
  _accepts(e) {
    if (isEditableFocused(e) || isInteractiveFocused(e)) return false;
    if (this.accept) {
      try {
        return this.accept(e) !== false;
      } catch (err) {
        return true; // 판단 실패 시에는 입력을 막지 않는다
      }
    }
    return true;
  }

  /** 고정 스텝 시작 시 호출: 큐 → 이번 스텝 이벤트 (이전 스텝 것은 버린다) */
  beginFrame() {
    this.current = this.queue;
    this.queue = [];
  }

  /** 이번 스텝에 해당 키 눌림이 있었나 (비소모성) */
  pressed(code) {
    for (let i = 0; i < this.current.length; i++) if (this.current[i].code === code) return true;
    return false;
  }

  /** 이번 스텝의 해당 키 눌림 이벤트 배열 [{ code, timeStamp }] (새 배열) */
  presses(code) {
    const out = [];
    for (let i = 0; i < this.current.length; i++) {
      const ev = this.current[i];
      if (ev.code === code) out.push({ code: ev.code, timeStamp: ev.timeStamp });
    }
    return out;
  }

  /** codes 중 하나라도 이번 스텝에 눌렸나 */
  anyPressed(codes) {
    if (!codes) return false;
    for (const c of codes) if (this.pressed(c)) return true;
    return false;
  }

  /** 현재 눌려있나 */
  isDown(code) {
    return this.down.has(code);
  }

  /** 모든 눌림 상태 해제 (blur 시 자동 호출) */
  releaseAll() {
    this.down.clear();
  }

  /** preventDefault 할 키 목록 교체 (플레이어 키 변경 시) */
  setPreventCodes(codes) {
    this.preventCodes = new Set(codes || []);
  }

  /** 리스너 해제. 여러 번 호출해도 안전 */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.target && typeof this.target.removeEventListener === 'function') {
      this.target.removeEventListener('keydown', this._onKeyDown);
      this.target.removeEventListener('keyup', this._onKeyUp);
      this.target.removeEventListener('blur', this._onBlur);
    }
    if (this.blurTarget && typeof this.blurTarget.removeEventListener === 'function') {
      this.blurTarget.removeEventListener('blur', this._onBlur);
    }
    this.down.clear();
    this.queue = [];
    this.current = [];
  }
}
