// =====================================================
// 입력 관리: 키보드 + 게임패드
//  - 리듬게임은 '언제 눌렀는지'가 중요하므로
//    키를 누르고 뗀 정확한 시각(타임스탬프)을 이벤트로 모아 둠
//  - 게임패드 N번 = 플레이어 N번 (왼쪽/가운데/오른쪽 = 패드 코드 'PadN:0~2')
// =====================================================
class Input {
  constructor(onFirstInput) {
    this.down = new Set();
    this.pressed = new Set();
    this.events = []; // { code, t(performance ms), down(true/false) }
    this.onFirstInput = onFirstInput;
    this.padState = [];

    const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    window.addEventListener('keydown', (e) => {
      if (block.has(e.code)) e.preventDefault();
      if (this.onFirstInput) this.onFirstInput();
      if (e.repeat || this.down.has(e.code)) return; // 꾹 누를 때 자동 반복은 무시
      this.pressed.add(e.code);
      this.down.add(e.code);
      this.events.push({ code: e.code, t: this.stamp(e), down: true });
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.events.push({ code: e.code, t: this.stamp(e), down: false });
    });
    // 창 포커스를 잃으면 눌린 키 초기화 (키가 계속 눌린 상태로 남는 버그 방지)
    window.addEventListener('blur', () => {
      const t = performance.now();
      for (const code of this.down) this.events.push({ code, t, down: false });
      this.down.clear();
    });
  }

  // 이벤트 발생 시각 (performance.now 기준 ms)
  stamp(e) {
    const t = e.timeStamp;
    // 아주 오래된 브라우저는 timeStamp 가 epoch 기준 → 현재 시각 사용
    return t > 0 && t <= performance.now() + 5 ? t : performance.now();
  }

  isDown(code) {
    return this.down.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  anyDown(codes) {
    return codes.some((c) => this.down.has(c));
  }

  anyPressed(codes) {
    return codes.some((c) => this.pressed.has(c));
  }

  // 이번 프레임까지 쌓인 입력 이벤트를 꺼냄 (꺼내면 비워짐)
  takeEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  // 매 프레임: 게임패드 버튼을 키 이벤트처럼 변환
  //  왼쪽 = 십자키← / 스틱← / X,  가운데 = 십자키↑ / A / Y,  오른쪽 = 십자키→ / 스틱→ / B
  pollPads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const t = performance.now();
    for (let i = 0; i < 5; i++) {
      const p = list && list[i];
      const prev = this.padState[i] || [false, false, false];
      let cur = [false, false, false];
      if (p) {
        const ax = p.axes[0] || 0;
        const btn = (n) => !!(p.buttons[n] && p.buttons[n].pressed);
        cur = [ax < -0.5 || btn(14) || btn(2), btn(12) || btn(0) || btn(3), ax > 0.5 || btn(15) || btn(1)];
      }
      for (let l = 0; l < 3; l++) {
        if (cur[l] === prev[l]) continue;
        const code = `Pad${i}:${l}`;
        if (cur[l]) {
          if (this.onFirstInput) this.onFirstInput();
          this.down.add(code);
          this.pressed.add(code);
        } else this.down.delete(code);
        this.events.push({ code, t, down: cur[l] });
      }
      this.padState[i] = cur;
    }
  }

  anyPad(lane) {
    for (let i = 0; i < 5; i++) if (this.pressed.has(`Pad${i}:${lane}`)) return true;
    return false;
  }

  // 메뉴 확인 (Space / Enter / 패드 가운데 버튼)
  confirm() {
    return this.anyPressed(['Space', 'Enter']) || this.anyPad(1);
  }

  menuLeft() {
    return this.anyPressed(['ArrowLeft', 'KeyA']) || this.anyPad(0);
  }

  menuRight() {
    return this.anyPressed(['ArrowRight', 'KeyD']) || this.anyPad(2);
  }

  endFrame() {
    this.pressed.clear();
    // 씬이 이번 프레임에 안 가져간 이벤트는 버림 (메뉴 화면 등)
    // (키 이벤트는 프레임 사이에만 들어오므로 놓치는 입력 없음)
    this.events = [];
  }
}
