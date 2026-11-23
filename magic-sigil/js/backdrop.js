// =====================================================
// 배경: 마법사 성 서재 (벽돌 + 천천히 흐르는 별가루 패럴랙스)
// =====================================================
function drawBackdrop(ctx, frame) {
  const W = CONFIG.WIDTH;
  const H = CONFIG.HEIGHT;
  ctx.fillStyle = C('2');
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 8) {
    for (let x = (y / 8) % 2 ? -8 : 0; x < W; x += 16) {
      ctx.fillStyle = C('1');
      ctx.fillRect(x, y, 16, 1);
      ctx.fillRect(x, y, 1, 8);
      ctx.fillStyle = C('3');
      ctx.fillRect(x + 1, y + 1, 14, 1);
    }
  }
  ctx.fillStyle = DITHER.get(ctx, 'o', 8);
  ctx.fillRect(0, 0, W, H);
  // 별가루 (패럴랙스: 느린 것 / 빠른 것)
  for (let i = 0; i < 24; i++) {
    const speed = i % 2 ? 0.15 : 0.35;
    const x = (i * 53 + frame * speed) % (W + 10) - 5;
    const y = (i * 37) % H;
    ctx.fillStyle = C(i % 3 ? '8' : 't');
    if ((frame + i * 9) % 50 < 40) ctx.fillRect(Math.round(x), y, 1, 1);
  }
}
