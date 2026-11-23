// =============================================================
// 주문을 외쳐라 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// 판정·점수·진행·음성 인식은 세션 너머(서버 또는 시험용 진행기)에서 하고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { ANIMALS, animalForIndex } from '../../shared/animals.js';
import { NetGame } from './net/NetGame.js';
import { NetLink } from './net/NetLink.js';

export const meta = Object.freeze({ id: 'spell', title: '주문을 외쳐라', minPlayers: 2, maxPlayers: 5 });

export function mount(container, ctx) {
  const net = new NetLink(ctx);
  const options = ctx.options || {};
  const meId = ctx.me && ctx.me.id;
  const players = ctx.players.map((p) => ({
    id: p.id,
    name: p.name,
    lookId: (ANIMALS[p.character] || animalForIndex(p.index)).id,
    isMe: p.id === meId,
  }));
  const game = new NetGame(container, { net, players, voice: options.voice, rounds: options.rounds });
  game.init().catch((err) => console.error('[spell] 시작 실패', err));
  return {
    destroy() {
      game.destroy();
      net.dispose();
    },
  };
}
