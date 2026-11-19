(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Referee — 심판 3명 (부심·주심·부심)
  //  - vote(): 판정 결과(evaluateStrike)를 보고 각자 기준값 + 약간의 개인차로 깃발을 정한다
  //      'red' / 'white' = 해당 색 깃발을 올림, 'wave' = 깃발을 아래에서 교차해 흔듦(무효), 'none'
  //  - 2명 이상이 같은 색을 올리면 한판
  //  - 컷인: 판정·시합 시작 때 화면 위쪽에 심판 3명을 크게 보여 주는 연출
  //  앞을 보고 선 심판은 오른손(화면 왼쪽)에 홍기, 왼손(화면 오른쪽)에 백기를 든다.
  // ─────────────────────────────────────────────────────────────
  const RW = 32, RH = 40;     // 심판 오프스크린
  const RX = 8, RY = 6;       // 그 안에서 스프라이트 좌상단

  // 자세별 손 위치 (스프라이트 좌표, L=화면 왼쪽 손=홍기, R=백기) 와 깃발 방향
  const HANDS = {
    down:   { L: [1, 19],  R: [14, 19], fL: 'down', fR: 'down' },
    red:    { L: [-2, 1],  R: [14, 19], fL: 'up',   fR: 'down' },
    white:  { L: [1, 19],  R: [17, 1],  fL: 'down', fR: 'up' },
    wave:   { L: [10, 19], R: [5, 19],  fL: 'cross', fR: 'cross' },
    hold:   { L: [-3, 10], R: [18, 10], fL: 'out',  fR: 'out' }
  };

  class Referee {
    constructor(x, cfg, isMain) {
      this.x = x;
      this.baseX = x;
      this.cfg = cfg;
      this.isMain = isMain;
      this.pose = 'down';
      this.t = 0;
      this.hold = 0;
      this.cv = document.createElement('canvas');
      this.cv.width = RW; this.cv.height = RH;
      this.g = this.cv.getContext('2d');
      this.spr = { canvas: this.cv, w: RW, h: RH, ax: RX + 8, ay: RY + 26 };
    }

    set(pose, hold) {
      this.pose = pose;
      this.t = 0;
      this.hold = hold || 70;
    }

    update() {
      this.t++;
      if (this.pose !== 'down' && this.t > this.hold) this.set('down');
    }

    // 오프스크린에 심판 + 팔 + 깃발 그리기
    render() {
      const C = PK.COL, D = PK.Draw, g = this.g;
      g.clearRect(0, 0, RW, RH);
      D.sprite(g, PK.Assets.get('referee'), RX + 8, RY + 26, false);
      const h = HANDS[this.pose];
      // 흔들기 애니메이션 (무효 표시)
      let wob = 0;
      if (this.pose === 'wave') wob = ((this.t >> 3) % 2) ? 2 : -1;
      // 올리는 순간 1틱 늦게 따라오는 느낌
      const rise = this.t < 4 && (this.pose === 'red' || this.pose === 'white') ? 4 - this.t : 0;
      const L = [h.L[0] + (this.pose === 'wave' ? wob : 0), h.L[1] + (this.pose === 'red' ? rise : 0)];
      const R = [h.R[0] - (this.pose === 'wave' ? wob : 0), h.R[1] + (this.pose === 'white' ? rise : 0)];
      this.arm(g, [3, 9], L);
      this.arm(g, [12, 9], R);
      this.flag(g, L, h.fL, 'red', -1, wob);
      this.flag(g, R, h.fR, 'white', 1, wob);
    }

    arm(g, a, b) {
      const C = PK.COL;
      g.fillStyle = C.outline;
      PK.Draw.linePoints(RX + a[0], RY + a[1], RX + b[0], RY + b[1], function (x, y) { g.fillRect(x - 1, y - 1, 3, 3); });
      g.fillStyle = C.navy;
      PK.Draw.linePoints(RX + a[0], RY + a[1], RX + b[0], RY + b[1], function (x, y) { g.fillRect(x, y, 1, 1); });
      g.fillStyle = C.skin;
      g.fillRect(RX + b[0], RY + b[1], 2, 2);
    }

    // 깃발: 깃대(갈색) + 천(5×4)
    flag(g, hand, dir, color, side, wob) {
      const C = PK.COL;
      const main = color === 'red' ? C.red : C.white;
      const shade = color === 'red' ? C.darkRed : C.lgrey;
      const hx = RX + hand[0], hy = RY + hand[1];
      let sx, sy, ex, ey, fx, fy, fw = 5, fh = 4;
      if (dir === 'up') { sx = hx; sy = hy; ex = hx + side; ey = hy - 5; fx = side < 0 ? ex - 5 : ex + 1; fy = ey; }
      else if (dir === 'out') { sx = hx; sy = hy; ex = hx + side * 4; ey = hy - 2; fx = side < 0 ? ex - 5 : ex + 1; fy = ey - 3; }
      else if (dir === 'cross') { sx = hx; sy = hy; ex = hx - side * 4; ey = hy + 4; fx = side < 0 ? ex : ex - 5; fy = ey; fy += wob > 0 ? 1 : 0; }
      else { sx = hx; sy = hy + 1; ex = hx + side; ey = hy + 5; fx = side < 0 ? ex - 5 : ex + 1; fy = ey - 3; fw = 4; fh = 5; }
      g.fillStyle = C.wood;
      PK.Draw.linePoints(sx, sy, ex, ey, function (x, y) { g.fillRect(x, y, 1, 1); });
      g.fillStyle = C.outline;
      g.fillRect(fx - 1, fy - 1, fw + 2, fh + 2);
      g.fillStyle = main;
      g.fillRect(fx, fy, fw, fh);
      g.fillStyle = shade;
      g.fillRect(fx, fy + fh - 1, fw, 1);
    }
  }

  class Referees {
    constructor() {
      const C = PK.CONFIG;
      const xs = [C.COURT_LEFT + 18, C.COURT_CENTER, C.COURT_RIGHT - 18];
      this.refs = C.REFEREES.map(function (cfg, i) { return new Referee(xs[i], cfg, i === 1); });
      this.cutin = null;
    }

    // 판정 투표 (심판마다 기준값이 조금씩 다르고, 매번 약간의 개인차가 있다)
    vote(ev, side) {
      const C = PK.CONFIG;
      return this.refs.map(function (r) {
        const th = r.cfg.threshold + (Math.random() * 2 - 1) * C.REF_NOISE;
        if (ev.valid && ev.quality >= th) return side;
        if (!ev.valid || ev.quality >= C.JUDGE.WAVE_MIN) return 'wave';
        return 'none';
      });
    }

    show(votes) {
      const self = this;
      votes.forEach(function (v, i) {
        const r = self.refs[i];
        if (v === 'red' || v === 'white') r.set(v, 80);
        else if (v === 'wave') r.set('wave', 40);
      });
      if (votes.some(function (v) { return v === 'red' || v === 'white'; })) {
        this.cutin = { kind: 'judge', t: 0, dur: 84 };
        PK.Audio.sfx('flag');
      }
    }

    // 시합 시작 — 주심이 양팔을 벌린다
    hajime(label) {
      this.refs[1].set('hold', 40);
      this.cutin = { kind: 'start', label: label || '시작!', t: 0, dur: 60 };
    }

    reset() {
      this.refs.forEach(function (r) { r.set('down'); r.x = r.baseX; });
      this.cutin = null;
    }

    // 주심은 두 선수 가운데를 따라 천천히 움직인다
    update(midX) {
      const main = this.refs[1];
      if (midX !== undefined) {
        const target = PK.CONFIG.COURT_CENTER + (midX - PK.CONFIG.COURT_CENTER) * 0.6;
        main.x += Math.max(-0.4, Math.min(0.4, target - main.x));
      }
      this.refs.forEach(function (r) { r.update(); });
      if (this.cutin && ++this.cutin.t > this.cutin.dur) this.cutin = null;
    }

    draw(g, camX) {
      const C = PK.CONFIG, D = PK.Draw;
      // 원근감: 뒤쪽 심판은 바닥 원근 계수에 맞춰 x 위치를 조정
      this.refs.forEach(function (r) {
        r.render();
        const sx = PK.Stage.screenX(r.x, C.REF_GROUND_Y, camX);
        D.shadow(g, sx, C.REF_GROUND_Y, 14, PK.COL.outline, 7);
        D.sprite(g, r.spr, sx, C.REF_GROUND_Y, false);
      });
    }

    // 컷인 (화면 위쪽) — 심판 상반신을 2배로 크게
    drawCutin(g) {
      const c = this.cutin;
      if (!c) return;
      const C = PK.COL, D = PK.Draw;
      const W = 216, H = 66;
      const x = (PK.CONFIG.SCREEN_W - W) >> 1;
      // 위에서 미끄러져 내려오고, 끝날 때 다시 올라간다
      const inT = Math.min(1, c.t / 8), outT = Math.max(0, (c.t - (c.dur - 8)) / 8);
      const y = Math.round(-H + (H + 1) * inT - (H + 1) * outT);   // HUD 위를 잠시 덮는다
      PK.UI.box(g, x, y, W, H, 'dark');
      D.dither(g, x + 3, y + 3, W - 6, H - 6, C.navy, 6);
      for (let i = 0; i < 3; i++) {
        const r = this.refs[i];
        r.render();
        const bx = x + 12 + i * 68;
        g.drawImage(r.cv, 0, 0, RW, 30, bx, y + 4, RW * 2, 60);
      }
      const label = c.kind === 'start' ? c.label : '판정';
      PK.Font.draw(g, label, x + (W >> 1), y + H - 15, { font: 'M', color: C.yellow, outline: C.outline, align: 'center' });
    }
  }

  PK.Referees = Referees;
})(window.PK = window.PK || {});
