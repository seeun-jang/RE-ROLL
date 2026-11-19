// =============================================================
// AssetLoader — 에셋 로딩 분리 지점
//
// 지금은 (1) Galmuri 웹폰트 로딩 + (2) 코드로 그린 픽셀 스프라이트(sprites.js)를 캔버스로 굽는다.
//
// ★ 나중에 실제 이미지(스프라이트 시트)로 바꾸는 방법 ★
//   1) 아래 IMAGE_MANIFEST 예시처럼 이미지 경로를 적은 객체를 만든다.
//   2) loadAssets(config, { manifest }) 로 넘기거나, IMAGE_MANIFEST 상수 자체를 채운다.
//   3) 캐릭터 시트는 SHEET_TEMPLATE_COLORS 의 '기준 색'으로 칠해 둔다.
//      → 로딩 시 기준 색을 슬롯 문자로 되돌려 읽고, 플레이어 색/팀 색으로 다시 칠한다
//        (그래서 플레이어 5명 × 팀 색 조합을 시트 한 장으로 처리할 수 있다).
//   4) 아이콘은 이미지 그대로 쓴다.
//   게임 코드는 Assets 의 character()/icon()/frameCount() 만 쓰므로, 이 파일 밖은 바꿀 필요가 없다.
//   (완전히 다른 방식이 필요하면 같은 메서드를 가진 클래스로 Assets 를 통째로 교체하면 된다.)
// =============================================================
import { PALETTE, C, TEAM_COLORS, shadeOf } from '../palette.js';
import { CHARACTER_FRAMES, CHAR_W, CHAR_H, CHAR_SLOTS, ICONS } from './sprites.js';
import { makeCanvas, renderPixelRows, flipCanvas, parseHex } from './SpriteFactory.js';
import { ANIMALS } from '../../../shared/animals.js';
import { poseFrame } from '../../../shared/chibi.js';

// ---------- 튜닝 상수 ----------
const FONT_SAMPLE_TEXT = '가A1';          // 폰트 로딩 확인용 샘플 (한글 + 영문 + 숫자 서브셋을 모두 요청)
const DEFAULT_FONT_TIMEOUT = 2500;       // config.FONT_LOAD_TIMEOUT 이 없을 때 (ms)
const IMAGE_LOAD_TIMEOUT = 5000;         // 매니페스트 이미지 하나당 최대 대기 (ms)
const CHAR_CACHE_LIMIT = 800;            // 캐릭터 캔버스 캐시 상한 (넘으면 비움 — 외부 색이 계속 바뀌는 경우 대비)
const SHEET_ALPHA_CUTOFF = 128;          // 시트 픽셀 알파가 이 값 미만이면 투명

/** 팀이 정해지지 않았을 때(side null) 머리띠 색 */
const NEUTRAL_BAND = Object.freeze({ main: PALETTE[C.WHITE], shade: PALETTE[C.SILVER] });

/** appearance 에 값이 빠졌을 때 기본 외형 */
const DEFAULT_APPEARANCE = Object.freeze({ shirt: PALETTE[C.WHITE], hair: PALETTE[C.CHARCOAL] });

/**
 * ★ 이미지 교체 지점 ★ — 기본값 null (코드 스프라이트 사용).
 * 예시:
 * {
 *   icons: { crown: './img/crown.png', speakerOn: './img/spk_on.png' },   // 일부만 적어도 됨 (나머지는 코드 아이콘)
 *   characterSheet: {
 *     url: './img/character.png',      // SHEET_TEMPLATE_COLORS 로 칠한 시트
 *     frameW: 16, frameH: 32,          // 한 칸 크기
 *     rows: { idle: 0, pull: 1, slip: 2, win: 3, fall: 4 },   // 애니메이션별 행 번호 (열 = 프레임)
 *     frames: { idle: 4, pull: 4, slip: 3, win: 4, fall: 3 }, // 생략하면 sprites.js 의 프레임 수
 *   },
 * }
 */
export const IMAGE_MANIFEST = null;

/**
 * 캐릭터 시트용 '기준 색' (슬롯마다 서로 다른 팔레트 색).
 * 시트를 이 색으로 그리면 로딩 시 슬롯 문자로 되돌려 읽는다. 실제 화면에 이 색이 그대로 나오지는 않는다.
 */
export const SHEET_TEMPLATE_COLORS = Object.freeze({
  o: PALETTE[C.INK], B: PALETTE[C.PLUM], b: PALETTE[C.RED], S: PALETTE[C.ORANGE],
  s: PALETTE[C.YELLOW], c: PALETTE[C.LIME], C: PALETTE[C.GREEN], H: PALETTE[C.TEAL],
  p: PALETTE[C.NAVY], P: PALETTE[C.BLUE], f: PALETTE[C.SKY], h: PALETTE[C.CYAN],
  w: PALETTE[C.WHITE], e: PALETTE[C.SILVER],
});

// ---------- 순수 함수 (DOM 없음 → 테스트 가능) ----------

/**
 * 외형 + 진영 → 슬롯 문자별 색(hex) 표.
 * @param {{shirt?: string, shirtShade?: string, hair?: string}} appearance
 * @param {'left'|'right'|null} side
 */
export function colorMapFor(appearance, side) {
  const a = appearance || {};
  const shirt = a.shirt || DEFAULT_APPEARANCE.shirt;
  const shirtShade = a.shirtShade || shadeOf(shirt);
  const hair = a.hair || DEFAULT_APPEARANCE.hair;
  const band = (side && TEAM_COLORS[side]) || NEUTRAL_BAND;
  return {
    o: PALETTE[C.INK],
    s: PALETTE[C.YELLOW],
    S: PALETTE[C.ORANGE],
    h: hair,
    H: shadeOf(hair),
    c: shirt,
    C: shirtShade,
    b: band.main,
    B: band.shade,
    p: PALETTE[C.CHARCOAL],
    P: PALETTE[C.INK],
    f: PALETTE[C.PLUM],
    w: PALETTE[C.WHITE],
    e: PALETTE[C.INK],
  };
}

/** 아이콘 데이터의 colors(팔레트 인덱스) → hex 조회 함수 */
function iconColorOf(icon) {
  return (ch) => {
    const idx = icon.colors[ch];
    return idx === undefined ? null : PALETTE[idx];
  };
}

/** 프로미스를 제한 시간과 경주. 시간 초과면 fallback 으로 resolve (절대 reject 하지 않음) */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, Math.max(0, ms));
    Promise.resolve(promise).then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } },
    );
  });
}

// ---------- 폰트 ----------

/** href 가 같은 <link> 가 없으면 head 에 한 번만 추가. 기존/새 link 반환 */
function ensureFontLink(doc, href) {
  let abs = href;
  try { abs = new URL(href, doc.baseURI).href; } catch (e) { /* 상대 경로 해석 실패 시 원문 비교 */ }
  const links = Array.from(doc.querySelectorAll('link'));
  const found = links.find((l) => l.getAttribute('href') === href || l.href === abs);
  if (found) return found;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-pixel-tug-font', '');
  (doc.head || doc.documentElement).appendChild(link);
  return link;
}

/** 스타일시트 로딩 완료(또는 실패)까지 대기. @font-face 규칙이 등록돼야 fonts.load 가 의미 있다 */
function waitForStylesheet(link) {
  return new Promise((resolve) => {
    if (link.sheet) { resolve(true); return; }
    const finish = (ok) => {
      link.removeEventListener('load', onLoad);
      link.removeEventListener('error', onError);
      resolve(ok);
    };
    const onLoad = () => finish(true);
    const onError = () => finish(false);
    link.addEventListener('load', onLoad);
    link.addEventListener('error', onError);
  });
}

/** config.FONTS 의 모든 글꼴을 실제로 불러온다 → 모두 성공하면 true */
async function loadFontFamilies(doc, config) {
  const url = config.FONT_CSS_URL;
  if (url) {
    const link = ensureFontLink(doc, url);
    await waitForStylesheet(link);
  }
  const fontSet = doc.fonts;
  if (!fontSet || typeof fontSet.load !== 'function') return false;
  const specs = Object.values(config.FONTS || {});
  if (specs.length === 0) return true;
  const results = await Promise.all(specs.map((f) =>
    fontSet.load(`${f.size}px "${f.family}"`, FONT_SAMPLE_TEXT).then((list) => list && list.length > 0, () => false)));
  return results.every(Boolean);
}

// ---------- 이미지 (매니페스트) ----------

function loadImage(url, ms) {
  if (typeof Image === 'undefined' || !url) return Promise.resolve(null);
  return withTimeout(new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  }), ms, null);
}

/** 매니페스트에 적힌 이미지를 모두 불러온다 (실패한 것은 null → 코드 스프라이트로 대체) */
async function loadManifestImages(manifest) {
  const images = { icons: {}, characterSheet: null };
  if (!manifest) return images;
  const jobs = [];
  for (const [name, url] of Object.entries(manifest.icons || {})) {
    jobs.push(loadImage(url, IMAGE_LOAD_TIMEOUT).then((img) => { if (img) images.icons[name] = img; }));
  }
  if (manifest.characterSheet && manifest.characterSheet.url) {
    jobs.push(loadImage(manifest.characterSheet.url, IMAGE_LOAD_TIMEOUT).then((img) => { images.characterSheet = img; }));
  }
  await Promise.all(jobs);
  return images;
}

// ---------- 공개 API ----------

/**
 * 에셋 로딩. 폰트(제한 시간 FONT_LOAD_TIMEOUT)와 매니페스트 이미지를 기다린다. 실패해도 reject 하지 않는다.
 * @param {object} config  mergeConfig() 결과
 * @param {{ manifest?: object|null }} [options]
 * @returns {Promise<Assets>}
 */
export async function loadAssets(config = {}, { manifest = IMAGE_MANIFEST } = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  const timeout = config.FONT_LOAD_TIMEOUT ?? DEFAULT_FONT_TIMEOUT;

  // 폰트: 시간 안에 끝나면 그 결과, 아니면 false 로 진행 (대체 폰트)
  let fontWork = Promise.resolve(false);
  if (doc) {
    try { fontWork = loadFontFamilies(doc, config).catch(() => false); } catch (e) { fontWork = Promise.resolve(false); }
  }
  // 이미지 (폰트 로딩과 동시에 진행)
  const images = await loadManifestImages(manifest).catch(() => null);
  const fontsReady = await withTimeout(fontWork, timeout, false);

  const assets = new Assets(config, { fontsReady, images, manifest });
  // 시간 초과 뒤에 폰트가 도착하면 표시만 갱신 (UI 는 필요하면 캐시를 비우고 다시 그린다)
  if (!fontsReady) fontWork.then((ok) => { if (ok) assets.fontsReady = true; }, () => {});
  return assets;
}

/**
 * 로딩된 에셋 묶음. 게임은 이 클래스의 메서드만 사용한다.
 * 나중에 실제 이미지(스프라이트 시트)로 바꿀 때는 이 클래스만 교체하면 된다.
 */
export class Assets {
  /**
   * @param {object} [config]
   * @param {{ fontsReady?: boolean, images?: object|null, manifest?: object|null }} [opts]
   */
  constructor(config = {}, { fontsReady = false, images = null, manifest = null } = {}) {
    this.config = config;
    this.fontsReady = !!fontsReady;
    this._images = images || { icons: {}, characterSheet: null };
    this._manifest = manifest;
    this._charCache = new Map();   // key → canvas
    this._iconCache = new Map();   // name → canvas
    this._sheetRows = new Map();   // 'anim:frame' → string[] (시트에서 읽은 슬롯 행)
  }

  /** 애니메이션 이름 정규화 (모르는 이름이면 idle) */
  _anim(anim) {
    return Object.prototype.hasOwnProperty.call(CHARACTER_FRAMES, anim) ? anim : 'idle';
  }

  /** 시트 이미지가 있으면 사용 */
  _sheet() {
    const spec = this._manifest && this._manifest.characterSheet;
    const img = this._images && this._images.characterSheet;
    return spec && img ? { spec, img } : null;
  }

  /** 애니메이션 프레임 수 */
  frameCount(anim) {
    const a = this._anim(anim);
    const sheet = this._sheet();
    if (sheet && sheet.spec.frames && Number.isInteger(sheet.spec.frames[a])) return sheet.spec.frames[a];
    return CHARACTER_FRAMES[a].length;
  }

  /** 해당 프레임의 슬롯 문자 행 (코드 데이터 또는 시트에서 읽은 것) */
  frameRows(anim, frame = 0) {
    const a = this._anim(anim);
    const n = this.frameCount(a);
    const f = Math.max(0, Math.min(n - 1, frame | 0));
    const sheet = this._sheet();
    if (sheet) {
      const key = `${a}:${f}`;
      if (!this._sheetRows.has(key)) this._sheetRows.set(key, this._readSheetFrame(sheet, a, f));
      const rows = this._sheetRows.get(key);
      if (rows) return rows;
    }
    return CHARACTER_FRAMES[a][Math.min(f, CHARACTER_FRAMES[a].length - 1)];
  }

  /** 시트의 한 칸을 읽어 기준 색 → 슬롯 문자로 되돌린다 (실패하면 null → 코드 데이터 사용) */
  _readSheetFrame({ spec, img }, anim, frame) {
    try {
      const fw = spec.frameW || CHAR_W;
      const fh = spec.frameH || CHAR_H;
      const row = spec.rows && Number.isInteger(spec.rows[anim]) ? spec.rows[anim] : null;
      if (row === null) return null;
      const cv = makeCanvas(fw, fh);
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, frame * fw, row * fh, fw, fh, 0, 0, fw, fh);
      const data = g.getImageData(0, 0, fw, fh).data;
      // 기준 색 → 슬롯 역방향 표
      const reverse = new Map();
      for (const ch of CHAR_SLOTS) {
        const rgb = parseHex(SHEET_TEMPLATE_COLORS[ch]);
        if (rgb) reverse.set((rgb[0] << 16) | (rgb[1] << 8) | rgb[2], ch);
      }
      const rows = [];
      for (let y = 0; y < fh; y++) {
        let s = '';
        for (let x = 0; x < fw; x++) {
          const i = (y * fw + x) * 4;
          if (data[i + 3] < SHEET_ALPHA_CUTOFF) { s += '.'; continue; }
          s += reverse.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) || '.';
        }
        rows.push(s);
      }
      return rows;
    } catch (e) {
      return null; // 교차 출처 이미지 등으로 픽셀을 못 읽으면 코드 스프라이트로
    }
  }

  /**
   * 캐릭터 프레임 캔버스 (16×32, 오른쪽을 바라봄). 결과는 캐시된다.
   * @param {{shirt: string, shirtShade?: string, hair: string}} appearance  hex 색
   * @param {'left'|'right'|null} side   null 이면 머리띠 흰색(WHITE/SILVER)
   * @param {string} anim                'idle'|'pull'|'slip'|'win'|'fall'
   * @param {number} frame
   * @param {boolean} [flip=false]       (선택) true 면 좌우 반전본 — 반전본도 캐시된다
   */
  character(appearance, side, anim, frame = 0, flip = false) {
    const a = this._anim(anim);
    const n = this.frameCount(a);
    const f = Math.max(0, Math.min(n - 1, frame | 0));
    const ap = appearance || {};
    const s = side === 'left' || side === 'right' ? side : null;
    const key = `${ap.animal || ''}|${ap.shirt || ''}|${ap.shirtShade || ''}|${ap.hair || ''}|${s}|${a}|${f}|${flip ? 1 : 0}`;
    const hit = this._charCache.get(key);
    if (hit) return hit;
    if (this._charCache.size >= CHAR_CACHE_LIMIT) this._charCache.clear();

    let canvas;
    if (flip) {
      canvas = flipCanvas(this.character(appearance, s, a, f, false));
    } else {
      const colors = colorMapFor(ap, s);
      const animal = ap.animal ? ANIMALS[ap.animal] : null;
      if (animal) {
        // 동물 캐릭터: 기본 그림을 동작에 맞게 변형한 것을 그 캐릭터의 색으로 칠한다
        canvas = renderPixelRows(poseFrame(animal, a, f), (ch) => animal.palette[ch] || null);
      } else {
        canvas = renderPixelRows(this.frameRows(a, f), (ch) => colors[ch] || null);
      }
    }
    this._charCache.set(key, canvas);
    return canvas;
  }

  /**
   * 아이콘 캔버스 ('crown','speakerOn','speakerOff','star','flag'). 모르는 이름이면 null.
   * 매니페스트에 이미지가 있으면 그것을 쓴다.
   */
  icon(name) {
    if (this._iconCache.has(name)) return this._iconCache.get(name);
    let canvas = null;
    const img = this._images && this._images.icons && this._images.icons[name];
    if (img) {
      canvas = makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
      const g = canvas.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0);
    } else if (Object.prototype.hasOwnProperty.call(ICONS, name)) {
      canvas = renderPixelRows(ICONS[name].rows, iconColorOf(ICONS[name]));
    }
    this._iconCache.set(name, canvas);
    return canvas;
  }

  /** 캐시 비우기 (색 설정이 크게 바뀌었을 때 등) */
  clearCache() {
    this._charCache.clear();
    this._iconCache.clear();
    this._sheetRows.clear();
  }
}
