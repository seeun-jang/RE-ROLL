// =====================================================
// RE:ROLL 메인 게임 연동 API
// - 미니게임이 끝나면 플레이어 점수/순위를 표준 형식으로 내보냄
// - 메인 게임은 아래 3가지 중 편한 방법으로 결과를 받으면 됨
//   1) window 이벤트   : window.addEventListener('re-minigame:finish', e => e.detail)
//   2) iframe 메시지    : parent 에서 message 이벤트 (type: 'RE_MINIGAME_RESULT')
//   3) 전역 변수        : window.RE_MINIGAME_LAST_RESULT
// - 실행 옵션은 URL 로 전달: ?mode=together&players=5&autostart=1&embed=1  (&seed=123 이면 마법진·저주 고정)
//   개인 화면: ?mode=personal&char=3 (char 1~5 = 럼블·나르·꽥스·볼리베어·에코, 혼자 그린 점수를 다른 사람과 비교)
// - 함께 하기: 마우스 하나를 차례로 넘기며 그림 / 개인 화면: 각자 기기에서 혼자 3라운드 → 점수(최대 348) 비교
// =====================================================
const MINIGAME_INFO = {
  id: 'magic-sigil',
  name: '마법진 그리기',
  version: 1,
};

// 순위: 합계 점수 → 마지막 라운드(기억해서 그리기) 점수 → 최고 정확도
function computeRanking(players, mode) {
  const rows = players.map((p) => {
    const rounds = CONFIG.ROUNDS.map((_, i) => (p.rounds[i] ? p.rounds[i].total : 0));
    return {
      playerId: p.def.id,
      slot: p.index + 1,
      seat: p.slot,
      name: p.name,
      cpu: false,
      score: p.total,                     // 3라운드 합계 (정확도 + 빨리 끝낸 보너스)
      rounds,                              // 라운드별 점수
      best: Math.max(0, ...p.rounds.filter(Boolean).map((r) => r.accuracy)), // 최고 정확도
    };
  });
  const last = rows.length ? CONFIG.ROUNDS.length - 1 : 0;
  rows.sort((a, b) => b.score - a.score || b.rounds[last] - a.rounds[last] || b.best - a.best);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.score === r.score && prev.rounds[last] === r.rounds[last] && prev.best === r.best ? prev.rank : i + 1;
    // 개인 화면은 혼자 결과라 메인 점수는 진행자가 모두의 score 를 모아 비교해서 줌 → null
    r.rankPoints = mode === 'personal' ? null : CONFIG.RANK_POINTS[r.rank - 1] || 0;
  });
  return rows;
}

function buildResult(mode, players) {
  return {
    gameId: MINIGAME_INFO.id,
    gameName: MINIGAME_INFO.name,
    version: MINIGAME_INFO.version,
    mode, // together | personal
    finishedAt: new Date().toISOString(),
    ranking: computeRanking(players, mode), // [{playerId, slot, name, score, rounds, best, rank, rankPoints}]
  };
}

function emitResult(result) {
  window.RE_MINIGAME_LAST_RESULT = result;
  window.dispatchEvent(new CustomEvent('re-minigame:finish', { detail: result }));
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'RE_MINIGAME_RESULT', result }, '*');
  }
  console.info('[RE minigame result]', JSON.stringify(result));
}

// URL 실행 옵션 읽기
function readLaunchOptions() {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && !isNaN(+q.get(k)) ? +q.get(k) : d);
  return {
    mode: q.has('mode') ? 'personal' : null, // 컴퓨터 1대 = 1명 → 늘 개인 화면
    players: Math.max(CONFIG.MIN_PLAYERS, Math.min(CONFIG.MAX_PLAYERS, num('players', CONFIG.MAX_PLAYERS))),
    char: Math.max(0, Math.min(CONFIG.MAX_PLAYERS - 1, num('char', 1) - 1)),
    autostart: q.get('autostart') === '1',
    embed: q.get('embed') === '1',
    autoplay: q.get('autoplay') === '1', // 자동 그리기 (시연·테스트용)
    seed: q.has('seed') && !isNaN(+q.get('seed')) ? +q.get('seed') : null, // 마법진·저주 순서 고정 (개인 화면 기본 = 오늘 날짜)
  };
}
