// ============================================================
// 하단 주문서 패널
//  - 윗줄: 입력 상태 아이콘(키보드/마이크), 5칸 볼륨(위력) 미터, 상태 문구, 일시정지 버튼
//  - 아랫줄: 주문 6칸 (키, 속성 아이콘, 이름, 마나, 쿨다운) — 마우스로 눌러도 시전
// ============================================================
import { CONFIG } from '../config.js';
import { C, ELEMENT_COLORS } from '../data/palette.js';
import { ELEMENTS } from '../data/elements.js';
import { nineSlice } from './Widgets.js';

const Y = CONFIG.LAYOUT.PANEL_Y;
const SLOT_W = 50, SLOT_H = 32, SLOT_GAP = 2, SLOT_X = 5, SLOT_Y = Y + 15;
const METER_COLORS = [C.green, C.green, C.yellow, C.gold, C.red];

export class SpellPanel {
  constructor(game, { onSlot }) {
    this.game = game;
    this.onSlot = onSlot;
    this.pressedSlot = -1;
    this.hoverSlot = -1;
    this.flashSlot = { index: -1, time: 0, ok: true };
    this.time = 0;
  }

  slotRect(i) {
    return { x: SLOT_X + i * (SLOT_W + SLOT_GAP), y: SLOT_Y, w: SLOT_W, h: SLOT_H };
  }

  _slotAt(p, n) {
    for (let i = 0; i < n; i++) {
      const s = this.slotRect(i);
      if (p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h) return i;
    }
    return -1;
  }

  /** 시전 성공/실패 시 해당 칸을 잠깐 반짝 */
  flash(spellIndex, ok) {
    this.flashSlot = { index: spellIndex, time: 0.25, ok };
  }

  update(dt) {
    this.time += dt;
    if (this.flashSlot.time > 0) this.flashSlot.time -= dt;
  }

  onPointerMove(p, spells) {
    this.hoverSlot = this._slotAt(p, spells.length);
  }

  onPointerDown(p, spells) {
    this.pressedSlot = this._slotAt(p, spells.length);
    return this.pressedSlot >= 0;
  }

  onPointerUp(p, spells) {
    const i = this._slotAt(p, spells.length);
    const hit = i >= 0 && i === this.pressedSlot;
    this.pressedSlot = -1;
    if (hit) this.onSlot?.(spells[i]);
    return hit;
  }

  /**
   * @param state.hub        InputHub (레벨/듣는 중/상태)
   * @param state.spellBook  플레이어 주문서
   * @param state.mana       현재 마나
   * @param state.chargingId 지금 차지 중인 주문 ID
   * @param state.locked     입력 잠금 여부
   */
  render(r, { hub, spellBook, mana, chargingId = null, locked = false, hint = null }) {
    const { assets, text } = this.game;
    const ctx = r.ctx;
    nineSlice(r, assets, 0, Y, 320, 180 - Y, 'dark');

    // ---------- 입력 상태 줄 ----------
    const listening = hub.listening;
    const kb = assets.frames('icon_keyboard', 'default')[0];
    r.sprite(kb, 6, Y + 5, { anchorX: 0, anchorY: 0 });
    // 마이크 아이콘: 마이크가 켜져 있으면 켜짐 표시
    const voice = hub.statuses.voice;
    const micVariant = voice?.status === 'listening' ? 'on' : 'off';
    r.sprite(assets.frames('icon_mic', 'default', { variant: micVariant })[0], 20, Y + 3, { anchorX: 0, anchorY: 0 });
    if (locked) r.sprite(assets.frames('icon_lock', 'default')[0], 24, Y + 6, { anchorX: 0, anchorY: 0 });

    // 5칸 볼륨 미터 (마이크에 소리가 들어오는지 보여 준다. 위력과는 무관)
    const level = hub.level;
    const lit = level > 0 ? Math.max(1, Math.ceil(level * 5 - 0.001)) : 0;
    for (let i = 0; i < 5; i++) {
      const h = 3 + i * 2;
      const x = 32 + i * 5;
      const y = Y + 13 - h;
      r.rect(x, y, 4, h, C.ink);
      r.rect(x + 1, y + 1, 2, h - 1, i < lit ? METER_COLORS[i] : C.dusk);
    }
    let status;
    if (locked) status = ['침묵! 주문을 쓸 수 없다', C.steel];
    else if (listening) status = ['듣는 중…', C.green];
    else status = [hint || '주문을 외치세요! (또는 1~6 키)', C.silver];
    text.draw(ctx, status[0], 62, Y + 3, { size: 's', color: status[1] });

    // ---------- 주문 칸 ----------
    spellBook.spells.forEach((spell, i) => {
      const s = this.slotRect(i);
      const cd = spellBook.cooldownLeft(spell.id);
      const noMana = mana < spell.mana;
      const charging = chargingId === spell.id;
      const pressed = this.pressedSlot === i;
      const oy = pressed ? 1 : 0;
      // 상태별 칸 스타일: 강조(차지/마우스 올림) · 사용 가능 · 사용 불가(마나 부족/쿨다운)
      const usable = !noMana && cd <= 0;
      const hot = charging || (usable && this.hoverSlot === i);
      const variant = hot ? 'buttonHot' : usable ? null : 'buttonOff';
      const ink = hot
        ? { key: C.brown, name: C.ink, mp: C.brown }
        : usable
          ? { key: C.gold, name: C.white, mp: C.cyan }
          : { key: C.slate, name: C.steel, mp: C.slate };
      nineSlice(r, assets, s.x, s.y + oy, s.w, s.h, variant);
      const cols = ELEMENT_COLORS[spell.element];
      // 속성 색 띠
      r.rect(s.x + 3, s.y + s.h - 5 + oy, s.w - 6, 2, usable || hot ? cols[1] : cols[0]);
      // 키
      text.draw(ctx, spell.key, s.x + 4, s.y + 3 + oy, { size: 's', color: ink.key });
      // 아이콘
      const icon = assets.frames(ELEMENTS[spell.element].icon, 'default')[0];
      r.sprite(icon, s.x + s.w - 12, s.y + 3 + oy, { anchorX: 0, anchorY: 0 });
      // 이름
      text.draw(ctx, spell.short || spell.name, s.x + s.w / 2, s.y + 12 + oy, { size: 's', color: ink.name, align: 'center' });
      // 마나
      text.draw(ctx, `MP${spell.mana}`, s.x + 4, s.y + 20 + oy, { size: 's', color: noMana ? C.red : ink.mp });
      // 쿨다운: 위에서부터 어둡게 덮고 남은 초 표시
      if (cd > 0) {
        const ratio = spellBook.cooldownRatio(spell);
        const ch = Math.round((s.h - 4) * ratio);
        r.dither(s.x + 2, s.y + 2 + oy, s.w - 4, ch, C.ink, 0.6);
        text.draw(ctx, cd.toFixed(1), s.x + s.w - 4, s.y + 20 + oy, { size: 's', color: C.white, align: 'right', outline: C.ink });
      }
      // 차지 중 테두리 깜빡임
      if (charging && Math.floor(this.time * 10) % 2 === 0) r.strokeRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2, C.yellow);
      if (this.flashSlot.index === i && this.flashSlot.time > 0) r.strokeRect(s.x - 1, s.y - 1 + oy, s.w + 2, s.h + 2, this.flashSlot.ok ? C.white : C.red);
    });
  }
}
