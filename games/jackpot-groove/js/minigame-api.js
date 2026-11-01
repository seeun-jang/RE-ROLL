// =====================================================
// RE:ROLL 메인 게임 연동 API
// - 미니게임이 끝나면 플레이어 점수/순위를 표준 형식으로 내보냄
// - 메인 게임은 아래 3가지 중 편한 방법으로 결과를 받으면 됨
//   1) window 이벤트   : window.addEventListener('re-minigame:finish', e => e.detail)
//   2) iframe 메시지    : parent 에서 message 이벤트 (type: 'RE_MINIGAME_RESULT')
//   3) 전역 변수        : window.RE_MINIGAME_LAST_RESULT
// - 실행 옵션은 URL 로 전달:
//   ?mode=together&players=5&difficulty=normal&autostart=1&embed=1   (difficulty: easy | normal | hard)
//   개인 화면: ?mode=personal&char=3   (char 1~5 = 럼블·나르·꽥스·볼리베어·에코)
// - 개인 화면끼리는 같은 곡·같은 채보라서 score 를 그대로 비교하면 됨
// =====================================================
const MINIGAME_INFO = {
  id: 'jackpot-groove',
  name: '잭팟 그루브',
  version: 1,
};

// 점수 → 최대 콤보 → PERFECT 수 순서로 순위 (완전히 같으면 공동 순위)
function computeRanking(performers) {
  const rows = performers.map((p) => ({
    playerId: p.def.id,
    slot: p.index + 1,
    name: p.name,
    ...p.summary(), // score, grade, maxCombo, perfect, great, good, miss, fullCombo, allPerfect
  }));
  rows.sort((a, b) => b.score - a.score || b.maxCombo - a.maxCombo || b.perfect - a.perfect);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.score === r.score && prev.maxCombo === r.maxCombo && prev.perfect === r.perfect ? prev.rank : i + 1;
    r.rankPoints = CONFIG.RANK_POINTS[r.rank - 1] || 0;
  });
  return rows;
}

function buildResult(mode, performers, difficulty) {
  return {
    gameId: MINIGAME_INFO.id,
    gameName: MINIGAME_INFO.name,
    version: MINIGAME_INFO.version,
    mode, // together | personal
    difficulty,
    maxScore: CONFIG.SCORE_MAX,
    finishedAt: new Date().toISOString(),
    ranking: computeRanking(performers),
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
    mode: ['together', 'personal'].includes(q.get('mode')) ? q.get('mode') : null,
    players: Math.max(2, Math.min(CONFIG.MAX_PLAYERS, num('players', CONFIG.MAX_PLAYERS))),
    char: Math.max(0, Math.min(CONFIG.MAX_PLAYERS - 1, num('char', 1) - 1)),
    difficulty: ['easy', 'normal', 'hard'].includes(q.get('difficulty')) ? q.get('difficulty') : 'normal',
    autostart: q.get('autostart') === '1',
    embed: q.get('embed') === '1',
    autoplay: q.get('autoplay') === '1', // 자동 연주 (테스트·시연용)
    song: SONGS[q.get('song')] ? q.get('song') : 'groove', // groove · moon · neon
    speed: Math.max(1, Math.min(5, num('speed', 3))), // 노트 속도 1~5
  };
}
