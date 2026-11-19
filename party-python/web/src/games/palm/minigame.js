// =============================================================
// 손바닥 밀치기 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 판정·점수·진행은 세션 너머(서버 또는 시험용 진행기)에서 오고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { CONFIG, mergeConfig } from './config.js';
import { loadAssets } from './assets/AssetLoader.js';
import { Game } from './core/Game.js';
import { NetLink } from './net/NetLink.js';
import { ANIMALS, animalForIndex } from '../../shared/animals.js';

export const meta = Object.freeze({ id: 'palm', title: '손바닥 밀치기', minPlayers: 2, maxPlayers: 5 });

/** 화면 쪽에서만 바꾸는 설정 */
const VIEW_CONFIG = Object.freeze({
  // 동물 캐릭터는 원본 사람 캐릭터보다 넓어서 두 선수 사이를 더 띄운다
  STAGE: { P1_X: 145, P2_X: 175 },
  // 폰트는 페이지(fonts.css)가 이미 불러온다
  FONT: { CSS_URL: null },
});

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  const cfg = mergeConfig(mergeConfig(CONFIG, (ctx.options && ctx.options.config) || {}), VIEW_CONFIG);
  const meId = ctx.me && ctx.me.id;
  const players = ctx.players.map((p) => ({
    id: p.id,
    name: p.name,
    lookId: (ANIMALS[p.character] || animalForIndex(p.index)).id,
    isMe: p.id === meId,
  }));

  let game = null;
  let destroyed = false;
  loadAssets({ cfg })
    .then((assets) => {
      if (destroyed) return;
      game = new Game(container, { players, net }, cfg, assets);
      // 대기실에서 이미 클릭했으므로 소리를 바로 켤 수 있다 (안 되면 첫 키 입력 때 켜진다)
      try { game.audio.unlock(); } catch (e) { /* 무시 */ }
    })
    .catch((err) => console.error('[palm] 시작 실패', err));

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (game) game.destroy();
      game = null;
      net.dispose();
    },
  };
}
