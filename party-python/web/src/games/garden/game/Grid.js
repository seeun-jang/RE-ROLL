// 레인/칸 그리드 — 5레인 × 9칸, 포탑 배치 관리
export class Grid {
  constructor(cfg) {
    this.cfg = cfg;
    const L = cfg.layout;
    this.lanes = L.lanes;
    this.cols = L.cols;
    this.cellW = L.cellW;
    this.laneH = L.laneH;
    this.cells = [];
    for (let l = 0; l < this.lanes; l++) this.cells.push(new Array(this.cols).fill(null));
  }

  laneTop(lane) { return this.cfg.layout.laneTop + lane * this.laneH; }
  laneBottom(lane) { return this.laneTop(lane) + this.laneH; }
  laneCenterY(lane) { return this.laneTop(lane) + (this.laneH >> 1); }
  cellX(col) { return this.cfg.layout.gridX + col * this.cellW; }

  // 화면 좌표 → 칸 (그리드 밖이면 null)
  cellAt(x, y) {
    const L = this.cfg.layout;
    if (x < L.gridX || x >= L.gridRight || y < L.laneTop || y >= L.laneTop + this.lanes * this.laneH) return null;
    return { lane: Math.floor((y - L.laneTop) / this.laneH), col: Math.floor((x - L.gridX) / this.cellW) };
  }

  get(lane, col) { return this.cells[lane]?.[col] ?? null; }
  isFree(lane, col) { return this.get(lane, col) === null; }
  place(turret) { this.cells[turret.lane][turret.col] = turret; }
  remove(turret) { if (this.cells[turret.lane][turret.col] === turret) this.cells[turret.lane][turret.col] = null; }

  turretsInLane(lane) { return this.cells[lane].filter(Boolean); }

  // 적 앞부분(frontX)이 닿는 포탑 — 적은 왼쪽으로 이동하므로 오른쪽 경계와 비교
  blockingTurret(lane, frontX) {
    const hb = this.cfg.turretHitbox;
    for (let col = this.cols - 1; col >= 0; col--) {
      const t = this.cells[lane][col];
      if (!t || t.dead) continue;
      const left = this.cellX(col) + hb.left;
      const right = this.cellX(col) + hb.right;
      if (frontX <= right && frontX > left - 1) return t;
    }
    return null;
  }

  clear() { for (const row of this.cells) row.fill(null); }
}
