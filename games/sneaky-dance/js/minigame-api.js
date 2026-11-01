// =====================================================
// RE:ROLL 메인 게임 연동 API
// - 미니게임이 끝나면 플레이어 점수/순위를 표준 형식으로 내보냄
// - 메인 게임은 아래 3가지 중 편한 방법으로 결과를 받으면 됨
//   1) window 이벤트   : window.addEventListener('re-minigame:finish', e => e.detail)
//   2) iframe 메시지    : parent 에서 message 이벤트 (type: 'RE_MINIGAME_RESULT')
//   3) 전역 변수        : window.RE_MINIGAME_LAST_RESULT
// - 실행 옵션은 URL 로 전달: ?mode=together&players=5&autostart=1&embed=1
//   개인 화면: ?mode=personal&char=3 (char 1~5 = 럼블·나르·꽥스·볼리베어·에코, 나머지 4명은 CPU)
// =====================================================
const MINIGAME_INFO = {
  id: 'sneaky-dance',
  name: '교수님 몰래 댄스!',
  version: 1,
};

// 순위: 점수(춤춘 점수) → 덜 걸린 순 → 최고 피버
//  교수님 움직임이 seed 로 정해져서 score 는 개인 화면끼리도 그대로 비교 가능
function computeRanking(players) {
  const rows = players.map((p) => ({
    playerId: p.def.id,
    slot: p.index + 1,
    seat: p.slot,
    name: p.name,
    cpu: !p.human,
    score: Math.floor(p.score),
    strikes: p.strikes,       // 걸린 횟수
    out: p.out,               // 복도로 쫓겨났나
    maxFever: CONFIG.FEVER[p.maxFever],
  }));
  rows.sort((a, b) => b.score - a.score || a.strikes - b.strikes || b.maxFever - a.maxFever);
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.score === r.score && prev.strikes === r.strikes && prev.maxFever === r.maxFever ? prev.rank : i + 1;
    r.rankPoints = CONFIG.RANK_POINTS[r.rank - 1] || 0;
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
    ranking: computeRanking(players), // [{playerId, slot, name, cpu, score, strikes, out, maxFever, rank, rankPoints}]
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
    players: Math.max(CONFIG.MIN_PLAYERS, Math.min(CONFIG.MAX_PLAYERS, num('players', CONFIG.MAX_PLAYERS))),
    char: Math.max(0, Math.min(CONFIG.MAX_PLAYERS - 1, num('char', 1) - 1)),
    autostart: q.get('autostart') === '1',
    embed: q.get('embed') === '1',
    seed: q.has('seed') && !isNaN(+q.get('seed')) ? +q.get('seed') : null, // 교수님 움직임 고정
    autoplay: q.get('autoplay') === '1', // 모두 CPU (시연·테스트용)
  };
}
