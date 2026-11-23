// =====================================================
// 노트 레인 (하이웨이) 그리기: 플레이어 1명분
//  - 노트 위치는 곡 시계(오디오)로 매번 계산 → 프레임과 상관없이 부드럽게 내려옴
//  - 판정선의 키캡에 그 플레이어의 키 글자가 항상 보임
// =====================================================

// 색 있는 디더 무늬 (반투명 대신 픽셀 체크무늬로 빛/그림자 표현)
const DITHER = {
  cache: new Map(),
  get(ctx, key, level) {
    const id = key + '|' + level;
    if (!this.cache.has(id)) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = C(key);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER4[y][x] < level) g.fillRect(x, y, 1, 1);
      this.cache.set(id, ctx.createPattern(c, 'repeat'));
    }
    return this.cache.get(id);
  },
};

// 판정 글자 색
const JUDGE_STYLE = {
  perfect: { text: 'PERFECT', color: '9' },
  great: { text: 'GREAT', color: 'h' },
  good: { text: 'GOOD', color: 'e' },
  miss: { text: 'MISS', color: 'j' },
};

class Highway {
  // layout: { x(첫 레인 왼쪽), laneW, top, judgeY, size('small'|'big') }
  constructor(performer, layout, keyLabels) {
    this.p = performer;
    this.L = layout;
    this.keys = keyLabels;
    this.rptr = [0, 0, 0]; // 레인별 그리기 시작 노트 (화면을 지나간 노트는 건너뜀)
    this.comboPop = 0;
    this.lastCombo = 0;
    this.stamp = null; // 끝났을 때 'FULL COMBO' 도장
    this.stampT = 0;
  }

  get width() {
    return this.L.laneW * 3;
  }

  get centerX() {
    return this.L.x + this.width / 2;
  }

  laneX(l) {
    return this.L.x + l * this.L.laneW + this.L.laneW / 2;
  }

  // 곡 시간 → 화면 y (판정선 기준)
  yOf(time, t, approach) {
    const span = this.L.judgeY - this.L.top;
    return this.L.judgeY - ((time - t) / approach) * span;
  }

  update() {
    if (this.p.combo > this.lastCombo) this.comboPop = 5;
    this.lastCombo = this.p.combo;
    if (this.comboPop > 0) this.comboPop--;
    if (this.stamp) this.stampT++;
  }

  render(ctx, t, approach, frame, beatSec) {
    const L = this.L;
    const p = this.p;
    const big = L.size === 'big';
    const x0 = L.x;
    const w = this.width;
    const top = L.top;
    const jy = L.judgeY;

    // ---- 바탕: 어두운 반투명 레인 + 테두리 ----
    // 노트가 잘 보이도록 거의 불투명한 어두운 바탕 (배경이 살짝만 비침)
    ctx.fillStyle = DITHER.get(ctx, 'o', 15);
    ctx.fillRect(x0, top - 2, w, jy - top + 10);
    ctx.fillStyle = DITHER.get(ctx, '2', 2);
    ctx.fillRect(x0, top - 2, w, jy - top + 10);
    // 레인 구분선
    ctx.fillStyle = C('2');
    for (let l = 1; l < 3; l++) ctx.fillRect(x0 + l * L.laneW, top - 2, 1, jy - top + 10);
    // 테두리 (피버면 금색 반짝임)
    const fever = p.fever;
    const edge = fever ? ((frame >> 2) % 2 ? '9' : 'a') : p.def.color;
    ctx.fillStyle = C('1');
    ctx.fillRect(x0 - 2, top - 2, 1, jy - top + 10);
    ctx.fillRect(x0 + w + 1, top - 2, 1, jy - top + 10);
    ctx.fillStyle = C(edge);
    ctx.fillRect(x0 - 1, top - 2, 1, jy - top + 10);
    ctx.fillRect(x0 + w, top - 2, 1, jy - top + 10);
    if (fever) {
      // 피버: 테두리를 타고 올라가는 반짝이
      ctx.fillStyle = C('b');
      for (let k = 0; k < 3; k++) {
        const yy = jy - (((frame * 2 + k * 31) % (jy - top)) | 0);
        ctx.fillRect(x0 - 1, yy, 1, 2);
        ctx.fillRect(x0 + w, top + jy - yy, 1, 2);
      }
    }

    // ---- 박자선 (마디선은 밝게) ----
    const bStart = Math.ceil(t / beatSec);
    const bEnd = Math.floor((t + approach) / beatSec);
    for (let b = bStart; b <= bEnd; b++) {
      if (b < 0) continue;
      const y = Math.round(this.yOf(b * beatSec, t, approach));
      if (y < top) continue;
      const barLine = b % 4 === 0;
      ctx.fillStyle = barLine ? C('i') : C('2');
      for (let x = x0; x < x0 + w; x += barLine ? 1 : 2) ctx.fillRect(x, y, 1, 1);
    }

    // ---- 누르고 있는 레인 빛 / 맞혔을 때 빛기둥 ----
    for (let l = 0; l < 3; l++) {
      const lc = LANE_COLORS[l];
      const lx = x0 + l * L.laneW + 1;
      const lw = L.laneW - 1;
      if (p.keyDown[l]) {
        const hgt = big ? 46 : 30;
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = DITHER.get(ctx, lc.dark, 8 - i * 2);
          ctx.fillRect(lx, jy - hgt + i * (hgt / 4), lw, hgt / 4);
        }
      }
      if (p.hitT[l] > 0) {
        const k = p.hitT[l] / 12;
        const hgt = Math.round((big ? 70 : 44) * k);
        const col = p.hitKind[l] === 'perfect' ? lc.glow : lc.hi;
        ctx.fillStyle = DITHER.get(ctx, col, Math.round(2 + k * 5));
        ctx.fillRect(lx + 1, jy - hgt, lw - 2, hgt);
        ctx.fillStyle = C(col);
        ctx.fillRect(lx + Math.floor(lw / 2) - 1, jy - Math.round(hgt * 0.6), 2, Math.round(hgt * 0.6));
      }
    }

    // ---- 콤보: 레인 위(이름 아래)에 작게 — 노트가 떨어지는 길을 가리지 않음 ----
    if (L.comboTop && p.combo >= 5) {
      const pop = this.comboPop > 2 ? -1 : 0;
      const txt = `${p.combo} 콤보`;
      // 뒤 배경(달 · 간판)과 섞이지 않게 어두운 바탕
      const tw = Math.min(w + 8, KText.width(txt, 'b') + 8);
      ctx.fillStyle = DITHER.get(ctx, 'o', 14);
      ctx.fillRect(Math.round(this.centerX - tw / 2), top - 13 + pop, tw, 12);
      KText.draw(ctx, txt, this.centerX, top - 14 + pop, fever ? C(frame % 10 < 5 ? '9' : 'a') : C('a'), { align: 'center', font: KText.width(txt, 'b') <= w + 6 ? 'b' : 'n', outline: C('1') });
    }

    // ---- 판정 글자: 노트보다 먼저 그려서 노트를 가리지 않음 · 레인 폭에 맞는 크기 ----
    const last = p.last;
    if (last && last.age < 30) {
      const st = JUDGE_STYLE[last.kind];
      const y = jy - (big ? 44 : 26) - (last.age < 4 ? 4 - last.age : 0);
      let col = C(st.color);
      if (last.kind === 'perfect') col = C(['9', 'b', 't', '8'][(frame >> 1) % 4]);
      if (!(last.age > 22 && last.age % 4 < 2)) {
        const font = KText.width(st.text, 'b') <= w + 2 ? 'b' : 'n';
        KText.draw(ctx, st.text, this.centerX, y, col, { align: 'center', font, outline: C('1') });
        if (big && last.early) KText.draw(ctx, last.early === 'early' ? 'FAST' : 'SLOW', this.centerX, y + 14, last.early === 'early' ? C('h') : C('5'), { align: 'center', font: 's', outline: C('1') });
      }
    }

    // ---- 노트 (레인 밖으로 삐져나오지 않게 잘라서 그림) ----
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 - 2, top - 2, w + 4, jy - top + 14); // 레인 위(이름 · 콤보) 쪽으로는 안 그림
    ctx.clip();
    const chip = SPR.chips[L.size];
    const chipH = chip[0].height;
    const chipW = chip[0].width;
    for (let l = 0; l < 3; l++) {
      const list = p.lanes[l];
      const lc = LANE_COLORS[l];
      const cx = Math.round(this.laneX(l));
      // 화면을 완전히 지나간 노트 건너뛰기
      while (this.rptr[l] < list.length) {
        const n = list[this.rptr[l]];
        const endT = n.endTime !== null ? n.endTime : n.time;
        const gone = n.endTime !== null ? n.tail !== null && !n.holding : n.head !== null;
        if (gone && (n.head !== 'miss' || endT < t - 0.4)) this.rptr[l]++;
        else break;
      }
      for (let i = this.rptr[l]; i < list.length; i++) {
        const n = list[i];
        if (n.time > t + approach + 0.05) break;
        const missed = n.head === 'miss';
        const hit = n.head !== null && !missed;
        // 머리를 맞힌 탭 노트는 사라짐
        if (hit && n.endTime === null) continue;
        let yHead = this.yOf(n.time, t, approach);
        if (n.endTime !== null) {
          // 롱노트 몸통
          if (n.tail !== null && !n.holding && !missed) continue; // 끝난 롱노트
          let yTail = Math.max(top, this.yOf(n.endTime, t, approach));
          if (n.holding) yHead = jy; // 누르는 동안 머리는 판정선에 붙어 있음
          const bw = big ? 10 : 6;
          const bx = cx - bw / 2;
          const yy = Math.round(yTail);
          const hh = Math.round(yHead) - yy;
          if (hh > 0) {
            if (missed) {
              ctx.fillStyle = C('i');
              ctx.fillRect(bx, yy, bw, hh);
            } else {
              ctx.fillStyle = C('1');
              ctx.fillRect(bx - 1, yy, bw + 2, hh);
              ctx.fillStyle = C(n.holding ? lc.body : lc.dark);
              ctx.fillRect(bx, yy, bw, hh);
              ctx.fillStyle = C(n.holding ? (frame % 6 < 3 ? 'b' : lc.hi) : lc.body);
              ctx.fillRect(bx + bw / 2 - 1, yy, 2, hh);
              // 누르는 중: 몸통을 타고 흐르는 빛
              if (n.holding) {
                ctx.fillStyle = C('b');
                for (let k = (frame * 2) % 8; k < hh; k += 8) ctx.fillRect(bx, yy + hh - k, bw, 1);
              }
            }
            // 꼬리 끝 캡
            ctx.fillStyle = C('1');
            ctx.fillRect(bx - 1, yy - 2, bw + 2, 3);
            ctx.fillStyle = C(missed ? 'j' : lc.hi);
            ctx.fillRect(bx, yy - 1, bw, 1);
          }
        }
        if (n.holding) continue;
        if (yHead < top - chipH || yHead > jy + 18) continue;
        const nx = cx - chipW / 2;
        const ny = Math.round(yHead - chipH / 2);
        if (missed) {
          ctx.globalAlpha = 1;
          ctx.drawImage(SPR.chipFlash[L.size], nx, ny);
          ctx.fillStyle = DITHER.get(ctx, 'i', 16);
          ctx.fillRect(nx, ny, chipW, chipH);
          continue;
        }
        ctx.drawImage(chip[l], nx, ny);
      }
    }

    ctx.restore();

    // 위쪽은 어둡게 (노트가 스르륵 나타남)
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = DITHER.get(ctx, 'o', 14 - i * 4);
      ctx.fillRect(x0, top - 2 + i * 3, w, 3);
    }

    // ---- 판정선 + 키캡 (조작키 항상 표시) ----
    ctx.fillStyle = C('1');
    ctx.fillRect(x0 - 1, jy - 1, w + 2, 3);
    ctx.fillStyle = fever ? C(frame % 8 < 4 ? '9' : 'b') : C('a');
    ctx.fillRect(x0, jy, w, 1);
    for (let l = 0; l < 3; l++) {
      const pressed = p.keyDown[l];
      const cap = getKeycap(L.size, l, this.keys[l], pressed);
      const cx = Math.round(this.laneX(l) - cap.width / 2);
      const cy = Math.round(jy - (cap.height - 2) / 2);
      ctx.drawImage(cap, cx, cy);
      if (p.hitT[l] > 8) {
        // 맞힌 순간 키캡 테두리 번쩍
        ctx.fillStyle = C('b');
        ctx.fillRect(cx, cy - 1, cap.width, 1);
        ctx.fillRect(cx, cy + cap.height - 1, cap.width, 1);
        if (p.hitKind[l] === 'perfect') {
          // PERFECT: 판정선 번쩍 + 네 방향 별빛
          const k = p.hitT[l] - 8;
          ctx.fillRect(x0, jy - 1, w, 2);
          const sx = Math.round(this.laneX(l));
          const r = 6 - k;
          ctx.fillStyle = C('t');
          ctx.fillRect(sx - r - 3, jy - 1, 3, 1);
          ctx.fillRect(sx + r + 1, jy - 1, 3, 1);
          ctx.fillRect(sx, jy - r - 4, 1, 3);
        }
      }
    }


    // ---- 끝났을 때 도장 ----
    if (this.stamp) {
      const k = Math.min(1, this.stampT / 8);
      const y = top + 40 + Math.round((1 - k) * -20);
      const col = this.stamp === 'ALL PERFECT' ? '9' : 'e';
      // 좁은 레인에서는 두 줄 (ALL / PERFECT)
      const lines = big ? [this.stamp] : this.stamp.split(' ');
      const tw = Math.max(...lines.map((ln) => KText.width(ln, 'b'))) + 8;
      const th = lines.length * 13 + 4;
      ctx.fillStyle = C('1');
      ctx.fillRect(Math.round(this.centerX - tw / 2) - 1, y - 4, tw + 2, th + 2);
      ctx.fillStyle = C(this.stampT % 10 < 5 ? col : 'b');
      ctx.fillRect(Math.round(this.centerX - tw / 2), y - 3, tw, th);
      lines.forEach((ln, i) => KText.draw(ctx, ln, this.centerX, y - 2 + i * 13, C('1'), { align: 'center', font: 'b' }));
    }
  }
}
