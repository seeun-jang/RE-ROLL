// =====================================================
// 채보 자동 생성: 곡 멜로디 → 3레인 노트
//  - 음이 올라가면 오른쪽, 내려가면 왼쪽 레인 (멜로디 모양 그대로 손이 움직임)
//  - 긴 음은 롱노트 (꾹 누르고 있기)
//  - 코러스 첫 박은 동시치기(2개)
//  - 같은 곡·같은 난이도면 항상 같은 채보 → 개인 화면끼리 점수 비교 공정
// =====================================================
const CHART_RULES = {
  easy: {
    grid: 4,           // 4분음표(박) 칸에 있는 음만 사용 → 노트 수 절반 이하
    holdMin: 6,        // 아주 긴 음만 롱노트
    doubleEvery: 0,    // 동시치기 없음
    breakTaps: false,
  },
  normal: {
    grid: 2,           // 8분음표 칸에 있는 음만 사용 (짝수 칸)
    holdMin: 4,        // 4칸(4분음표) 이상이면 롱노트
    doubleEvery: 16,   // 코러스에서 마디 첫 박마다 동시치기
    breakTaps: false,
  },
  hard: {
    grid: 1,           // 16분음표까지 전부
    holdMin: 3,
    doubleEvery: 4,    // 코러스에서 매 박 동시치기
    breakTaps: true,   // 브레이크 롱노트 중에 킥 박자 탭 추가
  },
};

// note: { time, lane, endTime(롱노트면 끝 시각, 아니면 null), id }
function buildChart(difficulty = 'normal') {
  const song = expandSong();
  const R = CHART_RULES[difficulty] || CHART_RULES.normal;
  const notes = [];
  const st = song.stepSec;
  let lane = 1;
  let prevMidi = null;
  let holdUntil = []; // 레인별로 롱노트가 끝나는 칸

  const free = (l, step) => !holdUntil[l] || holdUntil[l] <= step;
  const add = (step, l, dur) => {
    const isHold = dur >= R.holdMin;
    // 끝을 반 칸 일찍 끊어서 다음 노트와 붙지 않게
    const endStep = isHold ? step + dur - 0.5 : null;
    notes.push({ time: step * st, lane: l, endTime: isHold ? endStep * st : null, step });
    holdUntil[l] = isHold ? step + dur : step + 1;
  };

  for (const m of song.melody) {
    const bar = song.bars[m.bar];
    const inBar = m.step % 16;
    if (inBar % R.grid !== 0) continue;
    // 멜로디 모양으로 레인 결정
    if (prevMidi !== null) {
      const d = m.midi - prevMidi;
      const move = d === 0 ? 0 : (Math.abs(d) >= 5 ? 2 : 1) * Math.sign(d);
      let next = Math.max(0, Math.min(2, lane + move));
      if (move !== 0 && next === lane) next = 1; // 끝에 붙어 있으면 가운데로 튕김
      lane = next;
    }
    prevMidi = m.midi;
    let l = lane;
    if (!free(l, m.step)) l = [0, 1, 2].find((x) => free(x, m.step)) ?? l;
    add(m.step, l, m.dur);

    // 코러스 동시치기
    if (bar.fever && R.doubleEvery && inBar % R.doubleEvery === 0) {
      const other = l === 0 ? 2 : l === 2 ? 0 : (m.bar % 2 ? 0 : 2);
      if (free(other, m.step)) add(m.step, other, 1);
    }
  }

  // 어려움: 브레이크 롱노트 중간에 킥 박자 탭
  if (R.breakTaps) {
    song.bars.forEach((bar) => {
      if (bar.section !== 'break') return;
      for (const s of [4, 12]) {
        const step = bar.index * 16 + s;
        const held = notes.find((n) => n.endTime !== null && n.time <= step * st && n.endTime >= step * st);
        const cand = [2, 0, 1].find((x) => (!held || x !== held.lane) && !notes.some((n) => n.lane === x && Math.abs(n.time - step * st) < st * 1.5));
        if (cand !== undefined) notes.push({ time: step * st, lane: cand, endTime: null, step });
      }
    });
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((n, i) => (n.id = i));
  return notes;
}

// 판정 개수 (롱노트는 머리 + 꼬리 = 2개)
function chartJudgeCount(notes) {
  return notes.reduce((s, n) => s + (n.endTime !== null ? 2 : 1), 0);
}
