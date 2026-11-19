(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 렌더러 + 픽셀 그리기 도구
  //  - 내부 해상도 320×180 캔버스에 그리고, CSS로 정수배 확대 (nearest-neighbor)
  //  - 모든 좌표는 Math.round 로 정수 픽셀에 맞춘다 (서브픽셀 금지)
  //  - 그라데이션 대신 4×4 베이어 디더링 패턴을 쓴다
  // ─────────────────────────────────────────────────────────────
  const BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];
  const R = Math.round;
  const patternCache = {};

  const Draw = {
    BAYER4: BAYER4,

    rect(g, x, y, w, h, c) {
      g.fillStyle = c;
      g.fillRect(R(x), R(y), R(w), R(h));
    },

    px(g, x, y, c) {
      g.fillStyle = c;
      g.fillRect(R(x), R(y), 1, 1);
    },

    // 1px 테두리 사각형
    frame(g, x, y, w, h, c) {
      x = R(x); y = R(y); w = R(w); h = R(h);
      g.fillStyle = c;
      g.fillRect(x, y, w, 1);
      g.fillRect(x, y + h - 1, w, 1);
      g.fillRect(x, y, 1, h);
      g.fillRect(x + w - 1, y, 1, h);
    },

    // 브레젠험 직선 (안티앨리어싱 없음)
    line(g, x0, y0, x1, y1, c, size) {
      x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1);
      const s = size || 1;
      g.fillStyle = c;
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let i = 0; i < 2000; i++) {
        g.fillRect(x0, y0, s, s);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    },

    // 직선 위의 점들을 콜백으로 돌려준다 (팔·깃대 그릴 때 사용)
    linePoints(x0, y0, x1, y1, fn) {
      x0 = R(x0); y0 = R(y0); x1 = R(x1); y1 = R(y1);
      const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let i = 0; i < 2000; i++) {
        fn(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    },

    // 디더링 패턴 (level 0~16, cell = 패턴 한 칸 픽셀 크기)
    pattern(g, c, level, cell) {
      cell = cell || 1;
      level = Math.max(0, Math.min(16, R(level)));
      const key = c + '|' + level + '|' + cell;
      let p = patternCache[key];
      if (!p) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 4 * cell;
        const pg = cv.getContext('2d');
        pg.fillStyle = c;
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
          if (BAYER4[y][x] < level) pg.fillRect(x * cell, y * cell, cell, cell);
        }
        p = g.createPattern(cv, 'repeat');
        patternCache[key] = p;
      }
      return p;
    },

    // 디더링 사각형 (반투명·그라데이션 대용)
    dither(g, x, y, w, h, c, level, cell) {
      if (level <= 0) return;
      if (level >= 16) { Draw.rect(g, x, y, w, h, c); return; }
      g.fillStyle = Draw.pattern(g, c, level, cell);
      g.fillRect(R(x), R(y), R(w), R(h));
    },

    // 픽셀 원 (채움)
    circle(g, cx, cy, r, c) {
      cx = R(cx); cy = R(cy);
      g.fillStyle = c;
      for (let dy = -r; dy <= r; dy++) {
        const hw = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
        g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
      }
    },

    // 디더링 타원 그림자
    shadow(g, cx, cy, w, c, level) {
      cx = R(cx); cy = R(cy);
      const hw = w >> 1;
      Draw.dither(g, cx - hw + 2, cy - 1, w - 4, 1, c, level || 10);
      Draw.dither(g, cx - hw, cy, w, 1, c, level || 10);
      Draw.dither(g, cx - hw + 2, cy + 1, w - 4, 1, c, level || 10);
    },

    // 스프라이트 그리기 (x, y = 앵커 위치). flip = 좌우 반전
    sprite(g, spr, x, y, flip) {
      x = R(x); y = R(y);
      if (!flip) {
        g.drawImage(spr.canvas, x - spr.ax, y - spr.ay);
      } else {
        g.save();
        g.translate(x, 0);
        g.scale(-1, 1);
        g.drawImage(spr.canvas, -spr.ax, y - spr.ay);
        g.restore();
      }
    },

    // 정수배 확대 스프라이트 (좌상단 기준)
    spriteScaled(g, spr, x, y, scale, flip) {
      const s = Math.max(1, R(scale));
      x = R(x); y = R(y);
      const w = spr.w * s, h = spr.h * s;
      if (!flip) {
        g.drawImage(spr.canvas, 0, 0, spr.w, spr.h, x, y, w, h);
      } else {
        g.save();
        g.translate(x + w, 0);
        g.scale(-1, 1);
        g.drawImage(spr.canvas, 0, 0, spr.w, spr.h, 0, y, w, h);
        g.restore();
      }
    }
  };

  // ── 화면 캔버스 관리 ──
  class Renderer {
    constructor(canvas) {
      const C = PK.CONFIG;
      this.canvas = canvas;
      this.canvas.width = C.SCREEN_W;
      this.canvas.height = C.SCREEN_H;
      this.g = canvas.getContext('2d', { alpha: false });
      this.g.imageSmoothingEnabled = false;
      this.scale = 1;
      this.resize = this.resize.bind(this);
      window.addEventListener('resize', this.resize);
      this.resize();
    }

    // 창 크기에 맞춰 가장 큰 정수배로 확대 (×4 = 1280×720)
    // 배율은 "실제 화면 픽셀" 기준 — 윈도우 배율 125%·150% 에서도 게임 픽셀 하나가 정수 개 화면 픽셀이 되도록
    resize() {
      const C = PK.CONFIG;
      const dpr = window.devicePixelRatio || 1;
      const s = Math.max(1, Math.floor(Math.min(window.innerWidth * dpr / C.SCREEN_W, window.innerHeight * dpr / C.SCREEN_H)));
      this.scale = s;
      this.canvas.style.width = (C.SCREEN_W * s / dpr) + 'px';
      this.canvas.style.height = (C.SCREEN_H * s / dpr) + 'px';
      // 다른 배율의 모니터로 창을 옮기면 다시 계산
      if (window.matchMedia) {
        const mq = window.matchMedia('(resolution: ' + dpr + 'dppx)');
        if (mq.addEventListener) mq.addEventListener('change', this.resize, { once: true });
      }
    }

    begin() {
      this.g.imageSmoothingEnabled = false;
      this.g.setTransform(1, 0, 0, 1, 0, 0);
      this.g.globalAlpha = 1;
    }
  }

  PK.Draw = Draw;
  PK.Renderer = Renderer;
})(window.PK = window.PK || {});
