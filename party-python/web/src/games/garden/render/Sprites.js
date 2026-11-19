// 스프라이트 뱅크 — assets/sprites.json(문자 배열) + palette.json을 오프스크린 캔버스로 변환
// 나중에 실제 PNG로 바꿀 때는 loadSpriteAssets()만 교체하면 된다.
import PALETTE from '../assets/palette.js';
import SPRITES from '../assets/sprites.js';

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class SpriteBank {
  constructor(paletteJson, spritesJson) {
    this.colors = paletteJson.colors;          // ["#rrggbb", ...]
    this.key = paletteJson.key;                // 문자 → 팔레트 인덱스
    this.rgb = this.colors.map(hexToRgb);
    this.data = spritesJson;
    this.cache = new Map();
  }

  css(index) { return this.colors[index] ?? '#ff00ff'; }
  has(name) { return !!this.data[name]; }
  frames(name) { return this.data[name]?.frames.length ?? 0; }
  size(name) { const d = this.data[name]; return d ? { w: d.w, h: d.h } : { w: 0, h: 0 }; }

  // swap: { 'b': 'r' } 처럼 문자 → 문자 팔레트 스왑, flash: 흰색 실루엣
  get(name, frame = 0, swap = null, flash = false) {
    const d = this.data[name];
    if (!d) throw new Error(`[sprites] unknown sprite: ${name}`);
    const f = ((frame % d.frames.length) + d.frames.length) % d.frames.length;
    const swapKey = swap ? Object.entries(swap).map(([a, b]) => a + b).join('') : '';
    const key = `${name}#${f}#${swapKey}#${flash ? 'F' : ''}`;
    let c = this.cache.get(key);
    if (!c) {
      c = this.build(d, f, swap, flash);
      this.cache.set(key, c);
    }
    return c;
  }

  build(d, f, swap, flash) {
    const canvas = document.createElement('canvas');
    canvas.width = d.w; canvas.height = d.h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(d.w, d.h);
    const rows = d.frames[f];
    for (let y = 0; y < d.h; y++) {
      const row = rows[y] || '';
      for (let x = 0; x < d.w; x++) {
        let ch = row[x] || '.';
        if (ch === '.' || ch === ' ') continue;
        if (swap && swap[ch]) ch = swap[ch];
        const idx = this.key[ch];
        if (idx === undefined) continue;
        const o = (y * d.w + x) * 4;
        if (flash) { img.data[o] = 255; img.data[o + 1] = 255; img.data[o + 2] = 255; }
        else { const [r, g, b] = this.rgb[idx]; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; }
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // 스프라이트에서 쓰인 팔레트 인덱스 목록 (파편 파티클 색상용)
  colorsOf(name, swap = null) {
    const d = this.data[name];
    const set = new Set();
    for (const row of d.frames[0]) for (let ch of row) {
      if (ch === '.') continue;
      if (swap && swap[ch]) ch = swap[ch];
      const idx = this.key[ch];
      if (idx !== undefined && idx !== 25) set.add(idx);
    }
    return [...set];
  }
}

// 에셋 로딩 지점 — 실제 이미지 에셋으로 교체하려면 이 함수를 바꾼다.
/** 게임에 들어 있는 스프라이트 데이터로 뱅크를 만든다 */
export function createSpriteBank() {
  return new SpriteBank(PALETTE, SPRITES);
}
