// ============================================================
// 픽셀 아트 스프라이트 정의 (2차원 문자 배열 + 팔레트 범례)
//
//  - 한 글자 = 한 픽셀.  '.' = 투명,  '#' = 피격 플래시(흰색) 예약 문자
//  - legend : 글자 → 팔레트 색
//  - variants : 같은 그림을 다른 범례로 굽는다 (속성별 투사체/아이콘 등)
//  - 실제 이미지로 교체하려면 assets/manifest.js 의 IMAGE_OVERRIDES 를 사용
//  - 모든 캐릭터는 "오른쪽을 바라보는" 방향으로 그리고, 적은 굽는 단계에서 좌우 반전한다.
// ============================================================
import { C, ELEMENT_COLORS } from './palette.js';

// ---------- 그리드 편집 도우미 (순수 함수) ----------
const toRows = (g) => g.map((r) => r.split(''));
const toGrid = (rows) => rows.map((r) => r.join(''));

/** 그리드를 복제해 편집 함수(put/line)로 수정한 새 그리드를 돌려준다 */
function edit(grid, fn) {
  const rows = toRows(grid);
  const api = {
    put(x, y, ch) {
      if (rows[y] && x >= 0 && x < rows[y].length) rows[y][x] = ch;
    },
    // 브레젠험 직선
    line(x0, y0, x1, y1, ch) {
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        api.put(x0, y0, ch);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    },
  };
  fn(api);
  return toGrid(rows);
}

/** from~to 행을 n칸 아래로 (숨쉬기/웅크리기 표현) */
function shiftDown(grid, from, to, n) {
  const rows = toRows(grid);
  const w = rows[0].length;
  const out = rows.map((r) => r.slice());
  for (let y = from; y <= to + n && y < rows.length; y++) {
    const src = y - n;
    out[y] = src >= from && src <= to ? rows[src].slice() : (y < from + n ? new Array(w).fill('.') : out[y]);
  }
  return toGrid(out);
}

/** from~to 행을 n칸 좌우 이동 (흔들림/넉백) */
function shiftRowsX(grid, from, to, n) {
  return grid.map((row, y) => {
    if (y < from || y > to) return row;
    const w = row.length;
    let out = '';
    for (let x = 0; x < w; x++) {
      const sx = x - n;
      out += sx >= 0 && sx < w ? row[sx] : '.';
    }
    return out;
  });
}

/** 투명이 아닌 모든 픽셀을 플래시 색으로 */
const flash = (grid) => grid.map((r) => r.replace(/[^.]/g, '#'));

// ============================================================
// 견습 마법사 (플레이어) — 16x32, 지팡이는 별도로 덧그린다
// ============================================================
const WIZARD_BODY = [
  '................',
  '.kk.............',
  '.khk............',
  '..khk...........',
  '..khhk..........',
  '...khhk.........',
  '...khHhk........',
  '...khHhhk.......',
  '..khhHYhhk......',
  '..khhYYYhhk.....',
  '..khhhYhhhhk....',
  '.kyyyyyyyyyyk...',
  'khhhhhhhhhhhhhk.',
  '.kkkkkkkkkkkkk..',
  '...kbbsssssk....',
  '...kbbssskssk...',
  '...kbbsssssssk..',
  '...kbbSsssssk...',
  '....kkSSSSkk....',
  '....knhhhhhk....',
  '...knhhHyhhhk...',
  '...knhhHyhhhhk..',
  '..knnhhHyhhhsk..',
  '..knhhhHyhhhkk..',
  '..knhhhHyhhhhk..',
  '.knnhhhHyhhhhhk.',
  '.knhhhhHyhhhhhk.',
  '.knhhhhHyhhhhhk.',
  'knnhhhhHyhhhhhhk',
  'kyyyyyyyyyyyyyyk',
  '.kkkuukkkkuukkk.',
  '...kkkk..kkkkk..',
];

// 불꽃 마법사 모자 (0~13행 교체)
const FIRE_HAT = [
  '......k.........',
  '.....kyk...k....',
  '..k..kyk..kyk...',
  '.kyk.kYyk.kyk...',
  '.kyykyYYkkyyk...',
  '..kyyYYYyyyk....',
  '..khhyYyyhhk....',
  '..khhhyyhhhk....',
  '..khhhhhhhhk....',
  '..khhHHHhhhk....',
  '..khhhhhhhhhk...',
  '.kyyyyyyyyyyk...',
  'khhhhhhhhhhhhhk.',
  '.kkkkkkkkkkkkk..',
];

const FIRE_MAGE_BODY = edit([...FIRE_HAT, ...WIZARD_BODY.slice(14)], (g) => {
  // 은빛 수염
  for (let x = 6; x <= 11; x++) g.put(x, 17, 'v');
  for (let x = 6; x <= 10; x++) g.put(x, 18, 'v');
  g.put(8, 19, 'v');
  g.put(9, 19, 'v');
});

// 지팡이 포즈들
const staffDown = (g) => {
  g.line(13, 13, 13, 30, 'b');
  g.put(13, 10, 'y'); g.put(12, 11, 'y'); g.put(13, 11, 'Y'); g.put(14, 11, 'y'); g.put(13, 12, 'y');
};
const staffRaised = (g, glow) => {
  g.put(12, 22, 'h');                     // 원래 손 지우기
  g.line(13, 9, 13, 26, 'b');
  g.put(12, 18, 's'); g.put(12, 19, 's'); // 들어올린 손
  g.put(13, 6, 'y'); g.put(12, 7, 'y'); g.put(13, 7, glow ? 'w' : 'Y'); g.put(14, 7, 'y'); g.put(13, 8, 'y');
};
const staffForward = (g, glow) => {
  g.put(12, 22, 'h');
  g.line(11, 23, 15, 15, 'b');
  g.put(11, 22, 's');
  g.put(15, 13, 'y'); g.put(14, 14, 'y'); g.put(15, 14, glow ? 'w' : 'Y');
  if (glow) { g.put(14, 13, 'Y'); g.put(15, 12, 'Y'); }
};

/** 몸통 그리드 → 애니메이션 세트 */
function buildWizardAnims(body) {
  const idle0 = edit(body, staffDown);
  const idle1 = shiftDown(idle0, 0, 18, 1);
  const cast0 = edit(body, (g) => staffRaised(g, false));
  const cast1 = edit(body, (g) => staffForward(g, true));
  const cast2 = edit(body, (g) => staffForward(g, false));
  const win0 = edit(body, (g) => staffRaised(g, false));
  const win1 = edit(body, (g) => staffRaised(g, true));
  const lose0 = shiftDown(edit(body, staffDown), 0, 29, 2);
  return {
    idle: [idle0, idle0, idle1, idle1],
    charge: [cast0, edit(body, (g) => staffRaised(g, true))],
    cast: [cast0, cast1, cast2],
    hit: [flash(idle0), shiftRowsX(idle0, 0, 31, -1)],
    win: [win0, win1],
    lose: [lose0],
  };
}

// ============================================================
// 허수아비 (튜토리얼)
// ============================================================
const SCARECROW = [
  '................',
  '................',
  '................',
  '................',
  '......kkkk......',
  '.....kttctk.....',
  '...kkttttttkk...',
  '..kccccccccccck.',
  '...kkkkkkkkkk...',
  '....kssssssk....',
  '....ksksskSk....',
  '....ksssssSk....',
  '....kskkksSk....',
  '.....kssSSk.....',
  '......kbbk......',
  '.kkkkkkppkkkkkk.',
  'ktcpppppppppPctk',
  'kttkpppppppPkttk',
  '.kkkpppppppPkkk.',
  '....kpppPppPk...',
  '....kppppppPk...',
  '....kpcpppcPk...',
  '....kkkkkkkkk...',
  '.....tct.tct....',
  '......kbbk......',
  '......kbbk......',
  '......kbbk......',
  '......kbbk......',
  '......kbbk......',
  '......kbbk......',
  '.....kcbbck.....',
  '...kkcccccckk...',
];
const SCARECROW_GLOW = edit(SCARECROW, (g) => { g.put(6, 10, 'o'); g.put(9, 10, 'o'); });

// ============================================================
// 스승 부엉이 (16x16)
// ============================================================
const OWL = [
  '....kk....kk....',
  '...kbk....kbk...',
  '...kbbkkkkbbk...',
  '..kbbbbbbbbbbk..',
  '..kbssssssssbk..',
  '..kbswysswysbk..',
  '..kbskysskysbk..',
  '..kbsssoosssbk..',
  '..kbbssoossbbk..',
  '.kcbbbsssbbbbck.',
  '.kcbbsbsbsbbbck.',
  '.kcbbbsbsbbbbck.',
  '..kcbbbbbbbbck..',
  '...kcbbbbbbck...',
  '....kykkkkyk....',
  '................',
];
const OWL_BLINK = edit(OWL, (g) => {
  for (let x = 4; x <= 11; x++) { g.put(x, 5, 's'); g.put(x, 6, 's'); }
  g.put(4, 6, 'k'); g.put(5, 6, 'k'); g.put(8, 6, 'k'); g.put(9, 6, 'k');
});
const OWL_TALK = edit(OWL, (g) => { g.put(7, 8, 'k'); g.put(8, 8, 'k'); });

// ============================================================
// 투사체 / 이펙트 (속성 변형: 1=어두움 2=기본 3=밝음 4=코어)
// ============================================================
const ORB_A = [
  '..1111..',
  '.122221.',
  '12233221',
  '12344321',
  '12344321',
  '12233221',
  '.122221.',
  '..1111..',
];
const ORB_B = [
  '..1111..',
  '.122221.',
  '12232221',
  '12344221',
  '12244321',
  '12223221',
  '.122221.',
  '..1111..',
];
const CRESCENT_A = [
  '...11...',
  '....21..',
  '.....21.',
  '.....32.',
  '.....32.',
  '.....21.',
  '....21..',
  '...11...',
];
const CRESCENT_B = [
  '..11....',
  '...221..',
  '.....21.',
  '.....43.',
  '.....43.',
  '.....21.',
  '...221..',
  '..11....',
];

// ---------- 아이콘 8x8 ----------
const ICONS = {
  icon_fire: [
    '....1...',
    '...121..',
    '..1221..',
    '.122321.',
    '.123321.',
    '12333321',
    '.123321.',
    '..1111..',
  ],
  icon_water: [
    '...11...',
    '...11...',
    '..1221..',
    '.122221.',
    '12223221',
    '12222321',
    '.122221.',
    '..1111..',
  ],
  icon_lightning: [
    '....111.',
    '...1221.',
    '..1221..',
    '.1222111',
    '11122221',
    '...1221.',
    '..1221..',
    '..11....',
  ],
  icon_wind: [
    '........',
    '.11122..',
    '......2.',
    '1111122.',
    '........',
    '..11112.',
    '......2.',
    '....22..',
  ],
  icon_ice: [
    '...1....',
    '.1.2.1..',
    '..323...',
    '1223221.',
    '..323...',
    '.1.2.1..',
    '...1....',
    '........',
  ],
  icon_heal: [
    '........',
    '.11.11..',
    '1321221.',
    '1222221.',
    '.12221..',
    '..121...',
    '...1....',
    '........',
  ],
};

const ELEMENT_VARIANTS = Object.fromEntries(
  Object.entries(ELEMENT_COLORS).map(([el, cols]) => [el, { 1: cols[0], 2: cols[1], 3: cols[2], 4: cols[3] }]),
);

// ---------- UI 그림 ----------
const ICON_KEYBOARD = [
  '.kkkkkkkkkk.',
  'kwswswswswsk',
  'kswswswswswk',
  'kwsssssssswk',
  '.kkkkkkkkkk.',
];
const ICON_MIC = [
  '..kkkk..',
  '.kswwsk.',
  '.kswwsk.',
  '.kssssk.',
  'k.kkkk.k',
  '.kk..kk.',
  '...kk...',
  '..kkkk..',
];
const ICON_LOCK = [
  '..kkk...',
  '.k...k..',
  '.k...k..',
  'kyyyyyk.',
  'kyykyyk.',
  'kyyyyyk.',
  '.kkkkk..',
];
// 9-slice 상자 (3px 모서리)
const BOX = [
  '.kkkkkkk.',
  'klllllllk',
  'klfffffmk',
  'klfffffmk',
  'klfffffmk',
  'klfffffmk',
  'klfffffmk',
  'kmmmmmmmk',
  '.kkkkkkk.',
];

// ============================================================
// 최종 스프라이트 목록
// ============================================================
const WIZARD_LEGEND = {
  k: C.ink, h: C.dusk, H: C.slate, n: C.night, y: C.gold, Y: C.yellow,
  s: C.skin, S: C.skinShade, b: C.brown, u: C.umber, w: C.white, v: C.silver,
};

export const SPRITES = {
  player: {
    w: 16, h: 32,
    legend: WIZARD_LEGEND,
    anims: buildWizardAnims(WIZARD_BODY),
  },
  fireMage: {
    w: 16, h: 32,
    legend: { ...WIZARD_LEGEND, h: C.crimson, H: C.red, n: C.umber, y: C.orange, Y: C.yellow, b: C.brick },
    anims: buildWizardAnims(FIRE_MAGE_BODY),
  },
  scarecrow: {
    w: 16, h: 32,
    legend: { k: C.ink, t: C.tan, c: C.clay, s: C.sand, S: C.tan, b: C.brown, p: C.plum, P: C.magenta, o: C.orange },
    anims: {
      idle: [SCARECROW, SCARECROW, shiftRowsX(SCARECROW, 4, 23, 1), shiftRowsX(SCARECROW, 4, 23, 1)],
      charge: [SCARECROW_GLOW, SCARECROW],
      cast: [SCARECROW_GLOW, SCARECROW_GLOW, SCARECROW],
      hit: [flash(SCARECROW), shiftRowsX(SCARECROW, 4, 23, -1)],
      win: [SCARECROW],
      lose: [SCARECROW],
    },
  },
  owl: {
    w: 16, h: 16,
    legend: { k: C.ink, b: C.brown, c: C.clay, s: C.sand, y: C.gold, w: C.white, o: C.orange },
    anims: {
      idle: [OWL, OWL, OWL, OWL, OWL, OWL_BLINK],
      talk: [OWL, OWL_TALK],
    },
  },
  orb: {
    w: 8, h: 8,
    legend: ELEMENT_VARIANTS.neutral,
    variants: ELEMENT_VARIANTS,
    anims: { default: [ORB_A, ORB_B] },
  },
  crescent: {
    w: 8, h: 8,
    legend: ELEMENT_VARIANTS.wind,
    variants: ELEMENT_VARIANTS,
    anims: { default: [CRESCENT_A, CRESCENT_B] },
  },
  ...Object.fromEntries(
    Object.entries(ICONS).map(([id, grid]) => [
      id,
      { w: 8, h: 8, legend: ELEMENT_VARIANTS[id.replace('icon_', '')], variants: { ...ELEMENT_VARIANTS, hp: { 1: C.crimson, 2: C.red, 3: C.pink } }, anims: { default: [grid] } },
    ]),
  ),
  icon_keyboard: { w: 12, h: 5, legend: { k: C.ink, w: C.white, s: C.silver }, anims: { default: [ICON_KEYBOARD] } },
  icon_mic: {
    w: 8, h: 8,
    legend: { k: C.silver, s: C.steel, w: C.white },
    variants: { off: { k: C.slate, s: C.dusk, w: C.steel }, on: { k: C.green, s: C.forest, w: C.white } },
    anims: { default: [ICON_MIC] },
  },
  icon_lock: { w: 8, h: 7, legend: { k: C.ink, y: C.gold }, anims: { default: [ICON_LOCK] } },
  box: {
    w: 9, h: 9,
    legend: { k: C.ink, l: C.silver, m: C.steel, f: C.night },
    variants: {
      dark: { k: C.ink, l: C.slate, m: C.dusk, f: C.night },
      paper: { k: C.ink, l: C.white, m: C.tan, f: C.sand },
      success: { k: C.ink, l: C.green, m: C.forest, f: C.white },
      fail: { k: C.ink, l: C.silver, m: C.steel, f: C.white },
      danger: { k: C.ink, l: C.red, m: C.crimson, f: C.umber },
      button: { k: C.ink, l: C.gold, m: C.copper, f: C.brown },
      buttonHot: { k: C.ink, l: C.yellow, m: C.gold, f: C.copper },
      buttonOff: { k: C.ink, l: C.slate, m: C.dusk, f: C.night },
    },
    anims: { default: [BOX] },
  },
};
