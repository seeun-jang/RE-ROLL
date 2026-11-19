// =============================================================
// 눌림 상태가 있는 픽셀 버튼.
// - 마우스/터치: 버튼 안에서 눌렀다가 버튼 안에서 떼면 클릭 (스텝당 최대 1회)
// - 단축키: keyboard.pressed(hotkey) 가 true 인 스텝에 클릭
// - 그리기: 평소엔 아래 2px 그림자, 눌리면 2px 아래로 내려가며 그림자가 사라짐, hover 면 테두리가 밝아짐
// =============================================================
import { PALETTE, C } from '../palette.js';

const PRESS_OFFSET = 2;        // 눌림 시 아래로 이동하는 px (= 평소 그림자 두께)
const KEY_FLASH_STEPS = 8;     // 클릭(특히 단축키) 후 눌림 모양을 보여줄 스텝 수

export class Button {
  constructor({ x = 0, y = 0, w = 64, h = 18, label = '', style = 'gold', size = 'l', hotkey = null } = {}) {
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.w = Math.round(w);
    this.h = Math.round(h);
    this.label = label;
    this.style = style;
    this.size = size;
    this.hotkey = hotkey;      // KeyboardEvent.code (또는 코드 배열)
    this.visible = true;
    this.enabled = true;
    this.hover = false;        // 포인터가 위에 있음
    this.pressed = false;      // 포인터로 누르고 있는 중 (버튼 위)
    this._armed = false;       // 버튼 안에서 pointerdown 이 시작됨
    this._flash = 0;           // 클릭 직후 눌림 표시 남은 스텝
  }

  /** 논리 좌표가 버튼 영역 안인가 */
  contains(px, py) {
    if (px === undefined || py === undefined || px === null || py === null) return false;
    return px >= this.x && px < this.x + this.w && py >= this.y && py < this.y + this.h;
  }

  /** 단축키 눌림 확인 (코드 하나 또는 배열) */
  _hotkeyPressed(keyboard) {
    if (!keyboard || !this.hotkey || typeof keyboard.pressed !== 'function') return false;
    const codes = Array.isArray(this.hotkey) ? this.hotkey : [this.hotkey];
    for (const code of codes) if (code && keyboard.pressed(code)) return true;
    return false;
  }

  /**
   * 고정 스텝마다 호출.
   * @returns true 면 이번 스텝에 클릭됨 (한 번의 클릭당 정확히 1회)
   */
  update(pointer, keyboard) {
    if (this._flash > 0) this._flash--;
    if (!this.visible || !this.enabled) {
      this.hover = false;
      this.pressed = false;
      this._armed = false;
      return false;
    }
    let clicked = false;
    if (pointer) {
      const over = pointer.inside !== false && this.contains(pointer.x, pointer.y);
      this.hover = over;
      // 눌림 시작이 버튼 안이어야 '무장' 된다
      const down = pointer.downThisFrame;
      if (down && this.contains(down.x, down.y)) this._armed = true;
      const up = pointer.clicked;
      if (up) {
        // 버튼 안에서 눌렀다가 버튼 안에서 뗐을 때만 클릭
        if (this._armed && this.contains(up.x, up.y)) clicked = true;
        this._armed = false;
      } else if (!pointer.isDown) {
        this._armed = false;
      }
      this.pressed = this._armed && !!pointer.isDown && over;
    } else {
      this.hover = false;
      this.pressed = false;
      this._armed = false;
    }
    // 단축키
    if (!clicked && this._hotkeyPressed(keyboard)) clicked = true;
    if (clicked) this._flash = KEY_FLASH_STEPS;
    return clicked;
  }

  /** 버튼 그리기 */
  render(g, ui) {
    if (!this.visible) return;
    const down = this.pressed || this._flash > 0;
    const off = down ? PRESS_OFFSET : 0;
    const { x, y, w, h } = this;
    const style = this.enabled ? this.style : 'dark';
    const colors = ui.styleColors(style);

    // 바닥 그림자 (안 눌렸을 때만 2px)
    if (!down) {
      g.fillStyle = PALETTE[C.INK];
      g.fillRect(x + 1, y + h, w - 2, PRESS_OFFSET);
    }
    ui.box(g, x, y + off, w, h, style);

    // hover: 테두리 안쪽 1px 링을 밝게
    if (this.hover && this.enabled && !down && w > 4 && h > 4) {
      const by = y + off;
      g.fillStyle = PALETTE[C.WHITE];
      g.fillRect(x + 1, by + 1, w - 2, 1);
      g.fillRect(x + 1, by + h - 2, w - 2, 1);
      g.fillRect(x + 1, by + 1, 1, h - 2);
      g.fillRect(x + w - 2, by + 1, 1, h - 2);
    }

    // 라벨 (가운데)
    const lh = ui.lineHeight(this.size);
    const color = this.enabled ? colors.text : PALETTE[C.SLATE];
    ui.text(g, this.label, x + Math.floor(w / 2), y + off + Math.floor((h - lh) / 2), {
      size: this.size,
      color,
      align: 'center',
      shadow: this.enabled ? colors.textShadow : null,
    });
  }
}
