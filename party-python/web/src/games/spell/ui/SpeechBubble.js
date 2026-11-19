// ============================================================
// 말풍선: 인식된 주문을 캐릭터 머리 위에 표시
//  - 성공: 초록 테두리 + 주문 이름
//  - 실패: 회색 "???"  (디버그 모드면 원문도 함께)
//  - 정보: 마나 부족 / 쿨다운 등
// ============================================================
import { C } from '../data/palette.js';
import { nineSlice } from './Widgets.js';

export class SpeechBubble {
  constructor(game) {
    this.game = game;
    this.text = '';
    this.kind = 'success';
    this.time = 0;
    this.duration = 0;
    this.sub = '';
  }

  show(text, kind = 'success', { duration = 1.2, sub = '' } = {}) {
    this.text = text;
    this.kind = kind;
    this.sub = sub;
    this.time = 0;
    this.duration = duration;
  }

  hide() {
    this.duration = 0;
  }

  get visible() {
    return this.time < this.duration && !!this.text;
  }

  update(dt) {
    this.time += dt;
  }

  /** (ax, ay) = 말풍선 꼬리 끝 위치 */
  render(r, ax, ay) {
    if (!this.visible) return;
    const { text, assets } = this.game;
    const size = 'm';
    const tw = text.measure(this.text, size);
    const sw = this.sub ? text.measure(this.sub, 's') : 0;
    const w = Math.max(tw, sw) + 12;
    const h = this.sub ? 26 : 17;
    // 등장할 때 살짝 튀어오르는 연출 (정수 픽셀)
    const pop = this.time < 0.08 ? 2 : this.time < 0.16 ? -1 : 0;
    const x = Math.round(Math.max(2, Math.min(318 - w, ax - 10)));
    const y = Math.round(ay - h - 4 + pop);
    const variant = this.kind === 'success' ? 'success' : this.kind === 'fail' ? 'fail' : 'paper';
    // 꼬리
    const tailX = Math.round(ax);
    const tailCol = this.kind === 'success' ? C.green : this.kind === 'fail' ? C.silver : C.white;
    nineSlice(r, assets, x, y, w, h, variant);
    r.rect(tailX - 2, y + h - 1, 5, 1, C.white);
    r.rect(tailX - 1, y + h, 3, 1, tailCol);
    r.rect(tailX, y + h + 1, 1, 2, C.ink);
    r.rect(tailX - 2, y + h - 1, 1, 2, C.ink);
    r.rect(tailX + 2, y + h - 1, 1, 2, C.ink);
    r.rect(tailX - 1, y + h + 1, 1, 1, C.ink);
    r.rect(tailX + 1, y + h + 1, 1, 1, C.ink);
    const color = this.kind === 'success' ? C.forest : this.kind === 'fail' ? C.slate : C.brown;
    text.draw(r.ctx, this.text, x + w / 2, y + 3, { size, color, align: 'center' });
    if (this.sub) text.draw(r.ctx, this.sub, x + w / 2, y + 14, { size: 's', color: C.steel, align: 'center' });
  }
}
