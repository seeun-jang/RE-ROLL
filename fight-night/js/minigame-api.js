// =====================================================
// RE:ROLL 메인 게임 연동 API
// - 미니게임이 끝나면 5명의 점수/순위를 표준 형식으로 내보냄
// - 메인 게임은 아래 3가지 중 편한 방법으로 결과를 받으면 됨
//   1) window 이벤트   : window.addEventListener('re-minigame:finish', e => e.detail)
//   2) iframe 메시지    : parent 에서 message 이벤트 (type: 'RE_MINIGAME_RESULT')
//   3) 전역 변수        : window.RE_MINIGAME_LAST_RESULT
// - 실행 옵션은 URL 로 전달: ?mode=tournament&players=5&autostart=1&embed=1
// =====================================================
const MINIGAME_INFO = {
  id: 'fight-night',
  name: '매직 파이트 나이트',
  version: 1,
};

// 토너먼트: 최종 순위(placement)가 곧 순위 / 개인 화면: 점수로 순위
function computeRanking(players, mode) {
  const rows = players.map((p) => ({
    playerId: p.def.id,
    slot: p.index + 1,
    name: p.name,
    score: p.score,
    placement: p.placement || null,
    wins: p.wins,
    kos: p.kos,
    damage: p.damage,
  }));
  if (mode === 'tournament') rows.sort((a, b) => a.placement - b.placement);
  else rows.sort((a, b) => b.score - a.score || b.wins - a.wins || b.kos - a.kos);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (mode === 'tournament') r.rank = r.placement;
    else r.rank = prev && prev.score === r.score && prev.wins === r.wins && prev.kos === r.kos ? prev.rank : i + 1;
    r.rankPoints = CONFIG.RANK_POINTS[r.rank - 1] || 0;
  });
  return rows;
}

function buildResult(mode, players) {
  return {
    gameId: MINIGAME_INFO.id,
    gameName: MINIGAME_INFO.name,
    version: MINIGAME_INFO.version,
    mode, // tournament | personal
    finishedAt: new Date().toISOString(),
    ranking: computeRanking(players, mode), // [{playerId, slot, name, score, placement, wins, kos, damage, rank, rankPoints}]
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
    autoplay: q.get('autoplay') === '1', // 모두 CPU (시연·테스트용)
  };
}
