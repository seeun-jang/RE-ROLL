(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Player — 키보드 입력을 "의도(intent)" 로 바꾸는 컨트롤러 + 플레이어 선수
  //  공격 키는 짧게 선입력(버퍼)을 허용하지만,
  //  잔심 판정에는 버퍼가 아닌 "실제로 누른 순간(attackPressed)" 을 사용한다 → 연타하면 잔심이 깨진다.
  // ─────────────────────────────────────────────────────────────
  class PlayerController {
    constructor(input) {
      this.input = input;
      this.buf = null;
      this.bufT = 0;
    }

    getIntent(f) {
      const I = this.input, C = PK.CONFIG;
      const move = (I.down('right') ? 1 : 0) - (I.down('left') ? 1 : 0);
      const pressed = I.pressed('men') ? 'men' : I.pressed('kote') ? 'kote' : I.pressed('do') ? 'do' : null;
      if (pressed) { this.buf = pressed; this.bufT = C.INPUT_BUFFER; }
      let attack = null;
      if (this.buf && (f.canAct || f.state === 'block')) {
        attack = this.buf;
        this.buf = null;
        this.bufT = 0;
      } else if (this.bufT > 0) {
        this.bufT--;
        if (this.bufT === 0) this.buf = null;
      }
      return {
        move: move,
        attack: attack,
        attackPressed: !!pressed,
        block: I.down('block'),
        blockPressed: I.pressed('block'),
        kiai: I.down('kiai'),
        kiaiPressed: I.pressed('kiai'),
        tsuki: I.pressed('tsuki'),
        present: null
      };
    }

    clear() { this.buf = null; this.bufT = 0; }
  }

  class Player extends PK.Fighter {
    constructor(opts, input) {
      super(opts);
      this.controller = new PlayerController(input);
      this.isPlayer = true;
    }
  }

  PK.PlayerController = PlayerController;
  PK.Player = Player;
})(window.PK = window.PK || {});
