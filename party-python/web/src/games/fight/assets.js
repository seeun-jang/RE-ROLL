// =====================================================
// 그림 · 글꼴 파일 주소 (빌드 도구가 찾을 수 있게 파일마다 한 줄씩 적는다)
// =====================================================
const urls = () => ({
  bear: new URL('./assets/characters/bear.png', import.meta.url),
  'bear-mini': new URL('./assets/characters/bear-mini.png', import.meta.url),
  cat: new URL('./assets/characters/cat.png', import.meta.url),
  'cat-mini': new URL('./assets/characters/cat-mini.png', import.meta.url),
  duck: new URL('./assets/characters/duck.png', import.meta.url),
  'duck-mini': new URL('./assets/characters/duck-mini.png', import.meta.url),
  tiger: new URL('./assets/characters/tiger.png', import.meta.url),
  'tiger-mini': new URL('./assets/characters/tiger-mini.png', import.meta.url),
  shiba: new URL('./assets/characters/shiba.png', import.meta.url),
  'shiba-mini': new URL('./assets/characters/shiba-mini.png', import.meta.url),
  croupier: new URL('./assets/characters/croupier.png', import.meta.url),
  bouncer: new URL('./assets/characters/bouncer.png', import.meta.url),
});

let cache = null;

/** 캐릭터 그림 주소 (name = bear, bear-mini, bouncer …) */
export function imageUrl(name) {
  if (!cache) cache = urls();
  return cache[name] ? cache[name].href : '';
}

/** 굵은 Galmuri11 글꼴 주소 (보통 굵기 Galmuri9/11/14 는 페이지의 fonts.css 가 이미 불러온다) */
export function boldFontUrl() {
  return new URL('./assets/fonts/Galmuri11-Bold.woff2', import.meta.url).href;
}
