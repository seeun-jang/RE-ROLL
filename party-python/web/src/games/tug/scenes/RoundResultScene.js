// =============================================================
// 라운드 결과 장면 — 경기장 화면을 그대로 둔 채 승리 팀 발표 + 개인 라운드 점수
// 다음: 남은 라운드가 있으면 팀 배정(round+1), 아니면 누적 점수 기록 화면
// =============================================================
import { PALETTE, C, TEAM_COLORS } from '../palette.js';
import { drawCenterBanner, MUTE_BUTTON_RECT } from '../ui/HUD.js';

// ---- 연출용 상수 ----
const MIN_SHOW_TIME = 0.8;        // 이 시간 전에는 Enter/클릭으로 넘기지 않음 (초)
const CONFETTI_INTERVAL = 0.3;    // 꽃가루 간격 (초)
const CONFETTI_COUNT = 8;         // 한 번에 뿌리는 꽃가루 수
const CONFETTI_Y = 40;            // 꽃가루 시작 높이 (월드 y)
const BANNER_Y = 40;              // 승리 배너 y
const ROW_IN_STAGGER = 0.08;      // 점수 칸이 하나씩 나타나는 시차 (초)
const CELL_W = 64;
const CELL_H = 38;

export class RoundResultScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.result = null;
    this.rows = [];
    this.confettiT = 0;
    this.leaving = false;
  }

  enter(params = {}) {
    const game = this.game;
    const cfg = game.config;
    this.t = 0;
    this.confettiT = 0;
    this.leaving = false;
    this.result = params.result || { winnerSide: null, bonus: {}, roundScores: {} };
    const winnerSide = this.result.winnerSide || null;

    // 승리 팀은 만세, 진 팀은 넘어짐, 무승부면 모두 대기 자세
    for (const p of game.players) {
      if (!p.side) continue;
      if (!winnerSide) p.setAnim('idle');
      else if (p.side === winnerSide) p.setAnim('win');
      else p.setAnim('fall');
    }

    // 개인 라운드 점수 표 (라운드 점수 내림차순)
    const roundScores = this.result.roundScores || {};
    const bonus = this.result.bonus || {};
    const round = this.result.round ?? game.round;
    // applyBonus(외부 보너스) 점수까지 합친 라운드 점수 (점수 기록 화면과 같은 값)
    const scoreOf = (p) => {
      const withBonus = typeof game.roundScore === 'function' ? game.roundScore(p.id, round) : null;
      return withBonus ?? roundScores[p.id] ?? (game.scoreBoard.get(p.id)?.round ?? 0);
    };
    this.rows = game.players
      .map((p, i) => ({
        player: p,
        order: i,
        score: scoreOf(p),
        bonus: bonus[p.id] ?? 0,
      }))
      .sort((a, b) => (b.score - a.score) || (a.order - b.order));

    // 라운드 사이에도 음악이 이어지도록 메뉴 박자 시계
    if (game.music) game.music.stopAll();
    game.beat.reset(cfg.BPM_MENU);
    game.scheduleBeatAudio([0], 'menu');
  }

  exit() {}

  _startPressed() {
    const game = this.game;
    if (game.input && game.input.pressed(game.config.START_KEY)) return true;
    const c = game.pointer && game.pointer.clicked;
    if (!c) return false;
    const m = MUTE_BUTTON_RECT;
    return !(c.x >= m.x && c.x < m.x + m.w && c.y >= m.y && c.y < m.y + m.h);
  }

  update(dt) {
    const game = this.game;
    const cfg = game.config;
    this.t += dt;

    const beats = game.beat.update(dt);
    game.scheduleBeatAudio(beats, 'menu');

    for (const p of game.players) p.update(dt, game.fx.frozen);

    // 승리 팀 쪽 하늘에서 꽃가루
    const winnerSide = this.result && this.result.winnerSide;
    if (winnerSide && game.teams[winnerSide]) {
      this.confettiT -= dt;
      if (this.confettiT <= 0) {
        this.confettiT = CONFETTI_INTERVAL;
        const members = game.teams[winnerSide].members;
        if (members.length) {
          const xs = members.map((p) => Math.round(p.x));
          const x0 = Math.min(...xs) - 10;
          const x1 = Math.max(...xs) + 10;
          const x = x0 + Math.floor(Math.random() * (x1 - x0 + 1));
          game.particles.emit('confetti', x, CONFETTI_Y, { count: CONFETTI_COUNT });
        }
      }
    }

    if (this.leaving || game.net) return; // 멀티플레이: 다음 장면은 서버 상태에 맞춰 Game 이 넘긴다
    const auto = this.t >= cfg.ROUND_RESULT_TIME;
    const skip = this.t >= MIN_SHOW_TIME && this._startPressed();
    if (auto || skip) {
      // goto 가 거절되면(전환 중) leaving 을 세우지 않고 다음 스텝에 다시 시도한다
      if (game.round < cfg.ROUNDS) {
        const next = game.round + 1;
        this.leaving = game.goto('teamAssign', { round: next }, { transition: 'circleWipe' });
      } else {
        this.leaving = game.goto('scoreSummary', {}, { transition: 'circleWipe' });
      }
    }
  }

  render(g) {
    const game = this.game;
    const cfg = game.config;
    const ui = game.ui;

    // 경기장 그대로 (판정 팝업은 숨김)
    game.world.drawWorld(g, { labels: true, pops: false });

    // ---- 승리 배너 ----
    const winnerSide = this.result && this.result.winnerSide;
    let text = '무승부!';
    let style = 'gold';
    if (winnerSide === 'left' || winnerSide === 'right') {
      const team = game.teams[winnerSide];
      text = `${team ? team.name : cfg.TEAM_NAMES[winnerSide]} 승리!`;
      style = winnerSide === 'left' ? 'red' : 'blue';
    }
    ui.bitmapText(g, `ROUND ${game.round}`, cfg.LAYOUT.CENTER_X, 8, {
      scale: 2, align: 'center', color: PALETTE[C.WHITE], shadow: PALETTE[C.INK],
    });
    drawCenterBanner(g, ui, text, { style, y: BANNER_Y, size: 'xl' });

    // ---- 하단: 라운드 점수 칸 (점수 순) ----
    this._drawScoreCells(g);
  }

  _drawScoreCells(g) {
    const game = this.game;
    const cfg = game.config;
    const L = cfg.LAYOUT;
    const ui = game.ui;
    const n = this.rows.length;
    const totalW = n * CELL_W;
    const startX = Math.round((cfg.WIDTH - totalW) / 2);
    const y = L.PANEL_Y;

    this.rows.forEach((row, i) => {
      // 하나씩 아래에서 올라오며 등장
      const k = Math.max(0, Math.min(1, (this.t - i * ROW_IN_STAGGER) / 0.2));
      if (k <= 0) return;
      const dy = Math.round((1 - k) * 12);
      const p = row.player;
      const x = startX + i * CELL_W;
      const cy = y + dy;
      const style = p.side === 'left' ? 'red' : p.side === 'right' ? 'blue' : 'dark';
      const cx = x + Math.floor(CELL_W / 2);

      ui.box(g, x, cy, CELL_W, CELL_H, style);
      // 순위 + 라벨
      ui.bitmapText(g, p.name !== p.label ? `${i + 1}` : `${i + 1} ${p.label}`, x + 5, cy + 4, {   // 이름이 있으면 순위만(이름은 아래 줄)
        color: p.side ? TEAM_COLORS[p.side].light : PALETTE[C.YELLOW], shadow: PALETTE[C.INK],
      });
      // 이름 (플레이어 색 점 + 이름)
      g.fillStyle = PALETTE[C.INK];
      g.fillRect(x + CELL_W - 12, cy + 4, 7, 7);
      g.fillStyle = p.color;
      g.fillRect(x + CELL_W - 11, cy + 5, 5, 5);
      // 기본 이름(P1 등)은 위 라벨과 같으므로 다를 때만 표시
      if (p.name !== p.label) {
        ui.text(g, p.name, cx, cy + 12, {
          size: 's', align: 'center', color: PALETTE[C.WHITE], outline: PALETTE[C.INK],
        });
      }
      // 라운드 점수 (보너스 포함) + 그중 보너스 몫
      ui.bitmapText(g, String(row.score), cx, cy + 21, {
        align: 'center', color: PALETTE[C.WHITE], shadow: PALETTE[C.INK],
      });
      if (row.bonus > 0) {
        ui.text(g, `보너스 +${row.bonus}`, cx, cy + 29, {
          size: 's', align: 'center', color: PALETTE[C.YELLOW], outline: PALETTE[C.INK],
        });
      }
    });
  }
}
