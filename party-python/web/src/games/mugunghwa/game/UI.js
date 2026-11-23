// ============================================================
// UI.js — HUD, 9-slice 상자, 말풍선, 버튼
// ============================================================

import { TRACK, KEY_LABELS, RULES } from '../config.js';
import { C } from '../assets/palette.js';
import { rect, nineSlice, sprite } from '../engine/Draw.js';

export class UI {
  constructor(assets, text) {
    this.assets = assets;
    this.text = text;
  }

  box(ctx, style, x, y, w, h) {
    nineSlice(ctx, this.assets.get(`box.${style}`), x, y, w, h);
  }

  // ------------------------------------------------------------
  // 상단 문구 상자: "무 궁 화 꽃 이 피 었 습 니 다" 가 한 글자씩
  // ------------------------------------------------------------
  phraseBox(ctx, tagger, time) {
    const facing = tagger.isFacing();
    const x = 66, y = 2, w = 188, h = 24;
    let shakeX = 0;
    if (tagger.phase === 'fake') shakeX = Math.floor(time * 30) % 2 ? 1 : -1;
    this.box(ctx, facing ? 'alert' : 'paper', x + shakeX, y, w, h);
    const phrase = tagger.phrase;
    const step = 17;
    const startX = x + w / 2 - ((phrase.length - 1) * step) / 2;
    const shown = facing ? phrase.length : tagger.shown;
    for (let i = 0; i < phrase.length; i++) {
      const cx = Math.round(startX + i * step) + shakeX;
      if (i < shown) {
        const isNew = i === tagger.shown - 1 && tagger.popT > 0 && !facing;
        const color = facing ? C.yellow : (i === tagger.shown - 1 ? C.red : C.ink);
        this.text.draw(ctx, phrase[i], cx, y + 5 - (isNew ? 2 : 0), {
          font: 'big', color, outline: facing ? C.ink : null, align: 'center',
        });
      } else {
        rect(ctx, cx - 1, y + 12, 2, 2, facing ? C.red : C.silver); // 아직 안 나온 글자 자리
      }
    }
  }

  // ------------------------------------------------------------
  // 왼쪽 패널: 플레이어별 진행도 바
  // ------------------------------------------------------------
  progressPanel(ctx, players) {
    const x = 2, y = 62, w = 72, rowH = 16;
    const h = 14 + players.length * rowH;
    this.box(ctx, 'panel', x, y, w, h);
    this.text.draw(ctx, '진행도', x + w / 2, y + 3, { font: 'small', color: C.yellow, align: 'center' });
    players.forEach((p, i) => {
      const ry = y + 15 + i * rowH;
      // 이름표
      rect(ctx, x + 5, ry, 15, 9, C.ink);
      rect(ctx, x + 6, ry + 1, 13, 7, p.alive ? p.color : C.slate);
      this.text.draw(ctx, p.name, x + 13, ry + 1, { font: 'tiny', color: p.alive ? p.labelText : C.silver, align: 'center' });
      // 진행 막대
      const bx = x + 23, bw = 44;
      rect(ctx, bx, ry + 2, bw, 5, C.ink);
      const fill = Math.round((bw - 2) * p.progress);
      if (fill > 0) {
        rect(ctx, bx + 1, ry + 3, fill, 3, p.alive ? p.color : C.slate);
        rect(ctx, bx + 1, ry + 3, fill, 1, p.alive ? C.white : C.silver);
      }
      // 상태 글자
      let status = `${p.dist.toFixed(1)}m`, col = C.silver;
      if (p.finished) { status = `${p.finishRank}등 도착!`; col = C.yellow; }
      else if (!p.alive) { status = '탈락'; col = C.red; }
      this.text.draw(ctx, status, bx, ry + 7, { font: 'tiny', color: col });
    });
  }

  // ------------------------------------------------------------
  // 오른쪽 패널: 남은 시간 + 술래 눈
  // ------------------------------------------------------------
  timerPanel(ctx, timeLeft, tagger, time) {
    const x = 246, y = 62, w = 72, h = 74;
    const low = timeLeft <= 10;
    this.box(ctx, low ? 'alert' : 'panel', x, y, w, h);
    this.text.draw(ctx, '남은 시간', x + w / 2, y + 3, { font: 'small', color: C.yellow, align: 'center' });
    const sec = Math.max(0, Math.ceil(timeLeft));
    const blink = low && Math.floor(time * 4) % 2 === 0;
    this.text.draw(ctx, String(sec), x + w / 2, y + 15, { font: 'big', color: blink ? C.red : C.white, outline: C.ink, align: 'center' });
    // 시간 막대
    const bw = w - 12;
    rect(ctx, x + 6, y + 33, bw, 4, C.ink);
    rect(ctx, x + 7, y + 34, Math.round((bw - 2) * Math.max(0, timeLeft) / RULES.TIME_LIMIT), 2, low ? C.red : C.lime);
    // 술래 상태
    const facing = tagger.isFacing();
    sprite(ctx, this.assets.get(facing ? 'icon.eyeOpen' : 'icon.eyeClosed'), x + w / 2 - 5, y + 42);
    const label = facing ? '보는 중!' : (tagger.phase === 'fake' ? '…?' : '뒤돌아 있음');
    this.text.draw(ctx, label, x + w / 2, y + 54, { font: 'small', color: facing ? C.red : C.silver, align: 'center' });
  }

  // 출발선 아래 키 캡 (누르면 눌림 표현)
  keyCaps(ctx, players, stage, input) {
    for (const p of players) {
      const cx = stage.laneX(p.lane, 0, p.laneCount);
      const held = input.isDown(p.key);
      const label = KEY_LABELS[p.key] || p.key.replace('Key', '');
      const w = 14, h = 10;
      const x = cx - 7, y = TRACK.START_Y + 4 + (held ? 1 : 0); // 눌리면 1px 아래로
      rect(ctx, x, y, w, h, C.ink);
      rect(ctx, x + 1, y + 1, w - 2, h - (held ? 2 : 3), held ? p.color : C.silver);
      if (!held) rect(ctx, x + 1, y + h - 2, w - 2, 1, C.slate);
      this.text.draw(ctx, label, cx, y + 1, { font: 'tiny', color: held ? p.labelText : C.ink, align: 'center' });
    }
  }

  // ------------------------------------------------------------
  // 말풍선 (꼬리가 아래를 가리킴). x,y = 꼬리 끝
  // ------------------------------------------------------------
  bubble(ctx, text, x, y, { color = C.white, textColor = C.ink, font = 'small' } = {}) {
    const tw = this.text.measure(text, font);
    const w = tw + 8, h = font === 'tiny' ? 11 : 13;
    let bx = Math.round(x - w / 2);
    bx = Math.max(1, Math.min(319 - w, bx));
    const by = y - h - 3;
    rect(ctx, bx + 1, by, w - 2, h, C.ink);
    rect(ctx, bx, by + 1, w, h - 2, C.ink);
    rect(ctx, bx + 1, by + 1, w - 2, h - 2, color);
    // 꼬리
    rect(ctx, x - 2, by + h - 1, 5, 1, C.ink);
    rect(ctx, x - 1, by + h - 1, 3, 1, color);
    rect(ctx, x - 1, by + h, 3, 1, C.ink);
    rect(ctx, x, by + h, 1, 1, color);
    rect(ctx, x, by + h + 1, 1, 1, C.ink);
    this.text.draw(ctx, text, bx + w / 2, by + 2, { font, color: textColor, align: 'center' });
  }

  // 화면 가운데 큰 알림
  banner(ctx, title, sub = null, style = 'gold') {
    const w = 170, h = sub ? 42 : 30;
    const x = 160 - w / 2, y = 70;
    this.box(ctx, style, x, y, w, h);
    this.text.draw(ctx, title, 160, y + 7, { font: 'big', color: C.yellow, outline: C.ink, align: 'center' });
    if (sub) this.text.draw(ctx, sub, 160, y + 26, { font: 'small', color: C.white, align: 'center' });
  }
}

// ------------------------------------------------------------
// 버튼: 마우스 클릭 또는 Enter/Space 로 누름. 눌리면 2px 아래로 이동
// ------------------------------------------------------------
export class Button {
  constructor(label, x, y, w = 80, h = 20) {
    this.label = label;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.hover = false;
    this.pressT = 0;
    this.focused = false;
  }

  contains(mx, my) {
    return mx >= this.x && mx < this.x + this.w && my >= this.y && my < this.y + this.h;
  }

  // 반환: 이번 프레임에 클릭 완료되었는지
  update(dt, input, keyActivate = false) {
    const m = input.mouse;
    this.hover = m.inside && this.contains(m.x, m.y);
    if (this.pressT > 0) {
      this.pressT -= dt;
      if (this.pressT <= 0) return true; // 눌림 모션이 끝난 뒤 실행
      return false;
    }
    if ((m.clicked && this.hover) || keyActivate) this.pressT = 0.12;
    return false;
  }

  render(ctx, ui, input, time = 0) {
    const down = this.pressT > 0 || (this.hover && input.mouse.down);
    const hot = this.hover || this.focused;
    const oy = down ? 2 : 0;
    // 아래 그림자 (눌리면 사라짐)
    if (!down) rect(ctx, this.x + 2, this.y + this.h - 1, this.w - 4, 2, C.ink);
    ui.box(ctx, hot ? 'buttonHot' : 'button', this.x, this.y + oy, this.w, this.h);
    const pulse = this.focused && !down && Math.floor(time * 3) % 2 ? 1 : 0;
    ui.text.draw(ctx, this.label, this.x + this.w / 2, this.y + oy + Math.floor(this.h / 2) - 6 - pulse, {
      font: 'main', color: C.ink, align: 'center',
    });
  }
}
