// =====================================================
// RE:ROLL 파티 — 보드판 (서버와 화면이 같이 씀)
//  - 칸마다 { id, x, y, type, next: [다음 칸 id…], island, theme } · next 가 둘이면 갈림길
//  - 한 화면에 다 안 들어가는 큰 지도 (2460×1900). 화면은 카메라로 따라다님
//  - 섬(island)마다 땅이 따로 있고, 섬과 섬 사이 길은 다리로 이어짐
//
//  초원 · 숲 (위 줄) → 갈림길 1
//     ├ 화산 섬 (짧고 함정 많은 길)
//     └ 호수 섬 (길지만 안전한 길)
//  → 폐허 → 마을 → 갈림길 2
//     ├ 수정 섬 (쌈뽕한 칸)
//     └ 마을 아랫길 (안전)
//  → 성 (결승)
// =====================================================

const nodes = [];
const add = (x, y, type, island, theme = island) => {
  const n = { id: nodes.length, x: Math.round(x), y: Math.round(y), type, next: [], island, theme };
  nodes.push(n);
  return n;
};
const link = (a, b) => a.next.push(b.id);

// (x0,y0) → (x1,y1) 사이에 칸을 고르게 놓고 앞 칸과 이어줌. wave 만큼 위아래로 굽이침
function line(from, x0, y0, x1, y1, types, island, { wave = 0, theme } = {}) {
  let prev = from;
  return types.map((t, i) => {
    const k = types.length === 1 ? 0 : i / (types.length - 1);
    const y = y0 + (y1 - y0) * k + Math.sin(k * Math.PI * 2) * wave;
    const n = add(x0 + (x1 - x0) * k, y, t, island, typeof theme === 'function' ? theme(i) : theme || island);
    if (prev) link(prev, n);
    prev = n;
    return n;
  });
}

// 1) 위 줄: 초원 → 숲
const top = line(null, 220, 330, 1900, 330, [
  'start', 'plain', 'dice', 'trash', 'slot', 'dice', 'trap', 'capsule',
  'plain', 'thief', 'dice', 'mirror', 'rocket', 'dice', 'fork',
], 'top', { wave: 55, theme: (i) => (i < 8 ? 'meadow' : 'forest') });
const fork1 = top[top.length - 1];

// 2-a) 화산 섬 (짧고 함정 많음)
const short = line(fork1, 1780, 720, 420, 720, [
  'trap', 'dice', 'trap', 'hole', 'trash', 'trap', 'jackpot',
  'dice', 'trap', 'tornado', 'trash', 'quake', 'trap', 'dice',
], 'volcano', { wave: 40 });

// 2-b) 호수 섬 (길지만 안전)
const longDown = line(fork1, 2080, 470, 2170, 900, ['plain', 'dice', 'capsule', 'plain'], 'lake');
const long = line(longDown[longDown.length - 1], 2040, 1080, 420, 1080, [
  'rest', 'dice', 'slide', 'dice', 'gift', 'plain', 'capsule', 'taxi',
  'dice', 'point', 'plain', 'bigdice', 'dice', 'drill',
], 'lake', { wave: 45 });

// 폐허에서 합쳐짐
const merge1 = add(230, 900, 'plain', 'ruins');
link(short[short.length - 1], merge1);
link(long[long.length - 1], merge1);
const ruins = line(merge1, 240, 1150, 300, 1390, ['revolt', 'dice'], 'ruins');

// 3) 마을 → 갈림길 2
const bottom = line(ruins[ruins.length - 1], 430, 1590, 910, 1590, ['dice', 'trash', 'slot', 'capsule', 'fork'], 'village');
const fork2 = bottom[bottom.length - 1];
const wild = line(fork2, 1040, 1420, 1520, 1420, ['rocket', 'tornado', 'bigdice', 'hole', 'jackpot'], 'crystal', { wave: 25 });
const safe = line(fork2, 1040, 1760, 1520, 1760, ['dice', 'plain', 'rest', 'dice', 'mirror'], 'village', { wave: 20 });

// 4) 성 (결승)
const merge2 = add(1650, 1590, 'plain', 'castle');
link(wild[wild.length - 1], merge2);
link(safe[safe.length - 1], merge2);
line(merge2, 1780, 1590, 2260, 1590, ['trap', 'thief', 'timemachine', 'dice', 'goal'], 'castle');

export const BOARD = { width: 2460, height: 1900, nodes, start: 0, goal: nodes.length - 1 };

// 결승까지 남은 칸 수 (가장 짧은 길 기준)
export const DIST = (() => {
  const d = new Array(nodes.length).fill(Infinity);
  d[BOARD.goal] = 0;
  for (let changed = true; changed;) {
    changed = false;
    for (const n of nodes) {
      for (const m of n.next) {
        if (d[m] + 1 < d[n.id]) { d[n.id] = d[m] + 1; changed = true; }
      }
    }
  }
  return d;
})();
