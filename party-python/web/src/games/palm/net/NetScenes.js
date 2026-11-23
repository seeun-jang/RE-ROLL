// =============================================================
// 대결 사이 장면들 (멀티플레이용): 대기 / 대진 안내 / 라운드 결과 / 최종 결과
// 모두 서버 상태(game.net.snap)를 읽어 보여주기만 한다. 다음 장면은 Game 이 서버 진행에 맞춰 넘긴다.
// =============================================================
import { PAL } from '../palette.js';
import { drawText } from '../ui/PixelFont.js';
import { drawPanel, drawIcon } from '../ui/UIKit.js';
import { drawWorld, drawFrameScaled, dimScreen } from '../scenes/common.js';

/** 캐릭터 초상화(대기 자세)를 발 위치 기준으로 그린다 */
function drawPortrait(ctx, game, lookId, footX, footY, { scale = 2, flip = false, anim = 'idle', tick = 0 } = {}) {
  const set = game.assets.fighter(lookId);
  const frames = set[flip ? 'left' : 'right'][anim];
  const fr = frames[tick % frames.length];
  drawFrameScaled(ctx, fr, footX - fr.ax * scale, footY - fr.ay * scale, scale);
}

function standingsRows(game, snap) {
  const rows = game.session.players.map((p, order) => {
    const st = (snap.standings && snap.standings[p.id]) || { wins: 0, draws: 0, losses: 0, score: 0 };
    return { p, st, order };
  });
  rows.sort((x, y) => y.st.wins - x.st.wins || y.st.score - x.st.score || x.order - y.order);
  return rows;
}

/** 서버의 첫 상태를 기다리는 동안 */
export class NetWaitScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
  }
  update() {
    this.t++;
  }
  draw(ctx) {
    drawWorld(ctx, this.game, {});
    const dots = '.'.repeat(1 + (Math.floor(this.t / 20) % 3));
    drawText(ctx, `서버를 기다리는 중${dots}`, 160, 80, { font: 'm', color: PAL.white, outline: PAL.ink, align: 'center' });
  }
}

/** 이번 라운드 대진 안내 */
export class NetIntroScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.snap = game.net.snap;
  }
  enter() {
    this.game.audio.play('select');
    this.game.audio.setBgmIntensity(0.25);
  }
  update() {
    this.t++;
  }
  draw(ctx) {
    const g = this.game;
    const s = this.snap;
    const me = g.me;
    drawWorld(ctx, g, {});
    dimScreen(ctx, g.W, g.H, 2);
    drawPanel(ctx, 100, 6, 120, 20, 'gold');
    drawText(ctx, `ROUND ${s.round} / ${s.rounds}`, 160, 10, { font: 'm', color: PAL.ink, align: 'center' });

    const matches = s.matches || [];
    const rowH = matches.length > 1 ? 56 : 70;
    const top = matches.length > 1 ? 32 : 46;
    const tick = Math.floor(this.t / 12);
    matches.forEach((m, i) => {
      const a = g.playerById(m.a);
      const b = g.playerById(m.b);
      const y = top + i * rowH;
      const mine = me && (m.a === me.id || m.b === me.id);
      drawPanel(ctx, 30, y, 260, rowH - 6, mine ? 'default' : 'dark');
      const footY = y + rowH - 12;
      drawPortrait(ctx, g, a.lookId, 70, footY, { scale: 1, tick });
      drawPortrait(ctx, g, b.lookId, 250, footY, { scale: 1, flip: true, tick });
      const mid = y + Math.floor((rowH - 6) / 2) - 6;
      drawText(ctx, a.name, 96, mid, { font: 'm', color: g.assets.uiColor(a.lookId), outline: PAL.ink });
      drawText(ctx, b.name, 224, mid, { font: 'm', color: g.assets.uiColor(b.lookId), outline: PAL.ink, align: 'right' });
      drawText(ctx, 'VS', 160, mid - 1, { font: 'l', color: PAL.sand, outline: PAL.ink, align: 'center' });
      if (mine) drawText(ctx, '내 경기', 160, y + 3, { font: 's', color: PAL.lime, outline: PAL.ink, align: 'center' });
    });

    const resting = (s.resting || []).map((id) => g.playerById(id));
    if (resting.length) {
      const names = resting.map((p) => p.name).join(', ');
      const iRest = me && resting.some((p) => p.id === me.id);
      drawText(ctx, iRest ? `이번 라운드는 쉬어요 (${names}) — 관전` : `쉬는 사람: ${names}`, 160, 150, {
        font: 's', color: iRest ? PAL.sand : PAL.silver, outline: PAL.ink, align: 'center',
      });
    }
    drawText(ctx, 'A/D 균형 · J 밀기(길게: 차지) · K 손빼기 · L 버티기', 160, 166, {
      font: 's', color: PAL.white, outline: PAL.ink, align: 'center',
    });
  }
}

/** 라운드 결과: 경기별 승패와 점수, 지금까지 순위 */
export class NetRoundResultScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.snap = game.net.snap;
  }
  enter() {
    this.game.audio.play('confirm');
    this.game.audio.setBgmIntensity(0.25);
  }
  update() {
    this.t++;
    // 결과가 조금 늦게 도착할 수 있으므로 최신 상태를 계속 본다
    const s = this.game.net.snap;
    if (s && s.round === this.snap.round && s.roundResults) this.snap = s;
  }
  draw(ctx) {
    const g = this.game;
    const s = this.snap;
    drawWorld(ctx, g, {});
    dimScreen(ctx, g.W, g.H, 2);
    drawPanel(ctx, 90, 4, 140, 18, 'gold');
    drawText(ctx, `ROUND ${s.round} 결과`, 160, 7, { font: 'm', color: PAL.ink, align: 'center' });

    const results = s.roundResults || [];
    results.forEach((r, i) => {
      const y = 26 + i * 30;
      const a = g.playerById(r.a);
      const b = g.playerById(r.b);
      drawPanel(ctx, 20, y, 280, 27, 'dark');
      const line = (p, x, align) => {
        const won = r.winner === p.id;
        const sc = r.scores && r.scores[p.id] ? r.scores[p.id].total : 0;
        drawText(ctx, p.name, x, y + 3, { font: 'm', color: won ? PAL.sand : PAL.white, outline: PAL.ink, align });
        drawText(ctx, `${sc}점`, x, y + 15, { font: 's', color: PAL.silver, align });
      };
      line(a, 28, 'left');
      line(b, 292, 'right');
      const label = !r.winner ? '무승부' : `${g.playerById(r.winner).name} 승리!`;
      drawText(ctx, label, 160, y + 8, { font: 'm', color: r.winner ? PAL.lime : PAL.silver, outline: PAL.ink, align: 'center' });
    });

    // 지금까지 순위
    const baseY = 26 + Math.max(1, results.length) * 30 + 4;
    drawText(ctx, '지금까지', 160, baseY, { font: 's', color: PAL.silver, outline: PAL.ink, align: 'center' });
    standingsRows(g, s).forEach((row, i) => {
      const y = baseY + 11 + i * 11;
      if (y > 168) return;
      const me = row.p.isMe;
      drawText(ctx, `${i + 1}. ${row.p.name}`, 96, y, { font: 's', color: me ? PAL.lime : PAL.white, outline: PAL.ink });
      drawText(ctx, `${row.st.wins}승  ${row.st.score}점`, 224, y, { font: 's', color: PAL.sand, outline: PAL.ink, align: 'right' });
    });
  }
}

/** 최종 결과 */
export class NetFinalScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.cheered = false;
  }
  enter() {
    const g = this.game;
    g.audio.play('win');
    g.audio.play('cheer');
    g.bg.cheer(0, 1);
    g.audio.setBgmIntensity(0.5);
  }
  update() {
    this.t++;
  }
  draw(ctx) {
    const g = this.game;
    const s = g.net.snap;
    const results = (s && s.results) || [];
    drawWorld(ctx, g, {});
    dimScreen(ctx, g.W, g.H, 2);
    drawPanel(ctx, 100, 4, 120, 20, 'gold');
    drawText(ctx, '최종 결과', 160, 8, { font: 'm', color: PAL.ink, align: 'center' });

    const winners = results.filter((r) => r.isWinner);
    // 우승자 초상화 (만세)
    winners.slice(0, 3).forEach((r, i) => {
      const p = g.playerById(r.playerId);
      const x = 160 + (i - (Math.min(3, winners.length) - 1) / 2) * 44;
      drawPortrait(ctx, g, p.lookId, x, 88, { scale: 2, anim: 'win', tick: Math.floor(this.t / 10) });
    });
    const title = winners.length === 1 ? `${winners[0].name} 우승!` : winners.length > 1 ? '공동 우승!' : '';
    drawText(ctx, title, 160, 92, { font: 'l', color: PAL.sand, outline: PAL.ink, shadow: PAL.red, align: 'center' });

    drawPanel(ctx, 40, 110, 240, 10 + results.length * 11, 'dark');
    results.forEach((r, i) => {
      const y = 115 + i * 11;
      const p = g.playerById(r.playerId);
      const st = r.stats || {};
      const color = r.isWinner ? PAL.sand : p.isMe ? PAL.lime : PAL.white;
      if (r.isWinner) drawIcon(ctx, 'crown', 46, y, PAL.sand);
      drawText(ctx, `${r.rank}위  ${r.name}`, 58, y, { font: 's', color, outline: PAL.ink });
      drawText(ctx, `${st.wins ?? 0}승 ${st.draws ?? 0}무 ${st.losses ?? 0}패   ${r.score}점`, 274, y, {
        font: 's', color, outline: PAL.ink, align: 'right',
      });
    });
  }
}
