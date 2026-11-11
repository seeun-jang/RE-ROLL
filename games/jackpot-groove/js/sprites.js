// =====================================================
// 그래픽 에셋
//  - 캐릭터·딜러·경호원: 보내준 도트 그림에서 추출한 PNG (assets/characters/*.png)
//    → 그림을 바꾸려면 같은 이름의 PNG 파일만 교체하면 됨
//  - 칩 노트·키캡·무대: 코드로 직접 그린 도트
//  - 왕관·별 등 작은 소품: 문자열 픽셀 아트 (1글자 = 1픽셀, '.' = 투명)
// =====================================================

// ---- 캐릭터 PNG 불러오기 ----
const CHARACTER_IMAGE_DIR = 'assets/characters/';
const EXTRA_CHARACTER_IMAGES = ['croupier'];
const IMG = {};

function loadCharacterImages() {
  const names = [...CHARACTERS.map((c) => c.sprite), ...EXTRA_CHARACTER_IMAGES];
  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve) => {
          const im = new Image();
          im.onload = () => {
            IMG[name] = im;
            resolve();
          };
          im.onerror = () => {
            console.warn('캐릭터 이미지를 불러오지 못함:', name);
            resolve();
          };
          im.src = CHARACTER_IMAGE_DIR + name + '.png';
        })
    )
  );
}

// 이미지 → 캔버스 (못 불러왔으면 물음표 상자로 대체)
function imageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img ? img.width : 24;
  c.height = img ? img.height : 32;
  const g = c.getContext('2d');
  if (img) g.drawImage(img, 0, 0);
  else {
    g.fillStyle = PALETTE.i;
    g.fillRect(0, 0, c.width, c.height);
    BitmapFont.draw(g, '?', 11, 13, PALETTE.b);
  }
  return c;
}

// 대기 모션 2번째 프레임: 윗몸을 1px 눌러서 숨 쉬는 느낌
function buildBreath(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  const cut = Math.floor(src.height * 0.55);
  g.drawImage(src, 0, cut, src.width, src.height - cut, 0, cut, src.width, src.height - cut);
  g.drawImage(src, 0, 0, src.width, cut, 0, 1, src.width, cut);
  return c;
}

// 좁은 곳(결과표 등)에 쓰는 상반신
function buildPortrait(src, h = 22) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = Math.min(h, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
const ART = {
  crown: [
    '9.9.9',
    '99999',
    '98989',
  ],
  star: [
    '..9..',
    '.999.',
    '99999',
    '.9.9.',
    '9...9',
  ],
  // 음표
  note: [
    '...111',
    '...1a1',
    '...1a1',
    '.111a1',
    '1aaaa1',
    '1aaa1.',
    '.111..',
  ],
  // 반짝이
  sparkle: [
    '..b..',
    '..b..',
    'bbbbb',
    '..b..',
    '..b..',
  ],
};

// 레인 색 (왼쪽 빨강 칩 / 가운데 금색 칩 / 오른쪽 파랑 칩) — 하이라이트, 몸통, 그림자
const LANE_COLORS = [
  { hi: '5', body: '6', dark: '7', glow: 'p' },
  { hi: 't', body: '9', dark: '8', glow: 'a' },
  { hi: 'h', body: 'g', dark: 'f', glow: 'h' },
];

// 문자열 배열 → 캔버스 (swap 으로 색 치환)
function buildSprite(rows, swap = {}) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      let ch = row[x];
      if (swap[ch]) ch = swap[ch];
      if (ch === '.' || ch === ' ' || !PALETTE[ch]) continue;
      g.fillStyle = PALETTE[ch];
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

// 단색 실루엣 (번쩍임, 회색 대기 등)
function buildFlash(src, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

const SPR = {};

// 카지노 칩 모양 노트 (위에서 비스듬히 본 모양, 가장자리 흰 줄무늬)
function buildChip(w, h, lc, stripe = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const px = (x, y, ww, hh, k) => {
    g.fillStyle = C(k);
    g.fillRect(x, y, ww, hh);
  };
  // 외곽선 (모서리를 2칸 깎아 둥글게)
  px(2, 0, w - 4, h, '1');
  px(1, 1, w - 2, h - 2, '1');
  px(0, 2, w, h - 4, '1');
  // 윗면 / 옆면
  const top = Math.ceil(h * 0.55);
  px(2, 1, w - 4, top - 1, lc.body);
  px(1, 2, w - 2, top - 2, lc.body);
  px(3, 1, w - 6, 1, lc.hi);
  px(1, top, w - 2, h - top - 2, lc.dark);
  px(2, h - 2, w - 4, 1, lc.dark);
  // 흰 줄무늬 (칩 테두리 무늬)
  for (const fx of [0.25, 0.75]) {
    const x = Math.round(w * fx - stripe / 2);
    px(x, 1, stripe, h - 2, 'b');
  }
  // 윗면 가운데 동그라미
  px(Math.round(w / 2) - 1, 2, 2, Math.max(1, top - 3), lc.hi);
  return c;
}

// 판정선 키캡 (key: 표시 글자) — 평소 / 눌림
//  밝은 크림색 키 위에 진한 글씨 (어두운 배경에서도 또렷하게)
const KEY_GLYPH = { '<': '←', '^': '↑', '>': '→' };
function buildKeycap(w, h, lc, key, pressed) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + 2;
  const g = c.getContext('2d');
  const px = (x, y, ww, hh, k) => {
    g.fillStyle = C(k);
    g.fillRect(x, y, ww, hh);
  };
  const dy = pressed ? 2 : 0;
  // 키 두께 (아래쪽, 레인 색)
  px(1, 2, w - 2, h, '1');
  px(1, h - 1, w - 2, 2, lc.dark);
  // 키 윗면
  px(1, dy, w - 2, h, '1');
  px(0, dy + 1, w, h - 2, '1');
  px(1, dy + 1, w - 2, h - 2, pressed ? lc.hi : 'a');
  px(2, dy + 1, w - 4, 1, pressed ? 'b' : 'b');
  // 아래 테두리 = 레인 색 (왼쪽 빨강 / 가운데 금색 / 오른쪽 파랑)
  px(1, dy + h - 3, w - 2, 2, lc.body);
  // 글자: 굵은 픽셀 글꼴, 진한 색
  const label = KEY_GLYPH[key] || key;
  const tw = KText.width(label, 'b');
  const img = KText.get(label, PALETTE['1'], 'b');
  // 글자 맨 윗줄이 키 테두리에 가려지지 않게 윗면 안쪽(1px 아래)부터
  g.drawImage(img, Math.round((w - tw) / 2) - 1, dy + (h >= 17 ? 2 : 1));
  return c;
}

function initSprites() {
  SPR.players = CHARACTERS.map((ch) => {
    const base = imageToCanvas(IMG[ch.sprite]);
    return {
      frames: [base, buildBreath(base)],
      flash: buildFlash(base),
      gold: buildFlash(base, PALETTE['9']),
      ghost: buildFlash(base, PALETTE.i),
      portrait: buildPortrait(base),
    };
  });
  const croupier = imageToCanvas(IMG.croupier);
  SPR.croupier = [croupier, buildBreath(croupier)];
  // 노트: 작은 칩 (함께 모드) / 큰 칩 (개인 화면)
  SPR.chips = {
    small: LANE_COLORS.map((lc) => buildChip(14, 7, lc, 1)),
    big: LANE_COLORS.map((lc) => buildChip(26, 9, lc, 2)),
  };
  SPR.chipFlash = {
    small: buildFlash(SPR.chips.small[0], PALETTE.b),
    big: buildFlash(SPR.chips.big[0], PALETTE.b),
  };
  SPR.crown = buildSprite(ART.crown);
  SPR.star = buildSprite(ART.star);
  SPR.note = buildSprite(ART.note);
  SPR.sparkle = buildSprite(ART.sparkle);
}

// 키캡은 글자(키 이름)마다 달라서 필요할 때 만들어 캐시
const KEYCAP_CACHE = new Map();
function getKeycap(size, lane, key, pressed) {
  const id = [size, lane, key, pressed].join('|');
  if (!KEYCAP_CACHE.has(id)) {
    const big = size === 'big';
    KEYCAP_CACHE.set(id, buildKeycap(big ? 26 : 15, big ? 17 : 16, LANE_COLORS[lane], key, pressed));
  }
  return KEYCAP_CACHE.get(id);
}

// 정수 좌표로 중앙 정렬해서 그리기 (서브픽셀 방지)
function drawSprite(ctx, img, cx, cy) {
  ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2));
}

// 발 위치(아래 가운데)를 기준으로 서 있게 그리기
function drawStanding(ctx, img, cx, by, squash = 0) {
  const h = img.height + squash;
  const w = img.width - squash;
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(by - h), w, h);
}

// 스쿼시 & 스트레치 (위아래로 1~3px 늘이고 줄임)
function drawSquash(ctx, img, cx, cy, sy) {
  const h = img.height + sy;
  const w = img.width - sy;
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
}
