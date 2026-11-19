(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 배경 (패럴랙스 3~4레이어) — 전부 코드로 직접 찍는 픽셀 아트
  //  dojo  : 노을 하늘(창 너머, 0.15) → 회벽·기둥·창·현판(0.5) → 나무 바닥(원근 0.78~1.15)
  //  arena : 체육관 벽·현수막(0.15) → 관중석(0.45) → 경기장 바닥 + 흰 경계선
  //  바닥은 아래로 갈수록 빨리 움직여(원근) 깊이감을 준다. 선수 발 높이(GROUND_Y)에서 배율 1.
  // ─────────────────────────────────────────────────────────────
  const D = () => PK.Draw;

  // 결정적 난수 (매번 같은 관중 배치)
  function seeded(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  class Stage {
    constructor(kind) {
      this.kind = kind || 'dojo';
      this.t = 0;
      this.cheerT = 0;
      this.crowd = [];
      if (this.kind === 'arena') this.makeCrowd();
    }

    // 바닥 원근 배율
    static k(y) {
      const C = PK.CONFIG;
      return 0.78 + 0.22 * (y - C.FLOOR_TOP) / (C.GROUND_Y - C.FLOOR_TOP);
    }

    // 월드 x → 화면 x (y 높이의 원근 반영)
    static screenX(wx, y, camX) {
      const half = PK.CONFIG.SCREEN_W / 2;
      return Math.round((wx - camX - half) * Stage.k(y) + half);
    }

    makeCrowd() {
      const C = PK.COL;
      const rnd = seeded(17);
      const shirts = [C.red, C.blue, C.darkGreen, C.gold, C.white, C.purple, C.lgrey, C.sky, C.rust];
      const hairs = [C.outline, C.brown, C.navyDark, C.plum, C.outline];
      for (let tier = 0; tier < 4; tier++) {
        const y = 62 + tier * 12;
        for (let x = 4; x < 460; x += 6 + (rnd() * 4 | 0)) {
          if (rnd() < 0.12) continue;   // 빈자리
          this.crowd.push({
            x: x, y: y, tier: tier,
            shirt: shirts[rnd() * shirts.length | 0],
            hair: hairs[rnd() * hairs.length | 0],
            skin: rnd() < 0.7 ? C.skin : C.skinShadow,
            phase: rnd() * 200 | 0,
            jump: 0.3 + rnd() * 0.7
          });
        }
      }
    }

    cheer() { this.cheerT = 120; }

    update() {
      this.t++;
      if (this.cheerT > 0) this.cheerT--;
    }

    drawBack(g, camX) {
      if (this.kind === 'arena') this.drawArena(g, camX);
      else this.drawDojo(g, camX);
    }

    // ── 도장 ──
    drawSky(g, off) {
      const C = PK.COL, W = PK.CONFIG.SCREEN_W;
      // 노을 띠 (경계는 디더링)
      const bands = [[0, C.purple], [18, C.magenta], [32, C.pink], [44, C.orange], [54, C.gold]];
      for (let i = 0; i < bands.length; i++) {
        const y0 = bands[i][0], y1 = i + 1 < bands.length ? bands[i + 1][0] : 70;
        D().rect(g, 0, y0, W, y1 - y0, bands[i][1]);
        if (i + 1 < bands.length) D().dither(g, 0, y1 - 3, W, 3, bands[i + 1][1], 8);
      }
      // 해
      D().circle(g, 236 + off, 50, 9, C.yellow);
      D().dither(g, 222 + off, 38, 28, 4, C.yellow, 4);
      // 먼 산 실루엣
      g.fillStyle = C.purple;
      for (let x = 0; x < W; x++) {
        const wx = x - off;
        const h = 8 + Math.round(5 * Math.sin(wx * 0.045) + 3 * Math.sin(wx * 0.11 + 1));
        g.fillRect(x, 66 - h, 1, h + 4);
      }
      D().dither(g, 0, 56, W, 14, C.plum, 6);
    }

    drawDojo(g, camX) {
      const C = PK.COL, CF = PK.CONFIG;
      const W = CF.SCREEN_W;
      const wallOff = -Math.round(camX * 0.5);
      const skyOff = -Math.round(camX * 0.15);

      // 회벽 + 천장 보
      D().rect(g, 0, 0, W, 64, C.cream);
      D().dither(g, 0, 46, W, 18, C.tan, 4);
      D().rect(g, 0, 0, W, 5, C.plum);
      D().rect(g, 0, 5, W, 1, C.brown);

      // 기둥과 창 (벽 레이어 기준 96px 간격)
      for (let i = -1; i < 6; i++) {
        const px = i * 96 + wallOff;
        if (px > W + 10 || px < -110) continue;
        // 창 (안쪽에 하늘)
        const wx = px + 28, wy = 14, ww = 42, wh = 34;
        g.save();
        g.beginPath(); g.rect(wx, wy, ww, wh); g.clip();
        this.drawSky(g, skyOff - wallOff * 0 + (i * 6));
        g.restore();
        D().frame(g, wx - 2, wy - 2, ww + 4, wh + 4, C.plum);
        D().frame(g, wx - 1, wy - 1, ww + 2, wh + 2, C.brown);
        D().rect(g, wx + (ww >> 1), wy, 1, wh, C.plum);
        D().rect(g, wx, wy + (wh >> 1), ww, 1, C.plum);
        D().rect(g, wx - 3, wy + wh + 2, ww + 6, 2, C.brown);   // 창턱
        // 기둥
        D().rect(g, px, 5, 7, 101, C.brown);
        D().rect(g, px + 1, 5, 1, 101, C.wood);
        D().rect(g, px + 6, 5, 1, 101, C.plum);
      }

      // 현판 (정심 — 바른 마음)
      const bx = 160 - 32 + Math.round((CF.COURT_CENTER - 160) * 0.5) + wallOff;
      UIbox(g, bx, 16, 64, 22);
      PK.Font.draw(g, '正心', bx + 32, 21, { font: 'M', color: C.gold, align: 'center' });

      // 가로 보
      D().rect(g, 0, 62, W, 5, C.brown);
      D().rect(g, 0, 62, W, 1, C.wood);
      // 아래 나무 판벽
      D().rect(g, 0, 67, W, 39, C.wood);
      for (let x = ((wallOff % 10) + 10) % 10; x < W; x += 10) D().rect(g, x, 67, 1, 39, C.brown);
      D().dither(g, 0, 67, W, 6, C.brown, 6);
      // 명패 줄
      for (let i = 0; i < 26; i++) {
        const nx = 20 + i * 14 + wallOff;
        if (nx < -10 || nx > W) continue;
        D().rect(g, nx, 72, 10, 16, C.plum);
        D().rect(g, nx + 1, 73, 8, 14, C.cream);
        D().rect(g, nx + 4, 75, 2, 9, C.brown);
      }
      // 죽도 걸이
      const rx = 300 + wallOff;
      D().rect(g, rx, 76, 40, 3, C.plum);
      for (let i = 0; i < 6; i++) {
        D().rect(g, rx + 3 + i * 6, 70, 1, 34, C.cream);
        D().rect(g, rx + 3 + i * 6, 70, 1, 2, C.white);
        D().rect(g, rx + 2 + i * 6, 94, 3, 1, C.outline);
      }
      // 걸레받이
      D().rect(g, 0, 106, W, 6, C.plum);
      D().rect(g, 0, 106, W, 1, C.brown);

      this.drawFloor(g, camX, C.tan, C.orangeBrown, C.wood);

      // 창으로 들어온 노을빛 (바닥 위 디더링 빛줄기)
      for (let i = -1; i < 6; i++) {
        const px = i * 96 + wallOff + 28;
        if (px > W + 60 || px < -100) continue;
        for (let y = CF.FLOOR_TOP; y < 170; y += 1) {
          const slant = (y - CF.FLOOR_TOP) * 0.9;
          const x0 = px + 10 + slant;
          D().dither(g, x0, y, 30 + slant * 0.3, 1, C.yellow, y < 140 ? 3 : 2);
        }
      }
    }

    // ── 대회장(체육관) ──
    drawArena(g, camX) {
      const C = PK.COL, CF = PK.CONFIG;
      const W = CF.SCREEN_W;
      const farOff = -Math.round(camX * 0.15);
      const midOff = -Math.round(camX * 0.45);

      // 먼 벽
      D().rect(g, 0, 0, W, 60, C.navyDark);
      D().dither(g, 0, 0, W, 10, C.outline, 8);
      for (let i = 0; i < 9; i++) {
        const wx = i * 44 + farOff;
        D().rect(g, wx, 12, 26, 12, C.outline);
        D().rect(g, wx + 1, 13, 24, 10, C.blue);
        D().dither(g, wx + 1, 13, 24, 4, C.sky, 6);
        D().rect(g, wx + 13, 13, 1, 10, C.outline);
      }
      // 철골
      for (let x = (farOff % 16 + 16) % 16; x < W; x += 16) D().line(g, x, 4, x + 8, 10, C.navy);
      D().rect(g, 0, 3, W, 1, C.navy);
      D().rect(g, 0, 10, W, 1, C.navy);
      // 현수막
      const bx = 160 - 70 + farOff + 12;
      D().rect(g, bx - 1, 27, 142, 16, C.outline);
      D().rect(g, bx, 28, 140, 14, C.darkRed);
      D().rect(g, bx, 28, 140, 1, C.red);
      D().frame(g, bx + 2, 30, 136, 10, C.gold);
      PK.Font.draw(g, '제17회 시민 검도 대회', bx + 70, 30, { font: 'S', color: C.cream, align: 'center' });
      // 조명
      for (let i = 0; i < 6; i++) {
        const lx = i * 64 + 20 + farOff;
        D().rect(g, lx, 0, 12, 3, C.lgrey);
        D().rect(g, lx + 1, 3, 10, 1, C.yellow);
      }

      // 관중석
      for (let tier = 0; tier < 4; tier++) {
        const y = 50 + tier * 12;
        D().rect(g, 0, y, W, 12, tier % 2 ? C.navy : C.navyLight);
        D().rect(g, 0, y + 11, W, 1, C.navyDark);
      }
      const cheering = this.cheerT > 0;
      for (let i = 0; i < this.crowd.length; i++) {
        const p = this.crowd[i];
        const x = p.x + midOff;
        if (x < -6 || x > W + 6) continue;
        let bob = ((this.t + p.phase) >> 5) % 2;
        if (cheering) bob = -Math.round(Math.abs(Math.sin((this.t + p.phase) * 0.25)) * 3 * p.jump);
        const y = p.y + bob;
        D().rect(g, x - 3, y - 5, 6, 6, p.shirt);
        D().rect(g, x - 3, y - 5, 6, 1, C.outline);
        D().rect(g, x - 2, y - 9, 4, 4, p.skin);
        D().rect(g, x - 2, y - 10, 4, 2, p.hair);
        if (cheering && (this.t + p.phase) % 20 < 10) {
          D().rect(g, x - 4, y - 10, 1, 4, p.skin);
          D().rect(g, x + 3, y - 10, 1, 4, p.skin);
        }
      }
      // 난간
      D().rect(g, 0, 98, W, 14, C.navyDark);
      D().rect(g, 0, 98, W, 2, C.lgrey);
      D().rect(g, 0, 100, W, 1, C.grey);
      for (let x = (midOff % 24 + 24) % 24; x < W; x += 24) D().rect(g, x, 100, 2, 12, C.grey);
      // 광고판
      for (let i = 0; i < 7; i++) {
        const ax = i * 70 + midOff + 10;
        D().rect(g, ax, 103, 56, 8, i % 2 ? C.blue : C.forest);
        D().rect(g, ax + 4, 106, 48, 2, C.lgrey);
      }

      this.drawFloor(g, camX, C.cream, C.tan, C.orangeBrown);
      // 조명 빛 (디더링 원뿔)
      for (let i = 0; i < 6; i++) {
        const lx = i * 64 + 26 + farOff;
        for (let y = 4; y < 98; y += 2) {
          const hw = 3 + (y >> 3);
          D().dither(g, lx - hw, y, hw * 2, 2, C.yellow, 1);
        }
      }
    }

    // 원근 나무 바닥
    drawFloor(g, camX, c1, c2, seam) {
      const C = PK.COL, CF = PK.CONFIG;
      const W = CF.SCREEN_W, H = CF.SCREEN_H;
      const rows = [112, 117, 123, 130, 138, 147, 157, 168, 180];
      for (let r = 0; r < rows.length - 1; r++) {
        const y0 = rows[r], y1 = rows[r + 1];
        D().rect(g, 0, y0, W, y1 - y0, r % 2 ? c1 : c2);
        D().rect(g, 0, y0, W, 1, seam);
        // 판 이음매 (원근 반영)
        const ym = (y0 + y1) >> 1;
        const k = Stage.k(ym);
        const step = 56;
        const shift = r % 2 ? 0 : 28;
        const startW = Math.floor((camX - 200) / step) * step;
        for (let wx = startW; wx < camX + 520; wx += step) {
          const sx = Stage.screenX(wx + shift, ym, camX);
          if (sx < -1 || sx > W) continue;
          D().rect(g, sx, y0 + 1, 1, y1 - y0 - 1, seam);
        }
      }
      // 벽 쪽 그늘
      D().dither(g, 0, 112, W, 6, C.brown, 6);
      D().dither(g, 0, 118, W, 4, C.brown, 2);
      void H;
    }

    // 경기장 선 (대회장: 흰 테이프 경계선, 도장: 개시선만)
    drawCourt(g, camX) {
      const C = PK.COL, CF = PK.CONFIG;
      const lineC = C.white;
      if (this.kind === 'arena') {
        // 좌우 경계선 (원근으로 기울어짐)
        [CF.COURT_LEFT, CF.COURT_RIGHT].forEach(function (wx) {
          for (let y = 116; y < 176; y++) D().px(g, Stage.screenX(wx, y, camX), y, lineC);
        });
        // 앞뒤 경계선
        const yb = 116, yf = 175;
        const xb0 = Stage.screenX(CF.COURT_LEFT, yb, camX), xb1 = Stage.screenX(CF.COURT_RIGHT, yb, camX);
        D().rect(g, xb0, yb, xb1 - xb0 + 1, 1, lineC);
        const xf0 = Stage.screenX(CF.COURT_LEFT, yf, camX), xf1 = Stage.screenX(CF.COURT_RIGHT, yf, camX);
        D().rect(g, xf0, yf, xf1 - xf0 + 1, 1, lineC);
        // 중앙 X 표시
        const cx = Stage.screenX(CF.COURT_CENTER, CF.GROUND_Y, camX);
        D().line(g, cx - 2, CF.GROUND_Y - 6, cx + 2, CF.GROUND_Y - 2, lineC);
        D().line(g, cx + 2, CF.GROUND_Y - 6, cx - 2, CF.GROUND_Y - 2, lineC);
      }
      // 개시선
      [CF.COURT_CENTER - CF.START_GAP, CF.COURT_CENTER + CF.START_GAP].forEach(function (wx) {
        for (let y = CF.GROUND_Y - 10; y <= CF.GROUND_Y + 6; y++) D().px(g, Stage.screenX(wx, y, camX), y, lineC);
      });
    }

    drawFront(g, camX) {
      // 대회장 앞쪽 바닥 끝 그늘
      const C = PK.COL, CF = PK.CONFIG;
      if (this.kind === 'arena') D().dither(g, 0, 176, CF.SCREEN_W, 4, C.navyDark, 6);
      else D().dither(g, 0, 176, CF.SCREEN_W, 4, C.brown, 6);
      void camX;
    }
  }

  // 현판용 나무 틀
  function UIbox(g, x, y, w, h) {
    const C = PK.COL;
    D().rect(g, x, y, w, h, C.outline);
    D().rect(g, x + 1, y + 1, w - 2, h - 2, C.gold);
    D().rect(g, x + 2, y + 2, w - 4, h - 4, C.plum);
    D().rect(g, x + 2, y + h - 3, w - 4, 1, C.outline);
  }

  PK.Stage = Stage;
})(window.PK = window.PK || {});
