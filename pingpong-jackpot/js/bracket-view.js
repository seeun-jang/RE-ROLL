// =====================================================
// 토너먼트 대진표 그림 (아래 → 위로 올라가는 나무 모양)
//  맨 아래: 선수 (얼굴 + 이름)
//  위로 갈수록 경기 → 맨 위가 결승. 이긴 선수의 길은 금색 선으로 이어짐
//  3·4위전은 오른쪽 아래 작은 칸에 따로 표시
//  대진 정하기 화면(SeedScene)과 경기 사이 대진표(TournamentScene)가 같이 씀
// =====================================================
const BRACKET_VIEW = {
  TOP_Y: 22,        // 결승 칸 높이
  LEAF_Y: 106,      // 선수 얼굴 윗부분
  NODE_W: 62,
  NODE_H: 15,
  LEAF_W: 60,
};

// 결승(F)에서 시작해서 아래로 내려가며 나무 구조를 만듦
function buildBracketTree(tour) {
  const leaves = [];
  const nodes = [];
  const walk = (ref) => {
    if (ref.p) {
      const leaf = { type: 'leaf', p: ref.p, level: 0 };
      leaves.push(leaf);
      return leaf;
    }
    const m = tour.find(ref.w);
    const node = { type: 'match', m, children: [walk(m.a), walk(m.b)] };
    node.level = 1 + Math.max(...node.children.map((c) => c.level));
    nodes.push(node);
    return node;
  };
  const root = walk({ w: 'F' });
  // 가로 위치: 선수는 왼쪽부터 고르게, 경기는 두 자식의 가운데
  const W = CONFIG.WIDTH;
  const gap = Math.min(BRACKET_VIEW.LEAF_W + 4, (W - 20) / leaves.length);
  const x0 = W / 2 - (gap * (leaves.length - 1)) / 2;
  leaves.forEach((l, i) => (l.x = Math.round(x0 + i * gap)));
  const place = (n) => {
    if (n.type === 'leaf') return n.x;
    n.x = Math.round((place(n.children[0]) + place(n.children[1])) / 2);
    return n.x;
  };
  place(root);
  // 세로 위치: 단계(level)마다 같은 간격
  const step = (BRACKET_VIEW.LEAF_Y - BRACKET_VIEW.TOP_Y) / root.level;
  nodes.forEach((n) => (n.y = Math.round(BRACKET_VIEW.LEAF_Y - n.level * step)));
  return { root, leaves, nodes };
}

// 그 칸(선수 또는 경기)에서 올라오는 사람 (경기면 승자, 아직이면 null)
function bracketWho(n) {
  return n.type === 'leaf' ? n.p : n.m.winner;
}

// opts: { t(프레임), cursor(선택 중인 선수 칸 번호), picked(먼저 고른 칸 번호), current(다음 경기) }
function drawBracket(ctx, tour, opts = {}) {
  const t = opts.t || 0;
  const tree = buildBracketTree(tour);
  const V = BRACKET_VIEW;
  const line = (x, y, w, h, gold) => {
    ctx.fillStyle = C('1');
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = C(gold ? '9' : 'j');
    ctx.fillRect(x, y, w, h);
  };
  // 1) 선 (아래 칸 → 위 경기)
  for (const n of tree.nodes) {
    const joinY = n.y + V.NODE_H + 7;
    const [a, b] = n.children;
    const won = (c) => n.m.winner && bracketWho(c) === n.m.winner;
    for (const c of [a, b]) {
      const top = c.type === 'leaf' ? V.LEAF_Y : c.y + V.NODE_H;
      line(c.x - 1, joinY, 2, top - joinY, won(c));
    }
    // 가로선: 이긴 쪽 절반만 금색
    const mid = n.x;
    line(Math.min(a.x, mid), joinY, Math.abs(mid - a.x), 2, won(a));
    line(Math.min(b.x, mid), joinY, Math.abs(b.x - mid), 2, won(b));
    line(mid - 1, n.y + V.NODE_H, 2, joinY - n.y - V.NODE_H, !!n.m.winner);
  }
  // 2) 경기 칸 (아직이면 경기 이름, 끝났으면 이긴 사람)
  for (const n of tree.nodes) {
    const m = n.m;
    const isNext = opts.current === m;
    const x = n.x - V.NODE_W / 2;
    const style = m.winner ? 'default' : isNext ? 'red' : 'dark';
    drawPanel(ctx, x, n.y, V.NODE_W, V.NODE_H, style);
    if (m.winner) {
      KText.draw(ctx, m.winner.name, n.x, n.y + 1, m.winner.color, { align: 'center', font: 'b', outline: C('1') });
      if (m.id === 'F') ctx.drawImage(SPR.crown, n.x - 2, n.y - 5);
    } else {
      const label = isNext && t % 40 < 20 ? '다음!' : m.label;
      KText.draw(ctx, label, n.x, n.y + 1, isNext ? C('9') : C('k'), { align: 'center', font: 'b' });
    }
    if (m.winner && m.how) KText.draw(ctx, m.how, n.x + V.NODE_W / 2 + 2, n.y + 1, C('a'), { font: 's', outline: C('1') });
  }
  // 3) 선수 칸 (얼굴 + 이름)
  tree.leaves.forEach((l, i) => {
    const p = l.p;
    const out = isEliminated(tour, p);
    const sel = opts.cursor === i;
    const picked = opts.picked === i;
    const face = p.spr.portrait;
    const fy = V.LEAF_Y + 2 - (sel ? Math.round(Math.abs(Math.sin(t / 8)) * 2) : 0);
    const img = out ? buildFlashCached(face, PALETTE.i) : face;
    ctx.drawImage(img, Math.round(l.x - face.width / 2), fy);
    const bx = l.x - V.LEAF_W / 2 + 2;
    const by = V.LEAF_Y + 24;
    drawPanel(ctx, bx, by, V.LEAF_W - 4, 16, picked ? 'default' : sel ? 'red' : 'dark');
    KText.draw(ctx, p.name, l.x, by + 2, out ? C('i') : picked && t % 20 < 10 ? C('9') : p.color, { align: 'center', font: 'b', outline: C('1') });
  });
  // 4) 3·4위전 (오른쪽 아래)
  const B = tour.find('B');
  if (B) {
    const a = tour.resolve(B.a);
    const b = tour.resolve(B.b);
    const x = CONFIG.WIDTH - 112;
    const y = 6;
    const isNext = opts.current === B;
    drawPanel(ctx, x, y, 108, 15, B.winner ? 'default' : isNext ? 'red' : 'dark');
    const txt = B.winner ? `3위 ${B.winner.name}` : `3·4위전 ${a ? a.name : '?'}·${b ? b.name : '?'}`;
    KText.draw(ctx, txt, x + 54, y + 1, B.winner ? C('8') : isNext ? C('9') : C('k'), { align: 'center', font: 's' });
  }
  return tree;
}

// 이미 진 선수 (회색으로 표시) — 3·4위전이 남아 있으면 아직 아님
function isEliminated(tour, p) {
  if (p.placement) return p.placement > 1;
  return tour.matches.some((m) => m.loser === p && !tour.matches.some((mm) => !mm.winner && (tour.resolve(mm.a) === p || tour.resolve(mm.b) === p)));
}

// 대진표 화면 배경 (탁구: 카지노 홀 / 검도: 도장)
function makeBackdrop() {
  return typeof Hall !== 'undefined' ? new Hall() : new Dojo();
}
