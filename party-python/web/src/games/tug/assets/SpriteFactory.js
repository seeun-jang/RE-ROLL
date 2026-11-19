// =============================================================
// SpriteFactory — 픽셀 데이터(문자열 배열) → 캔버스 변환
// DOM 접근은 함수 안에서만 한다 (Node 에서 import 해도 안전).
// =============================================================

/**
 * 빈 캔버스 생성. 브라우저는 <canvas>, DOM 이 없으면 OffscreenCanvas 로 대체.
 * @param {number} w
 * @param {number} h
 */
export function makeCanvas(w, h) {
  const cw = Math.max(1, w | 0);
  const ch = Math.max(1, h | 0);
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(cw, ch);
  throw new Error('makeCanvas: 캔버스를 만들 수 없는 환경입니다 (document/OffscreenCanvas 없음)');
}

/** 2D 컨텍스트를 픽셀 아트용(보간 끔)으로 얻는다 */
function ctx2d(canvas) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  return g;
}

/** '#rgb' / '#rrggbb' → [r, g, b] (잘못된 값이면 null) */
export function parseHex(hexStr) {
  if (typeof hexStr !== 'string') return null;
  let s = hexStr.trim().replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6 || /[^0-9a-f]/i.test(s)) return null;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 픽셀 행 → 캔버스.
 * ImageData 에 한 번에 써서 빠르고, 반투명/보간 없이 정확한 픽셀만 찍힌다.
 * @param {string[]} rows    각 문자열 = 한 행. '.' 은 투명
 * @param {(ch: string) => string|null} colorOf  문자 → hex (null 이면 투명)
 * @returns {HTMLCanvasElement}
 */
export function renderPixelRows(rows, colorOf) {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const canvas = makeCanvas(w, h);
  const g = ctx2d(canvas);
  const img = g.createImageData(canvas.width, canvas.height);
  const data = img.data;
  // 같은 문자는 한 번만 색을 계산 (호출마다 로컬 캐시)
  const memo = new Map();
  const rgbOf = (ch) => {
    if (memo.has(ch)) return memo.get(ch);
    const rgb = ch === '.' ? null : parseHex(colorOf(ch));
    memo.set(ch, rgb);
    return rgb;
  };
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const rgb = rgbOf(row[x]);
      if (!rgb) continue; // 투명
      const i = (y * canvas.width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/**
 * 좌우 반전 사본 (오른쪽 팀 캐릭터는 왼쪽을 바라봐야 하므로 사용)
 * @param {HTMLCanvasElement} canvas
 */
export function flipCanvas(canvas) {
  const out = makeCanvas(canvas.width, canvas.height);
  const g = ctx2d(out);
  g.translate(canvas.width, 0);
  g.scale(-1, 1);
  g.drawImage(canvas, 0, 0);
  return out;
}
