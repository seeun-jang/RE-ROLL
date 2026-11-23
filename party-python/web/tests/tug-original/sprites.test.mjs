// 스프라이트 데이터 검증 — node --test tests/sprites.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAR_W, CHAR_H, CHAR_SLOTS, CHARACTER_FRAMES, CHARACTER_ANIMS, ICONS } from '../../src/games/tug/assets/sprites.js';
import { DEFAULT_CONFIG, DEFAULT_PLAYERS } from '../../src/games/tug/config.js';
import { PALETTE, C, TEAM_COLORS, shadeOf } from '../../src/games/tug/palette.js';
import { loadAssets, Assets, colorMapFor } from '../../src/games/tug/assets/AssetLoader.js';
import { parseHex } from '../../src/games/tug/assets/SpriteFactory.js';

const ALLOWED = new Set([...CHAR_SLOTS, '.']);
const SKIN = new Set(['s', 'S']);

test('캐릭터 크기 상수', () => {
  assert.equal(CHAR_W, 16);
  assert.equal(CHAR_H, 32);
  assert.equal(new Set(CHAR_SLOTS).size, CHAR_SLOTS.length, '슬롯 문자 중복 없음');
});

test('애니메이션 목록과 프레임 수가 config.ANIMS 와 일치', () => {
  assert.deepEqual(Object.keys(CHARACTER_FRAMES).sort(), Object.keys(DEFAULT_CONFIG.ANIMS).sort());
  assert.deepEqual([...CHARACTER_ANIMS].sort(), Object.keys(DEFAULT_CONFIG.ANIMS).sort());
  for (const [anim, spec] of Object.entries(DEFAULT_CONFIG.ANIMS)) {
    assert.equal(CHARACTER_FRAMES[anim].length, spec.frames, `${anim} 프레임 수`);
  }
});

test('모든 프레임: 32행 × 16글자, 허용 문자만', () => {
  for (const [anim, frames] of Object.entries(CHARACTER_FRAMES)) {
    frames.forEach((rows, fi) => {
      assert.equal(rows.length, CHAR_H, `${anim}[${fi}] 행 수`);
      rows.forEach((row, y) => {
        assert.equal(row.length, CHAR_W, `${anim}[${fi}] row ${y} 길이`);
        for (const ch of row) assert.ok(ALLOWED.has(ch), `${anim}[${fi}] row ${y} 허용되지 않은 문자 '${ch}'`);
      });
      // 비어있지 않은 프레임
      assert.ok(rows.some((r) => /[^.]/.test(r)), `${anim}[${fi}] 빈 프레임`);
    });
  }
});

test('idle/pull/slip 은 발이 마지막 행(31)에 닿는다', () => {
  for (const anim of ['idle', 'pull', 'slip']) {
    CHARACTER_FRAMES[anim].forEach((rows, fi) => {
      assert.match(rows[31], /[^.]/, `${anim}[${fi}] row 31 비어있음`);
    });
  }
  // 넘어짐 마지막 프레임(납작)도 바닥에 붙어 있다
  const fall = CHARACTER_FRAMES.fall;
  assert.match(fall[fall.length - 1][31], /[^.]/);
});

test('idle/pull 의 손(주먹)은 row 16~17, x 12~15 에 있다', () => {
  for (const anim of ['idle', 'pull']) {
    CHARACTER_FRAMES[anim].forEach((rows, fi) => {
      for (const y of [16, 17]) {
        const seg = rows[y].slice(12, 16);
        assert.ok([...seg].some((ch) => SKIN.has(ch)), `${anim}[${fi}] row ${y} 손 없음: '${seg}'`);
      }
    });
  }
  // slip 은 허우적대지만 손이 줄 높이 근처(row 15~18)에 있다
  CHARACTER_FRAMES.slip.forEach((rows, fi) => {
    const near = [15, 16, 17, 18].some((y) => [...rows[y].slice(12, 16)].some((ch) => SKIN.has(ch)));
    assert.ok(near, `slip[${fi}] 손이 줄 높이 근처에 없음`);
  });
});

test('맨 윗행·좌우 끝 열에는 채움 픽셀이 없다 (외곽선이 잘리지 않음)', () => {
  for (const [anim, frames] of Object.entries(CHARACTER_FRAMES)) {
    frames.forEach((rows, fi) => {
      assert.match(rows[0], /^[.o]*$/, `${anim}[${fi}] row 0`);
      rows.forEach((row, y) => {
        assert.ok(row[0] === '.' || row[0] === 'o', `${anim}[${fi}] row ${y} 왼쪽 끝 '${row[0]}'`);
        assert.ok(row[15] === '.' || row[15] === 'o', `${anim}[${fi}] row ${y} 오른쪽 끝 '${row[15]}'`);
      });
    });
  }
});

test('모든 프레임에 머리띠(팀 색)가 보인다', () => {
  for (const [anim, frames] of Object.entries(CHARACTER_FRAMES)) {
    frames.forEach((rows, fi) => assert.ok(rows.join('').includes('b'), `${anim}[${fi}] 머리띠 없음`));
  }
});

test('아이콘: 필수 이름, rows 가 w×h 와 일치, 모든 문자에 팔레트 색', () => {
  for (const name of ['crown', 'speakerOn', 'speakerOff', 'star', 'flag']) {
    assert.ok(ICONS[name], `아이콘 ${name} 없음`);
  }
  for (const [name, icon] of Object.entries(ICONS)) {
    assert.ok(Number.isInteger(icon.w) && icon.w > 0, `${name}.w`);
    assert.ok(Number.isInteger(icon.h) && icon.h > 0, `${name}.h`);
    assert.equal(icon.rows.length, icon.h, `${name} 행 수`);
    icon.rows.forEach((row, y) => {
      assert.equal(row.length, icon.w, `${name} row ${y} 길이`);
      for (const ch of row) {
        if (ch === '.') continue;
        const idx = icon.colors[ch];
        assert.ok(Number.isInteger(idx) && idx >= 0 && idx < PALETTE.length, `${name} '${ch}' 색 없음`);
      }
    });
  }
});

test('colorMapFor: 팀 색 / 중립 머리띠 / 외형 색', () => {
  const p = DEFAULT_PLAYERS[0];
  const ap = { shirt: p.color, shirtShade: shadeOf(p.color), hair: p.hair };
  const left = colorMapFor(ap, 'left');
  assert.equal(left.b, TEAM_COLORS.left.main);
  assert.equal(left.B, TEAM_COLORS.left.shade);
  assert.equal(left.c, p.color);
  assert.equal(left.h, p.hair);
  assert.equal(left.H, shadeOf(p.hair));
  assert.equal(left.s, PALETTE[C.YELLOW]);
  assert.equal(left.S, PALETTE[C.ORANGE]);
  assert.equal(left.o, PALETTE[C.INK]);
  assert.equal(left.p, PALETTE[C.CHARCOAL]);
  assert.equal(left.P, PALETTE[C.INK]);
  assert.equal(left.f, PALETTE[C.PLUM]);
  assert.equal(colorMapFor(ap, 'right').b, TEAM_COLORS.right.main);
  const neutral = colorMapFor(ap, null);
  assert.equal(neutral.b, PALETTE[C.WHITE]);
  assert.equal(neutral.B, PALETTE[C.SILVER]);
  // 모든 슬롯에 유효한 색
  for (const ch of CHAR_SLOTS) assert.ok(parseHex(neutral[ch]), `슬롯 ${ch}`);
  // 빈 외형도 안전
  for (const ch of CHAR_SLOTS) assert.ok(parseHex(colorMapFor(undefined, 'left')[ch]));
});

test('Node(DOM 없음)에서도 loadAssets 는 reject 하지 않는다', async () => {
  const assets = await loadAssets({ ...DEFAULT_CONFIG, FONT_LOAD_TIMEOUT: 50 });
  assert.ok(assets instanceof Assets);
  assert.equal(assets.fontsReady, false);
  for (const [anim, spec] of Object.entries(DEFAULT_CONFIG.ANIMS)) assert.equal(assets.frameCount(anim), spec.frames);
  assert.equal(assets.frameRows('pull', 99), CHARACTER_FRAMES.pull[3], '프레임 번호는 범위로 고정');
  assert.equal(assets.frameRows('nope', 0), CHARACTER_FRAMES.idle[0], '모르는 애니메이션은 idle');
});
