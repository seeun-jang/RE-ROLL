// =============================================================
// TitleScene — 타이틀 + 5인 준비 확인
//
// - 다섯 명이 한 줄로 서 있고, 각자 자기 키를 누르면 '준비'(만세 + READY! 태그), 한 번 더 누르면 취소.
// - 모두 준비되면 TITLE_ALL_READY_DELAY 초 뒤 자동 시작. Enter / '시작' 버튼 클릭으로 바로 시작.
// - 메뉴 배경음: BPM_MENU 박자 시계에 맞춰 예약 재생.
// =============================================================
import { PALETTE, C } from '../palette.js';
import { Button } from '../ui/Button.js';
import { drawHeadLabel } from '../ui/HUD.js';

/** 캐릭터 간 가로 간격 (px) */
const PLAYER_GAP = 40;
/** 캐릭터 높이 (스프라이트 16×32) */
const CHAR_H = 32;
/** 머리 위 라벨 아랫변 = 머리 꼭대기에서 이만큼 위 */
const LABEL_GAP = 2;
/** 키캡 눌림 표시 시간 (초) */
const KEY_FLASH_TIME = 0.12;
/** 로고 박스 */
const LOGO = { x: 54, y: 5, w: 212, h: 48 };
/** 시작 버튼 */
const START_BTN = { x: 132, y: 161, w: 56, h: 16 };
/** 준비 태그 크기 */
const TAG_W = 34, TAG_H = 11;

export class TitleScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.allReadyT = 0;    // 모두 준비된 뒤 경과 초
    this.starting = false; // 시작 처리 중 (중복 방지)
    this.startButton = new Button({
      x: START_BTN.x, y: START_BTN.y, w: START_BTN.w, h: START_BTN.h,
      label: '시작', style: 'gold', size: 'l', hotkey: game.config.START_KEY,
    });
  }

  /** i 번째 선수의 타이틀 화면 x (발 중앙) */
  _xOf(i) {
    return this.game.config.LAYOUT.CENTER_X + (i - 2) * PLAYER_GAP;
  }

  enter() {
    const game = this.game;
    const L = game.config.LAYOUT;
    this.t = 0;
    this.allReadyT = 0;
    this.starting = false;
    game.camX = 0;
    game.background.setTimeOfDay('day');
    game.background.setExcitement(0.2);
    game.particles.clear();

    // 준비 상태 초기화 + 한 줄로 세우기
    game.players.forEach((p, i) => {
      p.ready = false;
      p.side = null;
      p.slot = 0;
      p.pop = null;
      p.pressT = Infinity;
      p.x = this._xOf(i);
      p.y = L.GROUND_Y;
      p.setAnim('idle', true);
    });

    // 메뉴 음악: 박자 시계를 메뉴 템포로 → 첫 박 예약
    game.music.stopAll();
    game.beat.reset(game.config.BPM_MENU);
    game.scheduleBeatAudio([0], 'menu');
  }

  exit() {
    this.game.music.stopAll();
  }

  /** 준비 토글 */
  _toggleReady(p, i) {
    const game = this.game;
    const L = game.config.LAYOUT;
    p.pressT = 0;
    const pan = (i - 2) * 0.35; // 화면 위치에 맞춘 스테레오 패닝
    if (!p.ready) {
      p.ready = true;
      p.setAnim('win', true);
      game.audio.play('ready', { pan });
      game.particles.emit('sparkle', this._xOf(i), L.GROUND_Y - CHAR_H - 2, { count: 12 });
    } else {
      p.ready = false;
      p.setAnim('idle', true);
      game.audio.play('click', { pan });
    }
  }

  /** 게임 시작 → 팀 배정 (1라운드) */
  _start() {
    if (this.starting) return;
    const game = this.game;
    game.round = 1;
    if (game.goto('teamAssign', { round: 1 }, { transition: 'circleWipe' })) {
      this.starting = true;
      game.audio.play('whistle');
    }
  }

  update(dt) {
    const game = this.game;
    this.t += dt;

    // 메뉴 배경음 예약
    game.scheduleBeatAudio(game.beat.update(dt), 'menu');

    // 각자 자기 키로 준비/취소 (시작 처리 중에는 무시)
    if (!this.starting) {
      game.players.forEach((p, i) => {
        if (game.input.pressed(p.key)) this._toggleReady(p, i);
      });
    }

    // 애니메이션 진행
    const frozen = game.fx.frozen;
    for (const p of game.players) p.update(dt, frozen);

    // 준비 인원에 따라 관중 들썩임
    const readyCount = game.players.filter((p) => p.ready).length;
    game.background.setExcitement(0.2 + 0.8 * (readyCount / game.players.length));

    // 모두 준비 → 잠깐 뒤 자동 시작
    if (readyCount === game.players.length && game.players.length > 0) {
      this.allReadyT += dt;
      if (this.allReadyT >= game.config.TITLE_ALL_READY_DELAY) this._start();
    } else {
      this.allReadyT = 0;
    }

    // 시작 버튼 (Enter / 클릭)
    if (!this.starting && this.startButton.update(game.pointer, game.input)) {
      game.audio.play('click');
      this._start();
    }
  }

  render(g) {
    const game = this.game;
    const ui = game.ui;
    const L = game.config.LAYOUT;
    const cx = L.CENTER_X;
    const ink = PALETTE[C.INK];

    // 배경 (카메라 고정)
    game.background.render(g, 0);

    // ---- 로고 ----
    ui.box(g, LOGO.x, LOGO.y, LOGO.w, LOGO.h, 'dark');
    // 로고 박스 안쪽 장식: 양쪽 끝에 팀 색 깃발 블록
    g.fillStyle = PALETTE[C.RED];
    g.fillRect(LOGO.x + 6, LOGO.y + 8, 4, 4);
    g.fillStyle = PALETTE[C.BLUE];
    g.fillRect(LOGO.x + LOGO.w - 10, LOGO.y + 8, 4, 4);
    const bob = game.beat.phase < 0.2 ? 1 : 0; // 박 직후 1px 내려앉아 박자에 맞춰 들썩
    ui.text(g, '픽셀 줄다리기', cx, LOGO.y + 6 + bob, {
      size: 'xl', color: PALETTE[C.YELLOW], align: 'center', outline: ink, shadow: PALETTE[C.PLUM],
    });
    ui.bitmapText(g, 'PIXEL TUG-OF-WAR', cx, LOGO.y + 28, {
      color: PALETTE[C.WHITE], scale: 2, align: 'center', shadow: PALETTE[C.SLATE],
    });

    // ---- 안내 문구 ----
    ui.text(g, '박자에 맞춰 자기 키를 눌러 줄을 당겨요!', cx, LOGO.y + LOGO.h + 3, {
      size: 'm', color: PALETTE[C.WHITE], align: 'center', outline: ink,
    });

    // ---- 준비 인원 ----
    const readyCount = game.players.filter((p) => p.ready).length;
    ui.bitmapText(g, `READY ${readyCount}/${game.players.length}`, START_BTN.x - 8, START_BTN.y + 5, {
      color: readyCount === game.players.length ? PALETTE[C.YELLOW] : PALETTE[C.WHITE],
      align: 'right', shadow: ink,
    });

    // ---- 선수들 ----
    game.players.forEach((p, i) => {
      const x = this._xOf(i);
      const y = L.GROUND_Y;
      game.world.drawCharacter(g, p, x, y);
      drawHeadLabel(g, ui, x, y - CHAR_H - LABEL_GAP, {
        label: p.name || p.label,   // 대기실에서 정한 이름
        keyLabel: p.keyLabel,
        color: p.color,
        side: null,
        pressed: p.pressT < KEY_FLASH_TIME,
      });
      this._drawReadyTag(g, p, x, y + 3);
    });

    // 입자 (반짝임)
    game.particles.render(g, 0);

    // ---- 하단 안내 ----
    const allReady = readyCount === game.players.length;
    if (allReady) {
      if (Math.floor(this.t * 4) % 2 === 0) {
        ui.text(g, '모두 준비 완료! 곧 시작합니다', cx, 149, {
          size: 's', color: PALETTE[C.YELLOW], align: 'center', outline: ink,
        });
      }
    } else {
      ui.text(g, '모두 준비되면 시작 · Enter/클릭: 바로 시작', cx, 149, {
        size: 's', color: PALETTE[C.WHITE], align: 'center', outline: ink,
      });
    }

    this.startButton.render(g, ui);
  }

  /** 발밑 준비 태그: 준비면 금색 'READY!', 아니면 키를 누르라는 깜빡임 */
  _drawReadyTag(g, p, x, y) {
    const ui = this.game.ui;
    const bx = x - (TAG_W >> 1);
    if (p.ready) {
      ui.box(g, bx, y, TAG_W, TAG_H, 'gold');
      ui.bitmapText(g, 'READY!', x, y + 2, { color: PALETTE[C.INK], align: 'center' });
    } else if (Math.floor(this.t * 2) % 2 === 0) {
      ui.box(g, bx, y, TAG_W, TAG_H, 'dark');
      ui.bitmapText(g, 'PRESS', x, y + 2, { color: PALETTE[C.SILVER], align: 'center' });
    }
  }
}
