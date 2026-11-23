// =====================================================
// 캐릭터 UI: 이름표 카드 · 진행 막대 · 디더 무늬
//  - 이름표: 캐릭터 색 카드 + 동그란 얼굴 아이콘 + 진한 이름 글씨
//    꼭대기에 도착하면 금색 카드 + 왕관 + 등수
//  - 진행 막대: 단계 눈금 + 캐릭터 색으로 채움 + 작은 얼굴 표시
// =====================================================

// 색 있는 디더 무늬 (반투명 대신 픽셀 체크무늬)
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

// 캐릭터 색의 진한 짝 (카드 그림자/테두리)
const DARK_OF = { e: 'd', q: 'v', t: '8', 8: 'u', p: '4', 9: '8' };

// 둥근 모서리 카드 (모서리 2칸 깎음)
function drawCard(ctx, x, y, w, h, fill, edge) {
  ctx.fillStyle = C('1');
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.fillStyle = C(edge);
  ctx.fillRect(x + 2, y + 1, w - 4, h - 2);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 4);
  ctx.fillStyle = C(fill);
  ctx.fillRect(x + 2, y + 1, w - 4, h - 4);
  ctx.fillRect(x + 1, y + 2, w - 2, h - 5);
  // 윗부분 반짝
  ctx.fillStyle = C('w');
  ctx.fillRect(x + 3, y + 2, Math.max(0, w - 10), 1);
}

// 이름표: c = Climber (또는 { def, name, index, place })
function drawNameCard(ctx, x, y, w, c, frame = 0) {
  const done = c.place != null;
  const col = done ? '9' : c.def.color;
  drawCard(ctx, x, y, w, 17, col, DARK_OF[col] || '3');
  const face = SPR.players[c.index].face;
  ctx.drawImage(face, x + 1, y);
  // 이름이 칸보다 길면 작은 글꼴로 (얼굴 아이콘 오른쪽 공간에 맞춤)
  const room = w - 21;
  const big = KText.width(c.name, 'b') <= room;
  KText.draw(ctx, c.name, x + 19 + room / 2, y + (big ? 2 : 3), C('1'), { align: 'center', font: big ? 'b' : 'n' });
  if (done) {
    // 왕관 + 등수 리본
    ctx.drawImage(SPR.crown, x + 6, y - 3);
    const tag = `${c.place}등`;
    const tw = KText.width(tag, 's') + 6;
    const tx = x + w - tw;
    const bob = Math.round(Math.abs(Math.sin(frame / 10)));
    // 이름 아래로 늘어진 리본 (이름을 가리지 않게)
    drawCard(ctx, tx, y + 15 - bob, tw, 14, '6', '7');
    KText.draw(ctx, tag, tx + tw / 2, y + 15 - bob, C('a'), { align: 'center', font: 's' });
  }
}

// 진행 막대 (가로): 단계 5칸 눈금, 최고 기록은 옅게, 지금 위치는 얼굴
function drawProgressBar(ctx, x, y, w, c, tower) {
  const col = c.place != null ? '9' : c.def.color;
  ctx.fillStyle = C('1');
  ctx.fillRect(x, y, w, 6);
  ctx.fillStyle = C('2');
  ctx.fillRect(x + 1, y + 1, w - 2, 4);
  const inner = w - 2;
  ctx.fillStyle = DITHER.get(ctx, col, 8);
  ctx.fillRect(x + 1, y + 1, Math.round(inner * c.best), 4);
  ctx.fillStyle = C(col);
  ctx.fillRect(x + 1, y + 1, Math.round(inner * c.progress), 4);
  ctx.fillStyle = C('w');
  ctx.fillRect(x + 1, y + 1, Math.round(inner * c.progress), 1);
  // 단계 눈금
  for (const s of tower.stages) {
    const k = (tower.startY - s.bottom) / tower.climbH;
    if (k <= 0) continue;
    ctx.fillStyle = C('1');
    ctx.fillRect(x + 1 + Math.round(inner * k), y + 1, 1, 4);
  }
}
