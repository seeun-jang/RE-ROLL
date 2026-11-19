// ============================================================
// 공용 UI 위젯: 9-slice 상자, 픽셀 바, 버튼, 메뉴(키보드/마우스 겸용)
// ============================================================
import { C } from '../data/palette.js';

const SLICE = 3; // 9-slice 모서리 크기(px)

/** 9-slice 픽셀 테두리 상자 */
export function nineSlice(r, assets, x, y, w, h, variant = null) {
  const img = assets.frames('box', 'default', { variant })[0];
  if (!img) return;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const ctx = r.ctx;
  const s = SLICE, iw = img.width - s * 2, ih = img.height - s * 2;
  const cw = Math.max(0, w - s * 2), ch = Math.max(0, h - s * 2);
  // 모서리
  ctx.drawImage(img, 0, 0, s, s, x, y, s, s);
  ctx.drawImage(img, s + iw, 0, s, s, x + w - s, y, s, s);
  ctx.drawImage(img, 0, s + ih, s, s, x, y + h - s, s, s);
  ctx.drawImage(img, s + iw, s + ih, s, s, x + w - s, y + h - s, s, s);
  // 변 (한 방향으로만 늘리므로 픽셀이 뭉개지지 않는다)
  ctx.drawImage(img, s, 0, 1, s, x + s, y, cw, s);
  ctx.drawImage(img, s, s + ih, 1, s, x + s, y + h - s, cw, s);
  ctx.drawImage(img, 0, s, s, 1, x, y + s, s, ch);
  ctx.drawImage(img, s + iw, s, s, 1, x + w - s, y + s, s, ch);
  // 가운데
  ctx.drawImage(img, s, s, 1, 1, x + s, y + s, cw, ch);
}

/** 픽셀 게이지 바 (테두리 + 채움 + 윗줄 하이라이트) */
export function drawBar(r, x, y, w, h, ratio, { fill, back, border = C.ink, highlight = null, ghost = null, ghostRatio = 0 }) {
  ratio = Math.max(0, Math.min(1, ratio));
  r.rect(x, y, w, h, border);
  r.rect(x + 1, y + 1, w - 2, h - 2, back);
  const inner = w - 2;
  if (ghost && ghostRatio > ratio) r.rect(x + 1, y + 1, Math.round(inner * Math.min(1, ghostRatio)), h - 2, ghost);
  const fw = Math.round(inner * ratio);
  if (fw > 0) {
    r.rect(x + 1, y + 1, fw, h - 2, fill);
    if (highlight && h > 3) r.rect(x + 1, y + 1, fw, 1, highlight);
  }
}

export class Button {
  constructor({ x, y, w, h, label, onClick, size = 'm', enabled = true, sublabel = '' }) {
    Object.assign(this, { x, y, w, h, label, onClick, size, enabled, sublabel });
    this.hover = false;
    this.pressed = false;
    this.focused = false;
  }

  contains(p) {
    return p.x >= this.x && p.x < this.x + this.w && p.y >= this.y && p.y < this.y + this.h;
  }

  onPointerMove(p) {
    this.hover = this.contains(p);
    if (!this.hover) this.pressed = false;
  }

  onPointerDown(p) {
    if (this.enabled && this.contains(p)) {
      this.pressed = true;
      return true;
    }
    return false;
  }

  onPointerUp(p) {
    const fire = this.pressed && this.enabled && this.contains(p);
    this.pressed = false;
    if (fire) this.onClick?.();
    return fire;
  }

  render(r, game) {
    const hot = (this.hover || this.focused) && this.enabled;
    const off = this.pressed ? 1 : 0; // 눌림: 1px 아래로
    if (!this.pressed) r.rect(this.x + 1, this.y + this.h, this.w - 1, 1, C.ink); // 그림자
    nineSlice(r, game.assets, this.x, this.y + off, this.w, this.h, !this.enabled ? 'buttonOff' : hot ? 'buttonHot' : 'button');
    const color = this.enabled ? (hot ? C.ink : C.white) : C.steel;
    const ty = this.y + off + Math.floor((this.h - (this.sublabel ? 20 : 12)) / 2);
    game.text.draw(r.ctx, this.label, this.x + this.w / 2, ty, { size: this.size, color, align: 'center', shadow: this.enabled && !hot ? C.umber : null });
    if (this.sublabel) game.text.draw(r.ctx, this.sublabel, this.x + this.w / 2, ty + 11, { size: 's', color: this.enabled ? (hot ? C.brown : C.sand) : C.slate, align: 'center' });
  }
}

/** 버튼 묶음: 방향키/엔터와 마우스를 모두 지원 */
export class Menu {
  constructor(buttons = []) {
    this.buttons = buttons;
    this.index = buttons.findIndex((b) => b.enabled);
    this._sync();
  }

  _sync() {
    this.buttons.forEach((b, i) => (b.focused = i === this.index));
  }

  move(dir) {
    const n = this.buttons.length;
    if (!n) return;
    for (let k = 1; k <= n; k++) {
      const i = (this.index + dir * k + n * k) % n;
      if (this.buttons[i].enabled) { this.index = i; break; }
    }
    this._sync();
  }

  onKeyDown(e) {
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS') { this.move(1); return true; }
    if (e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'KeyW') { this.move(-1); return true; }
    if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
      this.buttons[this.index]?.onClick?.();
      return true;
    }
    return false;
  }

  onPointerMove(p) {
    this.buttons.forEach((b, i) => {
      b.onPointerMove(p);
      if (b.hover && b.enabled) this.index = i;
    });
    this._sync();
  }

  onPointerDown(p) {
    return this.buttons.some((b) => b.onPointerDown(p));
  }

  onPointerUp(p) {
    let hit = false;
    for (const b of this.buttons) if (b.onPointerUp(p)) hit = true;
    return hit;
  }

  render(r, game) {
    for (const b of this.buttons) b.render(r, game);
  }
}
