// =====================================================
// 마법사 성 카지노 무대 (패럴랙스 배경)
//  1) 밤하늘 + 달 + 별        (가만히, 별만 반짝)
//  2) 먼 성 실루엣             (아주 천천히 흐름)
//  3) 가까운 성 + 네온 간판     (조금 빠르게 흐름)
//  4) 스포트라이트             (박자에 맞춰 흔들림)
//  5) 디스코 바닥 타일          (박자마다 무늬가 바뀌며 빛남)
// =====================================================
const STAGE = {
  FLOOR_TOP: 120,   // 바닥 시작 높이
  HORIZON: 60,      // 원근 소실점 높이
};

// 밝은 색 → 한 단계 어두운 색 (바닥 불빛이 꺼져 갈 때)
const DIM_OF = { 9: '8', 6: '7', g: 'f', 4: '3', d: 'c', h: 'g', 5: '6', q: '3', e: 'd' };

class Stage {
  constructor() {
    if (!Stage.layers) Stage.layers = Stage.buildLayers();
    this.floorCanvas = document.createElement('canvas');
    this.floorCanvas.width = CONFIG.WIDTH;
    this.floorCanvas.height = CONFIG.HEIGHT - STAGE.FLOOR_TOP;
    this.floorCtx = this.floorCanvas.getContext('2d');
    this.floorImg = this.floorCtx.createImageData(this.floorCanvas.width, this.floorCanvas.height);
    this.tileGlow = new Float32Array(Stage.layers.tileCount);
    this.tileColor = new Array(Stage.layers.tileCount).fill('9');
    this.lastBeat = -99;
    this.pulse = 0;      // 박자마다 1 → 0 (조명 번쩍)
    this.fever = false;  // 코러스 '잭팟 타임'
    this.patternIdx = 0;
  }

  // ---------- 한 번만 그리는 배경 레이어 ----------
  static buildLayers() {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    const mk = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return [c, c.getContext('2d')];
    };
    const rect = (g, x, y, w, h, k) => {
      g.fillStyle = C(k);
      g.fillRect(x, y, w, h);
    };
    // 1) 밤하늘: 위는 깊은 남색, 아래로 갈수록 보라 (디더로 단계 섞기)
    const [sky, sg] = mk(W, H);
    const bands = ['o', 'o', 'f', '2', '3'];
    for (let y = 0; y < STAGE.FLOOR_TOP; y++) {
      const f = (y / STAGE.FLOOR_TOP) * (bands.length - 1);
      const i = Math.floor(f);
      const lv = Math.round((f - i) * 16);
      for (let x = 0; x < W; x++) {
        const use = BAYER4[y % 4][x % 4] < lv ? bands[Math.min(bands.length - 1, i + 1)] : bands[i];
        rect(sg, x, y, 1, 1, use);
      }
    }
    // 달
    const mx = 252;
    const my = 30;
    for (let y = -11; y <= 11; y++) {
      for (let x = -11; x <= 11; x++) {
        const d = Math.hypot(x, y);
        if (d <= 11) rect(sg, mx + x, my + y, 1, 1, d > 9.5 ? 't' : 'a');
      }
    }
    rect(sg, mx - 4, my - 3, 3, 3, 'k');
    rect(sg, mx + 3, my + 2, 4, 3, 'k');
    rect(sg, mx - 1, my + 6, 2, 2, 'k');

    // 2) 먼 성 (가로 640, 반복해서 흐름)
    const [far, fg] = mk(W * 2, 70);
    const tower = (g, x, w, h, base, roof, col, win) => {
      rect(g, x, base - h, w, h, col);
      // 뾰족 지붕
      for (let i = 0; i < roof; i++) {
        const ww = Math.max(1, Math.round(w * (1 - i / roof)) + 2);
        rect(g, x + Math.round((w - ww) / 2), base - h - i, ww, 1, col);
      }
      // 창문 불빛
      for (let wy = base - h + 6; wy < base - 4; wy += 8) {
        for (let wx = x + 2; wx < x + w - 2; wx += 5) if ((wx * 7 + wy * 3) % 5 < 2) rect(g, wx, wy, 2, 3, win);
      }
    };
    for (let x = 0; x < W * 2; x += 0) {
      const w = 10 + ((x * 13) % 9);
      const h = 18 + ((x * 7) % 26);
      tower(fg, x, w, h, 70, 6 + ((x * 3) % 6), '2', '4');
      x += w + 6 + ((x * 5) % 14);
    }
    rect(fg, 0, 58, W * 2, 12, '2');

    // 3) 가까운 성벽 + 네온 간판
    const [near, ng] = mk(W * 2, 60);
    for (let x = 0; x < W * 2; x += 0) {
      const w = 16 + ((x * 11) % 14);
      const h = 22 + ((x * 17) % 24);
      tower(ng, x, w, h, 60, 10, '1', '8');
      x += w + 18 + ((x * 3) % 20);
    }
    rect(ng, 0, 44, W * 2, 16, '1');
    // 성벽 톱니
    for (let x = 0; x < W * 2; x += 6) rect(ng, x, 41, 3, 3, '1');
    // 네온 간판 (네온 글자는 실시간으로 깜빡이게 위치만 저장)
    const signs = [60, 380];
    signs.forEach((sx) => {
      rect(ng, sx - 2, 14, 64, 22, '1');
      rect(ng, sx - 1, 15, 62, 20, '7');
      rect(ng, sx, 16, 60, 18, 'o');
      rect(ng, sx + 28, 36, 4, 8, '1');
    });

    // 5) 디스코 바닥: 화면 픽셀마다 어느 타일인지 미리 계산 (원근감)
    const FH = H - STAGE.FLOOR_TOP;
    const tileOf = new Int16Array(W * FH);
    const grout = new Uint8Array(W * FH);
    const ids = new Map();
    const rowOf = (y) => {
      const s = (y - STAGE.HORIZON) / (H - STAGE.HORIZON);
      return Math.floor((1 / s - 1) / 0.22);
    };
    for (let yy = 0; yy < FH; yy++) {
      const y = yy + STAGE.FLOOR_TOP;
      const s = (y - STAGE.HORIZON) / (H - STAGE.HORIZON);
      const row = rowOf(y);
      const rowEdge = rowOf(y - 1) !== row;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5 - W / 2) / s / 30 + 0.5;
        const col = Math.floor(u);
        const fu = (u - col) * 30 * s;
        const key = row * 100 + col;
        if (!ids.has(key)) ids.set(key, { id: ids.size, row, col });
        tileOf[yy * W + x] = ids.get(key).id;
        grout[yy * W + x] = rowEdge || fu < 1 ? 1 : 0;
      }
    }
    const tiles = [...ids.values()];
    return { sky, far, near, signs, tileOf, grout, tiles, tileCount: tiles.length };
  }

  // ---------- 박자 처리 ----------
  // t: 곡 시간, beatSec: 한 박 길이
  update(t, beatSec, fever) {
    this.fever = fever;
    const beat = Math.floor(t / beatSec);
    if (beat !== this.lastBeat && t >= -beatSec * 4) {
      this.lastBeat = beat;
      this.pulse = 1;
      this.lightFloor(beat);
    }
    this.pulse = Math.max(0, this.pulse - 0.06);
    const decay = this.fever ? 0.045 : 0.06;
    for (let i = 0; i < this.tileGlow.length; i++) this.tileGlow[i] = Math.max(0, this.tileGlow[i] - decay);
  }

  // 박자마다 바닥 무늬 (마디마다 무늬 종류가 바뀜)
  lightFloor(beat) {
    const tiles = Stage.layers.tiles;
    const cols = this.fever ? ['9', '6', 'g', '4', 'd', 'h'] : ['4', 'g', '3', 'f'];
    const bar = Math.floor(beat / 4);
    const kind = ((bar % 4) + 4) % 4;
    const b = ((beat % 4) + 4) % 4;
    tiles.forEach((tl) => {
      let on = false;
      if (kind === 0) on = (tl.row + tl.col + b) % 2 === 0;               // 체크무늬 번갈아
      else if (kind === 1) on = Math.abs(tl.col) % 4 === b;               // 가운데서 퍼지는 줄
      else if (kind === 2) on = (tl.row + b) % 4 === 0;                   // 앞뒤로 흐르는 줄
      else on = (tl.col * 7 + tl.row * 13 + beat * 5) % 5 === 0;          // 반짝반짝 무작위
      if (this.fever && !on) on = (tl.col * 3 + tl.row * 5 + beat) % 7 === 0;
      if (on) {
        this.tileGlow[tl.id] = 1;
        this.tileColor[tl.id] = cols[Math.abs(tl.col + tl.row + bar) % cols.length];
      }
    });
  }

  // ---------- 그리기 ----------
  // scroll: 패럴랙스 흐름용 시간(초)
  renderBack(ctx, time, frame) {
    const W = CONFIG.WIDTH;
    const Ls = Stage.layers;
    ctx.drawImage(Ls.sky, 0, 0);
    // 별 반짝
    for (let i = 0; i < 40; i++) {
      const sx = (i * 73) % W;
      const sy = (i * 37) % 70;
      const tw = (frame + i * 17) % 90;
      if (tw < 60) {
        ctx.fillStyle = C(tw < 8 ? 'b' : i % 3 ? 'k' : 'j');
        ctx.fillRect(sx, sy, 1, 1);
        if (tw < 4) {
          ctx.fillRect(sx - 1, sy, 3, 1);
          ctx.fillRect(sx, sy - 1, 1, 3);
        }
      }
    }
    // 먼 성 / 가까운 성 (속도 다르게)
    const farX = -Math.floor((time * 4) % W);
    ctx.drawImage(Ls.far, farX, 50);
    ctx.drawImage(Ls.far, farX + W * 2, 50);
    const nearX = -Math.floor((time * 10) % (W * 2));
    ctx.drawImage(Ls.near, nearX, 62);
    ctx.drawImage(Ls.near, nearX + W * 2, 62);
    // 네온 간판 글자 (박자에 맞춰 깜빡)
    Ls.signs.forEach((sx) => {
      const x = nearX + sx;
      for (const ox of [x, x + W * 2]) {
        if (ox < -70 || ox > W) continue;
        const on = this.pulse > 0.5 || frame % 30 < 26;
        BitmapFont.draw(ctx, 'JACKPOT', ox + 30, 62 + 19, on ? C(this.fever ? '9' : '5') : C('7'), { align: 'center', outline: on ? C('6') : null });
        for (let k = 0; k < 8; k++) {
          ctx.fillStyle = (k + (frame >> 3)) % 2 ? C('9') : C('7');
          ctx.fillRect(ox + 2 + k * 8, 62 + 17, 1, 1);
          ctx.fillRect(ox + 2 + k * 8, 62 + 31, 1, 1);
        }
      }
    });
    // 스포트라이트 2개 (위에서 바닥으로, 박자에 맞춰 좌우로)
    const beams = this.fever ? [['9', 0], ['h', 1], ['p', 2]] : [['a', 0], ['q', 1]];
    beams.forEach(([col, i]) => {
      const ox = i === 0 ? 30 : i === 1 ? W - 30 : W / 2;
      const sway = Math.sin(time * (this.fever ? 2.2 : 1.2) + i * 2.1) * 90;
      const tx = W / 2 + sway;
      ctx.fillStyle = DITHER.get(ctx, col, this.fever ? 4 : 3);
      for (let y = 0; y < STAGE.FLOOR_TOP + 20; y += 2) {
        const k = y / (STAGE.FLOOR_TOP + 20);
        const cx = ox + (tx - ox) * k;
        const hw = 2 + k * 16;
        ctx.fillRect(Math.round(cx - hw), y, Math.round(hw * 2), 2);
      }
    });
  }

  // 바닥 (디스코 타일) — 픽셀 단위로 직접 색칠
  renderFloor(ctx) {
    const Ls = Stage.layers;
    const W = CONFIG.WIDTH;
    const data = this.floorImg.data;
    const FH = this.floorCanvas.height;
    const base1 = PALETTE_RGB['2'];
    const base2 = PALETTE_RGB.o;
    const groutC = PALETTE_RGB['1'];
    for (let yy = 0; yy < FH; yy++) {
      for (let x = 0; x < W; x++) {
        const idx = yy * W + x;
        const tid = Ls.tileOf[idx];
        let rgb;
        if (Ls.grout[idx]) rgb = groutC;
        else {
          const g = this.tileGlow[tid];
          const tl = Ls.tiles[tid];
          const dither = BAYER4[yy % 4][x % 4] / 16;
          if (g > 0.55 + dither * 0.2) rgb = PALETTE_RGB[this.tileColor[tid]];
          else if (g > 0.2 + dither * 0.2) rgb = PALETTE_RGB[DIM_OF[this.tileColor[tid]] || '3'];
          else rgb = (tl.row + tl.col) % 2 ? base1 : base2;
        }
        const o = idx * 4;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
        data[o + 3] = 255;
      }
    }
    this.floorCtx.putImageData(this.floorImg, 0, 0);
    ctx.drawImage(this.floorCanvas, 0, STAGE.FLOOR_TOP);
    // 무대 앞 금색 난간 + 전구
    ctx.fillStyle = C('1');
    ctx.fillRect(0, STAGE.FLOOR_TOP - 1, W, 3);
    ctx.fillStyle = C('8');
    ctx.fillRect(0, STAGE.FLOOR_TOP, W, 1);
  }

  // 캐릭터 발밑 조명 (타원)
  renderSpot(ctx, cx, y, rx, color, level) {
    ctx.fillStyle = DITHER.get(ctx, color, level);
    for (let dy = -3; dy <= 3; dy++) {
      const hw = Math.round(rx * Math.sqrt(1 - (dy / 3.5) ** 2));
      ctx.fillRect(Math.round(cx - hw), y + dy, hw * 2, 1);
    }
  }
}
