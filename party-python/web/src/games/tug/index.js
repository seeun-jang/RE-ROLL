// =============================================================
// 공개 API — 다른 페이지/앱에 게임을 끼워 넣을 때 쓰는 진입점
//
//   import { mount } from './src/index.js';
//   const handle = mount(canvas, { players, config, onFinish(results) { ... } });
//   handle.destroy();
// =============================================================
import { Game } from './core/Game.js';

/**
 * 캔버스에 게임을 띄운다.
 * @param {HTMLCanvasElement} canvas
 * @param {{ players?: object[], config?: object, onFinish?: (results: object[]) => void,
 *           createPowerSource?: (player: object, game: Game) => object }} options
 * @returns {{ destroy(): void, pause(): void, resume(): void, setMuted(b: boolean): void,
 *             getResults(): object[], applyBonus(playerId: string, bonus: object): boolean, game: Game }}
 */
export function mount(canvas, options = {}) {
  // 캔버스처럼 생긴 객체인지 확인 (getContext 가 있어야 한다)
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('mount(canvas, options): canvas 는 HTMLCanvasElement 여야 합니다.');
  }
  const game = new Game(canvas, options || {});
  // 에셋 로딩은 비동기 — 실패해도 예외를 밖으로 던지지 않고 콘솔에 남긴다
  Promise.resolve()
    .then(() => game.start())
    .catch((err) => console.error('[PixelTugOfWar] 시작 실패', err));

  return {
    destroy: () => game.destroy(),
    pause: () => game.pause(),
    resume: () => game.resume(),
    setMuted: (b) => game.setMuted(b),
    getResults: () => game.results(),
    // TODO(AI): 외부 AI 판정·퀴즈 정답 보너스를 여기로 주입한다 ({ powerMult, scorePoints, reason })
    applyBonus: (playerId, bonus) => game.applyBonus(playerId, bonus),
    game,
  };
}

export { PowerSource, KeyboardPowerSource } from './input/PowerSource.js';
export { DEFAULT_CONFIG, DEFAULT_PLAYERS, mergeConfig } from './config.js';
