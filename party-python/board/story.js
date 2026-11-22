// =============================================================
// 스토리보드 2 · 6 · 7번의 그림: 인트로 영상, 굿엔딩, 배드엔딩
//
// 영상 파일(assets/intro.mp4)이 있으면 그 영상을 틀고, 없으면 아래 장면 4개를 차례로 보여 준다.
// 장면은 320×200 캔버스에 사각형 · 원으로 그린 뒤 3배로 키운다(보드판과 같은 도트 느낌).
// =============================================================
import { CHARACTERS } from './shared/rules.js';

const W = 320, H = 200;
const sprites = CHARACTERS.map((c) => { const i = new Image(); i.src = `assets/characters/${c.sprite}.png`; return i; });

// ---------------- 그리기 도구 ----------------
const rect = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
function sky(g, colors) {
  const band = Math.ceil(H / colors.length);
  colors.forEach((c, i) => rect(g, 0, i * band, W, band, c));
}
function hill(g, cx, cy, rx, ry, c) {
  g.fillStyle = c; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
}
function cloud(g, x, y, c = '#ffffff') {
  for (const [dx, dy, r] of [[0, 0, 9], [10, -4, 11], [22, 0, 9], [11, 3, 10]]) hill(g, x + dx, y + dy, r, r * 0.7, c);
}
function house(g, x, y, wall, roof, lit = true) {
  rect(g, x, y, 26, 18, wall);
  g.fillStyle = roof; g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x + 13, y - 13); g.lineTo(x + 30, y); g.fill();
  rect(g, x + 10, y + 8, 6, 10, '#6e4426');
  rect(g, x + 3, y + 4, 5, 5, lit ? '#ffe98a' : '#3b2f55');
  rect(g, x + 18, y + 4, 5, 5, lit ? '#ffe98a' : '#3b2f55');
}
function windmill(g, x, y, t, body = '#f6e3b8') {
  g.fillStyle = body; g.beginPath(); g.moveTo(x - 8, y); g.lineTo(x - 5, y - 30); g.lineTo(x + 5, y - 30); g.lineTo(x + 8, y); g.fill();
  rect(g, x - 2, y - 9, 4, 9, '#6e4426');
  g.save(); g.translate(x, y - 30); g.rotate(t * 1.2);
  for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); rect(g, -1.5, 0, 3, 20, '#a0683a'); rect(g, 1, 6, 5, 13, '#fff4dc'); }
  g.restore();
}
function castle(g, x, y, c1, c2, win) {
  rect(g, x, y - 34, 60, 34, c1);
  for (const tx of [x - 8, x + 22, x + 52]) {
    const tall = tx === x + 22 ? 62 : 46;
    rect(g, tx, y - tall, 16, tall, c2);
    g.fillStyle = '#b13e53'; g.beginPath(); g.moveTo(tx - 3, y - tall); g.lineTo(tx + 8, y - tall - 16); g.lineTo(tx + 19, y - tall); g.fill();
    rect(g, tx + 6, y - tall + 8, 4, 7, win);
  }
  rect(g, x + 24, y - 14, 12, 14, '#2b2140');
}
function person(g, x, y, shirt, skin = '#f4c9a0') {
  rect(g, x, y - 9, 6, 9, shirt); rect(g, x + 1, y - 14, 4, 5, skin); rect(g, x, y - 16, 6, 3, '#6e4426');
}
function tiles(g, points) {
  const colors = ['#4f8ff7', '#f2545b', '#ffcd4a', '#5cc449', '#b77be8'];
  points.forEach(([x, y], i) => { rect(g, x - 6, y - 3, 12, 7, '#2b2140'); rect(g, x - 5, y - 3, 10, 5, colors[i % colors.length]); });
}
function guardians(g, t, baseY, scale = 1) {
  g.imageSmoothingEnabled = false;
  sprites.forEach((img, i) => {
    if (!img.naturalWidth) return;
    const hop = Math.abs(Math.sin(t * 4 + i * 1.3)) * 5;
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    g.drawImage(img, Math.round(42 + i * 52 + (38 - img.naturalWidth) / 2 * scale), Math.round(baseY - h - hop), w, h);
  });
}
function sparkles(g, t, colors, n = 24) {
  for (let i = 0; i < n; i++) {
    const x = (i * 53 + Math.sin(t + i) * 8) % W, y = ((i * 37 + t * (18 + (i % 5) * 6)) % (H - 40));
    rect(g, x, y, 2, 2, colors[i % colors.length]);
  }
}

// ---------------- 장면 ----------------
function village(g, t, mood = 'day') {
  const night = mood === 'curse';
  sky(g, night ? ['#1d1433', '#2b1d4a', '#412a66', '#5b3a82'] : ['#58b4f5', '#74c4f8', '#92d4fb', '#bcebfd']);
  if (!night) { hill(g, 268, 36, 15, 15, '#fff2a8'); cloud(g, 40, 38); cloud(g, 150, 26); cloud(g, 225, 60); }
  hill(g, 70, 190, 150, 70, night ? '#3d5a4a' : '#7ed65f');
  hill(g, 250, 200, 160, 78, night ? '#32503f' : '#5cc449');
  rect(g, 0, 172, W, 28, night ? '#284235' : '#4bb03c');
  windmill(g, 250, 150, night ? 0 : t, night ? '#b9a7c9' : '#f6e3b8');
  house(g, 44, 150, night ? '#8f7da6' : '#fff4dc', night ? '#5b3a82' : '#f2545b', !night);
  house(g, 98, 160, night ? '#8f7da6' : '#ffe0b0', night ? '#5b3a82' : '#4f8ff7', !night);
  house(g, 168, 152, night ? '#8f7da6' : '#fff4dc', night ? '#5b3a82' : '#ffb54a', !night);
}
const SCENES = [
  { title: '평화로운 마을', ground: '#4bb03c', text: '주사위 놀이를 사랑하는 평화로운 마을이 있었어요.',
    draw(g, t) {
      village(g, t);
      [[30, '#f2545b'], [84, '#4f8ff7'], [140, '#ffcd4a'], [206, '#5cc449'], [286, '#b77be8']].forEach(([x, c], i) => person(g, x, 186 - Math.abs(Math.sin(t * 3 + i)) * 3, c));
    } },
  { title: '저주의 발생', ground: '#284235', text: '어느 날, 심술궂은 마법사가 마을에 저주를 걸었어요. 사람들이 모두 동물로 변해 버렸죠!',
    draw(g, t) {
      village(g, t, 'curse');
      // 저주 구름 + 번쩍이는 눈
      for (const [dx, dy, r] of [[0, 0, 34], [38, -8, 40], [80, 2, 32], [40, 16, 38]]) hill(g, 120 + dx, 54 + dy + Math.sin(t * 2) * 2, r, r * 0.62, '#2a123f');
      const blink = Math.sin(t * 5) > -0.85;
      if (blink) { rect(g, 140, 50, 12, 6, '#ff5ad1'); rect(g, 170, 50, 12, 6, '#ff5ad1'); rect(g, 144, 52, 4, 3, '#fff'); rect(g, 174, 52, 4, 3, '#fff'); }
      rect(g, 150, 68, 24, 3, '#ff5ad1');
      if (Math.floor(t * 3) % 4 === 0) { g.strokeStyle = '#fff2a8'; g.lineWidth = 2; g.beginPath(); g.moveTo(200, 80); g.lineTo(190, 110); g.lineTo(202, 112); g.lineTo(186, 150); g.stroke(); }
      sparkles(g, t, ['#c77dff', '#ff5ad1', '#7b4dd6'], 30);
    } },
  { title: '동물 수호자들의 등장', ground: '#4bb03c', text: '그때, 동물이 된 다섯 수호자가 저주를 풀기 위해 나섰어요.',
    draw(g, t) {
      sky(g, ['#58b4f5', '#74c4f8', '#92d4fb', '#bcebfd']);
      cloud(g, 30, 34); cloud(g, 240, 44);
      for (let i = 0; i < 12; i++) { g.save(); g.translate(160, 150); g.rotate(i * Math.PI / 6 + t * 0.3); rect(g, -6, -220, 12, 220, 'rgba(255,255,255,.22)'); g.restore(); }
      hill(g, 160, 215, 230, 70, '#5cc449'); rect(g, 0, 176, W, 24, '#4bb03c');
      guardians(g, t, 178, 1.6);
      sparkles(g, t, ['#ffcd4a', '#ffffff', '#ffe98a'], 18);
    } },
  { title: '마법사의 성으로!', ground: '#2e4f3e', text: '주사위 길을 지나 마법사의 성으로! 점수를 모아 마법사에게 도전하세요.',
    draw(g, t) {
      sky(g, ['#231743', '#33205c', '#4a2f7c', '#6a4aa3']);
      for (let i = 0; i < 26; i++) if ((Math.floor(t * 2) + i) % 5) rect(g, (i * 71) % W, (i * 43) % 100, 1, 1, '#fff');
      hill(g, 268, 30, 13, 13, '#f4efff');
      hill(g, 236, 208, 120, 96, '#3a2a63');
      castle(g, 206, 118, '#5b4691', '#6f58ad', Math.sin(t * 4) > 0 ? '#ffe98a' : '#ffcd4a');
      hill(g, 40, 220, 130, 60, '#2e4f3e');
      tiles(g, [[22, 178], [48, 170], [76, 164], [104, 160], [132, 154], [158, 146], [182, 136], [204, 126]]);
      const step = Math.floor(t * 2) % 8, p = [[22, 178], [48, 170], [76, 164], [104, 160], [132, 154], [158, 146], [182, 136], [204, 126]][step];
      const img = sprites[step % sprites.length];
      if (img.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(img, p[0] - 9, p[1] - 26, img.naturalWidth * 0.55, img.naturalHeight * 0.55); }
    } },
];

/** 굿엔딩: 저주가 풀린 마을 — 사람들이 돌아오고 수호자들이 기뻐한다 */
export function drawGoodEnding(g, t) {
  village(g, t);
  [[18, '#f2545b'], [300, '#4f8ff7'], [8, '#ffcd4a'], [288, '#5cc449'], [310, '#b77be8'], [30, '#4f8ff7']].forEach(([x, c], i) => person(g, x, 190 - Math.abs(Math.sin(t * 5 + i)) * 5, c));
  guardians(g, t, 184, 1.05);
  sparkles(g, t, ['#f2545b', '#ffcd4a', '#4f8ff7', '#5cc449', '#ffffff'], 46);   // 색종이
}
/** 배드엔딩: 마법사의 성 — 수정 구슬에 수호자들이 비친다 */
export function drawBadEnding(g, t) {
  sky(g, ['#150d2b', '#1e1340', '#2a1b55', '#38256b']);
  for (let i = 0; i < 20; i++) if ((Math.floor(t * 2) + i) % 4) rect(g, (i * 67) % W, (i * 31) % 90, 1, 1, '#cbb8ff');
  rect(g, 0, 150, W, 50, '#22163f');
  for (let i = 0; i < 4; i++) { rect(g, 16 + i * 14, 150 - 28 - (i % 2) * 6, 11, 34, ['#6e4426', '#7b4dd6', '#b13e53', '#3a6ea5'][i]); }   // 책 더미
  hill(g, 250, 132, 30, 30, '#5a3fa8'); hill(g, 250, 132, 26, 26, `rgba(160,120,255,${0.55 + Math.sin(t * 3) * 0.2})`);   // 수정 구슬
  rect(g, 232, 158, 36, 6, '#a0683a');
  g.imageSmoothingEnabled = false;
  sprites.slice(0, 3).forEach((img, i) => { if (img.naturalWidth) { g.globalAlpha = 0.75; g.drawImage(img, 232 + i * 12, 122, img.naturalWidth * 0.4, img.naturalHeight * 0.4); g.globalAlpha = 1; } });
  sparkles(g, t, ['#7b4dd6', '#c77dff'], 14);
}

// ---------------- 캔버스에 계속 그리기 ----------------
/** canvas 에 draw(g, 초) 를 매 프레임 그린다. 돌려준 함수를 부르면 멈춘다. */
export function animate(canvas, draw) {
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const t0 = performance.now();
  let id = 0, on = true;
  const frame = (now) => { if (!on) return; draw(g, (now - t0) / 1000); id = requestAnimationFrame(frame); };
  draw(g, 0);   // 창이 가려져 있어도 첫 장면은 바로 보이게
  id = requestAnimationFrame(frame);
  return () => { on = false; cancelAnimationFrame(id); };
}

// ---------------- 인트로 ----------------
const SCENE_MS = 4200;
const LIFT = 34;   // 인트로 그림을 위로 올리는 높이

// 영상 파일(assets/intro.mp4)은 페이지가 열릴 때 미리 통째로 받아 둔다.
// 재생하면서 조금씩 받아 오면 중간에 끊길 수 있어서, 다 받은 뒤 메모리에 있는 것을 튼다.
// 파일이 없으면 null → 그림 4장으로 대신한다.
const film = fetch('assets/intro.mp4')
  .then((r) => (r.ok && (r.headers.get('content-type') || '').startsWith('video') ? r.blob() : null))
  .then((blob) => (blob ? URL.createObjectURL(blob) : null))
  .catch(() => null);

/**
 * 인트로를 튼다. 끝나거나 SKIP 을 누르면 onDone() 을 한 번 부른다. 돌려준 함수를 부르면 중간에 멈춘다(onDone 없이).
 * el: { root, canvas, title, text, dots, skip } — #scr-intro 안의 그림 장면용 요소
 *     { film, video, filmSkip, loading }      — 화면 전체를 덮는 영상용 요소(#film)
 */
export function playIntro(el, onDone) {
  let stopDraw = () => {}, timer = 0, index = -1, over = false, mode = 'wait';   // wait → film | scenes
  const finish = (call) => {
    if (over) return;
    over = true;
    clearTimeout(timer); stopDraw();
    el.video.pause(); el.video.removeAttribute('src'); el.video.load();
    el.film.classList.add('hidden');
    el.skip.onclick = el.filmSkip.onclick = el.root.onclick = null;
    removeEventListener('keydown', onKey, true);
    if (call) onDone();
  };
  const onKey = (e) => {
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); }
    else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) next(); }
  };
  const next = () => {
    if (over || mode !== 'scenes') return;
    index += 1;
    if (index >= SCENES.length) return finish(true);
    const scene = SCENES[index];
    stopDraw();
    // 아래쪽은 설명 상자가 가리므로 그림을 조금 올려 그리고, 빈 바닥은 땅 색으로 채운다
    stopDraw = animate(el.canvas, (g, t) => {
      g.setTransform(1, 0, 0, 1, 0, -LIFT);
      scene.draw(g, t);
      g.setTransform(1, 0, 0, 1, 0, 0);
      rect(g, 0, H - LIFT, W, LIFT, scene.ground);
    });
    el.title.textContent = scene.title;
    el.text.textContent = scene.text;
    el.dots.innerHTML = SCENES.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('');
    clearTimeout(timer);
    timer = setTimeout(next, SCENE_MS);
  };
  el.skip.onclick = el.filmSkip.onclick = (e) => { e.stopPropagation(); finish(true); };
  el.root.onclick = () => next();            // 화면을 누르면 다음 장면
  addEventListener('keydown', onKey, true);

  // 영상을 다 받을 때까지는 검은 화면에 "불러오는 중" (이 컴퓨터에서는 거의 바로 끝난다)
  el.title.textContent = ''; el.text.textContent = ''; el.dots.innerHTML = '';
  el.film.classList.remove('hidden');
  el.loading.classList.remove('hidden');
  film.then((url) => {
    if (over) return;
    el.loading.classList.add('hidden');
    if (!url) {                              // 영상 파일이 없다 → 그림 4장
      el.film.classList.add('hidden');
      mode = 'scenes';
      return next();
    }
    mode = 'film';
    el.video.src = url;
    el.video.onended = () => finish(true);
    el.video.play().catch(() => { el.video.muted = true; el.video.play().catch(() => finish(true)); });
  });
  return () => finish(false);
}
