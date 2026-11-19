(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 에셋 로더
  //  - assets/data/sprites_data.js 의 "2D 문자 배열 + 팔레트 인덱스" 데이터를 캔버스로 굽는다.
  //  - 팔레트 스왑(홍/백 표식 끈, 사범님 흰 도복 등)은 스왑 키별로 따로 캐시한다.
  //  - 실제 이미지로 바꾸고 싶으면 CONFIG.ASSET_OVERRIDES 에 { 이름: 'png 경로' } 만 추가하면 된다.
  //    (게임 코드는 Assets.get() 만 부르므로 다른 곳은 고칠 필요 없음)
  // ─────────────────────────────────────────────────────────────
  const DATA = window.PK_SPRITE_DATA;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // 코드에서 직접 그릴 때 쓰는 이름 있는 색 (모두 같은 팔레트 안의 색)
  PK.COL = {};
  Object.keys(DATA.named).forEach(function (k) { PK.COL[k] = DATA.palette[DATA.named[k]]; });

  const Assets = {
    palette: DATA.palette,
    rgb: DATA.palette.map(hexToRgb),
    charMap: DATA.charMap,
    swaps: DATA.swaps,
    defs: DATA.sprites,
    overrides: {},
    cache: {},

    // 파생 스프라이트(행별 가로 기울이기)를 포함해 최종 문자 배열을 얻는다
    resolveRows(name) {
      const def = this.defs[name];
      if (!def) throw new Error('스프라이트 없음: ' + name);
      if (!def.from) {
        const w = Math.max.apply(null, def.rows.map(function (r) { return r.length; }));
        return {
          rows: def.rows.map(function (r) { return r.padEnd(w, '.'); }),
          anchor: def.anchor || [w >> 1, def.rows.length]
        };
      }
      const base = this.resolveRows(def.from);
      const shear = def.shear || [];
      let minS = 0, maxS = 0;
      shear.forEach(function (s) { minS = Math.min(minS, s); maxS = Math.max(maxS, s); });
      const off = -minS;
      const span = maxS + off;
      const rows = base.rows.map(function (r, y) {
        const s = (shear[y] || 0) + off;
        return '.'.repeat(s) + r + '.'.repeat(span - s);
      });
      return { rows: rows, anchor: [base.anchor[0] + off, base.anchor[1]] };
    },

    // 문자 배열 → 캔버스
    bake(name, swapKey) {
      const res = this.resolveRows(name);
      const rows = res.rows;
      const h = rows.length;
      const w = rows[0].length;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      const img = g.createImageData(w, h);
      const swap = (swapKey && this.swaps[swapKey]) || {};
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ch = rows[y][x];
          if (!ch || ch === '.') continue;
          const idx = swap[ch] !== undefined ? swap[ch] : this.charMap[ch];
          if (idx === undefined || idx < 0) continue;
          const c = this.rgb[idx];
          const p = (y * w + x) * 4;
          img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      return { canvas: cv, w: w, h: h, ax: res.anchor[0], ay: res.anchor[1] };
    },

    // 스프라이트 얻기 (캐시). 오버라이드 PNG가 있으면 그것을 쓴다.
    get(name, swapKey) {
      const key = name + '|' + (swapKey || '');
      let spr = this.cache[key];
      if (spr) return spr;
      const img = this.overrides[name];
      if (img) {
        const def = this.defs[name] || {};
        const a = def.anchor || [img.width >> 1, img.height];
        spr = { canvas: img, w: img.width, h: img.height, ax: a[0], ay: a[1] };
      } else {
        spr = this.bake(name, swapKey);
      }
      this.cache[key] = spr;
      return spr;
    },

    // 오버라이드 이미지 로드 (없으면 즉시 완료)
    load() {
      const list = Object.entries(PK.CONFIG.ASSET_OVERRIDES || {});
      const self = this;
      return Promise.all(list.map(function (e) {
        return new Promise(function (resolve) {
          const img = new Image();
          img.onload = function () { self.overrides[e[0]] = img; resolve(); };
          img.onerror = function () { console.warn('[에셋] 이미지를 불러오지 못해 코드 스프라이트를 사용:', e[1]); resolve(); };
          img.src = e[1];
        });
      }));
    }
  };

  PK.Assets = Assets;
})(window.PK = window.PK || {});
