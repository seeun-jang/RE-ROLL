// =====================================================
// 중계 그래픽 UI: 스코어 박스 · 구속판 · LED 전광판 숫자 · 공 아이콘 · 하단 자막
//  모두 픽셀 단위 사각형으로 그림 (번지지 않음)
// =====================================================

// ---- 7세그먼트 LED 숫자 (전광판) ----
//  세그먼트: a 위 · b 오른위 · c 오른아래 · d 아래 · e 왼아래 · f 왼위 · g 가운데
const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd',
  6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '',
};
function drawLedDigit(ctx, x, y, ch, w, h, on, off) {
  const t = w >= 7 ? 2 : 1; // 획 두께
  const mid = Math.floor((h - t) / 2);
  const segs = {
    a: [x + t, y, w - 2 * t, t],
    d: [x + t, y + h - t, w - 2 * t, t],
    g: [x + t, y + mid, w - 2 * t, t],
    f: [x, y + t, t, mid - t],
    b: [x + w - t, y + t, t, mid - t],
    e: [x, y + mid + t, t, h - mid - 2 * t],
    c: [x + w - t, y + mid + t, t, h - mid - 2 * t],
  };
  const lit = SEG[ch] || '';
  for (const k in segs) {
    const isOn = lit.includes(k);
    if (!isOn && !off) continue;
    ctx.fillStyle = C(isOn ? on : off);
    const [a, b, c, d] = segs[k];
    ctx.fillRect(a, b, c, d);
  }
}
// 숫자 문자열 (오른쪽 정렬 · 빈칸은 꺼진 8)
function drawLed(ctx, xRight, y, str, digits, w, h, on = '9', off = '2') {
  const s = String(str).padStart(digits, ' ').slice(-digits);
  const gap = w >= 7 ? 2 : 1;
  for (let i = 0; i < digits; i++) {
    const x = xRight - (digits - i) * (w + gap) + gap;
    drawLedDigit(ctx, x, y, s[i], w, h, on, off);
  }
  return digits * (w + gap) - gap;
}

// ---- 중계 패널: 어두운 판 + 위 반짝 줄 + 왼쪽 색 띠 ----
function drawBroadcastPanel(ctx, x, y, w, h, accent = '6', base = '1') {
  ctx.fillStyle = C('o');
  ctx.fillRect(x, y + 1, w + 1, h); // 그림자
  ctx.fillStyle = C(base);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C('2');
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillStyle = C('3');
  ctx.fillRect(x, y, w, 1);
  if (accent) {
    ctx.fillStyle = C(accent);
    ctx.fillRect(x, y, 3, h);
    ctx.fillStyle = C(DARK_OF[accent] || '7');
    ctx.fillRect(x + 2, y, 1, h);
  }
}

// 모서리를 깎은 띠 (자막 바)
function drawTag(ctx, x, y, w, h, fill, text, color = '1', font = 's') {
  ctx.fillStyle = C(fill);
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = C('w');
  ctx.fillRect(x + 2, y, w - 4, 1);
  KText.draw(ctx, text, x + w / 2, y + Math.round((h - 13) / 2), C(color), { align: 'center', font });
}

// ---- 야구공 아이콘 (5x5): state 'left' 남음 · 'used' 씀 · 'gold' 잭팟 ----
function drawBallIcon(ctx, x, y, state) {
  const body = state === 'used' ? '2' : state === 'gold' ? '9' : 'b';
  const edge = state === 'used' ? '1' : '1';
  ctx.fillStyle = C(edge);
  ctx.fillRect(x + 1, y, 5, 7);
  ctx.fillRect(x, y + 1, 7, 5);
  ctx.fillStyle = C(body);
  ctx.fillRect(x + 1, y + 1, 5, 5);
  if (state !== 'used') {
    ctx.fillStyle = C(state === 'gold' ? '8' : '6');
    ctx.fillRect(x + 1, y + 2, 1, 3);
    ctx.fillRect(x + 5, y + 2, 1, 3);
    ctx.fillStyle = C(state === 'gold' ? 't' : 'w');
    ctx.fillRect(x + 2, y + 1, 2, 1);
  }
}

// 구종별 색
const PITCH_COLOR = { fast: '6', slider: 'g', curve: 'd', change: '3' };

// ---- 방사형 빛줄기 (홈런 배경) ----
function drawRays(ctx, cx, cy, r, frame, c1, c2) {
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + frame / 60;
    const a1 = a0 + Math.PI / n;
    ctx.fillStyle = C(i % 2 ? c1 : c2);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    ctx.closePath();
    ctx.fill();
  }
}

// ---- 엠블럼: 야구공 + 엇갈린 방망이 ----
function drawEmblem(ctx, cx, cy, frame = 0) {
  for (const s of [-1, 1]) {
    drawPixelLine(ctx, cx - 13 * s, cy + 12, cx + 11 * s, cy - 12, C('1'), 5);
    drawPixelLine(ctx, cx - 13 * s, cy + 12, cx + 11 * s, cy - 12, C('m'), 3);
    drawPixelLine(ctx, cx - 13 * s, cy + 12, cx - 7 * s, cy + 6, C('l'), 3);
  }
  const r = 8;
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.round(Math.sqrt(r * r - dy * dy));
    ctx.fillStyle = C('1');
    ctx.fillRect(cx - hw - 1, cy + dy, hw * 2 + 3, 1);
  }
  for (let dy = -r + 1; dy <= r - 1; dy++) {
    const hw = Math.round(Math.sqrt((r - 1) * (r - 1) - dy * dy));
    ctx.fillStyle = C(dy < -3 ? 'w' : 'b');
    ctx.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
  // 실밥 (곡선 두 줄)
  for (let dy = -5; dy <= 5; dy += 2) {
    const off = Math.round(3 + (dy * dy) / 12);
    ctx.fillStyle = C('6');
    ctx.fillRect(cx - off, cy + dy, 1, 1);
    ctx.fillRect(cx + off, cy + dy, 1, 1);
  }
  if (frame % 60 < 6) {
    ctx.fillStyle = C('b');
    ctx.fillRect(cx - 4, cy - 6, 2, 2);
  }
}

// ---- 숫자 + 단위 (오른쪽 정렬): 숫자는 굵게 + 외곽선, 단위는 작게 그 뒤에 → 절대 안 겹침 ----
//  font: 숫자 글꼴 ('b' 보통 · 'L' 크게)
function drawValue(ctx, xRight, y, num, unit, col = '9', font = 'b', unitCol = 'k') {
  const ns = String(num);
  const uw = unit ? KText.width(unit, 'n') + 2 : 0;
  const nw = KText.width(ns, font);
  const big = font === 'L';
  if (unit) KText.draw(ctx, unit, xRight - uw + 2, y + (big ? 6 : 2), C(unitCol), { font: 'n', outline: C('1') });
  KText.draw(ctx, ns, xRight - uw - nw, y, C(col), { font, outline: C('1') });
  return uw + nw;
}
