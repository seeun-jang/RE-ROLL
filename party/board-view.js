// =====================================================
// 보드판 그리기 — 하늘에 떠 있는 섬 지도 (픽셀 그림, 카메라로 따라다님)
//  - 지도 전체(2460×1900)를 절반 해상도로 한 번 그려 둠: 섬 땅 · 절벽 · 길 · 다리 · 장식 · 칸
//  - 매 프레임: 하늘 → 먼 섬 · 구름(느리게 움직임) → 폭포 → 지도에서 카메라 부분 → 풍차 · 연기 · 말 → 픽셀 그대로 확대
//  - 카메라: 갈림길 → 칸 효과 받는 사람 → 움직이는 사람 → 내 말 순서로 따라감. 마우스로 끌면 잠깐 직접 보기
//  - 전체 지도 보기(Z 키 · 버튼) · 오른쪽 위 작은 지도
// =====================================================
import { BOARD } from './shared/board.js';
import { SPACES, CHARACTERS } from './shared/rules.js';

export const STAGE_W = 960, STAGE_H = 600;
const PX = 2;                                   // 지도 한 픽셀 = 화면 2픽셀
const VW = STAGE_W / PX, VH = STAGE_H / PX;     // 보이는 영역 (낮은 해상도)
const WW = Math.ceil(BOARD.width / PX), WH = Math.ceil(BOARD.height / PX);
const FOCUS_Y = 250;                            // 따라가는 대상을 화면 이 높이에 (아래 카드에 안 가리게)
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const INK = '#2b2140';

// 섬 모양 · 색
const THEME = {
  meadow: { top: '#6fd24f', light: '#9be86a', dark: '#3f9a3a', soil: ['#a0683a', '#7d4e2a', '#5a3720'], road: ['#f0dca6', '#c9a66a'] },
  forest: { top: '#4fb148', light: '#79cf5d', dark: '#2f7d32', soil: ['#8a5a32', '#6b4226', '#4a2c1a'], road: ['#e3c98d', '#b38d55'] },
  volcano: { top: '#6e5a6a', light: '#8e7a88', dark: '#4a3a48', soil: ['#4a3a48', '#3a2c3a', '#2a1e2c'], road: ['#9a8580', '#6e5a58'] },
  lake: { top: '#79d65a', light: '#a6ec7a', dark: '#46a046', soil: ['#d8b878', '#b8935a', '#8a6a3e'], road: ['#f7e6b5', '#d4b577'] },
  ruins: { top: '#8fcf6a', light: '#b6e58c', dark: '#5e9c48', soil: ['#9a8a7a', '#7a6a5e', '#5a4c44'], road: ['#d8d0c0', '#a8a090'] },
  village: { top: '#7fd65c', light: '#a8ea80', dark: '#4ba646', soil: ['#a0683a', '#7d4e2a', '#5a3720'], road: ['#f0dca6', '#c9a66a'] },
  crystal: { top: '#8a7ae0', light: '#b4a8f4', dark: '#5a4ab0', soil: ['#5a4ab0', '#463a90', '#30286a'], road: ['#d6ccff', '#9a8ad8'] },
  castle: { top: '#72d055', light: '#a0e678', dark: '#46a046', soil: ['#9a8a7a', '#7a6a5e', '#5a4c44'], road: ['#e6e0d4', '#b0a89a'] },
};
const TILE = {
  plain: ['#f3e7c6', '#c9b588'], start: ['#ffffff', '#9aa3b5'], goal: ['#ffd84a', '#c98a12'],
  fork: ['#7fd6ff', '#3c8fc4'], dice: ['#4f8ff7', '#2a55b8'], trash: ['#a668d6', '#6a3a99'],
  trap: ['#f2545b', '#a82c38'], fun: ['#78e06a', '#3b9e44'], wild: ['#ff9a3c', '#c2561c'],
};
const tileColor = (type) => TILE[type] || TILE[SPACES[type]?.tier] || TILE.plain;

const nx = (n) => Math.round(n.x / PX), ny = (n) => Math.round(n.y / PX);
const loadImg = (src) => { const i = new Image(); i.src = src; return i; };
const minis = CHARACTERS.map((c) => loadImg(`assets/characters/${c.sprite}-mini.png`));
export const spriteUrl = (seat) => `assets/characters/${CHARACTERS[seat % CHARACTERS.length].sprite}.png`;

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const layer = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  return [c, g];
};
// 부드러운 가장자리를 없애 도트처럼 (알파를 0 또는 255로)
function crisp(g, w, h) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
  g.putImageData(img, 0, 0);
}
// 모양(mask)을 한 가지 색으로
function tint(mask, color) {
  const [c, g] = layer(mask.width, mask.height);
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
function pxRect(g, x, y, w, h, color, cut = 1) {
  g.fillStyle = color;
  g.fillRect(x + cut, y, w - cut * 2, h);
  g.fillRect(x, y + cut, w, h - cut * 2);
}
const iconCache = new Map();
function iconSprite(icon, size) {
  const key = icon + size;
  if (iconCache.has(key)) return iconCache.get(key);
  const [c, g] = layer(size + 4, size + 4);
  g.font = `${size}px ${EMOJI}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(icon, (size + 4) / 2, (size + 4) / 2 + 1);
  crisp(g, size + 4, size + 4);
  iconCache.set(key, c);
  return c;
}
// 점과 선분 사이 거리
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

// 길 (같은 섬 안 = 흙길, 섬 사이 = 다리)
const EDGES = [];
for (const n of BOARD.nodes) for (const m of n.next) EDGES.push({ a: n, b: BOARD.nodes[m], bridge: n.island !== BOARD.nodes[m].island });

// 큰 볼거리 위치 (낮은 해상도) — 장식이 겹치지 않게
const LANDMARKS = { windmill: [300, 160, 30], volcano: [560, 335, 75], castle: [1150, 748, 75] };
// 볼거리 밑에도 땅이 있게 (섬 이름 · 반지름)
const LANDMARK_LAND = { windmill: ['top', 34], volcano: ['volcano', 52], castle: ['castle', 70] };

// =====================================================
export class BoardView {
  constructor(canvas, minimap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.minimap = minimap;
    [this.view, this.vg] = layer(VW, VH);
    this.tokens = new Map();
    this.state = null;
    this.myId = null;
    this.branch = null;
    this.targets = null;
    this.rolls = null;
    this.hover = null;
    this.scale = 1;
    this.t = 0;
    this.world = null;
    this.thumb = null;
    this.cam = { x: 0, y: 0 };           // 화면 왼쪽 위 (지도 좌표, 낮은 해상도 픽셀)
    this.camReady = false;
    this.manualUntil = 0;
    this.spot = null;                   // { pid, until }
    this.overview = false;
    this.anim = [];                     // 폭포 · 연기 · 깃발 · 반짝임 (지도 좌표)
    this.sky = this.buildSky();
    this.far = this.buildFar();
    this.clouds = this.makeClouds();
    this.bindMouse();
    Promise.all([document.fonts.ready, ...minis.map((i) => i.decode().catch(() => {}))]).then(() => { this.world = null; iconCache.clear(); });
    const loop = (now) => { this.t = now / 1000; this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setScale(s) {
    const r = s * (window.devicePixelRatio || 1);
    if (Math.abs(r - this.scale) < 0.01) return;
    this.scale = r;
    this.canvas.width = Math.round(STAGE_W * r);
    this.canvas.height = Math.round(STAGE_H * r);
  }

  // 효과를 받는 사람을 잠깐 비춤
  spotlight(pid, ms = 2200) { if (pid != null) this.spot = { pid, until: performance.now() + ms }; }
  toggleOverview() { this.overview = !this.overview; this.manualUntil = 0; }

  // ---------------- 마우스: 끌어서 둘러보기 · 칸 설명 ----------------
  bindMouse() {
    let drag = null;
    const toLow = (e) => {
      const b = this.canvas.getBoundingClientRect();
      return { x: ((e.clientX - b.left) / b.width) * VW, y: ((e.clientY - b.top) / b.height) * VH, b };
    };
    this.canvas.addEventListener('mousedown', (e) => { drag = toLow(e); });
    addEventListener('mouseup', () => { drag = null; });
    this.canvas.addEventListener('mousemove', (e) => {
      const p = toLow(e);
      if (drag && !this.overview) {
        this.cam.x -= p.x - drag.x; this.cam.y -= p.y - drag.y;
        this.clampCam();
        drag = p;
        this.manualUntil = performance.now() + 6000;
      }
      const wx = (p.x + this.cam.x) * PX, wy = (p.y + this.cam.y) * PX;
      const n = this.overview ? null : BOARD.nodes.find((n) => Math.abs(n.x - wx) < 30 && Math.abs(n.y - wy) < 30);
      if ((n && n.id) !== (this.hover && this.hover.id)) {
        this.hover = n || null;
        this.onHover?.(n ? { node: n, px: ((nx(n) - this.cam.x) / VW) * p.b.width + p.b.left, py: ((ny(n) - this.cam.y) / VH) * p.b.height + p.b.top } : null);
      }
    });
    this.canvas.addEventListener('mouseleave', () => { this.hover = null; this.onHover?.(null); });
    // 작은 지도를 누르면 거기로
    if (this.minimap) {
      this.minimap.addEventListener('click', (e) => {
        const b = this.minimap.getBoundingClientRect();
        this.cam.x = ((e.clientX - b.left) / b.width) * WW - VW / 2;
        this.cam.y = ((e.clientY - b.top) / b.height) * WH - VH / 2;
        this.clampCam();
        this.manualUntil = performance.now() + 6000;
        this.overview = false;
      });
    }
  }

  clampCam() {
    this.cam.x = Math.max(0, Math.min(WW - VW, this.cam.x));
    this.cam.y = Math.max(0, Math.min(WH - VH, this.cam.y));
  }

  // ---------------- 하늘 · 먼 풍경 ----------------
  buildSky() {
    const [c, g] = layer(VW, VH);
    const sky = ['#3a8ee0', '#4aa0ea', '#5cb3f2', '#70c4f7', '#86d3fa', '#9fe0fc', '#bcebfd', '#d4f3fe'];
    const band = Math.ceil(VH / sky.length);
    sky.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, i * band, VW, band); });
    for (let i = 1; i < sky.length; i++) {
      g.fillStyle = sky[i];
      for (let y = i * band - 3; y < i * band; y++) for (let x = y % 2; x < VW; x += 2) g.fillRect(x, y, 1, 1);
    }
    return c;
  }

  // 먼 섬들 (가로로 이어 붙여서 씀)
  buildFar() {
    const w = 640, h = VH;
    const [c, g] = layer(w, h);
    const rnd = seeded(5);
    const isle = (x, y, r, top, under) => {
      g.fillStyle = under;
      g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.lineTo(x + r * 0.2, y + r * 0.9); g.lineTo(x - r * 0.3, y + r * 0.6); g.closePath(); g.fill();
      g.fillStyle = top;
      g.beginPath(); g.ellipse(x, y, r, r * 0.22, 0, 0, Math.PI * 2); g.fill();
    };
    for (let i = 0; i < 6; i++) isle(rnd() * w, 70 + rnd() * 140, 18 + rnd() * 26, '#b9d6f2', '#9ec0e6');
    for (let i = 0; i < 5; i++) isle(rnd() * w, 120 + rnd() * 120, 10 + rnd() * 14, '#cfe4f8', '#b4d1f0');
    crisp(g, w, h);
    return c;
  }

  makeClouds() {
    const rnd = seeded(3);
    return Array.from({ length: 9 }, () => {
      const w = 50 + Math.floor(rnd() * 40);
      const [c, g] = layer(w + 8, 28);
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(10 + (i * (w - 10)) / 4, 15 - Math.sin(i * 1.3) * 5, 7 + rnd() * 4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#dceffc'; g.fillRect(4, 20, w, 4);
      crisp(g, w + 8, 28);
      return { c, x: rnd() * 900, y: rnd() * 260, v: 2 + rnd() * 4, p: 0.15 + rnd() * 0.25 };
    });
  }

  // ---------------- 지도 (한 번만) ----------------
  buildWorld() {
    const [c, g] = layer(WW, WH);
    this.anim = [];
    const islands = [...new Set(BOARD.nodes.map((n) => n.island))];
    const shapes = {};
    for (const id of islands) shapes[id] = this.drawIsland(g, id);
    this.drawRoads(g);
    for (const e of EDGES) if (e.bridge) this.drawBridge(g, e.a, e.b);
    this.drawLandmarks(g);
    this.drawDecor(g, shapes);
    for (const n of BOARD.nodes) this.drawTile(g, n);
    return c;
  }

  // 섬: 길을 따라 둥근 땅 → 흙 절벽 (아래로 갈수록 어둡게) → 잔디 윗면 (밝은 테두리)
  drawIsland(g, id) {
    const nodes = BOARD.nodes.filter((n) => n.island === id);
    const theme = THEME[nodes[0].theme] || THEME.meadow;
    const rnd = seeded(id.length * 97 + nodes[0].id);
    const [mask, mg] = layer(WW, WH);
    mg.fillStyle = '#fff';
    const blob = (x, y, r) => { mg.beginPath(); mg.arc(x, y, r, 0, Math.PI * 2); mg.fill(); };
    for (const e of EDGES.filter((e) => !e.bridge && e.a.island === id)) {
      const len = Math.hypot(nx(e.b) - nx(e.a), ny(e.b) - ny(e.a));
      for (let s = 0; s <= len; s += 6) {
        const k = s / len;
        const x = nx(e.a) + (nx(e.b) - nx(e.a)) * k, y = ny(e.a) + (ny(e.b) - ny(e.a)) * k;
        blob(x, y, 44 + Math.sin(x * 0.07 + y * 0.03) * 6 + Math.cos(x * 0.031) * 5);
      }
    }
    for (const n of nodes) blob(nx(n), ny(n), 46);
    for (const [k, [isl, r]] of Object.entries(LANDMARK_LAND)) if (isl === id) blob(LANDMARKS[k][0], LANDMARKS[k][1] - r * 0.3, r);
    crisp(mg, WW, WH);
    const md = mg.getImageData(0, 0, WW, WH).data;

    // 섬 아래 매달린 흙 조각 (세로줄마다 맨 아래를 찾아서)
    const bottomY = new Int32Array(WW).fill(-1);
    for (let x = 0; x < WW; x++) for (let y = WH - 1; y >= 0; y--) if (md[(y * WW + x) * 4 + 3]) { bottomY[x] = y; break; }
    const [drips, dg] = layer(WW, WH);
    dg.fillStyle = '#fff';
    for (let x = 0; x < WW; x += 5 + Math.floor(rnd() * 6)) {
      if (bottomY[x] < 0) continue;
      const len = 8 + rnd() * 26, w = 4 + rnd() * 6;
      dg.beginPath(); dg.moveTo(x - w, bottomY[x] + 20); dg.lineTo(x + w, bottomY[x] + 20); dg.lineTo(x + (rnd() - 0.5) * 4, bottomY[x] + 20 + len); dg.closePath(); dg.fill();
    }
    crisp(dg, WW, WH);

    const ink = tint(mask, INK);
    const [s0, s1, s2] = theme.soil;
    g.drawImage(tint(drips, s2), 0, 0);
    const layers = { [s0]: tint(mask, s0), [s1]: tint(mask, s1), [s2]: tint(mask, s2) };
    for (let d = 26; d >= 1; d--) g.drawImage(d === 26 ? ink : layers[d > 18 ? s2 : d > 9 ? s1 : s0], 0, d);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 2]]) g.drawImage(ink, dx, dy);
    g.drawImage(tint(mask, theme.light), 0, 0);
    // 윗면: 위 3픽셀 밝은 테두리를 남기고 안쪽을 기본 색으로
    const [topC, tg] = layer(WW, WH);
    tg.drawImage(tint(mask, theme.top), 0, 3);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(mask, 0, 0);
    g.drawImage(topC, 0, 0);
    // 풀 무늬
    for (let i = 0; i < nodes.length * 70; i++) {
      const x = Math.floor(rnd() * WW), y = Math.floor(rnd() * (WH - 8)) + 6;
      if (!md[(y * WW + x) * 4 + 3] || !md[((y - 5) * WW + x) * 4 + 3]) continue;
      g.fillStyle = rnd() < 0.55 ? theme.dark : theme.light;
      g.fillRect(x, y, 1, 2);
      if (rnd() < 0.5) g.fillRect(x + 1, y + 1, 1, 1);
    }
    // 폭포 자리 (숲 · 호수 섬 아래)
    if (id === 'lake' || id === 'top') {
      for (const k of id === 'lake' ? [0.25, 0.55, 0.8] : [0.4, 0.7]) {
        let bx = -1;
        for (let dx = 0; dx < 80 && bx < 0; dx++) if (bottomY[Math.floor(WW * k) + dx] > 0) bx = Math.floor(WW * k) + dx;
        if (bx > 0) this.anim.push({ kind: 'fall', x: bx, y: bottomY[bx] + 16, len: 90 + Math.floor(rnd() * 90) });
      }
    }
    return { mask: md, nodes, rnd };
  }

  // 흙길 (섬 안)
  drawRoads(g) {
    const [r, rg] = layer(WW, WH);
    rg.lineCap = 'round';
    for (const e of EDGES) {
      if (e.bridge) continue;
      rg.strokeStyle = INK; rg.lineWidth = 16;
      rg.beginPath(); rg.moveTo(nx(e.a), ny(e.a) + 1); rg.lineTo(nx(e.b), ny(e.b) + 1); rg.stroke();
    }
    for (const e of EDGES) {
      if (e.bridge) continue;
      const th = THEME[e.a.theme] || THEME.meadow;
      rg.strokeStyle = th.road[1]; rg.lineWidth = 14;
      rg.beginPath(); rg.moveTo(nx(e.a), ny(e.a) + 1); rg.lineTo(nx(e.b), ny(e.b) + 1); rg.stroke();
      rg.strokeStyle = th.road[0]; rg.lineWidth = 11;
      rg.beginPath(); rg.moveTo(nx(e.a), ny(e.a)); rg.lineTo(nx(e.b), ny(e.b)); rg.stroke();
    }
    crisp(rg, WW, WH);
    // 자갈 점
    const rnd = seeded(21);
    for (const e of EDGES) {
      if (e.bridge) continue;
      const th = THEME[e.a.theme] || THEME.meadow;
      const len = Math.hypot(nx(e.b) - nx(e.a), ny(e.b) - ny(e.a));
      rg.fillStyle = th.road[1];
      for (let s = 4; s < len; s += 5) {
        const k = s / len;
        rg.fillRect(Math.round(nx(e.a) + (nx(e.b) - nx(e.a)) * k + (rnd() - 0.5) * 7), Math.round(ny(e.a) + (ny(e.b) - ny(e.a)) * k + (rnd() - 0.5) * 6), 1, 1);
      }
    }
    g.drawImage(r, 0, 0);
  }

  // 나무 다리 (섬 사이 하늘 위, 가운데가 살짝 처짐)
  drawBridge(g, a, b) {
    const ax = nx(a), ay = ny(a), bx = nx(b), by = ny(b);
    const len = Math.hypot(bx - ax, by - ay);
    const px = -(by - ay) / len, py = (bx - ax) / len;
    const sag = Math.min(18, len * 0.08);
    const at = (k) => [ax + (bx - ax) * k, ay + (by - ay) * k + Math.sin(k * Math.PI) * sag];
    for (let s = 6; s < len - 6; s += 4) {
      const [x, y] = at(s / len);
      const plank = Math.floor(s / 4) % 2 ? '#b57a42' : '#c98c4e';
      for (let q = -8; q <= 8; q++) {
        g.fillStyle = Math.abs(q) === 8 ? INK : plank;
        g.fillRect(Math.round(x + px * q), Math.round(y + py * q), 2, 3);
      }
      g.fillStyle = INK; g.fillRect(Math.round(x), Math.round(y) + 3, 2, 1);
    }
    for (const side of [-1, 1]) {
      g.fillStyle = '#e8d2a0';
      for (let s = 0; s < len; s++) {
        const [x, y] = at(s / len);
        g.fillRect(Math.round(x + px * 9 * side), Math.round(y + py * 9 * side) - 6 + Math.round(Math.sin((s / len) * Math.PI) * 2), 1, 1);
      }
      for (const k of [0.04, 0.96]) {
        const [x, y] = at(k);
        const X = Math.round(x + px * 9 * side), Y = Math.round(y + py * 9 * side);
        g.fillStyle = INK; g.fillRect(X - 2, Y - 10, 5, 12);
        g.fillStyle = '#8a5a32'; g.fillRect(X - 1, Y - 9, 3, 10);
      }
    }
  }

  drawLandmarks(g) {
    const start = BOARD.nodes[BOARD.start];
    this.drawWindmill(g, ...LANDMARKS.windmill);
    this.drawVolcano(g, ...LANDMARKS.volcano);
    this.drawCastle(g, ...LANDMARKS.castle);
    this.drawArch(g, nx(start), ny(start) - 4);
    this.drawSign(g, nx(BOARD.nodes[14]) + 22, ny(BOARD.nodes[14]) - 12, '갈림길');
    const f2 = BOARD.nodes.find((n, i) => n.type === 'fork' && i > 20);
    if (f2) this.drawSign(g, nx(f2) + 22, ny(f2) - 12, '갈림길');
  }

  // 섬 위 장식 (길에서 떨어진 곳에 테마별로)
  drawDecor(g, shapes) {
    const items = [];
    for (const sh of Object.values(shapes)) {
      const { mask, nodes, rnd } = sh;
      for (let i = 0; i < nodes.length * 90; i++) {
        const x = Math.floor(rnd() * WW), y = Math.floor(rnd() * (WH - 30)) + 20;
        if (!mask[(y * WW + x) * 4 + 3] || !mask[((y - 18) * WW + x) * 4 + 3] || !mask[((y + 6) * WW + x) * 4 + 3]) continue;
        if (EDGES.some((e) => segDist(x, y, nx(e.a), ny(e.a), nx(e.b), ny(e.b)) < 17)) continue;
        if (items.some((o) => Math.abs(o.x - x) < 12 && Math.abs(o.y - y) < 9)) continue;
        if (Object.values(LANDMARKS).some(([sx, sy, r]) => Math.abs(sx - x) < r && y > sy - r * 1.4 && y < sy + 14)) continue;
        let near = nodes[0], best = Infinity;
        for (const n of nodes) { const d = Math.hypot(nx(n) - x, ny(n) - y); if (d < best) { best = d; near = n; } }
        items.push({ x, y, theme: near.theme, r: rnd() });
      }
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) this.drawDeco(g, it);
  }

  drawDeco(g, { x, y, theme, r }) {
    const pick = (list) => list[Math.floor(r * list.length)];
    const kind = {
      meadow: () => pick(['tree', 'tree', 'bush', 'flowers', 'flowers', 'fence', 'rock']),
      forest: () => pick(['pine', 'pine', 'pine', 'mushroom', 'log', 'bush', 'pine']),
      volcano: () => pick(['rockDark', 'lava', 'deadTree', 'rockDark', 'lava', 'vent']),
      lake: () => pick(['pond', 'palm', 'palm', 'flowers', 'rock', 'pond', 'reeds']),
      ruins: () => pick(['pillar', 'pillarBroken', 'rock', 'bush', 'flowers']),
      village: () => pick(['house', 'house', 'lamp', 'tree', 'fence', 'flowers', 'well']),
      crystal: () => pick(['crystal', 'crystal', 'crystalPink', 'rockPurple', 'crystal']),
      castle: () => pick(['hedge', 'banner', 'tree', 'flowers', 'hedge']),
    }[theme]?.() || 'flowers';
    DECO[kind]?.(g, x, y, this);
  }

  // 칸: 흰 테 + 색 윗면 + 두께 있는 옆면 (열쇠 그림의 발판처럼)
  drawTile(g, n) {
    const big = n.type === 'start' || n.type === 'goal';
    const w = big ? 34 : 28, h = big ? 28 : 23, side = 5;
    const x = nx(n) - w / 2, y = ny(n) - h / 2 - 2;
    const [face, edge] = tileColor(n.type);
    g.fillStyle = 'rgba(30,20,40,.45)';
    g.fillRect(x + 2, y + h + side - 1, w - 2, 3);
    pxRect(g, x - 1, y - 1, w + 2, h + side + 2, INK, 2);
    pxRect(g, x, y + side, w, h, edge, 2);
    pxRect(g, x, y, w, h, '#ffffff', 2);
    pxRect(g, x + 2, y + 2, w - 4, h - 4, face, 1);
    g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + 3, y + 3, w - 6, 1);
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x + 3, y + h - 4, w - 6, 1);
    g.fillStyle = 'rgba(0,0,0,.18)';
    for (let i = x + 3; i < x + w - 2; i += 4) g.fillRect(i, y + h + 1, 1, side - 2);
    if (n.type === 'start') {
      g.fillStyle = INK;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) if ((i + j) % 2) g.fillRect(x + 5 + i * 4, y + 4 + j * 4, 4, 4);
      return;
    }
    const icon = SPACES[n.type]?.icon;
    if (icon) {
      const ic = iconSprite(icon, big ? 18 : 15);
      g.drawImage(ic, Math.round(nx(n) - ic.width / 2), Math.round(y + h / 2 - ic.height / 2));
    }
  }

  // ---------------- 큰 그림들 ----------------
  drawArch(g, x, y) {
    g.fillStyle = INK; g.fillRect(x - 24, y - 34, 5, 36); g.fillRect(x + 20, y - 34, 5, 36);
    g.fillStyle = '#c98c4e'; g.fillRect(x - 23, y - 33, 3, 34); g.fillRect(x + 21, y - 33, 3, 34);
    pxRect(g, x - 28, y - 44, 57, 13, INK, 2);
    pxRect(g, x - 27, y - 43, 55, 11, '#f2545b', 2);
    g.fillStyle = '#ffd84a'; g.fillRect(x - 25, y - 43, 51, 1);
    g.fillStyle = '#ffffff'; g.font = '9px Galmuri9, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('START', x + 1, y - 37);
  }

  drawWindmill(g, x, y) {
    g.fillStyle = 'rgba(30,20,40,.35)'; g.fillRect(x - 12, y + 1, 24, 3);
    pxRect(g, x - 9, y - 30, 18, 31, INK, 1);
    pxRect(g, x - 8, y - 29, 16, 29, '#f3e7c6', 1);
    g.fillStyle = '#c9b588'; g.fillRect(x + 4, y - 29, 4, 29);
    g.fillStyle = INK;
    g.beginPath(); g.moveTo(x - 12, y - 28); g.lineTo(x + 12, y - 28); g.lineTo(x, y - 43); g.closePath(); g.fill();
    g.fillStyle = '#f2545b';
    g.beginPath(); g.moveTo(x - 10, y - 29); g.lineTo(x + 10, y - 29); g.lineTo(x, y - 41); g.closePath(); g.fill();
    g.fillStyle = INK; g.fillRect(x - 2, y - 8, 4, 8); g.fillRect(x - 2, y - 21, 4, 4);
    this.anim.push({ kind: 'mill', x, y: y - 30 });
  }

  drawVolcano(g, x, y) {
    g.fillStyle = INK;
    g.beginPath(); g.moveTo(x - 72, y + 2); g.lineTo(x - 16, y - 62); g.lineTo(x + 16, y - 62); g.lineTo(x + 72, y + 2); g.closePath(); g.fill();
    g.fillStyle = '#5a4a58';
    g.beginPath(); g.moveTo(x - 69, y); g.lineTo(x - 15, y - 60); g.lineTo(x + 15, y - 60); g.lineTo(x + 69, y); g.closePath(); g.fill();
    g.fillStyle = '#463846';
    g.beginPath(); g.moveTo(x + 4, y - 60); g.lineTo(x + 15, y - 60); g.lineTo(x + 69, y); g.lineTo(x + 20, y); g.closePath(); g.fill();
    g.fillStyle = '#ff7a2a';
    g.fillRect(x - 14, y - 60, 28, 3);
    for (const [sx, len] of [[-8, 26], [3, 40], [9, 18]]) for (let k = 0; k < len; k++) g.fillRect(x + sx + Math.round(Math.sin(k * 0.3) * 2), y - 58 + k, 2, 1);
    g.fillStyle = '#ffd84a'; g.fillRect(x - 10, y - 61, 20, 1);
    this.anim.push({ kind: 'smoke', x, y: y - 66, big: true });
  }

  drawCastle(g, cx, cy) {
    const wall = '#e8eef8', shade = '#b8c6dc', roof = '#e0566a', roofD = '#a83a50';
    g.fillStyle = 'rgba(30,20,40,.35)'; g.fillRect(cx - 62, cy + 2, 124, 4);
    pxRect(g, cx - 56, cy - 34, 112, 36, INK, 1);
    g.fillStyle = wall; g.fillRect(cx - 55, cy - 33, 110, 34);
    g.fillStyle = shade; g.fillRect(cx - 55, cy - 6, 110, 7);
    for (let i = -55; i < 55; i += 8) { g.fillStyle = INK; g.fillRect(cx + i, cy - 40, 5, 6); g.fillStyle = wall; g.fillRect(cx + i + 1, cy - 39, 3, 5); }
    for (let i = -50; i < 50; i += 10) for (let j = -28; j < -6; j += 6) { g.fillStyle = shade; g.fillRect(cx + i + ((j / 6) % 2 ? 5 : 0), cy + j, 4, 1); }
    const tower = (tx, top, w) => {
      pxRect(g, tx - w / 2 - 1, top - 1, w + 2, cy - top + 3, INK, 1);
      g.fillStyle = wall; g.fillRect(tx - w / 2, top, w, cy - top + 1);
      g.fillStyle = shade; g.fillRect(tx + w / 2 - 3, top, 3, cy - top + 1);
      g.fillStyle = INK;
      g.beginPath(); g.moveTo(tx - w / 2 - 3, top + 1); g.lineTo(tx + w / 2 + 3, top + 1); g.lineTo(tx, top - w * 1.3); g.closePath(); g.fill();
      g.fillStyle = roof;
      g.beginPath(); g.moveTo(tx - w / 2 - 1, top); g.lineTo(tx + w / 2 + 1, top); g.lineTo(tx, top - w * 1.25); g.closePath(); g.fill();
      g.fillStyle = roofD;
      g.beginPath(); g.moveTo(tx, top - w * 1.25); g.lineTo(tx + w / 2 + 1, top); g.lineTo(tx + 1, top); g.closePath(); g.fill();
      g.fillStyle = '#6a7fa8'; g.fillRect(tx - 1, top + 6, 3, 5); g.fillRect(tx - 1, top + 16, 3, 5);
      g.fillStyle = INK; g.fillRect(tx, Math.round(top - w * 1.25) - 9, 1, 9);
      this.anim.push({ kind: 'flag', x: tx + 1, y: Math.round(top - w * 1.25 - 9) });
    };
    tower(cx - 56, cy - 62, 18); tower(cx + 56, cy - 62, 18);
    tower(cx - 24, cy - 82, 16); tower(cx + 24, cy - 78, 16); tower(cx, cy - 104, 22);
    pxRect(g, cx - 10, cy - 20, 20, 22, INK, 3);
    g.fillStyle = '#8a5a32'; g.fillRect(cx - 8, cy - 18, 16, 20);
    g.fillStyle = '#6b4226'; for (let i = -6; i < 8; i += 4) g.fillRect(cx + i, cy - 16, 1, 18);
    g.fillStyle = '#ffd84a'; g.fillRect(cx + 4, cy - 8, 2, 2);
  }

  drawSign(g, x, y, text) {
    g.fillStyle = INK; g.fillRect(x - 1, y - 4, 3, 14);
    g.fillStyle = '#8a5a32'; g.fillRect(x, y - 3, 1, 12);
    g.font = '9px Galmuri9, monospace';
    const w = Math.ceil(g.measureText(text).width) + 8;
    pxRect(g, x - w / 2, y - 14, w, 12, INK, 1);
    pxRect(g, x - w / 2 + 1, y - 13, w - 2, 10, '#c98c4e', 1);
    g.fillStyle = '#fff4dc'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y - 8);
  }

  // =====================================================
  // 매 프레임
  // =====================================================
  draw() {
    if (!this.world) { this.world = this.buildWorld(); this.thumb = null; }
    this.updateCamera();
    const g = this.vg;
    const cx = Math.round(this.cam.x), cy = Math.round(this.cam.y);

    g.drawImage(this.sky, 0, 0);
    if (this.overview) { this.drawOverview(g); return; }

    // 먼 섬 · 구름 (천천히 따라 움직임)
    const fx = -((cx * 0.25) % this.far.width);
    g.drawImage(this.far, Math.round(fx), Math.round(-cy * 0.08));
    g.drawImage(this.far, Math.round(fx + this.far.width), Math.round(-cy * 0.08));
    for (const cl of this.clouds) {
      const span = VW + 120;
      const x = ((((cl.x + this.t * cl.v - cx * cl.p) % span) + span) % span) - 100;
      g.drawImage(cl.c, Math.round(x), Math.round(cl.y - cy * cl.p * 0.5));
    }
    // 폭포 (섬 아래로)
    for (const a of this.anim) {
      if (a.kind !== 'fall') continue;
      const x = a.x - cx, y = a.y - cy;
      if (x < -10 || x > VW + 10 || y > VH || y + a.len < 0) continue;
      g.fillStyle = '#5cb3f2'; g.fillRect(x - 1, y, 8, a.len);
      g.fillStyle = '#9fe0fc'; g.fillRect(x, y, 6, a.len);
      g.fillStyle = '#ffffff';
      for (let k = 0; k < a.len; k += 6) g.fillRect(x + 1 + (k % 4), y + ((k + Math.floor(this.t * 40)) % a.len), 1, 3);
      g.globalAlpha = 0.5; g.fillRect(x - 3, y + a.len - 4, 12, 4); g.globalAlpha = 1;
    }

    g.drawImage(this.world, cx, cy, VW, VH, 0, 0, VW, VH);
    g.save();
    g.translate(-cx, -cy);
    this.drawAnim(g);
    this.drawHighlights(g);
    this.drawTokens(g);
    g.restore();

    this.present();
    this.drawMinimap();
  }

  present() {
    const out = this.ctx;
    out.imageSmoothingEnabled = false;
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.drawImage(this.view, 0, 0, this.canvas.width, this.canvas.height);
  }

  // 풍차 날개 · 연기 · 깃발 · 용암 · 반짝임
  drawAnim(g) {
    for (const a of this.anim) {
      if (a.kind === 'mill') {
        const ang = this.t * 1.5;
        for (let k = 0; k < 4; k++) {
          const t = ang + (k * Math.PI) / 2, cs = Math.cos(t), sn = Math.sin(t);
          for (let r = 2; r < 17; r++) {
            g.fillStyle = r % 4 === 0 ? INK : '#f3e7c6';
            g.fillRect(Math.round(a.x + cs * r), Math.round(a.y + sn * r), 2, 2);
          }
        }
        g.fillStyle = INK; g.fillRect(a.x - 1, a.y - 1, 3, 3);
      } else if (a.kind === 'smoke') {
        for (let k = 0; k < 4; k++) {
          const ph = (this.t * 0.4 + k / 4) % 1;
          const r = (a.big ? 5 : 2) + ph * (a.big ? 10 : 4);
          g.globalAlpha = 0.7 * (1 - ph);
          g.fillStyle = '#9a8a96';
          g.beginPath(); g.arc(Math.round(a.x + Math.sin(ph * 6 + k) * 6), Math.round(a.y - ph * (a.big ? 50 : 18)), r, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
        }
      } else if (a.kind === 'flag') {
        const wv = Math.floor(this.t * 6 + a.x) % 2;
        g.fillStyle = INK; g.fillRect(a.x, a.y - 1, 9, 7);
        g.fillStyle = '#ffd84a'; g.fillRect(a.x + 1, a.y, 7 - wv, 2);
        g.fillStyle = '#4f8ff7'; g.fillRect(a.x + 1, a.y + 2, 7 - wv, 3);
      } else if (a.kind === 'lava') {
        g.fillStyle = Math.sin(this.t * 3 + a.x) > 0 ? '#ffd84a' : '#ff9a3c';
        g.fillRect(a.x - 2, a.y - 1, 4, 2);
      } else if (a.kind === 'sparkle') {
        if (Math.floor(this.t * 2 + a.x) % 3 === 0) { g.fillStyle = '#ffffff'; g.fillRect(a.x - 1, a.y, 3, 1); g.fillRect(a.x, a.y - 1, 1, 3); }
      } else if (a.kind === 'glint') {
        if (Math.floor(this.t * 1.5 + a.x * 0.1) % 4 === 0) { g.fillStyle = '#ffffff'; g.fillRect(a.x, a.y, 1, 2); }
      }
    }
  }

  // 쌈뽕한 칸 반짝 · 마우스 올린 칸 · 갈림길 화살표
  drawHighlights(g) {
    const blink = Math.floor(this.t * 3) % 2 === 0;
    for (const n of BOARD.nodes) {
      const wild = SPACES[n.type]?.tier === 'wild';
      const hover = this.hover && this.hover.id === n.id;
      if (!(wild && blink) && !hover) continue;
      const w = 34, h = 33, x = nx(n) - w / 2, y = ny(n) - h / 2;
      g.fillStyle = hover ? '#ffffff' : '#fff6a8';
      g.fillRect(x + 2, y, w - 4, 1); g.fillRect(x + 2, y + h - 1, w - 4, 1);
      g.fillRect(x, y + 2, 1, h - 4); g.fillRect(x + w - 1, y + 2, 1, h - 4);
    }
    if (this.branch) {
      this.branch.options.forEach((id, i) => {
        const n = BOARD.nodes[id];
        const on = i === this.branch.sel;
        const x = nx(n), y = ny(n) - 26 + (on ? Math.round(Math.sin(this.t * 8) * 2) : 0);
        g.fillStyle = INK;
        g.beginPath(); g.moveTo(x - 8, y - 9); g.lineTo(x + 8, y - 9); g.lineTo(x, y + 2); g.closePath(); g.fill();
        g.fillStyle = on ? '#a7f070' : '#f4f4f4';
        g.beginPath(); g.moveTo(x - 6, y - 8); g.lineTo(x + 6, y - 8); g.lineTo(x, y - 1); g.closePath(); g.fill();
      });
    }
  }

  drawTokens(g) {
    const st = this.state;
    if (!st || !st.players) return;
    const groups = new Map();
    for (const p of st.players) {
      if (!groups.has(p.node)) groups.set(p.node, []);
      groups.get(p.node).push(p);
    }
    const list = [...st.players].sort((a, b) => (a.id === this.myId) - (b.id === this.myId) || ny(BOARD.nodes[a.node]) - ny(BOARD.nodes[b.node]));
    for (const p of list) {
      const n = BOARD.nodes[p.node];
      const grp = groups.get(p.node);
      const k = grp.indexOf(p), cnt = grp.length;
      const tx = nx(n) + (cnt > 1 ? Math.round((k - (cnt - 1) / 2) * 11) : 0), ty = ny(n) + 4 + (cnt > 2 ? (k % 2) * 3 : 0);
      let tk = this.tokens.get(p.id);
      if (!tk) { tk = { x: tx, y: ty, hop: 0 }; this.tokens.set(p.id, tk); }
      const dx = tx - tk.x, dy = ty - tk.y;
      tk.moving = Math.hypot(dx, dy) > 0.5;
      if (tk.moving) { const sp = Math.hypot(dx, dy) > 80 ? 0.12 : 0.22; tk.x += dx * sp; tk.y += dy * sp; tk.hop = Math.min(1, tk.hop + 0.35); }
      else { tk.x = tx; tk.y = ty; tk.hop = Math.max(0, tk.hop - 0.1); }
      const hop = Math.round(Math.abs(Math.sin(this.t * 13)) * 7 * tk.hop);
      const x = Math.round(tk.x), y = Math.round(tk.y);
      const img = minis[p.seat % minis.length];
      const w = img.naturalWidth || 18, h = img.naturalHeight || 23;
      const color = CHARACTERS[p.seat % CHARACTERS.length].color;

      g.fillStyle = 'rgba(30,20,40,.5)'; g.fillRect(x - 7, y - 1, 14, 3);
      g.fillStyle = color; g.fillRect(x - 6, y, 12, 2);
      if (this.targets && this.targets.ids[this.targets.sel] === p.id) {
        const r = Math.floor(this.t * 6) % 2;
        g.fillStyle = '#ff5a5a';
        g.fillRect(x - 12 - r, y - h - 3, 2, h + 3); g.fillRect(x + 10 + r, y - h - 3, 2, h + 3);
        g.fillRect(x - 12 - r, y - h - 3, 5, 2); g.fillRect(x + 7 + r, y - h - 3, 5, 2);
      }
      if (img.complete && img.naturalWidth) {
        if (!p.online) g.globalAlpha = 0.45;
        g.drawImage(img, x - Math.floor(w / 2), y - h - hop);
        g.globalAlpha = 1;
      }
      // 이름표
      g.font = '9px Galmuri9, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const lw = Math.ceil(g.measureText(p.name).width) + 6, ly = y + 5;
      pxRect(g, x - Math.floor(lw / 2), ly, lw, 11, INK, 1);
      pxRect(g, x - Math.floor(lw / 2) + 1, ly + 1, lw - 2, 9, p.id === this.myId ? '#a7f070' : '#fff4dc', 1);
      g.fillStyle = INK; g.fillText(p.name, x, ly + 6);
      // 내 말 화살표
      if (p.id === this.myId) {
        const ay = y - h - hop - 5 + Math.round(Math.sin(this.t * 5));
        g.fillStyle = INK; g.fillRect(x - 5, ay - 5, 11, 2); g.fillRect(x - 4, ay - 3, 9, 1); g.fillRect(x - 3, ay - 2, 7, 1); g.fillRect(x - 2, ay - 1, 5, 1); g.fillRect(x - 1, ay, 3, 1);
        g.fillStyle = '#a7f070'; g.fillRect(x - 4, ay - 5, 9, 1); g.fillRect(x - 3, ay - 4, 7, 1); g.fillRect(x - 2, ay - 3, 5, 1); g.fillRect(x - 1, ay - 2, 3, 1);
      }
      // 굴린 수
      const r = this.rolls && this.rolls[p.id];
      if (r && !r.skip && st.step === 'reveal') {
        const lab = String(r.move);
        const bw = Math.max(15, Math.ceil(g.measureText(lab).width) + 8);
        const bx = x - Math.floor(bw / 2), by = y - h - 20;
        pxRect(g, bx - 1, by - 1, bw + 2, 14, INK, 1);
        pxRect(g, bx, by, bw, 12, r.move < 0 ? '#f2545b' : r.move === 0 ? '#9aa3b5' : '#ffd84a', 1);
        g.fillStyle = INK; g.fillRect(x - 1, by + 12, 3, 2);
        g.fillStyle = r.move > 0 ? INK : '#ffffff';
        g.fillText(lab, x, by + 7);
      }
    }
  }

  // ---------------- 카메라 ----------------
  tokenPos(pid) {
    const tk = this.tokens.get(pid);
    if (tk) return tk;
    const p = this.state?.players?.find((x) => x.id === pid);
    return p ? { x: nx(BOARD.nodes[p.node]), y: ny(BOARD.nodes[p.node]) } : null;
  }

  updateCamera() {
    const now = performance.now();
    if (this.overview || now < this.manualUntil) return;
    let target = null;
    if (this.branch) {
      const ns = this.branch.options.map((id) => BOARD.nodes[id]);
      target = { x: ns.reduce((s, n) => s + nx(n), 0) / ns.length, y: ns.reduce((s, n) => s + ny(n), 0) / ns.length };
    } else if (this.spot && now < this.spot.until) {
      target = this.tokenPos(this.spot.pid);
    }
    if (!target && this.state?.players) {
      const moving = this.state.players.filter((p) => this.tokens.get(p.id)?.moving);
      const pick = moving.find((p) => p.id === this.myId) || moving[0];
      target = this.tokenPos(pick ? pick.id : this.myId);
    }
    if (!target) target = { x: nx(BOARD.nodes[BOARD.start]), y: ny(BOARD.nodes[BOARD.start]) };
    const want = { x: target.x - VW / 2, y: target.y - FOCUS_Y / PX };
    if (!this.camReady) { this.cam = { ...want }; this.camReady = true; }
    this.cam.x += (want.x - this.cam.x) * 0.08;
    this.cam.y += (want.y - this.cam.y) * 0.08;
    this.clampCam();
  }

  // ---------------- 전체 지도 · 작은 지도 ----------------
  getThumb() {
    if (this.thumb) return this.thumb;
    const s = Math.min((VW - 20) / WW, (VH - 80) / WH);
    const [c, g] = layer(Math.round(WW * s), Math.round(WH * s));
    g.imageSmoothingEnabled = true;
    g.drawImage(this.world, 0, 0, c.width, c.height);
    this.thumb = c;
    return c;
  }

  drawDots(g, ox, oy, s, size) {
    for (const p of this.state?.players || []) {
      const n = BOARD.nodes[p.node];
      const x = Math.round(ox + nx(n) * s), y = Math.round(oy + ny(n) * s);
      g.fillStyle = INK; g.fillRect(x - size, y - size, size * 2 + 1, size * 2 + 1);
      g.fillStyle = CHARACTERS[p.seat % CHARACTERS.length].color; g.fillRect(x - size + 1, y - size + 1, size * 2 - 1, size * 2 - 1);
      if (p.id === this.myId) { g.fillStyle = '#ffffff'; g.fillRect(x, y, 1, 1); }
    }
  }

  drawOverview(g) {
    const th = this.getThumb();
    const ox = Math.round((VW - th.width) / 2), oy = 28;
    g.strokeStyle = INK; g.lineWidth = 2;
    g.strokeRect(ox - 1, oy - 1, th.width + 2, th.height + 2);
    g.drawImage(th, ox, oy);
    this.drawDots(g, ox, oy, th.width / WW, 3);
    this.present();
    this.drawMinimap();
  }

  drawMinimap() {
    const m = this.minimap;
    if (!m || !this.world) return;
    const th = this.getThumb();
    if (m.width !== th.width) { m.width = th.width; m.height = th.height; }
    const g = m.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#86d3fa'; g.fillRect(0, 0, m.width, m.height);
    g.drawImage(th, 0, 0);
    const s = th.width / WW;
    if (!this.overview) {
      g.strokeStyle = '#ffffff'; g.lineWidth = 1;
      g.strokeRect(Math.round(this.cam.x * s) + 0.5, Math.round(this.cam.y * s) + 0.5, Math.round(VW * s), Math.round(VH * s));
    }
    this.drawDots(g, 0, 0, s, 2);
  }
}

// =====================================================
// 장식 그림 (낮은 해상도 픽셀, x · y = 바닥 가운데)
// =====================================================
const shadow = (g, x, y, w) => { g.fillStyle = 'rgba(30,20,40,.35)'; g.fillRect(x - w / 2, y, w, 2); };
const DECO = {
  tree(g, x, y) {
    shadow(g, x, y, 14);
    g.fillStyle = INK; g.fillRect(x - 2, y - 7, 5, 8);
    g.fillStyle = '#7d4e2a'; g.fillRect(x - 1, y - 6, 3, 7);
    const blob = (cx, cy, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); };
    blob(x, y - 14, 9, INK); blob(x - 5, y - 11, 6, INK); blob(x + 5, y - 11, 6, INK);
    blob(x, y - 14, 8, '#3f9a3a'); blob(x - 5, y - 11, 5, '#3f9a3a'); blob(x + 5, y - 11, 5, '#3f9a3a');
    blob(x - 1, y - 16, 5, '#5cc449'); blob(x - 3, y - 18, 2, '#9be86a');
  },
  pine(g, x, y) {
    shadow(g, x, y, 12);
    g.fillStyle = '#6b4226'; g.fillRect(x - 1, y - 4, 3, 5);
    for (let i = 0; i < 3; i++) {
      const by = y - 4 - i * 6, hw = 8 - i * 2;
      g.fillStyle = INK; g.beginPath(); g.moveTo(x - hw - 1, by + 1); g.lineTo(x + hw + 2, by + 1); g.lineTo(x + 0.5, by - 10); g.closePath(); g.fill();
      g.fillStyle = '#2f7d32'; g.beginPath(); g.moveTo(x - hw, by); g.lineTo(x + hw + 1, by); g.lineTo(x + 0.5, by - 9); g.closePath(); g.fill();
      g.fillStyle = '#4fb148'; g.fillRect(x - 1, by - 6, 2, 5);
    }
  },
  bush(g, x, y) {
    shadow(g, x, y, 12);
    g.fillStyle = INK; g.beginPath(); g.ellipse(x, y - 4, 7, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#46a046'; g.beginPath(); g.ellipse(x, y - 4, 6, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#79cf5d'; g.fillRect(x - 3, y - 7, 3, 2);
    g.fillStyle = '#ff7eb6'; g.fillRect(x + 2, y - 5, 1, 1); g.fillRect(x - 2, y - 3, 1, 1);
  },
  flowers(g, x, y) {
    const cols = ['#ff7eb6', '#fff06a', '#ffffff', '#ff9a3c', '#b4a8f4'];
    for (let i = 0; i < 4; i++) {
      const fx = x + ((i * 7) % 11) - 5, fy = y - ((i * 5) % 5);
      g.fillStyle = '#2f7d32'; g.fillRect(fx, fy - 2, 1, 3);
      g.fillStyle = cols[(x + i) % cols.length]; g.fillRect(fx - 1, fy - 3, 3, 1); g.fillRect(fx, fy - 4, 1, 3);
    }
  },
  fence(g, x, y) {
    for (let i = -8; i <= 8; i += 4) { g.fillStyle = INK; g.fillRect(x + i - 1, y - 7, 3, 8); g.fillStyle = '#e8d2a0'; g.fillRect(x + i, y - 6, 1, 6); }
    g.fillStyle = INK; g.fillRect(x - 9, y - 5, 19, 1); g.fillStyle = '#c98c4e'; g.fillRect(x - 9, y - 4, 19, 1);
  },
  rock(g, x, y) {
    shadow(g, x, y, 10);
    pxRect(g, x - 5, y - 5, 10, 6, INK, 2);
    pxRect(g, x - 4, y - 4, 8, 4, '#a8a8b8', 1);
    g.fillStyle = '#d0d0dc'; g.fillRect(x - 3, y - 4, 3, 1);
  },
  rockDark(g, x, y) {
    shadow(g, x, y, 12);
    pxRect(g, x - 6, y - 7, 12, 8, INK, 2);
    pxRect(g, x - 5, y - 6, 10, 6, '#4a3a48', 1);
    g.fillStyle = '#6e5a6a'; g.fillRect(x - 4, y - 6, 4, 1);
    g.fillStyle = '#ff7a2a'; g.fillRect(x + 1, y - 3, 3, 1);
  },
  lava(g, x, y, v) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(x, y - 2, 9, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c2561c'; g.beginPath(); g.ellipse(x, y - 2, 8, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff9a3c'; g.fillRect(x - 5, y - 3, 10, 2);
    v.anim.push({ kind: 'lava', x, y: y - 2 });
  },
  vent(g, x, y, v) {
    DECO.rockDark(g, x, y);
    v.anim.push({ kind: 'smoke', x, y: y - 8 });
  },
  deadTree(g, x, y) {
    shadow(g, x, y, 8);
    g.fillStyle = INK; g.fillRect(x - 1, y - 14, 3, 15); g.fillRect(x - 5, y - 11, 5, 2); g.fillRect(x + 1, y - 8, 5, 2);
    g.fillStyle = '#6e5a6a'; g.fillRect(x, y - 13, 1, 13);
  },
  mushroom(g, x, y) {
    g.fillStyle = INK; g.fillRect(x - 1, y - 4, 3, 5);
    g.fillStyle = '#f3e7c6'; g.fillRect(x, y - 3, 1, 3);
    g.fillStyle = INK; g.beginPath(); g.ellipse(x + 0.5, y - 5, 5, 3, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#f2545b'; g.beginPath(); g.ellipse(x + 0.5, y - 5, 4, 2.5, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(x - 2, y - 7, 1, 1); g.fillRect(x + 2, y - 6, 1, 1);
  },
  log(g, x, y) {
    shadow(g, x, y, 14);
    pxRect(g, x - 7, y - 5, 14, 6, INK, 1);
    g.fillStyle = '#8a5a32'; g.fillRect(x - 6, y - 4, 12, 4);
    g.fillStyle = '#e3c98d'; g.fillRect(x + 4, y - 4, 2, 4);
  },
  pond(g, x, y, v) {
    g.fillStyle = INK; g.beginPath(); g.ellipse(x, y - 3, 13, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3c8fc4'; g.beginPath(); g.ellipse(x, y - 3, 12, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7fd6ff'; g.beginPath(); g.ellipse(x, y - 4, 10, 3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5cc449'; g.fillRect(x - 6, y - 4, 3, 2);
    v.anim.push({ kind: 'sparkle', x: x + 3, y: y - 4 }, { kind: 'sparkle', x: x - 4, y: y - 3 });
  },
  palm(g, x, y) {
    shadow(g, x, y, 10);
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 3 ? '#b57a42' : INK; g.fillRect(x + Math.round(Math.sin(i / 6) * 3) - 1, y - i, 3, 1); }
    const tx = x + 3, ty = y - 16;
    g.fillStyle = INK;
    for (const [dx, dy] of [[-9, 3], [9, 3], [-6, -4], [6, -4], [0, -6]]) { g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + dx, ty + dy); g.lineTo(tx + dx * 0.6, ty + dy + 3); g.closePath(); g.fill(); }
    g.fillStyle = '#46a046';
    for (const [dx, dy] of [[-8, 3], [8, 3], [-5, -3], [5, -3], [0, -5]]) { g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + dx, ty + dy); g.lineTo(tx + dx * 0.6, ty + dy + 2); g.closePath(); g.fill(); }
    g.fillStyle = '#8a5a32'; g.fillRect(tx - 1, ty, 3, 2);
  },
  reeds(g, x, y) {
    for (let i = -3; i <= 3; i += 2) { g.fillStyle = '#3f9a3a'; g.fillRect(x + i, y - 7 + Math.abs(i), 1, 7 - Math.abs(i)); }
    g.fillStyle = '#8a5a32'; g.fillRect(x - 1, y - 9, 1, 3); g.fillRect(x + 2, y - 8, 1, 3);
  },
  pillar(g, x, y) {
    shadow(g, x, y, 10);
    g.fillStyle = INK; g.fillRect(x - 4, y - 18, 9, 19);
    g.fillStyle = '#e8e4da'; g.fillRect(x - 3, y - 17, 7, 17);
    g.fillStyle = '#b8b2a4'; g.fillRect(x + 2, y - 17, 2, 17); g.fillRect(x - 3, y - 14, 7, 1);
    g.fillStyle = INK; g.fillRect(x - 5, y - 20, 11, 3); g.fillStyle = '#e8e4da'; g.fillRect(x - 4, y - 19, 9, 1);
  },
  pillarBroken(g, x, y) {
    shadow(g, x, y, 12);
    g.fillStyle = INK; g.fillRect(x - 4, y - 9, 9, 10);
    g.fillStyle = '#e8e4da'; g.fillRect(x - 3, y - 8, 7, 8);
    g.fillStyle = INK; g.fillRect(x - 3, y - 9, 3, 1); g.fillRect(x + 1, y - 10, 3, 2);
    pxRect(g, x + 5, y - 3, 7, 4, INK, 1); g.fillStyle = '#d0cabc'; g.fillRect(x + 6, y - 2, 5, 2);
  },
  house(g, x, y) {
    const red = (x + y) % 2;
    const roof = red ? '#e0566a' : '#4f8ff7', roofD = red ? '#a83a50' : '#2a55b8';
    shadow(g, x, y, 22);
    g.fillStyle = INK; g.fillRect(x - 10, y - 14, 20, 15);
    g.fillStyle = '#fff4dc'; g.fillRect(x - 9, y - 13, 18, 13);
    g.fillStyle = '#f6e3b8'; g.fillRect(x + 5, y - 13, 4, 13);
    g.fillStyle = INK; g.beginPath(); g.moveTo(x - 13, y - 13); g.lineTo(x + 13, y - 13); g.lineTo(x, y - 25); g.closePath(); g.fill();
    g.fillStyle = roof; g.beginPath(); g.moveTo(x - 11, y - 14); g.lineTo(x + 11, y - 14); g.lineTo(x, y - 23); g.closePath(); g.fill();
    g.fillStyle = roofD; g.beginPath(); g.moveTo(x, y - 23); g.lineTo(x + 11, y - 14); g.lineTo(x + 1, y - 14); g.closePath(); g.fill();
    g.fillStyle = INK; g.fillRect(x - 3, y - 7, 5, 7); g.fillStyle = '#8a5a32'; g.fillRect(x - 2, y - 6, 3, 6);
    g.fillStyle = INK; g.fillRect(x + 3, y - 10, 5, 4); g.fillStyle = '#ffd84a'; g.fillRect(x + 4, y - 9, 3, 2);
    g.fillStyle = INK; g.fillRect(x - 8, y - 10, 4, 4); g.fillStyle = '#7fd6ff'; g.fillRect(x - 7, y - 9, 2, 2);
  },
  lamp(g, x, y) {
    g.fillStyle = INK; g.fillRect(x - 1, y - 14, 3, 15); g.fillRect(x - 3, y - 18, 7, 5);
    g.fillStyle = '#ffd84a'; g.fillRect(x - 2, y - 17, 5, 3);
  },
  well(g, x, y) {
    shadow(g, x, y, 14);
    pxRect(g, x - 6, y - 6, 13, 7, INK, 1); g.fillStyle = '#a8a8b8'; g.fillRect(x - 5, y - 5, 11, 5);
    g.fillStyle = INK; g.fillRect(x - 6, y - 15, 2, 10); g.fillRect(x + 5, y - 15, 2, 10);
    g.fillStyle = '#e0566a'; g.fillRect(x - 8, y - 17, 17, 3);
    g.fillStyle = '#3c8fc4'; g.fillRect(x - 4, y - 5, 9, 1);
  },
  crystal(g, x, y, v) {
    shadow(g, x, y, 12);
    for (const [dx, h, w] of [[-4, 9, 3], [0, 15, 4], [4, 7, 3]]) {
      g.fillStyle = INK; g.beginPath(); g.moveTo(x + dx - w - 1, y + 1); g.lineTo(x + dx + w + 1, y + 1); g.lineTo(x + dx + w + 1, y - h + 3); g.lineTo(x + dx, y - h - 1); g.lineTo(x + dx - w - 1, y - h + 3); g.closePath(); g.fill();
      g.fillStyle = '#3cb8e8'; g.beginPath(); g.moveTo(x + dx - w, y); g.lineTo(x + dx + w, y); g.lineTo(x + dx + w, y - h + 3); g.lineTo(x + dx, y - h); g.lineTo(x + dx - w, y - h + 3); g.closePath(); g.fill();
      g.fillStyle = '#7fe6ff'; g.fillRect(x + dx - w + 1, y - h + 3, 2, h - 4);
    }
    v.anim.push({ kind: 'glint', x, y: y - 12 });
  },
  crystalPink(g, x, y, v) {
    shadow(g, x, y, 10);
    for (const [dx, h, w] of [[-3, 10, 3], [3, 13, 3]]) {
      g.fillStyle = INK; g.beginPath(); g.moveTo(x + dx - w - 1, y + 1); g.lineTo(x + dx + w + 1, y + 1); g.lineTo(x + dx, y - h - 1); g.closePath(); g.fill();
      g.fillStyle = '#e86ad6'; g.beginPath(); g.moveTo(x + dx - w, y); g.lineTo(x + dx + w, y); g.lineTo(x + dx, y - h); g.closePath(); g.fill();
      g.fillStyle = '#ffb4f0'; g.fillRect(x + dx - 1, y - h + 4, 1, h - 5);
    }
    v.anim.push({ kind: 'glint', x: x + 3, y: y - 10 });
  },
  rockPurple(g, x, y) {
    shadow(g, x, y, 12);
    pxRect(g, x - 6, y - 6, 12, 7, INK, 2);
    pxRect(g, x - 5, y - 5, 10, 5, '#5a4ab0', 1);
    g.fillStyle = '#8a7ae0'; g.fillRect(x - 4, y - 5, 4, 1);
  },
  hedge(g, x, y) {
    shadow(g, x, y, 16);
    pxRect(g, x - 8, y - 8, 16, 9, INK, 2);
    pxRect(g, x - 7, y - 7, 14, 7, '#3f9a3a', 2);
    g.fillStyle = '#5cc449'; g.fillRect(x - 6, y - 7, 12, 2);
  },
  banner(g, x, y) {
    g.fillStyle = INK; g.fillRect(x - 1, y - 22, 3, 23); g.fillRect(x + 2, y - 21, 9, 13);
    g.fillStyle = x % 2 ? '#e0566a' : '#4f8ff7'; g.fillRect(x + 2, y - 20, 8, 11);
    g.fillStyle = '#ffd84a'; g.fillRect(x + 5, y - 17, 2, 2);
  },
};
