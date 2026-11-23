// ============================================================
//  마우스 / 터치 입력 — 왼쪽 버튼(또는 손가락)을 누른 채 드래그하면 칼이 된다
// ============================================================
import { VIEW } from '../config.js';

export class PointerInput {
  constructor(manager) {
    this.manager = manager;
    this.el = null;
    this.down = false;
    this.stroke = 0;
    this.pointerId = null;
    this.cursor = { x: VIEW.W / 2, y: VIEW.H / 2, visible: false, active: false, source: 'mouse' };
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onLeave = this.onLeave.bind(this);
    this.onContext = (e) => e.preventDefault();
  }

  attach(el) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('lostpointercapture', this.onUp);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('contextmenu', this.onContext);
  }

  detach() {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('lostpointercapture', this.onUp);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('contextmenu', this.onContext);
    this.el = null;
  }

  // 화면 좌표 → 논리 해상도(320×180) 좌표
  toLogical(e) {
    const r = this.el.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * VIEW.W,
      y: ((e.clientY - r.top) / r.height) * VIEW.H,
    };
  }

  emit(e) {
    const p = this.toLogical(e);
    this.cursor.x = p.x;
    this.cursor.y = p.y;
    if (this.down) {
      this.manager.push({ x: p.x, y: p.y, t: e.timeStamp / 1000, stroke: `m${this.stroke}`, source: 'mouse' });
    }
  }

  onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 좌클릭만
    e.preventDefault();
    this.manager.onUserGesture?.();
    this.down = true;
    this.stroke++;
    this.pointerId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* 일부 브라우저는 캡처 실패해도 무시 */
    }
    this.cursor.visible = true;
    this.cursor.active = true;
    this.emit(e);
  }

  onMove(e) {
    if (this.down && e.pointerId !== this.pointerId) return;
    this.cursor.visible = e.pointerType === 'mouse' || this.down;
    // 빠른 드래그는 한 프레임에 여러 이벤트가 합쳐지므로 전부 꺼내 쓴다
    const events = this.down && e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) this.emit(ev);
  }

  onUp(e) {
    if (e.pointerId !== this.pointerId) return;
    this.down = false;
    this.cursor.active = false;
    this.pointerId = null;
    if (e.pointerType !== 'mouse') this.cursor.visible = false;
  }

  onLeave(e) {
    if (!this.down && e.pointerType === 'mouse') this.cursor.visible = false;
  }
}
