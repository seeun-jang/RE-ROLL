// ============================================================
//  캔버스용 3×5 픽셀 폰트 — 점수 팝업, 콤보, 카운트다운에 사용
//  (캔버스 fillText 는 안티앨리어싱이 생기므로 직접 도트로 찍는다)
// ============================================================
import { PALETTE } from './palette.js';

// 각 글자 = 5행 × 3열 비트 ("111 101 ..." 순서)
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001110',
  '+': '000010111010000', '-': '000000111000000', '!': '010010010000010', x: '000101010101000',
  '.': '000000000000010', ':': '000010000010000', ' ': '000000000000000', '?': '110001010000010',
};

const GLYPH_W = 3;
const GLYPH_H = 5;
const SPACING = 1;

export function textWidth(text, scale = 1) {
  return (text.length * (GLYPH_W + SPACING) - SPACING) * scale;
}

function drawGlyphs(ctx, text, x, y, scale, color) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const bits = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
    for (let i = 0; i < 15; i++) {
      if (bits[i] === '1') ctx.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
    }
    cx += (GLYPH_W + SPACING) * scale;
  }
}

/**
 * 픽셀 텍스트 그리기 (어두운 외곽선 포함)
 * opts: { color: 팔레트 인덱스, outline: 팔레트 인덱스|null, scale, align: 'left'|'center'|'right' }
 */
export function drawText(ctx, text, x, y, { color = 12, outline = 0, scale = 1, align = 'left' } = {}) {
  const w = textWidth(text, scale);
  let sx = Math.round(x);
  if (align === 'center') sx = Math.round(x - w / 2);
  else if (align === 'right') sx = Math.round(x - w);
  const sy = Math.round(y);
  if (outline !== null && outline !== undefined) {
    const oc = PALETTE[outline];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      drawGlyphs(ctx, text, sx + dx * scale, sy + dy * scale, scale, oc);
    }
    // 아래쪽 그림자 한 줄 더 — 입체감
    drawGlyphs(ctx, text, sx, sy + 2 * scale, scale, oc);
  }
  drawGlyphs(ctx, text, sx, sy, scale, PALETTE[color]);
  return w;
}

export const FONT_H = GLYPH_H;
