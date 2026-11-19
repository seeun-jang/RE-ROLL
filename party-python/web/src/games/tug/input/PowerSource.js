// =============================================================
// PowerSource ★ AI 연결 지점
//
// 플레이어의 '당기기 시도'가 어디서 오는지를 추상화한 인터페이스.
// 지금은 키보드(KeyboardPowerSource)만 쓰지만, 나중에 AI 플레이어나
// 퀴즈 정답 보너스 같은 입력원을 같은 모양으로 끼워 넣을 수 있다.
//
// 게임(PlayScene)은 매 고정 스텝마다 player.powerSource.poll(game) 을 호출하고,
// 돌려받은 각 시도 { timeStamp, bonus? } 를 박자 판정 → 힘 계산 → 점수 기록에 넘긴다.
// =============================================================

/** 기본 클래스: 아무 입력도 만들지 않는다 */
export class PowerSource {
  /** @param {import('../entities/Player.js').Player} player */
  constructor(player) {
    this.player = player;
    this.kind = 'base';
  }

  /**
   * 이번 스텝의 '당기기 시도' 배열.
   * @returns {{ timeStamp: number, bonus?: { powerMult?: number, scorePoints?: number, reason?: string } }[]}
   *   timeStamp: performance.now() 기준 ms
   */
  // eslint-disable-next-line no-unused-vars
  poll(game) {
    return [];
  }

  /** 라운드 시작 알림. info: { round, side, teammates: [playerId], opponents: [playerId] } */
  // eslint-disable-next-line no-unused-vars
  onRoundStart(info) {}

  /** 라운드 종료 알림. info: { round, winnerSide } */
  // eslint-disable-next-line no-unused-vars
  onRoundEnd(info) {}

  /** 자원 해제 */
  dispose() {}
}

/** 키보드 입력원: player.key 의 이번 스텝 눌림을 그대로 시도로 돌려준다 */
export class KeyboardPowerSource extends PowerSource {
  /**
   * @param {import('../entities/Player.js').Player} player
   * @param {import('./KeyboardInput.js').KeyboardInput} keyboard
   */
  constructor(player, keyboard) {
    super(player);
    this.kind = 'keyboard';
    this.keyboard = keyboard;
  }

  // eslint-disable-next-line no-unused-vars
  poll(game) {
    if (!this.keyboard || !this.player) return [];
    // 이번 스텝에 눌린 횟수만큼 시도 생성 (한 스텝에 여러 번도 가능 — 판정이 헛힘으로 거른다)
    return this.keyboard.presses(this.player.key).map((p) => ({ timeStamp: p.timeStamp }));
  }

  dispose() {
    this.keyboard = null;
  }
}

// =============================================================
// TODO(AI): 아래는 '실행되지 않는' 예시 골격이다. 실제 AI 연동 시 참고용.
//
// 연결 방법:
//   mount(canvas, {
//     createPowerSource: (player, game) => {
//       // player.id 별로 원하는 입력원을 만들어 돌려준다. null/undefined 를 돌려주면 기본 KeyboardPowerSource 사용.
//       if (player.id === 'p5') return new AIPlayerPowerSource(player, { accuracy: 0.8 });
//       return new QuizBonusPowerSource(new KeyboardPowerSource(player, game.input), quizClient);
//     },
//   });
//
// 각 시도의 timeStamp 는 performance.now() 기준 ms 이고, 판정 쪽(PlayScene)이
// 이를 박자 시계(game.beat.time, 초)로 바꿔 game.beat.judge(player.id, t) 에 넘긴다.
// bonus.powerMult 는 computePower() 에서 힘에 곱해지고, bonus.scorePoints 는
// scoreBoard.record(..., { bonusPoints }) 로 점수에 더해진다.
// =============================================================
//
// /** TODO(AI): 박자 근처에서 스스로 누르는 AI 플레이어 */
// export class AIPlayerPowerSource extends PowerSource {
//   constructor(player, { accuracy = 0.75, jitter = 0.08, rng = Math.random } = {}) {
//     super(player);
//     this.kind = 'ai';
//     this.accuracy = accuracy;   // 0..1 — 높을수록 박자에 정확히 누른다
//     this.jitter = jitter;       // 최대 오차 (초)
//     this.rng = rng;
//     this.plannedBeat = -1;      // 이미 누르기로 계획한 박 index
//     this.pressAt = null;        // 계획된 누름 시각 (박자 시계 초)
//   }
//   poll(game) {
//     const beat = game.beat;
//     // 다음 박에 대한 누름 계획 세우기 (박마다 1회)
//     if (this.plannedBeat !== beat.nextBeatIndex) {
//       this.plannedBeat = beat.nextBeatIndex;
//       const err = (1 - this.accuracy) * this.jitter * (this.rng() * 2 - 1) * 2;
//       this.pressAt = beat.nextBeatTime + err;
//     }
//     if (this.pressAt !== null && beat.time >= this.pressAt) {
//       // 박자 시계 → performance.now() ms 로 환산 (지금 시각 기준으로 오차만큼 보정)
//       const timeStamp = performance.now() - (beat.time - this.pressAt) * 1000;
//       this.pressAt = null;
//       return [{ timeStamp }];
//     }
//     return [];
//   }
//   onRoundStart(info) { this.plannedBeat = -1; this.pressAt = null; }
// }
//
// /** TODO(AI): 다른 입력원을 감싸서, 퀴즈 정답 시 일정 시간 힘 보너스를 붙이는 래퍼 */
// export class QuizBonusPowerSource extends PowerSource {
//   constructor(inner, quizClient, { powerMult = 1.5, scorePoints = 20, duration = 3 } = {}) {
//     super(inner.player);
//     this.kind = 'quiz';
//     this.inner = inner;             // 실제 입력원 (예: KeyboardPowerSource)
//     this.bonusUntil = 0;            // 이 시각(performance.now ms)까지 보너스 유효
//     this.opts = { powerMult, scorePoints, duration };
//     // TODO(AI): 외부 퀴즈/AI 판정 서비스가 정답을 알려주면 보너스 창을 연다
//     this.unsubscribe = quizClient.onCorrect(this.player.id, () => {
//       this.bonusUntil = performance.now() + duration * 1000;
//     });
//   }
//   poll(game) {
//     const tries = this.inner.poll(game);
//     const now = performance.now();
//     if (now > this.bonusUntil) return tries;
//     // 보너스 창 안의 시도에만 bonus 를 붙인다 → computePower 의 bonus.powerMult 로 들어간다
//     return tries.map((t) => ({
//       ...t,
//       bonus: { powerMult: this.opts.powerMult, scorePoints: this.opts.scorePoints, reason: 'quiz' },
//     }));
//   }
//   onRoundStart(info) { this.inner.onRoundStart(info); }
//   onRoundEnd(info) { this.inner.onRoundEnd(info); }
//   dispose() { this.unsubscribe?.(); this.inner.dispose(); }
// }
// (즉시 보너스만 필요하면 game.applyBonus(playerId, { powerMult, scorePoints, reason }) 를 써도 된다)
