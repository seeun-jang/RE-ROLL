// =============================================================
// WaitScene — 서버의 첫 상태를 기다리는 동안 보여주는 장면 (멀티플레이용)
// =============================================================
import { PALETTE, C } from '../palette.js';

export class WaitScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
  }

  enter() {
    this.t = 0;
    this.game.camX = 0;
  }

  exit() {}

  update(dt) {
    this.t += dt;
  }

  render(g) {
    const game = this.game;
    const cx = game.W >> 1;
    if (game.background) game.background.render(g, 0);
    const dots = '.'.repeat(1 + (Math.floor(this.t * 3) % 3));
    game.ui.text(g, `서버를 기다리는 중${dots}`, cx, 80, {
      size: 'l', align: 'center', color: PALETTE[C.WHITE], outline: PALETTE[C.INK],
    });
  }
}
