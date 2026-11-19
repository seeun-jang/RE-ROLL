// =============================================================
// AssetLoader.js — 에셋 로딩을 한곳에 모은 계층
//   기본: 코드로 그린 픽셀 아트(SpriteFactory) + Galmuri 폰트
//   교체: options.assets.fighterSheets 로 PNG 스프라이트 시트를 넘기면 해당 룩만 이미지로 대체
//
//   fighterSheets 형식 예)
//   {
//     p1: {
//       url: 'img/p1.png',            // 오른쪽을 바라보는 원본 시트
//       frames: {                     // 애니메이션 이름 → 프레임 사각형 목록
//         idle: [{ x: 0, y: 0, w: 16, h: 32, ax: 6, ay: 32 }, ...],
//         push: [...], charge: [...], feint: [...], hold: [...], stagger: [...],
//         fallFwd: [...], fallBack: [...], wet: [...], win: [...]
//       }
//     }
//   }
//   시트에 없는 애니메이션은 코드 생성 스프라이트를 그대로 쓴다.
// =============================================================
import { createFighterSprites } from './SpriteFactory.js';
import { LOOKS } from './sprites.js';
import { loadFonts } from '../ui/PixelFont.js';
import { ANIMALS } from '../../../shared/animals.js';
import { createAnimalSprites } from '../net/animalSprites.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${url}`));
    img.src = url;
  });
}

// 시트에서 한 프레임 잘라내기
function cropFrame(img, r) {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return { canvas: c, w: r.w, h: r.h, ax: r.ax ?? 6, ay: r.ay ?? r.h };
}

// 좌우 반전 프레임 (왼쪽을 바라봄)
export function mirrorFrame(f) {
  const c = document.createElement('canvas');
  c.width = f.w;
  c.height = f.h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.translate(f.w, 0);
  g.scale(-1, 1);
  g.drawImage(f.canvas, 0, 0);
  return { canvas: c, w: f.w, h: f.h, ax: f.w - f.ax, ay: f.ay };
}

// 흰색(또는 지정 색) 실루엣 — 맞았을 때 번쩍임 연출용. 원본 캔버스별로 캐시
const silhouetteCache = new WeakMap();
export function silhouette(canvas, color) {
  let byColor = silhouetteCache.get(canvas);
  if (!byColor) {
    byColor = new Map();
    silhouetteCache.set(canvas, byColor);
  }
  let s = byColor.get(color);
  if (!s) {
    s = document.createElement('canvas');
    s.width = canvas.width;
    s.height = canvas.height;
    const g = s.getContext('2d');
    g.drawImage(canvas, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, s.width, s.height);
    byColor.set(color, s);
  }
  return s;
}

export class Assets {
  constructor() {
    this.fontsOk = false;
    this.fighterCache = new Map();
    this.overrides = {}; // lookId → { right: Anims(부분) }
  }

  get looks() {
    return LOOKS;
  }

  // 캐릭터를 나타내는 색 (이름표·게이지)
  uiColor(lookId) {
    if (ANIMALS[lookId]) return ANIMALS[lookId].color;
    return LOOKS[lookId] ? LOOKS[lookId].uiColor : '#f4f4f4';
  }
  // 룩 하나의 SpriteSet (오버라이드가 있으면 덮어씀)
  fighter(lookId) {
    let set = this.fighterCache.get(lookId);
    if (set) return set;
    // 동물 캐릭터(shared/animals.js)면 그 그림으로 만든 동작 세트를 쓴다
    if (ANIMALS[lookId]) {
      set = createAnimalSprites(lookId);
      this.fighterCache.set(lookId, set);
      return set;
    }
    const base = createFighterSprites(lookId);
    const ov = this.overrides[lookId];
    if (ov) {
      const right = { ...base.right };
      const left = { ...base.left };
      for (const anim of Object.keys(ov)) {
        right[anim] = ov[anim];
        left[anim] = ov[anim].map(mirrorFrame);
      }
      set = { ...base, right, left };
    } else {
      set = base;
    }
    this.fighterCache.set(lookId, set);
    return set;
  }
}

/**
 * 모든 에셋 준비
 * @param {object} o { cfg, assets: { fighterSheets } }
 * @returns {Promise<Assets>}
 */
export async function loadAssets({ cfg, assets = {} } = {}) {
  const out = new Assets();
  const tasks = [];
  tasks.push(
    loadFonts({ cssUrl: cfg.FONT.CSS_URL, timeoutMs: cfg.FONT.LOAD_TIMEOUT_MS })
      .then((ok) => {
        out.fontsOk = ok;
      })
      .catch(() => {
        out.fontsOk = false;
      }),
  );
  const sheets = assets.fighterSheets || {};
  for (const lookId of Object.keys(sheets)) {
    const sheet = sheets[lookId];
    tasks.push(
      loadImage(sheet.url)
        .then((img) => {
          const anims = {};
          for (const anim of Object.keys(sheet.frames || {})) {
            anims[anim] = sheet.frames[anim].map((r) => cropFrame(img, r));
          }
          out.overrides[lookId] = anims;
        })
        .catch((err) => {
          // 이미지가 없으면 코드 생성 스프라이트로 계속 진행
          console.warn('[palm-push]', err.message);
        }),
    );
  }
  await Promise.all(tasks);
  // 동물 캐릭터는 미리 만들어 둔다 (첫 대결 시작 때 끊김 방지)
  for (const id of Object.keys(ANIMALS)) out.fighter(id);
  return out;
}
