// 레벨 미터(10칸 세그먼트, 칸 단위 3색)와 픽셀 바. 그라데이션 없음, 정수 좌표.
import { rect, dither } from '../engine/draw.js';
import { C } from '../palette.js';
import { METER } from '../config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// 미터 몸체 크기(1px 바탕 테두리 포함). threshDb 표시가 있으면 표시 2px이 더해진다.
export function meterSize(opts = {}) {
  const len = METER.cells * METER.cellW + (METER.cells - 1) * METER.gap;
  const thick = METER.cellH;
  let w = opts.vertical ? thick + 2 : len + 2;
  let h = opts.vertical ? len + 2 : thick + 2;
  if (opts.threshDb != null && Number.isFinite(opts.threshDb)) {
    if (opts.vertical) w += 2; else h += 2;
  }
  return { w, h };
}

// db(dBFS)를 칸 수로 바꿔 그린다. 칸 색은 칸의 아래 경계 dB로 정한다:
// okDb 미만 = 작음(C.meterLow), hotDb 이상 = 과입력(C.meterHot), 그 사이 = 적정(C.meterOk), 꺼진 칸 = C.meterOff.
// 가로: 왼쪽→오른쪽, 세로: 아래→위. threshDb가 있으면 그 위치에 작은 ▲(가로: 아래쪽) / ◀(세로: 오른쪽) 표시.
// 반환: 실제로 차지한 크기 {w, h}
export function drawMeter(ctx, db, x, y, opts = {}) {
  const { cells, cellW, cellH, gap, minDb, maxDb, okDb, hotDb } = METER;
  const vertical = !!opts.vertical;
  x = Math.round(x); y = Math.round(y);
  const len = cells * cellW + (cells - 1) * gap; // 긴 쪽 길이
  const bw = vertical ? cellH + 2 : len + 2;
  const bh = vertical ? len + 2 : cellH + 2;
  // 바탕: 가장 어두운 색 (꺼진 칸·칸 사이 틈이 패널 위에서도 보이게)
  rect(ctx, x, y, bw, bh, C.outline);

  const range = maxDb - minDb;
  const step = range / cells;
  const v = Number.isFinite(db) ? db : -Infinity;
  // 칸의 아래 경계를 넘으면 켠다 (정수 칸 수)
  const lit = v === -Infinity ? 0 : clamp(Math.ceil((v - minDb) / step), 0, cells);
  for (let i = 0; i < cells; i++) {
    const lo = minDb + i * step;
    let col = C.meterOff;
    if (i < lit) col = lo >= hotDb ? C.meterHot : lo >= okDb ? C.meterOk : C.meterLow;
    const off = i * (cellW + gap);
    if (vertical) rect(ctx, x + 1, y + 1 + (len - off - cellW), cellH, cellW, col);
    else rect(ctx, x + 1 + off, y + 1, cellW, cellH, col);
  }

  let w = bw, h = bh;
  if (opts.threshDb != null && Number.isFinite(opts.threshDb)) {
    const t = clamp((opts.threshDb - minDb) / range, 0, 1);
    const pos = Math.min(len - 1, Math.round(t * len));
    const mark = opts.markColor || C.text;
    if (vertical) {
      const ty = y + 1 + (len - 1 - pos);
      rect(ctx, x + bw, ty, 1, 1, mark);
      rect(ctx, x + bw + 1, ty - 1, 1, 3, mark);
      w += 2;
    } else {
      const tx = x + 1 + pos;
      rect(ctx, tx, y + bh, 1, 1, mark);
      rect(ctx, tx - 1, y + bh + 1, 3, 1, mark);
      h += 2;
    }
  }
  return { w, h };
}

// 픽셀 바: 1px 어두운 테두리 + 안쪽 바탕 + 정수 폭 채움(아래 1px은 디더 음영)
export function drawBar(ctx, value01, x, y, w, h, color) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w < 3 || h < 3) return;
  rect(ctx, x, y, w, h, C.outline);
  rect(ctx, x + 1, y + 1, w - 2, h - 2, C.bg);
  const v = Number.isFinite(value01) ? clamp(value01, 0, 1) : 0;
  const fill = Math.round(v * (w - 2));
  if (fill > 0) {
    rect(ctx, x + 1, y + 1, fill, h - 2, color);
    if (h - 2 >= 3) dither(ctx, x + 1, y + h - 2, fill, 1, C.outline, 0);
  }
}
