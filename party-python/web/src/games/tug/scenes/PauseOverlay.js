// =============================================================
// PauseOverlay — 일시정지 오버레이 (장면 위에 덮어 그린다)
//
// - 화면 전체를 INK 체커보드 디더로 어둡게 (반투명 대신 디더링)
// - '계속하기' (Enter / 클릭 — Esc 는 Game 이 직접 토글), '처음으로' (점수 초기화 후 타이틀)
// =============================================================
import { PALETTE, C } from '../palette.js';
import { Button } from '../ui/Button.js';
import { makeCanvas } from '../assets/SpriteFactory.js';

/** 가운데 상자 크기 */
const BOX_W = 132, BOX_H = 92;
/** 버튼 크기 */
const BTN_W = 92, BTN_H = 16;

export class PauseOverlay {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this._dither = null; // 체커보드 오버레이 캔버스 (처음 그릴 때 1번 만든다)
    const W = game.W, H = game.H;
    this.bx = ((W - BOX_W) / 2) | 0;
    this.by = ((H - BOX_H) / 2) | 0;
    const btnX = ((W - BTN_W) / 2) | 0;
    this.resumeButton = new Button({
      x: btnX, y: this.by + 40, w: BTN_W, h: BTN_H,
      label: '계속하기', style: 'gold', size: 'm', hotkey: game.config.START_KEY,
    });
    this.homeButton = new Button({
      x: btnX, y: this.by + 62, w: BTN_W, h: BTN_H,
      label: '처음으로', style: 'panel', size: 'm', hotkey: null,
    });
  }

  /** Game.pause() 가 호출 */
  enter() {
    this.t = 0;
  }

  update(dt) {
    const game = this.game;
    this.t += dt;
    if (this.resumeButton.update(game.pointer, game.input)) {
      game.audio.play('click');
      game.resume();
      return;
    }
    if (this.homeButton.update(game.pointer, game.input)) {
      game.resume();
      game.audio.play('click');
      game.restart();
    }
  }

  /** INK 체커보드 디더 캔버스 (W×H, 한 칸 건너 한 칸) */
  _getDither() {
    const W = this.game.W, H = this.game.H;
    if (this._dither && this._dither.width === W && this._dither.height === H) return this._dither;
    const c = makeCanvas(W, H);
    const cg = c.getContext('2d');
    cg.fillStyle = PALETTE[C.INK];
    for (let y = 0; y < H; y++) {
      for (let x = y & 1; x < W; x += 2) cg.fillRect(x, y, 1, 1);
    }
    this._dither = c;
    return c;
  }

  render(g) {
    const game = this.game;
    const ui = game.ui;
    const ink = PALETTE[C.INK];
    const cx = game.W >> 1;

    // 화면 어둡게 (디더)
    g.drawImage(this._getDither(), 0, 0);

    // 가운데 상자
    ui.box(g, this.bx, this.by, BOX_W, BOX_H, 'dark');
    ui.text(g, '일시정지', cx, this.by + 7, {
      size: 'xl', color: PALETTE[C.YELLOW], align: 'center', outline: ink,
    });
    // 깜빡이는 PAUSED 표시
    if (Math.floor(this.t * 2) % 2 === 0) {
      ui.bitmapText(g, 'PAUSED', cx, this.by + 27, { color: PALETTE[C.SILVER], align: 'center' });
    }
    this.resumeButton.render(g, ui);
    this.homeButton.render(g, ui);

    // 상자 아래 키 안내
    ui.text(g, 'Esc / Enter: 계속하기', cx, this.by + BOX_H + 4, {
      size: 's', color: PALETTE[C.WHITE], align: 'center', outline: ink,
    });
  }
}
