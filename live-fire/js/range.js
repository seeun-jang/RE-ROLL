// =====================================================
// 사격장 규칙: 표적 순서 · 등급 · 점수
//  - 모든 사로에 같은 순서로 표적이 올라옴 (100m 7 · 200m 7 · 250m 6, 섞어서)
//  - 뒤쪽 절반은 표적이 서 있는 시간이 조금 짧아짐
// =====================================================
function makeSchedule() {
  const list = [];
  const counts = { 100: 7, 200: 7, 250: 6 };
  for (const [d, n] of Object.entries(counts)) for (let i = 0; i < n; i++) list.push(+d);
  // 섞기 (첫 표적은 연습 삼아 100m)
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const first = list.indexOf(100);
  [list[0], list[first]] = [list[first], list[0]];
  return list.slice(0, CONFIG.TARGETS).map((dist, k) => {
    const D = CONFIG.DISTANCES[dist];
    return {
      dist,
      x: D.slots[Math.floor(Math.random() * D.slots.length)],
      time: Math.round(D.time * (k >= CONFIG.TARGETS / 2 ? 0.85 : 1)),
    };
  });
}

function gradeOf(hits) {
  return CONFIG.GRADES.find((g) => hits >= g.min);
}

// 표적 사각형 (사로 칸 좌표). rise: 0~1 올라온 정도
function targetRect(tg, rise) {
  const D = CONFIG.DISTANCES[tg.dist];
  const h = Math.max(1, Math.round(D.h * rise));
  return { x: tg.x - D.w / 2, y: D.y - h, w: D.w, h };
}
