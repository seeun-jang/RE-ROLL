// =====================================================
// 플레이어 캐릭터 정의 (동물 5종 — 보내준 그림 속 캐릭터)
// sprite: assets/characters/<sprite>.png 파일 이름
// color: 이름표·칩 색
// =====================================================
const CHARACTERS = [
  {
    id: 'bear',
    name: '럼블',
    title: '해맑은 응원단장',
    sprite: 'bear',
    color: 'e',
  },
  {
    id: 'cat',
    name: '나르',
    title: '별빛 마녀',
    sprite: 'cat',
    color: 'q',
  },
  {
    id: 'duck',
    name: '꽥스',
    title: '왕관 배달부',
    sprite: 'duck',
    color: 't',
  },
  {
    id: 'tiger',
    name: '볼리베어',
    title: '츤데레 교관',
    sprite: 'tiger',
    color: '8',
  },
  {
    id: 'shiba',
    name: '에코',
    title: '수줍은 신병',
    sprite: 'shiba',
    color: 'p',
  },
];

// 그림 속 손 위치 (그림 좌표 · 오른쪽 R = 앞손, 왼쪽 L = 뒷손 — 오른쪽을 볼 때 기준)
//  c: 손 중심 (글러브를 끼는 곳) · clear: 원래 손을 지울 칸 · root: 팔이 나오는 곳(소매 끝)
//  arm: [소매 색, 손 쪽 색] — 펀치 · 가드 때 그림과 같은 색의 팔이 뻗어 나감
const HANDS = {
  bear: { R: { c: [29, 31], clear: [26, 28, 6, 6], root: [28, 27] }, L: { c: [6, 30], clear: [3, 27, 6, 6], root: [7, 26] }, arm: ['c', 'm'] },
  cat: { R: { c: [27, 34], clear: [24, 31, 6, 6], root: [26, 30] }, L: { c: [4, 30], clear: [1, 27, 6, 6], root: [6, 27] }, arm: ['3', 'w'] },
  duck: { R: { c: [29, 24], clear: [26, 21, 7, 6], root: [26, 23] }, L: { c: [4, 22], clear: [1, 19, 6, 7], root: [6, 23] }, arm: ['g', 'b'] },
  tiger: { R: { c: [35, 32], clear: [32, 29, 6, 6], root: [33, 28] }, L: { c: [8, 33], clear: [5, 30, 6, 6], root: [8, 29] }, arm: ['c', 'u'] },
  shiba: { R: { c: [29, 34], clear: [26, 31, 6, 6], root: [29, 29] }, L: { c: [3, 32], clear: [0, 29, 6, 6], root: [4, 27] }, arm: ['u', 'u'] },
};
