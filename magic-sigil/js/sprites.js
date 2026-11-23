// =====================================================
// 그래픽 에셋
//  - 캐릭터·딜러·경호원: 보내준 도트 그림에서 추출한 PNG (assets/characters/*.png)
//    → 그림을 바꾸려면 같은 이름의 PNG 파일만 교체하면 됨
//  - 스케치북·펜·키캡: 코드로 직접 그린 도트 / 얼굴 아이콘은 절반 크기 PNG(<이름>-mini.png)로 만듦
//  - 왕관·별 등 작은 소품: 문자열 픽셀 아트 (1글자 = 1픽셀, '.' = 투명)
// =====================================================

// ---- 캐릭터 PNG 불러오기 ----
const CHARACTER_IMAGE_DIR = 'assets/characters/';
const EXTRA_CHARACTER_IMAGES = ['croupier'];
const IMG = {};

function loadCharacterImages() {
  // 절반 크기 그림(<이름>-mini.png)도 함께 (좁은 칸에서 오르기용)
  const names = [...CHARACTERS.map((c) => c.sprite), ...CHARACTERS.map((c) => c.sprite + '-mini'), ...EXTRA_CHARACTER_IMAGES];
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
  // 심판 깃발 (X: 깃발 색, S: 그림자)
  flag: [
    '1.........',
    'm11111111.',
    'mXXXXXXXX1',
    'mXXXXXXXX1',
    'mXXXXXXXS1',
    'mXXXXXXSS1',
    'mXXXXXSSS1',
    'm11111111.',
    'm.........',
    'm.........',
    'm.........',
  ],
};

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

function initSprites() {
  SPR.players = CHARACTERS.map((ch) => {
    const base = imageToCanvas(IMG[ch.sprite]);
    return {
      frames: [base, buildBreath(base)],
      flash: buildFlash(base),
      ghost: buildFlash(base, PALETTE.i),
      portrait: buildPortrait(base),
      mini: imageToCanvas(IMG[ch.sprite + '-mini']),
    };
  });
  SPR.players.forEach((sp) => {
    sp.miniFlash = buildFlash(sp.mini, PALETTE.b);
    sp.face = buildFace(sp.mini);
  });
  const croupier = imageToCanvas(IMG.croupier);
  SPR.croupier = [croupier, buildBreath(croupier)];
  SPR.flags = {
    red: buildSprite(ART.flag, { X: '6', S: '7' }),
    white: buildSprite(ART.flag, { X: 'b', S: 'k' }),
  };
  SPR.crown = buildSprite(ART.crown);
  SPR.star = buildSprite(ART.star);
}

// ---- 조작키 키캡 ----
// 밝은 크림색 키 위에 진한 굵은 글씨 (어두운 배경에서도 또렷하게)
// tone: 키 아래 테두리 색 (뒤/막기 = 파랑, 치기 = 금색, 앞 = 빨강)
const KEY_TONES = {
  back: { body: 'g', dark: 'f', hi: 'h' },
  strike: { body: '9', dark: '8', hi: 't' },
  fwd: { body: '6', dark: '7', hi: '5' },
  plain: { body: 'j', dark: 'i', hi: 'k' },
};
const KEY_GLYPH = { '<': '←', '^': '↑', '>': '→' };

function buildKeycap(w, h, tone, key, pressed) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h + 2;
  const g = c.getContext('2d');
  const px = (x, y, ww, hh, k) => {
    g.fillStyle = C(k);
    g.fillRect(x, y, ww, hh);
  };
  const dy = pressed ? 2 : 0;
  // 키 두께 (아래쪽)
  px(1, 2, w - 2, h, '1');
  px(1, h - 1, w - 2, 2, tone.dark);
  // 키 윗면
  px(1, dy, w - 2, h, '1');
  px(0, dy + 1, w, h - 2, '1');
  px(1, dy + 1, w - 2, h - 2, pressed ? tone.hi : 'a');
  px(2, dy + 1, w - 4, 1, 'b');
  px(1, dy + h - 3, w - 2, 2, tone.body);
  // 글자 (맨 윗줄이 테두리에 가려지지 않게 1px 아래부터)
  const label = KEY_GLYPH[key] || key;
  const tw = KText.width(label, 'b');
  g.drawImage(KText.get(label, PALETTE['1'], 'b'), Math.round((w - tw) / 2) - 1, dy + 2);
  return c;
}

// 키캡은 글자마다 달라서 필요할 때 만들어 캐시 (너비는 글자 길이에 맞춤)
const KEYCAP_CACHE = new Map();
function getKeycap(key, toneName, pressed) {
  const id = [key, toneName, pressed].join('|');
  if (!KEYCAP_CACHE.has(id)) {
    const label = KEY_GLYPH[key] || key;
    const w = Math.max(15, KText.width(label, 'b') + 8);
    KEYCAP_CACHE.set(id, buildKeycap(w, 18, KEY_TONES[toneName] || KEY_TONES.plain, key, pressed));
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

// 픽셀 직선 (죽도 등) — 정수 좌표로 한 칸씩 찍음
function drawPixelLine(ctx, x0, y0, x1, y1, color, thick = 1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x0, y0, thick, thick);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// 절반 크기 캐릭터는 assets/characters/<이름>-mini.png (원본 PNG 를 줄여 미리 만들어 둠)
//  → 파일을 더블클릭해서 열어도(file://) 브라우저 보안에 걸리지 않음

// ---- 동그란 얼굴 아이콘 (이름표용, 16x16) ----
//  픽셀을 읽지 않고 그리기만 해서 만듦 (file:// 에서도 동작)
function buildFace(mini) {
  const S = 16;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = PALETTE.w;
  g.fillRect(0, 0, S, S);
  g.drawImage(mini, Math.round(S / 2 - mini.width / 2), 0);
  // 픽셀 동그라미 모양만 남기기 (안티앨리어싱 없이 한 줄씩)
  //  (동그라미 마스크를 따로 그린 뒤 한 번에 잘라냄)
  const mask = document.createElement('canvas');
  mask.width = S;
  mask.height = S;
  const mg = mask.getContext('2d');
  mg.fillStyle = '#000';
  const r = S / 2 - 0.5;
  for (let y = 0; y < S; y++) {
    const dy = y + 0.5 - S / 2;
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    if (half > 0) mg.fillRect(S / 2 - half, y, half * 2, 1);
  }
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = 'source-over';
  // 테두리
  const out = document.createElement('canvas');
  out.width = S + 2;
  out.height = S + 2;
  const og = out.getContext('2d');
  const ring = buildFlash(c, PALETTE['1']);
  og.drawImage(ring, 0, 1);
  og.drawImage(ring, 2, 1);
  og.drawImage(ring, 1, 0);
  og.drawImage(ring, 1, 2);
  og.drawImage(c, 1, 1);
  return out;
}
