// 배경 — 패럴랙스 4레이어: 밤하늘(달·별) / 먼 구름 / 마을 실루엣 / 울타리·텃밭 레인
// 전부 코드로 그린다. 레인 바닥은 두 잔디색 체크무늬.
export class Background {
  constructor(cfg, renderer) {
    this.cfg = cfg;
    this.r = renderer;
    this.t = 0;
    this.W = cfg.base.width; this.H = cfg.base.height;
    // 고정 별 배치 (결정적)
    this.stars = [];
    let s = 1234567;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) / 16777216; };
    for (let i = 0; i < 46; i++) this.stars.push({ x: Math.floor(rnd() * this.W), y: Math.floor(rnd() * 26), tw: rnd() * 6.28, c: rnd() < 0.3 ? 19 : 20 });
    this.clouds = [];
    for (let i = 0; i < 5; i++) this.clouds.push({ x: rnd() * this.W, y: 2 + Math.floor(rnd() * 14), w: 18 + Math.floor(rnd() * 22), spd: 2 + rnd() * 3 });
    this.farClouds = [];
    for (let i = 0; i < 4; i++) this.farClouds.push({ x: rnd() * this.W, y: 10 + Math.floor(rnd() * 12), w: 26 + Math.floor(rnd() * 30), spd: 0.6 + rnd() * 0.6 });
    // 먼 마을 실루엣 (집 모양 목록)
    this.houses = [];
    let hx = 40;
    while (hx < this.W + 30) { const w = 10 + Math.floor(rnd() * 14); const h = 6 + Math.floor(rnd() * 9); this.houses.push({ x: hx, w, h, roof: rnd() < 0.6, lit: rnd() < 0.5 }); hx += w + 2 + Math.floor(rnd() * 6); }
    this.layerCanvas = null;
    this.buildStatic();
  }

  update(dt) {
    this.t += dt;
    for (const c of this.clouds) { c.x -= c.spd * dt; if (c.x + c.w < -4) c.x = this.W + 4; }
    for (const c of this.farClouds) { c.x -= c.spd * dt; if (c.x + c.w < -4) c.x = this.W + 4; }
  }

  // 레인·집·울타리는 매 프레임 같으므로 한 번만 그려 둔다
  buildStatic() {
    const L = this.cfg.layout;
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    const ctx = c.getContext('2d');
    const col = (i) => this.r.sprites.css(i);
    const laneArea = L.lanes * L.laneH;
    // 레인 체크무늬 (잔디 두 색) — 그리드 왼쪽(집 앞)과 오른쪽(스폰 길)도 포함
    for (let lane = 0; lane < L.lanes; lane++) {
      const y = L.laneTop + lane * L.laneH;
      for (let x = L.gridX; x < this.W; x += L.cellW) {
        const colIdx = Math.floor((x - L.gridX) / L.cellW);
        const dark = (lane + colIdx) % 2 === 0;
        ctx.fillStyle = col(dark ? 14 : 13);
        ctx.fillRect(x, y, L.cellW, L.laneH);
        // 잔디 디테일 (결정적 패턴)
        ctx.fillStyle = col(dark ? 13 : 12);
        for (let k = 0; k < 5; k++) {
          const px = x + ((k * 7 + lane * 3 + colIdx * 5) % (L.cellW - 2)) + 1;
          const py = y + ((k * 11 + lane * 5 + colIdx * 3) % (L.laneH - 2)) + 1;
          ctx.fillRect(px, py, 1, 2);
        }
      }
      // 레인 경계선 (어두운 보색 그림자)
      ctx.fillStyle = col(15);
      ctx.fillRect(L.gridX, y, this.W - L.gridX, 1);
    }
    // 그리드 세로 눈금 (칸 구분, 살짝)
    ctx.fillStyle = col(15);
    for (let cI = 0; cI <= L.cols; cI++) {
      const x = L.gridX + cI * L.cellW;
      for (let y = L.laneTop; y < L.laneTop + laneArea; y += 4) ctx.fillRect(x, y, 1, 2);
    }
    // 오른쪽 스폰 길 (흙색) 경계
    ctx.fillStyle = col(5);
    ctx.fillRect(L.gridRight, L.laneTop, 1, laneArea);
    for (let y = L.laneTop; y < L.laneTop + laneArea; y += 1) {
      for (let x = L.gridRight + 1; x < this.W; x++) {
        if (((x * 7 + y * 13) % 17) === 0) { ctx.fillStyle = col(4); ctx.fillRect(x, y, 1, 1); }
      }
    }

    // 집 (텃밭 주인의 집) — 왼쪽 기둥 전체 높이
    const hx = 0, hy = L.laneTop, hw = L.gridX - 4, hh = laneArea;
    ctx.fillStyle = col(3); ctx.fillRect(hx, hy, hw, hh);          // 벽
    ctx.fillStyle = col(31);                                        // 벽 판자 무늬
    for (let y = hy + 3; y < hy + hh; y += 6) ctx.fillRect(hx, y, hw, 1);
    ctx.fillStyle = col(5); ctx.fillRect(hx + hw - 1, hy, 1, hh);  // 벽 외곽
    for (let lane = 0; lane < L.lanes; lane++) {                    // 레인마다 창문
      const wy = L.laneTop + lane * L.laneH + 5;
      ctx.fillStyle = col(6); ctx.fillRect(hx + 3, wy, 9, 9);
      ctx.fillStyle = col(11); ctx.fillRect(hx + 4, wy + 1, 7, 7);
      ctx.fillStyle = col(10); ctx.fillRect(hx + 4, wy + 4, 7, 1); ctx.fillRect(hx + 7, wy + 1, 1, 7);
    }
    ctx.fillStyle = col(6); ctx.fillRect(hx + 4, L.laneTop + laneArea - 14, 8, 14); // 문
    ctx.fillStyle = col(5); ctx.fillRect(hx + 5, L.laneTop + laneArea - 13, 6, 13);
    ctx.fillStyle = col(11); ctx.fillRect(hx + 9, L.laneTop + laneArea - 8, 1, 1);
    // 집 앞 흙길
    ctx.fillStyle = col(5); ctx.fillRect(hw, hy, 4, hh);
    ctx.fillStyle = col(4); for (let y = hy; y < hy + hh; y += 3) ctx.fillRect(hw + ((y / 3) % 3 | 0), y, 1, 1);
    // 울타리 (하단 띠) + 흙
    ctx.fillStyle = col(6); ctx.fillRect(0, L.bottomY, this.W, this.H - L.bottomY);
    ctx.fillStyle = col(5); ctx.fillRect(0, L.bottomY, this.W, 1);
    this.layerCanvas = c;
  }

  // HUD 위쪽 하늘 + 실루엣. HUD(30px)가 위를 덮으므로 하늘은 HUD 뒤에 그려 HUD 투명 부분으로 보인다.
  drawSky(ctx) {
    const col = (i) => this.r.sprites.css(i);
    ctx.fillStyle = col(25); ctx.fillRect(0, 0, this.W, 30);
    // 별 (반짝임)
    for (const s of this.stars) {
      const tw = Math.sin(this.t * 2 + s.tw) > 0.3;
      ctx.fillStyle = col(tw ? s.c : 23);
      ctx.fillRect(s.x, s.y, 1, 1);
    }
    // 달
    ctx.fillStyle = col(2); ctx.fillRect(282, 4, 10, 10); ctx.fillRect(280, 6, 14, 6); ctx.fillRect(284, 2, 6, 14);
    ctx.fillStyle = col(21); ctx.fillRect(285, 6, 2, 2); ctx.fillRect(289, 10, 2, 1);
    ctx.fillStyle = col(25); ctx.fillRect(289, 2, 6, 5); ctx.fillRect(291, 7, 4, 3); // 초승달 그림자
    // 먼 구름
    for (const c of this.farClouds) this.cloud(ctx, c.x | 0, c.y, c.w, 23);
    // 마을 실루엣
    for (const h of this.houses) {
      ctx.fillStyle = col(24); ctx.fillRect(h.x, 30 - h.h, h.w, h.h);
      if (h.roof) { ctx.fillRect(h.x + 1, 29 - h.h, h.w - 2, 1); ctx.fillRect(h.x + 2, 28 - h.h, h.w - 4, 1); }
      if (h.lit) { ctx.fillStyle = col(10); ctx.fillRect(h.x + 2, 30 - h.h + 3, 2, 2); }
    }
    // 가까운 구름
    for (const c of this.clouds) this.cloud(ctx, c.x | 0, c.y, c.w, 22);
  }

  cloud(ctx, x, y, w, colorIdx) {
    ctx.fillStyle = this.r.sprites.css(colorIdx);
    ctx.fillRect(x, y + 2, w, 3); ctx.fillRect(x + 3, y, w - 6, 2); ctx.fillRect(x + 6, y + 5, w - 12, 1);
  }

  drawField(ctx) { ctx.drawImage(this.layerCanvas, 0, 0); }
}
