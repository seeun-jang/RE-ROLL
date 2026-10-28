// 사실적인 질감(구름, 돌, 모래, 나뭇결)을 만드는 노이즈 도구입니다.

// 정수 좌표 → 0~1 난수 (같은 좌표면 항상 같은 값)
function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// 부드러운 값 노이즈
export function noise2(x, y, seed = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// 여러 크기의 노이즈를 겹친 것 (구름, 바위 같은 자연스러운 무늬), 대략 0~1
export function fbm(x, y, octaves = 5, seed = 1) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

export const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const mix = (a, b, t) => a + (b - a) * t;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// (x, y) → [r, g, b, a(0~255)] 함수로 그림 한 장 만들기
export function paintPixels(w, h, fn) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn(x, y);
      d[i++] = r;
      d[i++] = g;
      d[i++] = b;
      d[i++] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// 질감을 패턴으로 깔기 위한 회색 노이즈 타일
export function grainTile(size = 128, seed = 3, scale = 0.5, contrast = 1) {
  return paintPixels(size, size, (x, y) => {
    const n = (noise2(x * scale, y * scale, seed) - 0.5) * contrast + 0.5;
    const v = Math.max(0, Math.min(255, n * 255));
    return [v, v, v, 255];
  });
}
