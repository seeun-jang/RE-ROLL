// =====================================================
// 입력 관리: 키보드 + 게임패드 (패드 N번 = 플레이어 N번)
// =====================================================
class Input {
  constructor(onFirstInput) {
    this.down = new Set();
    this.pressed = new Set();
    this.order = []; // 이번 프레임에 눌린 키 순서 (같은 프레임에 종을 동시에 쳐도 먼저 누른 사람이 이김)
    this.onFirstInput = onFirstInput;
    this.pads = [];
    this.prevPadSkill = [];

    const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Numpad8', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad2', 'Numpad0', 'Slash']);
    window.addEventListener('keydown', (e) => {
      if (block.has(e.code)) e.preventDefault();
      if (this.onFirstInput) this.onFirstInput();
      if (!this.down.has(e.code)) {
        this.pressed.add(e.code);
        this.order.push(e.code);
      }
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    // 창 포커스를 잃으면 눌린 키 초기화 (키가 계속 눌린 상태로 남는 버그 방지)
    window.addEventListener('blur', () => this.down.clear());
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

  // 매 프레임 시작 시 게임패드 상태 읽기
  pollPads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pads = [];
    for (let i = 0; i < 5; i++) {
      const p = list && list[i];
      if (!p) {
        this.pads.push(null);
        continue;
      }
      const ax = p.axes[0] || 0;
      const ay = p.axes[1] || 0;
      const btn = (n) => p.buttons[n] && p.buttons[n].pressed;
      const skill = btn(0) || btn(1) || btn(2) || btn(3);
      if (skill && !this.prevPadSkill[i] && this.onFirstInput) this.onFirstInput();
      this.pads.push({
        left: ax < -0.4 || btn(14),
        right: ax > 0.4 || btn(15),
        up: ay < -0.4 || btn(12),
        down: ay > 0.4 || btn(13),
        skill,
        skillPressed: skill && !this.prevPadSkill[i],
      });
      this.prevPadSkill[i] = skill;
    }
  }

  // 함께 모드: 플레이어 개인 키 (←→↑↓) + 개인 패드
  player(i) {
    const k = KEYMAP[i];
    const pad = this.pads[i];
    return {
      left: this.isDown(k.left) || (pad && pad.left),
      right: this.isDown(k.right) || (pad && pad.right),
      up: (k.up && this.isDown(k.up)) || (pad && pad.up),
      down: (k.down && this.isDown(k.down)) || (k.down2 && this.isDown(k.down2)) || (pad && pad.down),
      skillPressed: this.wasPressed(k.skill) || (pad && pad.skillPressed),
      skillHeld: this.isDown(k.skill) || (pad && pad.skill),
    };
  }

  // 한 명씩 모드: 공용 방향키/스페이스 + 본인 3키 + 본인 패드
  solo(i) {
    const k = KEYMAP[i];
    const pad = this.pads[i] || this.pads.find((p) => p);
    return {
      left: this.anyDown(SOLO_KEYS.left) || this.isDown(k.left) || (pad && pad.left),
      right: this.anyDown(SOLO_KEYS.right) || this.isDown(k.right) || (pad && pad.right),
      up: this.anyDown(SOLO_KEYS.up) || (k.up && this.isDown(k.up)) || (pad && pad.up),
      down: this.anyDown(SOLO_KEYS.down) || (k.down && this.isDown(k.down)) || (pad && pad.down),
      skillPressed: this.anyPressed(SOLO_KEYS.skill) || this.wasPressed(k.skill) || (pad && pad.skillPressed),
      skillHeld: this.anyDown(SOLO_KEYS.skill) || this.isDown(k.skill) || (pad && pad.skill),
    };
  }

  // 메뉴 확인 (Space / Enter / 패드 버튼)
  confirm() {
    return this.anyPressed(['Space', 'Enter']) || this.pads.some((p) => p && p.skillPressed);
  }

  menuLeft() {
    return this.anyPressed(['ArrowLeft', 'KeyA']);
  }

  menuRight() {
    return this.anyPressed(['ArrowRight', 'KeyD']);
  }

  // 이 키가 이번 프레임에 몇 번째로 눌렸나 (안 눌렸으면 Infinity)
  pressRank(codes) {
    let best = Infinity;
    for (const c of codes) {
      const i = this.order.indexOf(c);
      if (i >= 0 && i < best) best = i;
    }
    return best;
  }

  endFrame() {
    this.pressed.clear();
    this.order = [];
  }
}
