(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // UI 부품
  //  - 9-slice 픽셀 테두리 박스 (9×9 스프라이트를 3×3 조각으로 나눔)
  //  - 픽셀 게이지 바, 눌림 상태가 있는 버튼, 판 수 아이콘
  // ─────────────────────────────────────────────────────────────
  const D = () => PK.Draw;
  const BOX = { gold: 'ui_box', dark: 'ui_box_dark', paper: 'ui_box_paper' };

  const UI = {
    // 9-slice 박스. 가장자리 조각은 방향을 따라 균일하므로 늘려도 픽셀이 깨지지 않는다.
    box(g, x, y, w, h, style) {
      const spr = PK.Assets.get(BOX[style || 'gold'] || style);
      const cv = spr.canvas;
      const s = 3, m = spr.w - 2 * s;
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
      const iw = w - 2 * s, ih = h - 2 * s;
      // 모서리
      g.drawImage(cv, 0, 0, s, s, x, y, s, s);
      g.drawImage(cv, s + m, 0, s, s, x + w - s, y, s, s);
      g.drawImage(cv, 0, s + m, s, s, x, y + h - s, s, s);
      g.drawImage(cv, s + m, s + m, s, s, x + w - s, y + h - s, s, s);
      // 변
      if (iw > 0) {
        g.drawImage(cv, s, 0, m, s, x + s, y, iw, s);
        g.drawImage(cv, s, s + m, m, s, x + s, y + h - s, iw, s);
      }
      if (ih > 0) {
        g.drawImage(cv, 0, s, s, m, x, y + s, s, ih);
        g.drawImage(cv, s + m, s, s, m, x + w - s, y + s, s, ih);
      }
      // 안쪽
      if (iw > 0 && ih > 0) g.drawImage(cv, s, s, m, m, x + s, y + s, iw, ih);
    },

    // 픽셀 게이지 바. v = 0~1, mark = 0~1 위치에 기준선(예: 기합 필요량)
    bar(g, x, y, w, h, v, color, opt) {
      opt = opt || {};
      const C = PK.COL;
      x = Math.round(x); y = Math.round(y);
      D().rect(g, x - 1, y - 1, w + 2, h + 2, C.outline);
      D().rect(g, x, y, w, h, opt.bg || C.navyDark);
      const fw = Math.round(Math.max(0, Math.min(1, v)) * w);
      const rtl = opt.rtl;
      const fx = rtl ? x + w - fw : x;
      if (fw > 0) {
        D().rect(g, fx, y, fw, h, color);
        D().rect(g, fx, y, fw, 1, opt.hi || C.white);   // 윗줄 하이라이트
        if (opt.hiDither) D().dither(g, fx, y + 1, fw, h - 1, opt.hi || C.white, 3);
      }
      if (opt.mark !== undefined) {
        const mx = rtl ? x + w - Math.round(opt.mark * w) : x + Math.round(opt.mark * w);
        D().rect(g, mx, y - 2, 1, h + 4, opt.markColor || C.red);
      }
    },

    // 버튼 — 선택되면 금색 테두리, 눌리면 2px 아래로 이동
    button(g, x, y, w, h, label, selected, pressed, opt) {
      opt = opt || {};
      const C = PK.COL;
      const dy = pressed ? 2 : 0;
      if (!pressed) D().rect(g, x + 1, y + h, w - 2, 2, C.outline);   // 버튼 아래 그림자
      UI.box(g, x, y + dy, w, h, selected ? 'gold' : 'dark');
      PK.Font.draw(g, label, x + (w >> 1), y + dy + ((h - PK.Font.lineH(opt.font || 'M')) >> 1) + 1, {
        font: opt.font || 'M', color: selected ? C.yellow : (opt.dim ? C.grey : C.lgrey), align: 'center', outline: C.outline
      });
      if (selected) {
        const ar = PK.Assets.get('icon_arrow');
        PK.Draw.sprite(g, ar, x - 6 + ((PK.Game.tick >> 4) % 2), y + dy + (h >> 1) - 3 + ar.ay, false);
      }
    },

    // 딴 판 아이콘 (좌상단 x, y 기준 11×11) — side: 'red'|'white', kind: 'men'|'kote'|'do'|'hansoku'|null
    // 실제 검도 점수판처럼 딴 부위의 첫 글자를 원 안에 적는다
    pointIcon(g, x, y, side, kind) {
      const spr = PK.Assets.get(kind ? 'icon_point' : 'icon_point_empty', side);
      g.drawImage(spr.canvas, Math.round(x), Math.round(y));
      if (kind) {
        PK.Font.draw(g, PK.MatchRules.label(kind), x + 6, y + 1, { font: 'S', color: side === 'red' ? PK.COL.white : PK.COL.outline, align: 'center' });
      }
    },

    // 홍/백 표식 꼬리표
    sideTag(g, x, y, side) {
      const C = PK.COL;
      const bg = side === 'red' ? C.red : C.white;
      D().rect(g, x, y, 13, 11, C.outline);
      D().rect(g, x + 1, y + 1, 11, 9, bg);
      D().rect(g, x + 1, y + 9, 11, 1, side === 'red' ? C.darkRed : C.lgrey);
      PK.Font.draw(g, side === 'red' ? '홍' : '백', x + 7, y, { font: 'S', color: side === 'red' ? C.white : C.outline, align: 'center' });
    },

    // 화면 전체 반투명 막 (디더링)
    dim(g, level, color) {
      D().dither(g, 0, 0, PK.CONFIG.SCREEN_W, PK.CONFIG.SCREEN_H, color || PK.COL.outline, level);
    },

    // 대화 상자 (초상화 + 이름 + 본문)
    dialog(g, entry, shownText, blink) {
      const C = PK.COL;
      const x = 6, y = 118, w = 308, h = 56;
      UI.box(g, x, y, w, h, 'gold');
      let tx = x + 8;
      if (entry.portrait) {
        const p = PK.Assets.get(entry.portrait, entry.swap);
        D().rect(g, x + 6, y + 6, 28, 28, C.outline);
        D().rect(g, x + 7, y + 7, 26, 26, C.navyLight);
        D().dither(g, x + 7, y + 20, 26, 13, C.navy, 8);
        PK.Draw.sprite(g, p, x + 8 + p.ax, y + 8 + p.ay, !!entry.flip);
        tx = x + 40;
      }
      PK.Font.draw(g, entry.who || '', tx, y + 5, { font: 'M', color: entry.color || C.yellow, outline: C.outline });
      const lines = PK.Font.wrap(shownText, w - (tx - x) - 10, 'M');
      lines.slice(0, 3).forEach(function (ln, i) {
        PK.Font.draw(g, ln, tx, y + 19 + i * 12, { font: 'M', color: C.white });
      });
      if (blink) {
        // 다음으로 넘기기 표시 (아래 삼각형, 위아래로 까딱)
        const by = y + h - 10 + ((PK.Game.tick >> 4) % 2);
        PK.Draw.rect(g, x + w - 13, by, 5, 1, C.yellow);
        PK.Draw.rect(g, x + w - 12, by + 1, 3, 1, C.yellow);
        PK.Draw.rect(g, x + w - 11, by + 2, 1, 1, C.yellow);
      }
    }
  };

  PK.UI = UI;
})(window.PK = window.PK || {});
