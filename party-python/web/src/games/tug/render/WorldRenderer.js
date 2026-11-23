// =============================================================
// WorldRenderer — 줄·캐릭터·머리 위 라벨 등 '월드' 그리기 (여러 장면이 공용으로 사용)
// 좌표는 모두 월드 좌표이며, 화면에 그릴 때 camX 를 뺀다. 모든 좌표는 정수.
// =============================================================
import { PALETTE, C } from '../palette.js';
import { flipCanvas } from '../assets/SpriteFactory.js';
import { drawHeadLabel, drawJudgePop } from '../ui/HUD.js';

// ---- 연출용 작은 상수 ----
const ROPE_END_MARGIN = 12;      // 맨 뒤 선수 뒤로 줄이 더 나가는 길이 (px)
const ROPE_WOBBLE_FREQ_X = 0.25; // 줄 튕김 파형의 공간 주파수
const ROPE_WOBBLE_FREQ_T = 40;   // 줄 튕김 파형의 시간 주파수 (rad/s)
const RIBBON_LEN = 8;            // 중앙 리본 길이 (px)
const RIBBON_FLUTTER_SPEED = 9;  // 리본 펄럭임 속도 (rad/s)
const LABEL_OFFSET_Y = 34;       // 발 기준 머리 위 라벨 아랫변까지 높이
const POP_OFFSET_Y = 48;         // 발 기준 판정 팝업 높이 (라벨 위)
const PRESSED_TIME = 0.12;       // 마지막 입력 후 이 시간 동안 키캡이 눌린 것으로 표시
// 같은 팀 선수 간격(20px)이 라벨 폭보다 좁으므로, 홀수 슬롯의 라벨·팝업을 이만큼 위로 올려 겹치지 않게 한다
export const LABEL_STAGGER_Y = 11;

/** 슬롯 번호에 따른 머리 위 라벨 높이 보정 (홀수 슬롯은 한 칸 위) */
export function labelLift(player) {
  return player && player.side && (player.slot % 2) === 1 ? LABEL_STAGGER_Y : 0;
}
const CHAR_DRAW_W = 16;          // 캐릭터 스프라이트 폭
const CHAR_DRAW_H = 32;          // 캐릭터 스프라이트 높이
const FALLBACK_BACK_SLOTS = 2;   // 팀이 비어 있을 때 줄 길이를 정할 가상 슬롯 수

const COL = {
  ink: PALETTE[C.INK],
  yellow: PALETTE[C.YELLOW],
  orange: PALETTE[C.ORANGE],
  red: PALETTE[C.RED],
  white: PALETTE[C.WHITE],
};

export class WorldRenderer {
  constructor(game) {
    this.game = game;
    // 좌우 반전 스프라이트 캐시 (원본 캔버스 → 반전 사본). 인스턴스별 상태
    this._flipCache = new WeakMap();
  }

  /** 팀 멤버의 x 위치를 줄 위치(rope.pos)에 맞춰 계산한다 */
  layoutTeams() {
    const game = this.game;
    const L = game.config.LAYOUT;
    const ropeOff = Math.round(game.rope ? game.rope.pos : 0);
    for (const side of ['left', 'right']) {
      const team = game.teams && game.teams[side];
      if (!team) continue;
      const dir = side === 'left' ? -1 : 1;
      // members[0] 이 중앙에 가장 가까운 선수 (slot 0)
      team.members.forEach((p, i) => {
        const slot = Number.isInteger(p.slot) ? p.slot : i;
        p.x = L.CENTER_X + dir * (L.FRONT_OFFSET + slot * L.PLAYER_SPACING) + ropeOff;
        p.y = L.GROUND_Y;
      });
    }
  }

  /** 줄의 월드 x 범위 { x0, x1 } — 양 팀 맨 뒤 선수 뒤 ROPE_END_MARGIN 까지 */
  ropeExtents() {
    const game = this.game;
    const L = game.config.LAYOUT;
    const ropeOff = Math.round(game.rope ? game.rope.pos : 0);
    const fallback = L.FRONT_OFFSET + FALLBACK_BACK_SLOTS * L.PLAYER_SPACING;
    let x0 = L.CENTER_X - fallback + ropeOff;
    let x1 = L.CENTER_X + fallback + ropeOff;
    const left = game.teams && game.teams.left;
    const right = game.teams && game.teams.right;
    if (left && left.members.length) x0 = Math.min(...left.members.map((p) => Math.round(p.x)));
    if (right && right.members.length) x1 = Math.max(...right.members.map((p) => Math.round(p.x)));
    return { x0: x0 - ROPE_END_MARGIN, x1: x1 + ROPE_END_MARGIN };
  }

  /** 줄 위 한 지점의 세로 흔들림 (px, 정수). 중앙 표식에서 최대, 양 끝에서 0 */
  _wobbleAt(wx, x0, x1, mx, t, wobble) {
    if (!wobble) return 0;
    let env;
    if (wx <= mx) env = mx > x0 ? (wx - x0) / (mx - x0) : 1;
    else env = x1 > mx ? (x1 - wx) / (x1 - mx) : 1;
    env = Math.max(0, Math.min(1, env));
    return Math.round(Math.sin(wx * ROPE_WOBBLE_FREQ_X + t * ROPE_WOBBLE_FREQ_T) * wobble * env);
  }

  /** 줄 + 중앙 리본 표식 */
  drawRope(g, camX = 0) {
    const game = this.game;
    const L = game.config.LAYOUT;
    const W = game.W || game.config.WIDTH;
    const rope = game.rope;
    const pos = Math.round(rope ? rope.pos : 0);
    const wobble = rope ? rope.wobble || 0 : 0;
    const t = game.time || 0;
    const cam = Math.round(camX);
    const { x0, x1 } = this.ropeExtents();
    const mx = L.CENTER_X + pos; // 중앙 표식 월드 x

    // ---- 줄 본체: 한 열(1px)씩 꼬임 패턴을 찍는다 ----
    for (let wx = x0; wx <= x1; wx++) {
      const sx = wx - cam;
      if (sx < 0 || sx >= W) continue;
      const ry = L.ROPE_Y + this._wobbleAt(wx, x0, x1, mx, t, wobble);
      // 꼬임 패턴은 줄과 함께 움직이도록 (wx - pos) 기준
      const u = wx - pos;
      const topCol = ((u >> 1) & 1) ? COL.orange : COL.yellow;       // 윗면: 노랑/주황 2px 교대
      const botCol = (((u + 1) >> 1) & 1) ? COL.red : COL.orange;    // 아랫면: 주황/빨강 (1px 어긋나 꼬인 느낌)
      g.fillStyle = COL.ink;
      g.fillRect(sx, ry - 2, 1, 1); // 위 외곽선
      g.fillRect(sx, ry + 1, 1, 1); // 아래 외곽선
      g.fillStyle = topCol;
      g.fillRect(sx, ry - 1, 1, 1);
      g.fillStyle = botCol;
      g.fillRect(sx, ry, 1, 1);
    }

    // ---- 줄 끝: 살짝 풀린 술 (양 끝) ----
    this._drawRopeEnd(g, x0 - cam, L.ROPE_Y, -1, W);
    this._drawRopeEnd(g, x1 - cam, L.ROPE_Y, 1, W);

    // ---- 중앙 표식 (매듭 + 리본) ----
    this._drawMarker(g, mx - cam, L.ROPE_Y + this._wobbleAt(mx, x0, x1, mx, t, wobble), t, W);
  }

  _drawRopeEnd(g, sx, ry, dir, W) {
    // 끝 열 바깥으로 1~2px 풀린 실 (INK 외곽 포함)
    const px = (x, y, col) => {
      if (x < 0 || x >= W) return;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    };
    px(sx + dir, ry - 1, COL.ink);
    px(sx + dir, ry, COL.orange);
    px(sx + dir, ry + 1, COL.ink);
    px(sx + dir * 2, ry + 1, COL.yellow);
    px(sx + dir * 2, ry + 2, COL.ink);
    px(sx + dir, ry + 2, COL.ink);
  }

  _drawMarker(g, sx, ry, t, W) {
    if (sx < -4 || sx > W + 4) return;
    // 매듭: 줄 위에 감긴 3×4 빨간 매듭 (INK 테두리)
    g.fillStyle = COL.ink;
    g.fillRect(sx - 2, ry - 3, 5, 6);
    g.fillStyle = COL.red;
    g.fillRect(sx - 1, ry - 2, 3, 4);
    g.fillStyle = COL.orange;
    g.fillRect(sx - 1, ry - 2, 1, 1); // 하이라이트

    // 리본: 매듭 아래로 3×8 매달림, 아래쪽 절반이 펄럭인다
    const sway = Math.round(Math.sin(t * RIBBON_FLUTTER_SPEED));
    const top = ry + 3;
    for (let r = 0; r < RIBBON_LEN; r++) {
      const off = r >= RIBBON_LEN / 2 ? sway : 0;
      const rx = sx - 1 + off;
      const y = top + r;
      g.fillStyle = COL.ink;
      g.fillRect(rx - 1, y, 1, 1);
      g.fillRect(rx + 3, y, 1, 1);
      g.fillStyle = ((r >> 1) & 1) ? COL.yellow : COL.white;
      g.fillRect(rx, y, 3, 1);
    }
    // 제비꼬리 모양 끝: 가운데 1px 을 파내고 INK 로 마감
    const bx = sx - 1 + sway;
    const by = top + RIBBON_LEN;
    g.fillStyle = COL.ink;
    g.fillRect(bx - 1, by, 2, 1);
    g.fillRect(bx + 2, by, 2, 1);
    g.fillRect(bx + 1, by - 1, 1, 1);
  }

  /** 반전 스프라이트 (캐시) */
  _flipped(canvas) {
    let f = this._flipCache.get(canvas);
    if (!f) {
      f = flipCanvas(canvas);
      this._flipCache.set(canvas, f);
    }
    return f;
  }

  /** 캐릭터 한 명 그리기. x = 발 중앙(화면 좌표), y = 발 */
  drawCharacter(g, player, x, y, { anim, frame, side, flip } = {}) {
    const assets = this.game.assets;
    if (!assets) return;
    const a = anim ?? player.anim;
    const s = side === undefined ? player.side : side;
    const fl = flip === undefined ? player.flip : flip;
    let f = frame ?? player.frame;
    const count = assets.frameCount ? assets.frameCount(a) : 1;
    if (count > 0) f = ((f % count) + count) % count;
    const ix = Math.round(x);
    const iy = Math.round(y);

    // 발밑 그림자: INK 체커 디더 (반투명 대신)
    g.fillStyle = COL.ink;
    for (let dx = -6; dx <= 5; dx++) {
      if (((ix + dx + iy) & 1) === 0) g.fillRect(ix + dx, iy - 1, 1, 1);
      if (dx > -5 && dx < 4 && ((ix + dx + iy + 1) & 1) === 0) g.fillRect(ix + dx, iy, 1, 1);
    }

    const src = assets.character(player.appearance(), s, a, f);
    if (!src) return;
    const img = fl ? this._flipped(src) : src;
    // 스프라이트 크기는 캐릭터 종류마다 다를 수 있다(사람 16×32, 동물 24×32). 발 가운데를 기준으로 그린다
    const iw = img.width || CHAR_DRAW_W;
    const ih = img.height || CHAR_DRAW_H;
    g.drawImage(img, ix - (iw >> 1), iy - ih);
  }

  /** 팀이 정해진 선수 전원 + 머리 위 라벨 + 판정 팝업 */
  drawPlayers(g, camX = 0, { labels = true, pops = true } = {}) {
    const game = this.game;
    const L = game.config.LAYOUT;
    const cam = Math.round(camX);
    const list = game.players.filter((p) => p.side);
    // 캐릭터 먼저, 라벨/팝업은 그 위에
    for (const p of list) this.drawCharacter(g, p, Math.round(p.x) - cam, L.GROUND_Y);
    if (labels) {
      for (const p of list) {
        drawHeadLabel(g, game.ui, Math.round(p.x) - cam, L.GROUND_Y - LABEL_OFFSET_Y - labelLift(p), {
          label: p.name || p.label,   // 대기실에서 정한 이름
          keyLabel: p.keyLabel,
          color: p.color,
          side: p.side,
          pressed: p.pressT < PRESSED_TIME,
        });
      }
    }
    if (pops) {
      for (const p of list) {
        if (!p.pop) continue;
        drawJudgePop(g, game.ui, Math.round(p.x) - cam, L.GROUND_Y - POP_OFFSET_Y - labelLift(p), p.pop.grade, p.pop.t);
      }
    }
  }

  /** 배경 → 줄 → 선수 → 입자 (game.camX 적용) */
  drawWorld(g, { labels = true, pops = true, rope = true } = {}) {
    const game = this.game;
    const camX = Math.round(game.camX || 0);
    if (game.background) game.background.render(g, camX);
    if (rope) this.drawRope(g, camX);
    this.drawPlayers(g, camX, { labels, pops });
    if (game.particles) game.particles.render(g, camX);
  }

  /** 하단 플레이어 패널용 데이터 (HUD.drawPlayerPanels 인자) — 여러 장면 공용 헬퍼 */
  buildPanels() {
    const game = this.game;
    return game.players.map((p) => {
      const s = game.scoreBoard ? game.scoreBoard.get(p.id) : null;
      return {
        label: p.label,
        name: p.name,
        keyLabel: p.keyLabel,
        color: p.color,
        side: p.side,
        // applyBonus 점수까지 포함한 누적 점수 (Game.totalScore)
        score: typeof game.totalScore === 'function' ? game.totalScore(p.id) : (s ? s.total : 0),
        combo: s ? s.combo : 0,
        grade: p.pop ? p.pop.grade : null,
        gradeT: p.pop ? p.pop.t : 0,
        pressed: p.pressT < PRESSED_TIME,
      };
    });
  }
}
