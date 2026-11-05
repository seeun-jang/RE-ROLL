// =====================================================
// 진입점: 폰트 로딩 → 스프라이트 생성 → 게임 시작
// URL 옵션 예) index.html?mode=tournament&players=5&autostart=1&embed=1  (개인 화면: mode=personal&char=1~5)
// =====================================================
(async function main() {
  const canvas = document.getElementById('screen');

  // 픽셀 폰트를 먼저 불러와야 한글이 제대로 그려짐 (최대 3초 대기)
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('12px Galmuri11'),
        document.fonts.load('bold 12px Galmuri11'),
        document.fonts.load('10px Galmuri9'),
        document.fonts.load('15px Galmuri14'),
      ]),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch (e) {
    console.warn('폰트 로딩 실패, 기본 글꼴 사용', e);
  }
  KText.clear();
  await loadCharacterImages();
  initSprites();
  Transition.buildPatterns();

  const game = new Game(canvas);
  window.game = game; // 디버그용

  // 메인 게임에서 URL 로 바로 실행하는 경우
  const launch = readLaunchOptions();
  if (launch.mode) {
    game.settings.mode = launch.mode;
    game.settings.count = launch.players;
    game.settings.charIdx = launch.char;
    PlayerName.applyTo(CHARACTERS, launch.char);
  }
  if (launch.autostart && launch.mode) {
    const opts = { mode: launch.mode, count: launch.players, charIdx: launch.char, embed: launch.embed, autoplay: launch.autoplay };
    if (Array.isArray(launch.seeds)) opts.seeds = launch.seeds;
    // 토너먼트는 대진을 직접 고르는 화면부터 (seeds 를 주거나 자동 시연이면 바로 시작)
    const pick = launch.mode === 'tournament' && !launch.seeds && !launch.autoplay;
    game.start(pick ? new SeedScene(game, opts) : new TournamentScene(game, opts));
  } else {
    game.start();
  }
})();
