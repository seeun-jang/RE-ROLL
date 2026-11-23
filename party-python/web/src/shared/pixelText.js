// =============================================================
// pixelText — 낮은 해상도 캔버스에 한글을 또렷하게 찍는 도우미 (게임 공용)
//
// 웹폰트(Galmuri)를 작은 캔버스에 그린 뒤 반투명 가장자리를 없애(알파 이진화) 픽셀 글자로 만든다.
// 같은 글자·색·크기는 캐시에서 다시 쓴다.
//
//   drawPixelText(ctx, '안녕', x, y, { color: '#fff', outline: '#181425', align: 'center', size: 10 });
// =============================================================
const FAMILY = '"Galmuri9", "Galmuri11", monospace';
const cache = new Map();
let scratch = null;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 글자를 그린 작은 캔버스. textW = 글자 너비 */
export function pixelText(text, color = '#ffffff', size = 10) {
  const key = `${text}|${color}|${size}`;
  let cv = cache.get(key);
  if (cv) return cv;
  if (!scratch) scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const g = scratch;
  g.font = `${size}px ${FAMILY}`;
  const w = Math.max(1, Math.ceil(g.measureText(text).width) + 2);
  const h = size + 4;
  g.canvas.width = w;
  g.canvas.height = h;
  g.font = `${size}px ${FAMILY}`;
  g.textBaseline = 'top';
  g.fillStyle = '#ffffff';
  g.fillText(text, 0, 1);
  const img = g.getImageData(0, 0, w, h);
  const [r, gg, b] = hexToRgb(color);
  for (let i = 0; i < img.data.length; i += 4) {
    const on = img.data[i + 3] >= 110;
    img.data[i] = r;
    img.data[i + 1] = gg;
    img.data[i + 2] = b;
    img.data[i + 3] = on ? 255 : 0;
  }
  cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').putImageData(img, 0, 0);
  cv.textW = w - 2;
  if (cache.size > 600) cache.clear();
  cache.set(key, cv);
  return cv;
}

/** opts: { color, outline(테두리 색), align: 'left'|'center'|'right', size } */
export function drawPixelText(ctx, text, x, y, opts = {}) {
  const str = String(text);
  if (!str) return 0;
  const size = opts.size || 10;
  const cv = pixelText(str, opts.color || '#ffffff', size);
  let px = Math.round(x);
  if (opts.align === 'center') px = Math.round(x - cv.textW / 2);
  else if (opts.align === 'right') px = Math.round(x - cv.textW);
  const py = Math.round(y);
  if (opts.outline) {
    const o = pixelText(str, opts.outline, size);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(o, px + dx, py + dy);
  }
  ctx.drawImage(cv, px, py);
  return cv.textW;
}
