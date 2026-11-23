// =============================================================
// 결투 사이 장면들 (멀티플레이용): 대기 / 대진 안내 / 라운드 결과 / 최종 결과
// 모두 서버 상태(game.net.snap)를 읽어 보여 주기만 한다. 다음 장면은 NetGame 이 서버 진행에 맞춰 넘긴다.
// =============================================================
import { Scene } from '../core/SceneManager.js';
import { C } from '../data/palette.js';
import { CYCLE, ELEMENTS } from '../data/elements.js';
import { Background } from '../game/Background.js';
import { nineSlice } from '../ui/Widgets.js';

function drawPortrait(r, game, player, x, footY, { flip = false, anim = 'idle', time = 0, scale = 1 } = {}) {
  const img = game.assets.frameAt(`animal_${player.lookId}`, anim, time, { flip, fps: anim === 'win' ? 8 : 3 });
  r.sprite(img, x, footY, { sx: scale, sy: scale });
}

function standingsRows(game, snap) {
  const rows = game.players.map((p, order) => {
    const st = (snap.standings && snap.standings[p.id]) || { wins: 0, draws: 0, losses: 0, score: 0 };
    return { p, st, order };
  });
  rows.sort((x, y) => y.st.wins - x.st.wins || y.st.score - x.st.score || x.order - y.order);
  return rows;
}

class BaseScene extends Scene {
  enter() {
    this.bg = new Background('training');
    this.t = 0;
    this.snap = this.game.net.snap;
  }

  update(dt) {
    this.t += dt;
    this.bg.update(dt);
  }

  drawBack(r) {
    this.bg.render(r);
    this.bg.renderGround(r);
    r.dither(0, 0, r.W, r.H, C.ink, 0.5);
  }
}

/** 서버의 첫 상태를 기다리는 동안 */
export class NetWaitScene extends BaseScene {
  render(r) {
    this.drawBack(r);
    const dots = '.'.repeat(1 + (Math.floor(this.t * 3) % 3));
    this.game.text.draw(r.ctx, `서버를 기다리는 중${dots}`, 160, 84, { size: 'm', color: C.white, outline: C.ink, align: 'center' });
  }
}

/** 이번 라운드 대진 안내 + 주문·상성 설명 */
export class NetIntroScene extends BaseScene {
  enter() {
    super.enter();
    this.game.audio.play('confirm');
    this.game.audio.playMusic('training');
  }

  render(r) {
    const g = this.game;
    const { text, assets } = g;
    const ctx = r.ctx;
    const s = this.snap;
    const me = g.me;
    this.drawBack(r);
    nineSlice(r, assets, 104, 4, 112, 18, 'paper');
    text.draw(ctx, `ROUND ${s.round} / ${s.rounds}`, 160, 7, { size: 'm', color: C.ink, align: 'center' });

    const matches = s.matches || [];
    const rowH = matches.length > 1 ? 46 : 56;
    const top = matches.length > 1 ? 26 : 34;
    matches.forEach((m, i) => {
      const a = g.playerById(m.a);
      const b = g.playerById(m.b);
      const y = top + i * rowH;
      const mine = me && (m.a === me.id || m.b === me.id);
      nineSlice(r, assets, 30, y, 260, rowH - 4, mine ? null : 'dark');
      const footY = y + rowH - 9;
      drawPortrait(r, g, a, 62, footY, { time: this.t });
      drawPortrait(r, g, b, 258, footY, { time: this.t, flip: true });
      const mid = y + Math.floor((rowH - 4) / 2) - 6;
      text.draw(ctx, a.name, 86, mid, { size: 'm', color: g.uiColor(a), outline: C.ink });
      text.draw(ctx, b.name, 234, mid, { size: 'm', color: g.uiColor(b), outline: C.ink, align: 'right' });
      text.draw(ctx, 'VS', 160, mid - 1, { size: 'l', color: C.yellow, outline: C.ink, align: 'center' });
      if (mine) text.draw(ctx, '내 결투', 160, y + 3, { size: 's', color: C.green, outline: C.ink, align: 'center' });
    });

    const resting = (s.resting || []).map((id) => g.playerById(id));
    if (resting.length) {
      const names = resting.map((p) => p.name).join(', ');
      const iRest = me && resting.some((p) => p.id === me.id);
      text.draw(ctx, iRest ? `이번 라운드는 쉬어요 (${names}) — 관전` : `쉬는 사람: ${names}`, 160, 126, {
        size: 's', color: iRest ? C.yellow : C.silver, outline: C.ink, align: 'center',
      });
    }
    // 상성 안내: 불 → 바람 → 번개 → 물 → 불
    nineSlice(r, assets, 30, 138, 260, 38, 'dark');
    text.draw(ctx, g.voice ? '주문 이름을 외치세요! (숫자키 1~6 도 가능)' : '숫자키 1~6 으로 주문을 쓰세요', 160, 141, {
      size: 's', color: C.white, align: 'center',
    });
    let x = 78;
    text.draw(ctx, '상성', 44, 156, { size: 's', color: C.silver });
    [...CYCLE, CYCLE[0]].forEach((el, i) => {
      const icon = assets.frames(ELEMENTS[el].icon, 'default')[0];
      r.sprite(icon, x, 155, { anchorX: 0, anchorY: 0 });
      text.draw(ctx, ELEMENTS[el].name, x + 10, 156, { size: 's', color: C.white });
      x += 12 + text.measure(ELEMENTS[el].name, 's');
      if (i < CYCLE.length) {
        text.draw(ctx, '→', x, 156, { size: 's', color: C.yellow });
        x += 12;
      }
    });
    text.draw(ctx, '(화살표 방향이 이긴다)', 160, 166, { size: 's', color: C.steel, align: 'center' });
  }
}

/** 라운드 결과: 결투별 승패와 남은 체력, 지금까지 순위 */
export class NetRoundResultScene extends BaseScene {
  enter() {
    super.enter();
    this.game.audio.stopMusic();
    this.game.audio.play('confirm');
  }

  update(dt) {
    super.update(dt);
    // 결과가 조금 늦게 도착할 수 있으므로 최신 상태를 계속 본다
    const s = this.game.net.snap;
    if (s && s.round === this.snap.round && s.roundResults) this.snap = s;
  }

  render(r) {
    const g = this.game;
    const { text, assets } = g;
    const ctx = r.ctx;
    const s = this.snap;
    this.drawBack(r);
    nineSlice(r, assets, 100, 4, 120, 18, 'paper');
    text.draw(ctx, `ROUND ${s.round} 결과`, 160, 7, { size: 'm', color: C.ink, align: 'center' });

    const results = s.roundResults || [];
    results.forEach((res, i) => {
      const y = 26 + i * 30;
      const a = g.playerById(res.a);
      const b = g.playerById(res.b);
      nineSlice(r, assets, 20, y, 280, 27, 'dark');
      const line = (p, x, align) => {
        const won = res.winner === p.id;
        const hp = res.scores && res.scores[p.id] ? res.scores[p.id].hp : 0;
        text.draw(ctx, p.name, x, y + 3, { size: 'm', color: won ? C.yellow : C.white, outline: C.ink, align });
        text.draw(ctx, `남은 체력 ${hp}`, x, y + 15, { size: 's', color: C.silver, align });
      };
      line(a, 28, 'left');
      line(b, 292, 'right');
      const label = !res.winner ? '무승부' : `${g.playerById(res.winner).name} 승리!`;
      text.draw(ctx, label, 160, y + 4, { size: 'm', color: res.winner ? C.green : C.silver, outline: C.ink, align: 'center' });
      text.draw(ctx, res.reason === 'ko' ? 'K.O.' : '시간 종료', 160, y + 16, { size: 's', color: C.steel, align: 'center' });
    });

    const baseY = 26 + Math.max(1, results.length) * 30 + 4;
    text.draw(ctx, '지금까지', 160, baseY, { size: 's', color: C.silver, outline: C.ink, align: 'center' });
    standingsRows(g, s).forEach((row, i) => {
      const y = baseY + 11 + i * 11;
      if (y > 168) return;
      text.draw(ctx, `${i + 1}. ${row.p.name}`, 96, y, { size: 's', color: row.p.isMe ? C.green : C.white, outline: C.ink });
      text.draw(ctx, `${row.st.wins}승  체력 ${row.st.score}`, 224, y, { size: 's', color: C.yellow, outline: C.ink, align: 'right' });
    });
  }
}

/** 최종 결과 */
export class NetFinalScene extends BaseScene {
  enter() {
    super.enter();
    this.game.audio.stopMusic();
    this.game.audio.play('win');
  }

  render(r) {
    const g = this.game;
    const { text, assets } = g;
    const ctx = r.ctx;
    const s = g.net.snap;
    const results = (s && s.results) || [];
    this.drawBack(r);
    nineSlice(r, assets, 110, 4, 100, 18, 'paper');
    text.draw(ctx, '최종 결과', 160, 7, { size: 'm', color: C.ink, align: 'center' });

    const winners = results.filter((x) => x.isWinner).slice(0, 3);
    winners.forEach((res, i) => {
      const x = 160 + (i - (winners.length - 1) / 2) * 44;
      drawPortrait(r, g, g.playerById(res.playerId), x, 84, { anim: 'win', time: this.t, scale: 1 });
    });
    const title = winners.length === 1 ? `${winners[0].name} 우승!` : winners.length > 1 ? '공동 우승!' : '';
    text.draw(ctx, title, 160, 88, { size: 'l', color: C.yellow, outline: C.ink, align: 'center' });

    nineSlice(r, assets, 40, 106, 240, 10 + results.length * 11, 'dark');
    results.forEach((res, i) => {
      const y = 110 + i * 11;
      const p = g.playerById(res.playerId);
      const st = res.stats || {};
      const color = res.isWinner ? C.yellow : p.isMe ? C.green : C.white;
      text.draw(ctx, `${res.rank}위  ${res.name}`, 48, y, { size: 's', color });
      text.draw(ctx, `${st.wins ?? 0}승 ${st.draws ?? 0}무 ${st.losses ?? 0}패   체력 ${res.score}`, 272, y, { size: 's', color, align: 'right' });
    });
  }
}
