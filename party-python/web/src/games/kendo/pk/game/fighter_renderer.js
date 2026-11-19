(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 선수 그리기 (조립식 픽셀 리그)
  //  하반신(하카마·갑상) + 상반신(면·갑) 스프라이트는 2D 배열 데이터에서 굽고,
  //  팔·호완(코테)·죽도는 자세 표의 손 위치/칼 각도로 픽셀 단위 직선을 찍어 그린다.
  //  → 한 장의 오프스크린(72×56)에 오른쪽 방향으로 그린 뒤 필요하면 좌우 반전해 화면에 찍는다.
  //  호구·도복 실루엣이 잘 보이도록 팔과 코테는 어두운 1px 외곽선을 가진다.
  // ─────────────────────────────────────────────────────────────
  const OW = 72, OH = 56;          // 오프스크린 크기
  const OX = 24, OY = 52;          // 오프스크린 안에서 발 중앙 위치

  // 자세 표: hand = 오른손(죽도 코등이 쪽) 위치 [발 중앙 기준 x, y], ang = 칼 각도(라디안, 아래가 +)
  const POSES = {
    kamae:       { legs: 'legs_stand', torso: 'torso',      hand: [8, -15],  ang: -0.30 },
    raise:       { legs: 'legs_stand', torso: 'torso',      hand: [3, -31],  ang: -1.95 },
    swing:       { legs: 'legs_stepA', torso: 'torso_lean', hand: [10, -27], ang: -0.95 },
    men:         { legs: 'legs_stomp', torso: 'torso_lean', hand: [12, -23], ang: -0.22 },
    menFollow:   { legs: 'legs_stepA', torso: 'torso',      hand: [11, -21], ang: -0.40 },
    koteRaise:   { legs: 'legs_stand', torso: 'torso',      hand: [7, -23],  ang: -1.15 },
    kote:        { legs: 'legs_stomp', torso: 'torso_lean', hand: [12, -17], ang: 0.08 },
    koteFollow:  { legs: 'legs_stepA', torso: 'torso',      hand: [10, -18], ang: -0.25 },
    doRaise:     { legs: 'legs_stand', torso: 'torso',      hand: [3, -31],  ang: -1.60 },
    doSwing:     { legs: 'legs_stepA', torso: 'torso_lean', hand: [9, -23],  ang: -0.35 },
    do:          { legs: 'legs_stomp', torso: 'torso_lean', hand: [11, -14], ang: 0.12 },
    doFollow:    { legs: 'legs_stepA', torso: 'torso',      hand: [9, -15],  ang: -0.05 },
    block:       { legs: 'legs_stand', torso: 'torso',      hand: [6, -29],  ang: -0.55 },
    stun:        { legs: 'legs_stepB', torso: 'torso_bent', hand: [7, -11],  ang: 0.45, dy: 1 },
    stagger:     { legs: 'legs_stepB', torso: 'torso_back', hand: [4, -25],  ang: -1.05 },
    sonkyo:      { legs: 'legs_crouch', torso: 'torso',     hand: [8, -11],  ang: -0.32 },
    presentMen:  { legs: 'legs_stand', torso: 'torso',      hand: [8, -14],  ang: 0.55 },
    presentKote: { legs: 'legs_stand', torso: 'torso',      hand: [6, -23],  ang: -1.00 },
    presentDo:   { legs: 'legs_stand', torso: 'torso',      hand: [3, -31],  ang: -1.70 }
  };
  const STEP_LEGS = ['legs_stepA', 'legs_stand', 'legs_stepB', 'legs_stand'];

  const FR = {
    POSES: POSES,

    // 상태 → 자세 이름 + 보정값
    poseOf(f) {
      const A = PK.CONFIG.ANIM_TICKS;
      let name = 'kamae', legs = null, handDy = 0, torsoDx = 0;
      switch (f.state) {
        case 'strike': {
          const s = f.strike;
          const p = s.t / s.startup;
          const T = s.type;
          if (s.t < s.startup) {
            if (T === 'men') name = p < 0.55 ? 'raise' : 'swing';
            else if (T === 'kote') name = p < 0.6 ? 'koteRaise' : 'kote';
            else name = p < 0.55 ? 'doRaise' : 'doSwing';
          } else {
            const after = s.t - s.startup;
            name = after < 9 ? T : T + 'Follow';
            if (s.bad && after > 12 && ((after >> 2) % 2)) torsoDx = -1;   // 헛친 뒤 흔들림
          }
          break;
        }
        case 'block': name = 'block'; break;
        case 'stagger': name = 'stagger'; torsoDx = (f.stateT >> 2) % 2 ? -1 : 0; break;
        case 'stun': name = 'stun'; handDy = (f.stateT >> 4) % 2; break;
        case 'sonkyo': name = 'sonkyo'; break;
        case 'present':
          name = f.presentTarget === 'men' ? 'presentMen' : f.presentTarget === 'kote' ? 'presentKote' : 'presentDo';
          break;
        case 'move':
          legs = STEP_LEGS[f.stepFrame];
          handDy = f.stepFrame % 2 ? 0 : 1;
          break;
        default:
          // 겨눔 대기: 숨쉬기 2프레임
          handDy = Math.floor(f.animT / (A * 5)) % 2;
      }
      return { pose: POSES[name], name: name, legs: legs, handDy: handDy, torsoDx: torsoDx };
    },

    getCanvas(f) {
      if (!f._cv) {
        const cv = document.createElement('canvas');
        cv.width = OW; cv.height = OH;
        f._cv = cv;
        f._g = cv.getContext('2d');
        f._spr = { canvas: cv, w: OW, h: OH, ax: OX, ay: OY };
      }
      return f._g;
    },

    // 칼끝 월드 좌표 (불꽃 위치 등)
    tipWorld(f) {
      const r = this.poseOf(f);
      const p = r.pose;
      const len = f.swordLen;
      return {
        x: f.x + f.facing * (p.hand[0] + Math.cos(p.ang) * len),
        y: PK.CONFIG.GROUND_Y + p.hand[1] + Math.sin(p.ang) * len
      };
    },

    draw(g, f, camX, groundY, opt) {
      opt = opt || {};
      const C = PK.COL, D = PK.Draw;
      const og = this.getCanvas(f);
      og.clearRect(0, 0, OW, OH);
      const r = this.poseOf(f);
      const pose = r.pose;
      const legs = PK.Assets.get(r.legs || (f.squashT > 0 && f.state === 'strike' ? 'legs_stomp' : pose.legs), f.swapKey);
      const torsoName = f.flinchT > 0 ? 'torso_back' : pose.torso;
      const torso = PK.Assets.get(torsoName, f.swapKey);
      const lh = legs.ay;
      // 스쿼시: 발구름 순간 상체가 1px 내려앉음
      const tdy = (pose.dy || 0) + (f.squashT > 1 ? 1 : 0);
      const tdx = r.torsoDx + (f.flinchT > 4 ? -1 : 0);

      const hx = pose.hand[0] + tdx, hy = pose.hand[1] + r.handDy + tdy;
      const ca = Math.cos(pose.ang), sa = Math.sin(pose.ang);
      // 왼손은 자루 끝 쪽
      const lx = hx - ca * 5, ly = hy - sa * 5;
      const sy = -lh - 7 + tdy;
      const shF = [1 + tdx, sy], shB = [-2 + tdx, sy];

      // 1) 뒤쪽 팔 (몸 뒤로 지나감)
      this.arm(og, shB, [lx, ly], f.swapKey === 'sensei' ? C.grey : C.navyDark);
      // 2) 하반신, 상반신
      D.sprite(og, legs, OX, OY, false);
      D.sprite(og, torso, OX + tdx, OY - lh + tdy, false);
      // 3) 죽도
      this.shinai(og, hx, hy, pose.ang, f.swordLen);
      // 4) 앞쪽 팔 + 코테(호완)
      this.arm(og, shF, [hx, hy], f.swapKey === 'sensei' ? C.lgrey : C.navy);
      this.kote(og, lx, ly, C.navyDark);
      this.kote(og, hx, hy, C.navy);

      // 화면에 찍기
      const sx = Math.round(f.x - camX) + (opt.offX || 0);
      D.sprite(g, f._spr, sx, groundY, f.facing < 0);
    },

    // 팔: 1px 외곽선 + 2px 소매
    arm(g, a, b, color) {
      const C = PK.COL;
      g.fillStyle = C.outline;
      PK.Draw.linePoints(OX + a[0], OY + a[1], OX + b[0], OY + b[1], function (x, y) { g.fillRect(x - 1, y - 1, 4, 4); });
      g.fillStyle = color;
      PK.Draw.linePoints(OX + a[0], OY + a[1], OX + b[0], OY + b[1], function (x, y) { g.fillRect(x, y, 2, 2); });
    },

    // 코테: 3×3 장갑 + 외곽선, 손바닥 가죽 한 점
    kote(g, x, y, color) {
      const C = PK.COL;
      x = Math.round(OX + x); y = Math.round(OY + y);
      g.fillStyle = C.outline; g.fillRect(x - 2, y - 2, 5, 5);
      g.fillStyle = color; g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = C.navyLight; g.fillRect(x - 1, y - 1, 1, 1);
      g.fillStyle = C.cream; g.fillRect(x + 1, y + 1, 1, 1);
    },

    // 죽도: 자루(흰 가죽) → 코등이(검정) → 대나무 → 중결(갈색 끈) → 선혁(흰 끝)
    shinai(g, hx, hy, ang, len) {
      const C = PK.COL;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      // 1차: 대나무 부분 아래쪽에 1px 어두운 테두리 (밝은 바닥 위에서도 칼이 보이도록)
      g.fillStyle = C.outline;
      for (let t = 1; t <= len; t += 0.5) {
        g.fillRect(Math.round(OX + hx + ca * t), Math.round(OY + hy + sa * t) + 1, 1, 1);
      }
      // 2차: 색
      let lastX = null, lastY = null;
      for (let t = -7; t <= len; t += 0.5) {
        const x = Math.round(OX + hx + ca * t), y = Math.round(OY + hy + sa * t);
        if (x === lastX && y === lastY) continue;
        lastX = x; lastY = y;
        let c;
        if (t < -6) c = C.lgrey;
        else if (t < -0.5) c = C.white;
        else if (t <= 0.5) {
          c = C.outline;
          // 코등이는 칼과 수직으로 3px
          g.fillStyle = C.outline;
          g.fillRect(Math.round(x - sa), Math.round(y + ca), 1, 1);
          g.fillRect(Math.round(x + sa), Math.round(y - ca), 1, 1);
        }
        else if (t > len - 2.5) c = C.white;
        else if (Math.abs(t - len * 0.66) < 0.6) c = C.brown;
        else c = C.cream;
        g.fillStyle = c;
        g.fillRect(x, y, 1, 1);
      }
    }
  };

  PK.FighterRenderer = FR;
})(window.PK = window.PK || {});
