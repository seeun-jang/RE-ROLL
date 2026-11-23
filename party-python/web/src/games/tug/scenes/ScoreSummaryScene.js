// =============================================================
// ScoreSummaryScene — 모든 라운드가 끝난 뒤 누적 점수 기록표
//
// - 플레이어 순서(P1..P5) 그대로 한 줄씩: 색 칩, 라벨+이름, 라운드별 점수, 합계
//   (순위·우승자는 아직 공개하지 않는다 → '결과 확인' 버튼을 눌러야 최종 결과)
// - 라운드가 4개를 넘으면 마지막 3라운드 + 합계만 보여준다.
// - 메뉴 배경음(BPM_MENU) 계속 재생.
// =============================================================
import { PALETTE, C } from '../palette.js';
import { Button } from '../ui/Button.js';

/** 표 패널 */
const PANEL = { x: 14, y: 30, w: 292, h: 116 };
/** 첫 행(헤더) y, 데이터 행 시작 y, 행 간격 */
const HEADER_Y = 36, ROW_Y0 = 50, ROW_H = 18;
/** 열 x: 색 칩, 이름, 라운드 열 시작/끝, 합계(오른쪽 정렬 기준) */
const COL_CHIP = 24, COL_NAME = 34, COL_ROUNDS_X0 = 150, COL_ROUNDS_X1 = 236, COL_TOTAL_R = 296;
/** 이름 칸 최대 폭 (px) */
const NAME_MAX_W = 108;
/** 모든 라운드를 다 보여줄 최대 라운드 수 (넘으면 마지막 VISIBLE_ROUNDS 개만) */
const MAX_FULL_ROUNDS = 4, VISIBLE_ROUNDS = 3;
/** 행이 하나씩 나타나는 간격 (초) */
const ROW_REVEAL_STEP = 0.12;

/** 폭에 맞게 문자열 자르기 ('..' 붙임) */
function fitText(ui, str, size, maxW) {
  if (ui.measure(str, size) <= maxW) return str;
  const chars = Array.from(str);
  while (chars.length > 1 && ui.measure(chars.join('') + '..', size) > maxW) chars.pop();
  return chars.join('') + '..';
}

export class ScoreSummaryScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.revealed = 0;   // 지금까지 나타난 행 수
    this.leaving = false;
    this.button = new Button({
      x: 120, y: 153, w: 80, h: 18,
      label: '결과 확인', style: 'gold', size: 'l', hotkey: game.config.START_KEY,
    });
  }

  enter() {
    const game = this.game;
    this.t = 0;
    this.revealed = 0;
    this.leaving = false;
    game.camX = 0;
    game.background.setExcitement(0.4);
    // 메뉴 음악 박자 시계
    game.music.stopAll();
    game.beat.reset(game.config.BPM_MENU);
    game.scheduleBeatAudio([0], 'menu');
  }

  exit() {}

  update(dt) {
    const game = this.game;
    this.t += dt;
    game.scheduleBeatAudio(game.beat.update(dt), 'menu');

    // 행 순차 공개 (공개될 때마다 작은 틱 소리)
    const target = Math.min(game.players.length, Math.floor(this.t / ROW_REVEAL_STEP));
    while (this.revealed < target) {
      this.revealed++;
      game.audio.play('tick', { volume: 0.5 });
    }

    for (const p of game.players) p.update(dt, game.fx.frozen);

    if (!this.leaving && this.button.update(game.pointer, game.input)) {
      // 모든 행이 나오기 전이면 먼저 전부 보여준다
      if (this.revealed < game.players.length) {
        this.revealed = game.players.length;
        this.t = game.players.length * ROW_REVEAL_STEP;
        return;
      }
      game.audio.play('click');
      if (game.net) {
        // 멀티플레이: 서버에 요청만 한다. 최종 결과 장면은 서버 상태에 맞춰 Game 이 넘긴다
        game.net.sendConfirm();
        this.leaving = true;
      } else if (game.goto('finalResult', {}, { transition: 'circleWipe' })) this.leaving = true;
    }
  }

  /** 표에 보여줄 라운드 번호 목록 */
  _visibleRounds() {
    const total = Math.max(1, this.game.config.ROUNDS | 0);
    const first = total > MAX_FULL_ROUNDS ? total - VISIBLE_ROUNDS + 1 : 1;
    const list = [];
    for (let r = first; r <= total; r++) list.push(r);
    return list;
  }

  render(g) {
    const game = this.game;
    const ui = game.ui;
    const ink = PALETTE[C.INK];
    const cx = game.W >> 1;

    game.background.render(g, 0);
    game.particles.render(g, 0);

    // ---- 제목 ----
    const titleW = ui.measure('점수 기록', 'xl') + 24;
    ui.box(g, cx - (titleW >> 1), 5, titleW, 22, 'gold');
    ui.text(g, '점수 기록', cx, 9, { size: 'xl', color: PALETTE[C.INK], align: 'center' });

    // ---- 표 ----
    ui.box(g, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 'panel');
    const rounds = this._visibleRounds();
    const truncated = rounds[0] > 1;
    const colW = rounds.length > 0 ? Math.floor((COL_ROUNDS_X1 - COL_ROUNDS_X0) / rounds.length) : 0;
    const roundColX = (k) => COL_ROUNDS_X0 + colW * k + (colW >> 1); // 열 가운데

    // 헤더
    const headColor = PALETTE[C.SLATE];
    ui.bitmapText(g, 'PLAYER', COL_NAME, HEADER_Y, { color: headColor });
    if (truncated) ui.bitmapText(g, '..', COL_ROUNDS_X0 - 8, HEADER_Y, { color: headColor });
    rounds.forEach((r, k) => {
      ui.bitmapText(g, `R${r}`, roundColX(k), HEADER_Y, { color: headColor, align: 'center' });
    });
    ui.bitmapText(g, 'TOTAL', COL_TOTAL_R, HEADER_Y, { color: PALETTE[C.RED], align: 'right' });
    // 헤더 구분선 (점선)
    g.fillStyle = PALETTE[C.SILVER];
    for (let x = PANEL.x + 6; x < PANEL.x + PANEL.w - 6; x += 2) g.fillRect(x, HEADER_Y + 9, 1, 1);

    // 행
    game.players.forEach((p, i) => {
      if (i >= this.revealed) return;
      const y = ROW_Y0 + i * ROW_H;
      // 줄무늬 배경 (짝수 행만, 디더 1px 점)
      if (i % 2 === 1) {
        g.fillStyle = PALETTE[C.YELLOW];
        for (let yy = y - 3; yy < y + ROW_H - 4; yy++) {
          for (let x = PANEL.x + 4 + (yy & 1); x < PANEL.x + PANEL.w - 4; x += 2) g.fillRect(x, yy, 1, 1);
        }
      }
      // 색 칩 (INK 테두리 + 선수 색)
      g.fillStyle = ink;
      g.fillRect(COL_CHIP - 1, y - 1, 9, 9);
      g.fillStyle = p.color;
      g.fillRect(COL_CHIP, y, 7, 7);
      g.fillStyle = p.shade;
      g.fillRect(COL_CHIP, y + 5, 7, 2);

      // 라벨 + 이름
      // 대기실에서 정한 이름을 쓴다. 이름이 없을 때만 P1 같은 기본 라벨.
      if (p.name !== p.label) {
        ui.text(g, fitText(ui, p.name, 'm', NAME_MAX_W), COL_NAME, y - 2, { size: 'm', color: PALETTE[C.INK] });
      } else {
        ui.bitmapText(g, p.label, COL_NAME, y, { color: PALETTE[C.INK] });
      }

      // 라운드 점수
      rounds.forEach((r, k) => {
        const v = game.roundScore(p.id, r);
        ui.bitmapText(g, v === null ? '-' : String(v), roundColX(k), y, {
          color: v === null ? PALETTE[C.SILVER] : PALETTE[C.CHARCOAL], align: 'center',
        });
      });

      // 합계
      ui.bitmapText(g, String(game.totalScore(p.id)), COL_TOTAL_R, y, {
        color: PALETTE[C.RED], align: 'right', shadow: PALETTE[C.YELLOW],
      });
    });

    // ---- 버튼 + 안내 ----
    this.button.render(g, ui);
    if (this.revealed >= game.players.length && Math.floor(this.t * 2) % 2 === 0) {
      ui.bitmapText(g, 'ENTER', 208, 159, { color: PALETTE[C.WHITE], shadow: ink });
    }
  }
}
