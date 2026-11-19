// =============================================================
// FinalResultScene — 최종 승자 발표
//
// - enter 에서 game.results() 계산 → game.finish() (onFinish 콜백, 게임당 1회) → 팡파르
// - 시상대: 1등 가운데(가장 높음), 2등 왼쪽, 3등 오른쪽, 4·5등은 양옆 바닥
//   (공동 순위는 같은 rank 숫자를 단상에 표시, 자리는 정렬 순서대로)
// - 우승자(공동 포함)는 'win' 만세 + 머리 위 왕관, 나머지는 'idle'
// - 꽃가루가 주기적으로 터지고, 하단에 점수 목록. SHOW_RESTART 면 '다시 하기' 버튼.
// =============================================================
import { PALETTE, C } from '../palette.js';
import { Button } from '../ui/Button.js';

/** 캐릭터 높이 */
const CHAR_H = 32;
/** 시상대 자리 (정렬 순서 0..4): dx = 중앙에서의 x 오프셋, h = 단상 높이(px, 0 이면 바닥), style = 9-slice 스타일 */
const PODIUM_SLOTS = [
  { dx: 0, h: 30, style: 'gold' },
  { dx: -40, h: 20, style: 'paper' },
  { dx: 40, h: 14, style: 'panel' },
  { dx: -96, h: 0, style: null },
  { dx: 96, h: 0, style: null },
];
/** 단상 폭 */
const PODIUM_W = 34;
/** 꽃가루 터지는 간격 (초) */
const CONFETTI_INTERVAL = 0.6;
/** 배너 떨어지는 연출 시간 (초) */
const BANNER_DROP_TIME = 0.35;
/** 하단 점수 목록 영역 */
const LIST_Y = 143, LIST_H = 34;
/** 다시 하기 버튼 */
const RESTART_BTN = { w: 58, h: 18 };
/** 다시 하기 버튼이 나타나기까지 (초) — 결과를 볼 시간 */
const RESTART_DELAY = 1.2;

/** 폭에 맞게 문자열 자르기 ('..' 붙임) */
function fitText(ui, str, size, maxW) {
  if (ui.measure(str, size) <= maxW) return str;
  const chars = Array.from(str);
  while (chars.length > 1 && ui.measure(chars.join('') + '..', size) > maxW) chars.pop();
  return chars.join('') + '..';
}

/** 결정적인 의사 난수 (장면 내부 시드 기반, 전역 상태 없음) */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class FinalResultScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.results = [];
    this.entries = [];     // [{ result, player, x, footY, slot }]
    this.confettiT = 0;
    this.burstCount = 0;
    this.leaving = false;
    const showRestart = !!game.config.SHOW_RESTART;
    this.restartButton = showRestart
      ? new Button({
        x: game.W - RESTART_BTN.w - 6, y: LIST_Y + ((LIST_H - RESTART_BTN.h) >> 1), w: RESTART_BTN.w, h: RESTART_BTN.h,
        label: '다시 하기', style: 'gold', size: 'm', hotkey: game.config.START_KEY,
      })
      : null;
  }

  enter() {
    const game = this.game;
    const L = game.config.LAYOUT;
    this.t = 0;
    this.confettiT = 0;
    this.burstCount = 0;
    this.leaving = false;
    game.camX = 0;

    // 결과 계산 + 외부 콜백 (게임당 1회)
    this.results = game.results();
    game.finish();
    game.audio.play('fanfare');

    // 메뉴 음악
    game.music.stopAll();
    game.beat.reset(game.config.BPM_MENU);
    game.scheduleBeatAudio([0], 'menu');

    game.background.setExcitement(1);
    game.particles.clear();

    // 시상대 배치 (results 는 점수 내림차순)
    this.entries = this.results.slice(0, PODIUM_SLOTS.length).map((r, i) => {
      const slot = PODIUM_SLOTS[i];
      const player = game.players.find((p) => p.id === r.playerId) || null;
      const x = L.CENTER_X + slot.dx;
      const footY = L.GROUND_Y - slot.h;
      if (player) {
        player.pop = null;
        player.setAnim(r.isWinner ? 'win' : 'idle', true);
      }
      return { result: r, player, x, footY, slot };
    });

    // 우승자 머리 위 반짝임
    for (const e of this.entries) {
      if (e.result.isWinner) game.particles.emit('sparkle', e.x, e.footY - CHAR_H, { count: 16 });
    }
  }

  exit() {
    this.game.music.stopAll();
  }

  update(dt) {
    const game = this.game;
    this.t += dt;
    game.scheduleBeatAudio(game.beat.update(dt), 'menu');

    for (const e of this.entries) if (e.player) e.player.update(dt, game.fx.frozen);

    // 주기적으로 꽃가루 (좌·중·우를 돌아가며 터뜨림)
    this.confettiT += dt;
    while (this.confettiT >= CONFETTI_INTERVAL) {
      this.confettiT -= CONFETTI_INTERVAL;
      this.burstCount++;
      const x = 40 + Math.floor(hash01(this.burstCount) * (game.W - 80));
      game.particles.emit('confetti', x, 8, { count: 18 });
    }

    if (this.restartButton && !this.leaving && this.t >= RESTART_DELAY) {
      if (this.restartButton.update(game.pointer, game.input)) {
        this.leaving = true;
        game.audio.play('click');
        game.restart();
      }
    }
  }

  /** 우승 배너 문구 */
  _bannerText() {
    const winners = this.results.filter((r) => r.isWinner);
    if (winners.length === 0) return '최종 결과';
    if (winners.length === 1) return `${winners[0].name} 최종 우승!`;
    return `공동 우승! ${winners.map((w) => w.name).join(', ')}`;
  }

  render(g) {
    const game = this.game;
    const ui = game.ui;
    const ink = PALETTE[C.INK];
    const L = game.config.LAYOUT;
    const crown = game.assets ? game.assets.icon('crown') : null;

    game.background.render(g, 0);

    // ---- 시상대 + 캐릭터 ----
    for (const e of this.entries) {
      const { slot, x, footY, result, player } = e;
      if (slot.h > 0) {
        // 단상: 지면 아래까지 살짝 묻히게 그린다
        const bx = x - (PODIUM_W >> 1);
        ui.box(g, bx, footY, PODIUM_W, L.GROUND_Y - footY + 6, slot.style);
        ui.bitmapText(g, String(result.rank), x, footY + 3, {
          color: PALETTE[C.INK], scale: slot.h >= 20 ? 2 : 1, align: 'center',
        });
      }
      if (player) {
        // 가운데보다 오른쪽 선수는 가운데를 보도록 좌우 반전
        game.world.drawCharacter(g, player, x, footY, { side: null, flip: x > L.CENTER_X });
      }
      // 이름표 + 왕관
      const nameY = footY - CHAR_H - 10;
      ui.text(g, fitText(ui, result.name, 's', 60), x, nameY, {
        size: 's', color: result.isWinner ? PALETTE[C.YELLOW] : PALETTE[C.WHITE], align: 'center', outline: ink,
      });
      if (result.isWinner && crown) {
        const bob = Math.floor(this.t * 4) % 2; // 왕관 1px 들썩
        ui.icon(g, crown, x - (crown.width >> 1), nameY - crown.height - 1 - bob);
      }
    }

    game.particles.render(g, 0);

    // ---- 우승 배너 (위에서 떨어지며 등장) ----
    const text = fitText(ui, this._bannerText(), 'xl', game.W - 40);
    const bw = ui.measure(text, 'xl') + 24;
    const drop = Math.min(1, this.t / BANNER_DROP_TIME);
    const by = Math.round(-26 + (5 + 26) * drop);
    ui.box(g, (game.W >> 1) - (bw >> 1), by, bw, 22, 'gold');
    ui.text(g, text, game.W >> 1, by + 4, { size: 'xl', color: PALETTE[C.INK], align: 'center' });

    // ---- 하단 점수 목록 ----
    this._renderList(g);

    if (this.restartButton && this.t >= RESTART_DELAY) this.restartButton.render(g, ui);
  }

  /** 순위별 점수 목록 (5칸) */
  _renderList(g) {
    const game = this.game;
    const ui = game.ui;
    const listX = 6;
    const listW = (this.restartButton ? game.W - RESTART_BTN.w - 18 : game.W - 12);
    ui.box(g, listX, LIST_Y, listW, LIST_H, 'dark');
    const n = Math.max(1, this.results.length);
    const colW = Math.floor((listW - 8) / n);
    this.results.forEach((r, i) => {
      const x0 = listX + 4 + i * colW;
      const cx = x0 + (colW >> 1);
      const player = game.players.find((p) => p.id === r.playerId);
      // 1줄: 순위 + 이름
      const head = fitText(ui, `${r.rank}위 ${r.name}`, 's', colW - 4);
      ui.text(g, head, cx, LIST_Y + 5, {
        size: 's', color: r.isWinner ? PALETTE[C.YELLOW] : PALETTE[C.WHITE], align: 'center',
      });
      // 2줄: 색 칩 + 점수
      const scoreStr = String(r.score);
      const w = scoreStr.length * 6 + 8;
      const sx = cx - (w >> 1);
      if (player) {
        g.fillStyle = PALETTE[C.INK];
        g.fillRect(sx - 1, LIST_Y + 18, 7, 7);
        g.fillStyle = player.color;
        g.fillRect(sx, LIST_Y + 19, 5, 5);
      }
      ui.bitmapText(g, scoreStr, sx + 8, LIST_Y + 18, {
        color: r.isWinner ? PALETTE[C.YELLOW] : PALETTE[C.SILVER],
      });
      // 칸 구분 점선
      if (i > 0) {
        g.fillStyle = PALETTE[C.SLATE];
        for (let y = LIST_Y + 4; y < LIST_Y + LIST_H - 4; y += 2) g.fillRect(x0 - 1, y, 1, 1);
      }
    });
  }
}
