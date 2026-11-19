// =============================================================
// 상단 HUD (멀티플레이용): 왼쪽·오른쪽 마법사의 이름·체력·마나, 제한 시간, 콤보
// (원본 ui/HUD.js 를 양쪽이 같은 조건이 되도록 고쳤다)
// =============================================================
import { C, UI_COLORS } from '../data/palette.js';
import { CONFIG } from '../config.js';
import { nineSlice, drawBar } from '../ui/Widgets.js';

export class NetHUD {
  constructor(game) {
    this.game = game;
    this.ghost = { left: 1, right: 1 }; // 깎인 체력이 천천히 줄어드는 잔상
    this.time = 0;
  }

  update(dt, duel) {
    this.time += dt;
    for (const [k, w] of [['left', duel.left], ['right', duel.right]]) {
      const ratio = w.hpRatio;
      if (this.ghost[k] > ratio) this.ghost[k] = Math.max(ratio, this.ghost[k] - dt * 0.4);
      else this.ghost[k] = ratio;
    }
  }

  render(r, duel, { showTimer = true } = {}) {
    const { assets, text } = this.game;
    const ctx = r.ctx;
    const p = duel.left, e = duel.right;
    const heart = assets.frames('icon_heal', 'default', { variant: 'hp' })[0];
    const comboBonus = (n) => (n < 2 ? 0 : Math.min(CONFIG.COMBO.MAX_BONUS, (n - 1) * CONFIG.COMBO.STEP_BONUS));

    // ---------- 왼쪽 ----------
    nineSlice(r, assets, 2, 2, 118, 24, 'dark');
    text.draw(ctx, p.name, 7, 3, { size: 's', color: this.game.uiColor(p.player), shadow: C.ink });
    text.draw(ctx, `${Math.ceil(p.hp)}/${p.maxHp}`, 115, 3, { size: 's', color: C.silver, align: 'right' });
    const lowHp = p.hpRatio < 0.3 && Math.floor(this.time * 4) % 2 === 0;
    r.sprite(heart, 6, 12, { anchorX: 0, anchorY: 0 });
    drawBar(r, 15, 13, 100, 6, p.hpRatio, {
      fill: lowHp ? UI_COLORS.hpLow : UI_COLORS.hp, back: UI_COLORS.hpBack, highlight: C.pink,
      ghost: C.gold, ghostRatio: this.ghost.left,
    });
    r.rect(6, 20, 8, 4, C.navy);
    text.draw(ctx, 'M', 8, 18, { size: 's', color: C.cyan });
    drawBar(r, 15, 20, 80, 4, p.mana / p.maxMana, { fill: UI_COLORS.mana, back: UI_COLORS.manaBack, highlight: C.cyan });
    if (p.shield) text.draw(ctx, `◆${Math.ceil(p.shield.hp)}`, 98, 18, { size: 's', color: C.cyan });

    // ---------- 오른쪽 (막대가 오른쪽 기준으로 줄어든다) ----------
    nineSlice(r, assets, 200, 2, 118, 24, 'dark');
    text.draw(ctx, e.name, 313, 3, { size: 's', color: this.game.uiColor(e.player), align: 'right', shadow: C.ink });
    text.draw(ctx, `${Math.ceil(e.hp)}/${e.maxHp}`, 205, 3, { size: 's', color: C.silver });
    const bx = 205, bw = 100;
    r.sprite(heart, 306, 12, { anchorX: 0, anchorY: 0 });
    r.rect(bx, 13, bw, 6, C.ink);
    r.rect(bx + 1, 14, bw - 2, 4, UI_COLORS.hpBack);
    const gw = Math.round((bw - 2) * this.ghost.right);
    r.rect(bx + 1 + (bw - 2 - gw), 14, gw, 4, C.gold);
    const fw = Math.round((bw - 2) * e.hpRatio);
    r.rect(bx + 1 + (bw - 2 - fw), 14, fw, 4, UI_COLORS.hp);
    r.rect(bx + 1 + (bw - 2 - fw), 14, fw, 1, C.pink);
    r.rect(306, 20, 8, 4, C.navy);
    text.draw(ctx, 'M', 308, 18, { size: 's', color: C.cyan });
    const mw = 80, mx = 225;
    r.rect(mx, 20, mw, 4, C.ink);
    r.rect(mx + 1, 21, mw - 2, 2, UI_COLORS.manaBack);
    const mf = Math.round((mw - 2) * (e.mana / e.maxMana));
    r.rect(mx + 1 + (mw - 2 - mf), 21, mf, 2, UI_COLORS.mana);
    if (e.shield) text.draw(ctx, `◆${Math.ceil(e.shield.hp)}`, 222, 18, { size: 's', color: C.cyan, align: 'right' });

    // ---------- 제한 시간 / 콤보 ----------
    if (showTimer) {
      const warn = duel.timeLeft <= 10;
      nineSlice(r, assets, 142, 2, 36, 16, warn ? 'danger' : 'dark');
      text.draw(ctx, String(Math.ceil(duel.timeLeft)), 160, 3, { size: 'l', color: warn ? C.yellow : C.white, align: 'center', shadow: C.ink });
    }
    const combo = p.combo;
    if (combo.count >= 2) {
      const pulse = combo.timer > 0.4 || Math.floor(this.time * 10) % 2 === 0;
      if (pulse) {
        text.draw(ctx, `COMBO x${combo.count}`, 160, 20, { size: 's', color: C.yellow, align: 'center', outline: C.ink });
        text.draw(ctx, `+${Math.round(comboBonus(combo.count) * 100)}%`, 160, 29, { size: 's', color: C.orange, align: 'center', outline: C.ink });
      }
    }
  }
}
