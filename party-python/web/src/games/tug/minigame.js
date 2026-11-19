// =============================================================
// 줄다리기 — 미니게임 공통 규격 진입점 (docs/COMMON_SPEC.md)
//
//   const handle = mount(container, ctx);
//   handle.destroy();
//
// ctx = { session, run, players: [{ id, name, index }], me: { id }, options }
// 판정·점수는 세션 너머(서버 또는 시험용 진행기)에서 오고, 여기서는 화면과 입력만 다룬다.
// =============================================================
import { Game } from './core/Game.js';
import { NetLink } from './net/NetLink.js';
import { ANIMALS, animalForIndex } from '../../shared/animals.js';

export const meta = Object.freeze({ id: 'tug', title: '픽셀 줄다리기', minPlayers: 2, maxPlayers: 5 });

/** 각자 자기 컴퓨터에서 하므로 당기기 키는 모두 Space */
const PULL_KEY = 'Space';

export function mount(container, ctx) {
  const doc = container.ownerDocument;
  const canvas = doc.createElement('canvas');
  canvas.className = 'game-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '픽셀 줄다리기 게임 화면');
  container.appendChild(canvas);

  const net = new NetLink(ctx);
  const meId = ctx.me && ctx.me.id;
  const players = ctx.players.map((p) => {
    const isMe = p.id === meId;
    // 대기실에서 고른 캐릭터. 없으면 참가 순서대로 배정한다
    const animal = ANIMALS[p.character] || animalForIndex(p.index);
    return {
      id: p.id, name: p.name, key: isMe ? PULL_KEY : null, keyLabel: isMe ? 'SPC' : null, isMe,
      animal: animal.id, color: animal.color,
    };
  });
  const config = {
    ...((ctx.options && ctx.options.config) || {}),
    AUTO_PAUSE_ON_BLUR: false,  // 멀티플레이는 한 사람이 멈출 수 없다
    PAUSE_KEY: null,
    SHOW_RESTART: false,        // 다시 하기는 대기실에서
    FONT_CSS_URL: null,         // 폰트는 페이지(fonts.css)가 이미 불러온다
    LAYOUT: { ROPE_Y: 123, PLAYER_SPACING: 22 }, // 동물 캐릭터의 손 높이와 몸 너비에 맞춘 줄 높이·간격
  };

  const game = new Game(canvas, { players, config, net });
  Promise.resolve()
    .then(() => game.start())
    .catch((err) => console.error('[tug] 시작 실패', err));
  // 대기실에서 이미 클릭했으므로 소리를 바로 켤 수 있다 (안 되면 첫 키 입력 때 켜진다)
  try { game._unlockAudio(); } catch (e) { /* 무시 */ }
  try { canvas.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      game.destroy();
      net.dispose();
      canvas.remove();
    },
  };
}
