// =====================================================
// 전광판 (레인 위에 달린 점수 모니터) — 실제 볼링장 고증
//  - 표: 이름 | 프레임별 (투구 칸 + 누적 점수) | TOTAL
//    투구 칸 표기: X 스트라이크, / 스페어, - 0핀, 숫자
//  - 스트라이크·스페어·스플릿·거터 때는 모니터 전체가 애니메이션으로 바뀜
//  - 연속 스트라이크 이름: 더블 → 터키 → 포배거 → 파이브배거 …
// =====================================================
const BOARD = {
  X: 2, Y: 0, W: 316, H: 75,
  SX: 6, SY: 4, SW: 308, SH: 68, // 화면 안쪽
  NAME_W: 55,
  TOTAL_W: 52,
  ROW_H: 12,
};

function strikeName(n) {
  return ['스트라이크!', '스트라이크!', '더블!', '터키!', '포배거!', '파이브배거!', '식스팩!'][n] || `${n}배거!`;
}

// opts: { players, cur, frameNo, anim, frame, laneNo }
function drawMonitor(ctx, o) {
  const B = BOARD;
  // 베젤 (검은 테 + 회색 금속 테두리 + 매다는 기둥)
  ctx.fillStyle = C('1');
  ctx.fillRect(B.X, B.Y, B.W, B.H);
  ctx.fillStyle = C('i');
  ctx.fillRect(B.X + 1, B.Y + 1, B.W - 2, B.H - 2);
  ctx.fillStyle = C('j');
  ctx.fillRect(B.X + 2, B.Y + 1, B.W - 4, 1);
  ctx.fillStyle = C('1');
  ctx.fillRect(B.SX - 1, B.SY - 1, B.SW + 2, B.SH + 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(B.SX, B.SY, B.SW, B.SH);
  ctx.clip();
  if (o.anim) drawMonitorAnim(ctx, o);
  else drawScoreTable(ctx, o);
  // 모니터 화면 줄무늬 (옛날 CRT 느낌) — 애니메이션 글자 위에는 안 그림 (획이 끊겨 '핀'이 '찐'처럼 보임)
  ctx.fillStyle = DITHER.get(ctx, 'o', 2);
  if (!o.anim) for (let y = B.SY + 1; y < B.SY + B.SH; y += 3) ctx.fillRect(B.SX, y, B.SW, 1);
  ctx.restore();
}

function drawScoreTable(ctx, o) {
  const B = BOARD;
  const N = CONFIG.FRAMES;
  // 프레임 칸 폭: 프레임 수에 맞춰 넓힘 (최대 64)
  const cw = Math.min(64, Math.floor((B.SW - B.NAME_W - (N > 5 ? 34 : B.TOTAL_W)) / N));
  ctx.fillStyle = C('f');
  ctx.fillRect(B.SX, B.SY, B.SW, B.SH);
  // 머리글
  ctx.fillStyle = C('1');
  ctx.fillRect(B.SX, B.SY, B.SW, 7);
  BitmapFont.draw(ctx, `LANE ${o.laneNo || 7}`, B.SX + 2, B.SY + 1, C('h'));
  const cx0 = B.SX + B.NAME_W;
  for (let i = 0; i < N; i++) BitmapFont.draw(ctx, String(i + 1), cx0 + i * cw + cw / 2, B.SY + 1, i === o.frameNo ? C('9') : C('a'), { align: 'center' });
  const tx = cx0 + N * cw; // TOTAL 칸 시작
  BitmapFont.draw(ctx, 'TOTAL', tx + (B.SX + B.SW - tx) / 2, B.SY + 1, C('a'), { align: 'center' });
  const n = o.players.length;
  const RH = Math.min(18, Math.floor((B.SH - 7) / n)); // 사람이 적으면 줄을 높게
  const ty = Math.floor((RH - 12) / 2) - 1; // 굵은 글씨 세로 가운데
  const y0 = B.SY + 7 + Math.floor((B.SH - 7 - n * RH) / 2);
  o.players.forEach((p, r) => {
    const y = y0 + r * RH;
    const cur = r === o.cur;
    ctx.fillStyle = cur ? C('7') : r % 2 ? C('f') : C('2');
    ctx.fillRect(B.SX, y, B.SW, RH);
    if (r % 2 === 0 && !cur) {
      ctx.fillStyle = DITHER.get(ctx, 'f', 8);
      ctx.fillRect(B.SX, y, B.SW, RH);
    }
    // 이름 (지금 치는 사람은 ▶ 깜빡)
    if (cur && o.frame % 30 < 20) BitmapFont.draw(ctx, '>', B.SX + 2, y + Math.floor(RH / 2) - 2, C('9'));
    KText.draw(ctx, p.name, B.SX + 8, y + ty, C(p.def.color), { font: KText.width(p.name, 'b') <= B.NAME_W - 10 ? 'b' : 'n' });
    // 프레임 칸 — 칸이 넓으면(3 · 5프레임) 굵은 글씨로 크게, 좁으면(10프레임) 작은 글씨
    const frames = scoreFrames(p.rolls);
    const wide = cw >= 34;
    const MARK_COL = (m) => (m === 'X' ? '5' : m === '/' ? 'h' : m === '-' ? 'j' : 'b');
    frames.forEach((f, i) => {
      const x = cx0 + i * cw;
      const last = i === N - 1;
      ctx.fillStyle = C('g');
      ctx.fillRect(x, y, 1, RH);
      const boxes = last ? 3 : 2;
      const bw = wide ? 10 : 8;
      for (let k = 0; k < boxes; k++) {
        const bx = x + cw - (boxes - k) * bw;
        ctx.fillStyle = C('g');
        ctx.fillRect(bx, y, 1, wide ? RH : 7);
        if (!wide) ctx.fillRect(bx, y + 6, 8, 1);
        const m = f.marks[k];
        if (!m) continue;
        if (wide) {
          if (m === 'X') {
            // 스트라이크: 빨간 바탕에 굵은 X
            ctx.fillStyle = C('6');
            ctx.fillRect(bx + 1, y, bw - 1, RH);
          }
          KText.draw(ctx, m, bx + bw / 2 + 1, y + ty, m === 'X' ? C('b') : C(MARK_COL(m)), { align: 'center', font: 'b' });
        } else BitmapFont.draw(ctx, m, bx + 3, y + 1, C(MARK_COL(m)));
      }
      // 지금 칠 칸: 노란 테두리 깜빡
      if (cur && i === o.frameNo && o.frame % 30 < 20) {
        ctx.fillStyle = C('9');
        ctx.fillRect(x + 1, y, cw - 1, 1);
        ctx.fillRect(x + 1, y + RH - 1, cw - 1, 1);
      }
      if (f.cum != null) {
        if (wide) KText.draw(ctx, String(f.cum), x + (cw - boxes * bw) / 2 + 1, y + ty, C('9'), { align: 'center', font: 'b' });
        else if (RH >= 16) BitmapFont.draw(ctx, String(f.cum), x + cw / 2 + 1, y + RH - 7, C('9'), { align: 'center' });
        else BitmapFont.draw(ctx, String(f.cum), x + (cw - boxes * 8) / 2 + 1, y + 6, C('9'), { align: 'center' });
      }
    });
    // TOTAL (볼링 점수 + 잭팟 핀)
    ctx.fillStyle = C('g');
    ctx.fillRect(tx, y, 1, RH);
    const total = runningScore(p.rolls) + p.bonus;
    KText.draw(ctx, String(total), B.SX + B.SW - 3, y + ty, C('9'), { align: 'right', font: 'b', outline: C('1') });
    if (p.bonus) KText.draw(ctx, `+${p.bonus}`, tx + 3, y + ty + 1, C('8'), { font: 'n' });
  });
}

// 전광판 애니메이션 (anim: { type, t, dur, text, sub, extra })
function drawMonitorAnim(ctx, o) {
  const B = BOARD;
  const a = o.anim;
  const t = a.t;
  const cx = B.SX + B.SW / 2;
  // 배경 줄무늬 (종류별 색)
  const bands = {
    strike: ['6', '7'], spare: ['g', 'f'], split: ['3', '2'], gutter: ['2', 'o'], welcome: ['f', '2'], end: ['7', '3'], jackpot: ['8', '7'],
  }[a.type] || ['f', '2'];
  for (let x = B.SX - 16; x < B.SX + B.SW; x += 8) {
    const k = Math.floor((x + t * 2) / 8) % 2;
    ctx.fillStyle = C(bands[Math.abs(k)]);
    ctx.fillRect(x + ((t * 2) % 8), B.SY, 8, B.SH);
  }
  // 테두리 전구 (번갈아 깜빡)
  for (let x = B.SX + 2; x < B.SX + B.SW; x += 6) {
    ctx.fillStyle = C(((x >> 1) + (t >> 2)) % 2 ? '9' : '8');
    ctx.fillRect(x, B.SY + 1, 2, 1);
    ctx.fillRect(x, B.SY + B.SH - 2, 2, 1);
  }
  const ballY = B.SY + 41;
  if (a.type === 'strike' || a.type === 'spare' || a.type === 'gutter' || a.type === 'split') {
    // 굴러가는 공 → 핀
    const hitT = 22;
    const bx = Math.round(B.SX + 20 + Math.min(1, t / hitT) * (cx + 40 - B.SX - 20));
    const pinX = cx + 54;
    const pins = a.type === 'split' ? [[-14, 0], [14, 0]] : [[0, 0], [5, -3], [5, 3], [10, -6], [10, 0], [10, 6]];
    pins.forEach(([px, py], i) => {
      let x = pinX + px;
      let y = ballY - 2 + py;
      const knocked = a.type === 'strike' || (a.type === 'spare' && i < 4);
      if (knocked && t > hitT) {
        const dt = t - hitT;
        x += Math.round(Math.cos(i * 1.7) * dt * 2.2);
        y += Math.round(-dt * 1.4 + dt * dt * 0.06 + Math.sin(i * 2.1) * dt);
      }
      ctx.drawImage(SPR3D.tiny, x, y);
    });
    if (a.type === 'gutter') {
      // 공이 아래로 빠져 버림
      const gy = t > hitT * 0.6 ? Math.round((t - hitT * 0.6) * 1.5) : 0;
      if (gy < 30) ctx.drawImage(SPR3D.balls[a.color][1][(t >> 2) % 3], Math.min(bx, cx), ballY + gy - 4);
    } else if (t < hitT + 4) ctx.drawImage(SPR3D.balls[a.color][1][(t >> 2) % 3], bx, ballY - 4);
  }
  // 큰 글자 (톡 튀어나옴)
  const show = a.type === 'welcome' || a.type === 'end' || a.type === 'jackpot' || t > 18;
  if (show) {
    const pop = Math.max(0, 6 - (t - (a.type === 'welcome' || a.type === 'end' || a.type === 'jackpot' ? 0 : 18)));
    const col = { strike: '9', spare: 'h', split: '5', gutter: 'k', welcome: '9', end: '9', jackpot: '9' }[a.type] || '9';
    const flash = t % 10 < 5 && (a.type === 'strike' || a.type === 'jackpot');
    KText.draw(ctx, a.text, cx, B.SY + 6 - pop, flash ? C('b') : C(col), { align: 'center', font: 'L', outline: C('1'), scale: 2 });
    // 아래 작은 글씨: 어두운 띠 위에 테두리 없이 (테두리를 두르면 '핀'의 ㅍ이 뭉개져 '찐'처럼 보임)
    const tag = (txt, x, align, col) => {
      const w = KText.width(txt, 'b') + 6;
      const bx = align === 'right' ? x - w : x;
      ctx.fillStyle = C('1');
      ctx.fillRect(bx, B.SY + 51, w, 15);
      KText.draw(ctx, txt, bx + 3, B.SY + 52, C(col), { font: 'b' });
    };
    if (a.sub) tag(a.sub, B.SX + 4, 'left', 'b');
    if (a.extra && t % 20 < 15) tag(a.extra, B.SX + B.SW - 4, 'right', '9');
  }
  // 리액션 캠 사진 (오른쪽 위) + 판정
  if (a.reaction) {
    const r = a.reaction;
    const px = B.SX + B.SW - 60;
    const py = B.SY + 3;
    ctx.fillStyle = C(r.bonus ? '9' : '1');
    ctx.fillRect(px - 2, py - 2, 60, 46);
    ctx.drawImage(r.img, px, py);
    ctx.fillStyle = C('1');
    ctx.fillRect(px, py + 31, 56, 11);
    const txt = `${r.label}${r.bonus ? ` +${r.bonus}` : ''}`;
    KText.draw(ctx, txt, px + 28, py + 31, C(r.color), { align: 'center', font: 'n' });
  }
}
