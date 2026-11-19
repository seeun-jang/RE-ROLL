(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 픽셀 폰트 렌더러
  //  1순위: 갈무리 BDF 비트맵 글리프(assets/data/font_data.js)를 픽셀 그대로 찍는다 → 완전한 도트 글자
  //  2순위(데이터가 없을 때): 웹폰트를 오프스크린에 그린 뒤 알파 문턱값으로 잘라
  //         "완전 불투명 / 완전 투명" 픽셀만 남긴다 (안티앨리어싱 제거)
  //  결과는 문자열·색·외곽선 조합별로 캐시한다.
  // ─────────────────────────────────────────────────────────────
  const BITMAP = window.PK_FONT_DATA ? window.PK_FONT_DATA.fonts : null;
  const TOP_REF = ['가', '한', '힣', 'A', 'H'];

  const Font = {
    ready: false,
    cache: new Map(),
    measureCanvas: null,
    workCanvas: null,
    bitmap: BITMAP,

    init() {
      this.measureCanvas = document.createElement('canvas').getContext('2d');
      const wc = document.createElement('canvas');
      wc.width = 512; wc.height = 64;
      this.workCanvas = wc.getContext('2d', { willReadFrequently: true });
      // 비트맵 폰트: 글자 윗선이 y 에 오도록 기준선 위치를 계산
      if (BITMAP) {
        Object.keys(BITMAP).forEach(function (k) {
          const f = BITMAP[k];
          let top = 0;
          TOP_REF.forEach(function (ch) { const gl = f.glyphs[ch]; if (gl) top = Math.max(top, gl[2] + gl[4]); });
          f.top = top || f.ascent;
        });
      }
    },

    // 웹폰트 로드 (비트맵 폰트가 있으면 필요 없음. 실패하거나 4초가 지나면 대체 글꼴로 진행)
    load() {
      const F = PK.CONFIG.FONT;
      const self = this;
      if (BITMAP) { this.ready = true; return Promise.resolve(); }
      if (!document.fonts || !document.fonts.load) return Promise.resolve();
      const loads = [
        document.fonts.load(F.M.size + 'px "' + F.M.family + '"', '가A'),
        document.fonts.load(F.S.size + 'px "' + F.S.family + '"', '가A')
      ];
      const timeout = new Promise(function (res) { setTimeout(res, 4000); });
      return Promise.race([Promise.all(loads), timeout]).then(function () {
        self.ready = document.fonts.check(F.M.size + 'px "' + F.M.family + '"', '가');
        if (!self.ready) console.warn('[폰트] 갈무리 폰트를 불러오지 못해 대체 글꼴을 사용합니다.');
        self.cache.clear();
      }).catch(function () { self.ready = false; });
    },

    css(font) {
      const f = PK.CONFIG.FONT[font] || PK.CONFIG.FONT.M;
      return f.size + 'px "' + f.family + '", ' + PK.CONFIG.FONT.fallback;
    },

    lineH(font) {
      const f = PK.CONFIG.FONT[font] || PK.CONFIG.FONT.M;
      return f.lineH;
    },

    measure(text, font) {
      if (BITMAP) {
        const f = BITMAP[font || 'M'];
        let w = 0;
        for (const ch of text) { const gl = f.glyphs[ch]; w += gl ? gl[0] : (ch === ' ' ? 4 : 8); }
        return w;
      }
      this.measureCanvas.font = this.css(font || 'M');
      return Math.ceil(this.measureCanvas.measureText(text).width);
    },

    // 비트맵 글리프로 마스크 만들기
    bitmapMask(text, font) {
      const f = BITMAP[font] || BITMAP.M;
      const pad = 2;
      const w = Math.max(1, this.measure(text, font) + pad * 2);
      const h = f.top + f.descent + pad * 2;
      const mask = new Uint8Array(w * h);
      let pen = pad;
      const base = pad + f.top;   // 기준선 y
      for (const ch of text) {
        const gl = f.glyphs[ch];
        if (!gl) { pen += ch === ' ' ? 4 : 8; continue; }
        const gw = gl[1], gh = gl[2], xo = gl[3], yo = gl[4], hex = gl[5];
        const bytesPerRow = Math.ceil(gw / 8);
        for (let row = 0; row < gh; row++) {
          for (let b = 0; b < bytesPerRow; b++) {
            const v = parseInt(hex.substr((row * bytesPerRow + b) * 2, 2), 16);
            for (let bit = 0; bit < 8; bit++) {
              const x = b * 8 + bit;
              if (x >= gw || !(v & (0x80 >> bit))) continue;
              const px = pen + xo + x, py = base - yo - gh + row;
              if (px >= 0 && py >= 0 && px < w && py < h) mask[py * w + px] = 1;
            }
          }
        }
        pen += gl[0];
      }
      return { mask: mask, w: w, h: h, pad: pad };
    },

    // 문자열 하나를 픽셀화된 캔버스로 만든다
    render(text, font, color, outline) {
      font = font || 'M';
      const key = text + '\u0001' + font + '\u0001' + color + '\u0001' + (outline || '');
      let cv = this.cache.get(key);
      if (cv) return cv;
      if (BITMAP) {
        const m = this.bitmapMask(text, font);
        cv = this.paint(m.mask, m.w, m.h, color, outline);
        cv.textW = m.w - m.pad * 2;
        cv.pad = m.pad;
        this.cache.set(key, cv);
        if (this.cache.size > 1500) this.cache.clear();
        return cv;
      }
      const F = PK.CONFIG.FONT;
      const f = F[font] || F.M;
      const pad = 2;
      const w = Math.max(1, this.measure(text, font) + pad * 2);
      const h = f.size + pad * 2 + 2;
      const wg = this.workCanvas;
      if (wg.canvas.width < w || wg.canvas.height < h) {
        wg.canvas.width = Math.max(wg.canvas.width, w);
        wg.canvas.height = Math.max(wg.canvas.height, h);
      }
      wg.clearRect(0, 0, wg.canvas.width, wg.canvas.height);
      wg.font = this.css(font);
      wg.textBaseline = 'top';
      wg.fillStyle = '#ffffff';
      wg.fillText(text, pad, pad);
      const src = wg.getImageData(0, 0, w, h).data;

      // 알파 문턱값 → 마스크
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) mask[i] = src[i * 4 + 3] >= F.alphaCut ? 1 : 0;

      cv = this.paint(mask, w, h, color, outline);
      cv.textW = w - pad * 2;
      cv.pad = pad;
      this.cache.set(key, cv);
      if (this.cache.size > 1500) this.cache.clear();
      return cv;
    },

    // 마스크 → 색칠된 캔버스 (외곽선 = 8방향 이웃)
    paint(mask, w, h, color, outline) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      const out = g.createImageData(w, h);
      const fc = hex(color), oc = outline ? hex(outline) : null;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          let c = null;
          if (mask[i]) c = fc;
          else if (oc) {
            // 8방향 이웃 중 글자 픽셀이 있으면 외곽선
            for (let oy = -1; oy <= 1 && !c; oy++) for (let ox = -1; ox <= 1; ox++) {
              const nx = x + ox, ny = y + oy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) { c = oc; break; }
            }
          }
          if (c) { const p = i * 4; out.data[p] = c[0]; out.data[p + 1] = c[1]; out.data[p + 2] = c[2]; out.data[p + 3] = 255; }
        }
      }
      g.putImageData(out, 0, 0);
      return cv;
    },

    // 화면에 글자 그리기
    // opts: { font:'M'|'S', color, outline, align:'left'|'center'|'right', scale }
    draw(g, text, x, y, opts) {
      opts = opts || {};
      const font = opts.font || 'M';
      const color = opts.color || PK.COL.white;
      const scale = Math.max(1, Math.round(opts.scale || 1));
      const lines = String(text).split('\n');
      const lh = this.lineH(font) * scale;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cv = this.render(lines[i], font, color, opts.outline);
        let dx = 0;
        const tw = cv.textW * scale;
        if (opts.align === 'center') dx = -Math.floor(tw / 2);
        else if (opts.align === 'right') dx = -tw;
        g.drawImage(cv, 0, 0, cv.width, cv.height,
          Math.round(x + dx - cv.pad * scale), Math.round(y + i * lh - cv.pad * scale),
          cv.width * scale, cv.height * scale);
      }
    },

    // 최대 너비에 맞춰 줄바꿈 (한글은 글자 단위, 공백 우선)
    wrap(text, maxW, font) {
      const out = [];
      String(text).split('\n').forEach(function (para) {
        let line = '';
        const words = para.split(' ');
        words.forEach(function (word, wi) {
          const cand = line ? line + ' ' + word : word;
          if (Font.measure(cand, font) <= maxW) { line = cand; return; }
          if (line) { out.push(line); line = ''; }
          // 단어 자체가 너무 길면 글자 단위로 자른다
          let chunk = '';
          for (const ch of word) {
            if (Font.measure(chunk + ch, font) > maxW && chunk) { out.push(chunk); chunk = ''; }
            chunk += ch;
          }
          line = chunk;
          if (wi === words.length - 1 && !line) line = '';
        });
        out.push(line);
      });
      return out;
    }
  };

  function hex(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  PK.Font = Font;
})(window.PK = window.PK || {});
