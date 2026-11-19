// =============================================================
// 스모크 테스트 — src/ 아래 모든 .js 모듈을 Node 에서 import 한다.
// - 문법 오류, 없는 named export import(링크 에러), 모듈 최상위 DOM 접근을 잡아낸다.
// - DOM 이 없는 순수 Node 환경에서 실행되어야 하므로 이 파일은 가짜 DOM 을 만들지 않는다.
// =============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'src', 'games', 'tug');

/** dir 아래 .js 파일을 재귀로 모은다 */
function collectJs(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectJs(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = collectJs(SRC);

test('src/ 에 모듈이 있다', () => {
  assert.ok(files.length > 30, `모듈 수가 너무 적다: ${files.length}`);
});

test('DOM 없는 환경이다 (최상위 DOM 접근 검사용)', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
});

for (const file of files) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  test(`import ${rel}`, async () => {
    const mod = await import(pathToFileURL(file).href);
    assert.ok(mod && typeof mod === 'object');
  });
}

test('공개 API (SPEC 2.26) export', async () => {
  const mod = await import(pathToFileURL(join(SRC, 'index.js')).href);
  for (const name of ['mount', 'PowerSource', 'KeyboardPowerSource', 'DEFAULT_CONFIG', 'DEFAULT_PLAYERS', 'mergeConfig']) {
    assert.ok(name in mod, `index.js 에 ${name} export 없음`);
  }
  assert.equal(typeof mod.mount, 'function');
});

test('SPEC 에 적힌 주요 export 들이 존재한다', async () => {
  const expect = {
    'core/Loop.js': ['Loop'],
    'core/Game.js': ['Game'],
    'input/KeyboardInput.js': ['KeyboardInput'],
    'input/PointerInput.js': ['PointerInput'],
    'input/PowerSource.js': ['PowerSource', 'KeyboardPowerSource'],
    'systems/BeatJudge.js': ['BeatJudge'],
    'systems/Rope.js': ['Rope'],
    'systems/Team.js': ['Team', 'TeamAssigner', 'assignTeams'],
    'systems/Fever.js': ['Fever'],
    'systems/PowerCalculator.js': ['computePower'],
    'systems/ScoreBoard.js': ['ScoreBoard'],
    'entities/Player.js': ['Player'],
    'assets/sprites.js': ['CHAR_W', 'CHAR_H', 'CHAR_SLOTS', 'CHARACTER_FRAMES', 'ICONS'],
    'assets/SpriteFactory.js': ['makeCanvas', 'renderPixelRows', 'flipCanvas'],
    'assets/AssetLoader.js': ['loadAssets', 'Assets'],
    'render/Renderer.js': ['Renderer'],
    'render/Background.js': ['Background'],
    'render/Particles.js': ['Particles'],
    'render/Effects.js': ['Effects'],
    'render/WorldRenderer.js': ['WorldRenderer'],
    'ui/PixelFont.js': ['GLYPH_W', 'GLYPH_H', 'drawBitmapText', 'measureBitmapText'],
    'ui/UI.js': ['UI'],
    'ui/Button.js': ['Button'],
    'ui/HUD.js': [
      'drawTopBar', 'MUTE_BUTTON_RECT', 'drawMuteButton', 'drawBeatLane', 'drawPlayerPanels',
      'drawJudgePop', 'drawFeverBanner', 'drawCenterBanner', 'drawHeadLabel',
    ],
    'audio/AudioEngine.js': ['AudioEngine'],
    'audio/Music.js': ['Music'],
    'scenes/TitleScene.js': ['TitleScene'],
    'scenes/TeamAssignScene.js': ['TeamAssignScene'],
    'scenes/CountdownScene.js': ['CountdownScene'],
    'scenes/PlayScene.js': ['PlayScene'],
    'scenes/RoundResultScene.js': ['RoundResultScene'],
    'scenes/ScoreSummaryScene.js': ['ScoreSummaryScene'],
    'scenes/FinalResultScene.js': ['FinalResultScene'],
    'scenes/PauseOverlay.js': ['PauseOverlay'],
  };
  for (const [rel, names] of Object.entries(expect)) {
    const mod = await import(pathToFileURL(join(SRC, rel)).href);
    for (const n of names) assert.ok(n in mod, `${rel} 에 ${n} export 없음`);
  }
});
