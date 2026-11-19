// =============================================================
// 팀 배정 장면 — 룰렛 연출 후 각자 팀 자리로 이동
//  1) 룰렛: 5명이 가운데 한 줄로 서 있고 강조 틀이 사람 사이를 뛰어다니며 머리띠가 빨강/파랑으로 깜빡인다
//  2) 공개: 각자 팀 위치로 미끄러지듯 이동, 양쪽에 팀 패널 등장
// =============================================================
import { PALETTE, C } from '../palette.js';
import { drawHeadLabel, MUTE_BUTTON_RECT } from '../ui/HUD.js';
import { labelLift } from '../render/WorldRenderer.js';

// ---- 연출용 상수 ----
const ROULETTE_TIME = 1.6;      // 룰렛 연출 시간 (초)
const HOP_START = 0.05;         // 강조 틀이 처음 넘어가는 간격 (초) — 점점 느려진다
const HOP_END = 0.22;           // 룰렛 끝 무렵 간격 (초)
const ROW_SPACING = 30;         // 룰렛 때 한 줄로 선 선수 간격 (px)
const SLIDE_TIME = 0.55;        // 한 명이 팀 자리까지 이동하는 시간 (초)
const SLIDE_STAGGER = 0.08;     // 선수별 출발 시차 (초)
const SLIDE_HOP = 6;            // 이동 중 깡충 뛰는 높이 (px)
const PANEL_IN_TIME = 0.3;      // 팀 패널이 옆에서 들어오는 시간 (초)
const PANEL_W = 92;
const PANEL_H = 40;
const PANEL_Y = 40;
const PANEL_MARGIN = 6;
const TOD_NAMES = { day: '낮', sunset: '노을', night: '밤' };

const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);
const clamp01 = (k) => Math.max(0, Math.min(1, k));

export class TeamAssignScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.round = 1;
    this.rowX = new Map();     // playerId → 룰렛 줄 x
    this.targetX = new Map();  // playerId → 팀 자리 x
    this.hopIndex = 0;         // 강조 틀이 가리키는 선수 index
    this.hopCount = 0;
    this.nextHopT = 0;
    this.revealAt = ROULETTE_TIME; // 공개 시작 시각 (건너뛰면 앞당겨짐)
    this.revealed = false;
    this.leaving = false;
  }

  enter(params = {}) {
    const game = this.game;
    const cfg = game.config;
    const L = cfg.LAYOUT;
    const round = params.round ?? game.round ?? 1;
    game.round = round;
    this.round = round;

    // 팀 배정·줄/피버/박자 초기화·시간대 설정은 Game.setupRound 가 처리
    game.setupRound(round);
    game.camX = 0;
    if (game.particles) game.particles.clear();

    // 메뉴 템포 박자 시계 (라운드 사이에도 음악이 이어지도록)
    if (game.music) game.music.stopAll();
    game.beat.reset(cfg.BPM_MENU);
    game.scheduleBeatAudio([0], 'menu');

    // 팀 자리(목표) 계산: rope.pos = 0 기준 layoutTeams 결과를 기록
    game.world.layoutTeams();
    this.targetX.clear();
    this.rowX.clear();
    const n = game.players.length;
    game.players.forEach((p, i) => {
      this.targetX.set(p.id, Math.round(p.x));
      const rx = L.CENTER_X + Math.round((i - (n - 1) / 2) * ROW_SPACING);
      this.rowX.set(p.id, rx);
      p.x = rx;
      p.y = L.GROUND_Y;
      p.setAnim('idle', true);
    });

    this.t = 0;
    this.hopIndex = Math.floor(Math.random() * Math.max(1, n));
    this.hopCount = 0;
    this.nextHopT = HOP_START;
    this.revealAt = ROULETTE_TIME;
    this.revealed = false;
    this.leaving = false;
  }

  exit() {}

  /** 공개 연출이 모두 끝나는 시각 */
  get revealEnd() {
    return this.revealAt + SLIDE_TIME + SLIDE_STAGGER * Math.max(0, this.game.players.length - 1);
  }

  _startPressed() {
    const game = this.game;
    if (game.input && game.input.pressed(game.config.START_KEY)) return true;
    const c = game.pointer && game.pointer.clicked;
    if (!c) return false;
    // 음소거 버튼 클릭은 장면 진행으로 치지 않는다
    const m = MUTE_BUTTON_RECT;
    return !(c.x >= m.x && c.x < m.x + m.w && c.y >= m.y && c.y < m.y + m.h);
  }

  update(dt) {
    const game = this.game;
    const cfg = game.config;
    this.t += dt;

    // 메뉴 박자 시계 진행 + 음악 예약
    const beats = game.beat.update(dt);
    game.scheduleBeatAudio(beats, 'menu');

    // 멀티플레이: 건너뛰기 없음. 다음 장면은 서버가 정한 시각에 Game 이 넘긴다
    const net = !!game.net;
    const skip = !net && !this.leaving && this._startPressed();

    if (!this.revealed) {
      // ---- 룰렛: 강조 틀이 점점 느려지며 다음 사람으로 넘어감 ----
      if (skip) this.revealAt = this.t; // Enter/클릭: 바로 공개
      while (this.t >= this.nextHopT && this.nextHopT < this.revealAt) {
        this.hopIndex = (this.hopIndex + 1) % game.players.length;
        this.hopCount++;
        if (game.audio) game.audio.play('shuffle', { volume: 0.6 });
        const k = clamp01(this.nextHopT / ROULETTE_TIME);
        this.nextHopT += HOP_START + (HOP_END - HOP_START) * k * k;
      }
      if (this.t >= this.revealAt) {
        this.revealed = true;
        if (game.audio) game.audio.play('ready');
      }
    } else if (!this.leaving) {
      const done = this.t >= this.revealEnd;
      const auto = this.t >= Math.max(cfg.TEAM_ASSIGN_TIME, this.revealEnd + 0.2);
      if (!net && (auto || (done && skip))) {
        // 들어오는 전환이 아직 진행 중이면 goto 가 거절된다 → 다음 스텝에 다시 시도
        this.leaving = game.goto('countdown', {}, { transition: 'pixelFade' });
      }
    }

    // ---- 선수 위치: 공개 후 줄 → 팀 자리로 미끄러짐 (정수 좌표) ----
    game.players.forEach((p, i) => {
      const from = this.rowX.get(p.id);
      const to = this.targetX.get(p.id);
      const k = this._slideK(i);
      p.x = Math.round(from + (to - from) * easeOutCubic(k));
      p.update(dt);
    });
  }

  /** 선수 i 의 이동 진행도 (0..1) */
  _slideK(i) {
    if (!this.revealed) return 0;
    return clamp01((this.t - this.revealAt - i * SLIDE_STAGGER) / SLIDE_TIME);
  }

  render(g) {
    const game = this.game;
    const cfg = game.config;
    const L = cfg.LAYOUT;
    const ui = game.ui;
    const world = game.world;
    const camX = Math.round(game.camX || 0);
    const allArrived = this.revealed && this.t >= this.revealEnd;

    if (game.background) game.background.render(g, camX);
    // 모두 자리에 도착하면 줄 등장
    if (allArrived) world.drawRope(g, camX);

    // ---- 선수 ----
    const n = game.players.length;
    game.players.forEach((p, i) => {
      const k = this._slideK(i);
      const hop = k > 0 && k < 1 ? Math.round(Math.sin(k * Math.PI) * SLIDE_HOP) : 0;
      const sx = Math.round(p.x) - camX;
      const sy = L.GROUND_Y - hop;
      let side;
      let flip = false;
      if (!this.revealed) {
        // 룰렛 중: 머리띠가 빨강/파랑으로 번갈아 깜빡임
        side = ((this.hopCount + i) & 1) ? 'left' : 'right';
      } else {
        side = p.side;
        flip = k > 0 ? p.side === 'right' : false;
      }
      world.drawCharacter(g, p, sx, sy, { anim: 'idle', frame: p.frame, side, flip });
    });

    // ---- 룰렛 강조 틀 ----
    if (!this.revealed && n > 0) {
      const p = game.players[this.hopIndex % n];
      const sx = Math.round(p.x) - camX;
      this._drawHighlight(g, sx - 11, L.GROUND_Y - 36, 22, 38, (this.hopCount & 1) === 0);
    }

    // ---- 머리 위 라벨 ----
    game.players.forEach((p, i) => {
      const k = this._slideK(i);
      const hop = k > 0 && k < 1 ? Math.round(Math.sin(k * Math.PI) * SLIDE_HOP) : 0;
      // 팀 자리로 갈수록 홀수 슬롯 라벨을 위로 (같은 팀끼리 라벨 겹침 방지)
      const lift = this.revealed ? Math.round(clamp01(k) * labelLift(p)) : 0;
      drawHeadLabel(g, ui, Math.round(p.x) - camX, L.GROUND_Y - 34 - hop - lift, {
        label: p.name || p.label,   // 대기실에서 정한 이름
        keyLabel: p.keyLabel,
        color: p.color,
        side: this.revealed && k >= 1 ? p.side : null,
        pressed: p.pressT < 0.12,
      });
    });

    if (game.particles) game.particles.render(g, camX);

    // ---- 라운드 배너: 'ROUND n' + 시간대 ----
    this._drawRoundBanner(g);

    // ---- 팀 패널 (공개 후 옆에서 미끄러져 들어옴) ----
    if (this.revealed) {
      const k = easeOutCubic(clamp01((this.t - this.revealAt) / PANEL_IN_TIME));
      const slide = Math.round((1 - k) * (PANEL_W + PANEL_MARGIN));
      this._drawTeamPanel(g, game.teams.left, PANEL_MARGIN - slide, 'red');
      this._drawTeamPanel(g, game.teams.right, cfg.WIDTH - PANEL_MARGIN - PANEL_W + slide, 'blue');
      if (k >= 1) {
        ui.bitmapText(g, 'VS', L.CENTER_X, PANEL_Y + 13, {
          scale: 2, align: 'center', color: PALETTE[C.YELLOW], shadow: PALETTE[C.INK],
        });
      }
    }

    // ---- 진행 안내 (공개 완료 후 깜빡임) ----
    if (!game.net && allArrived && !this.leaving && Math.floor(this.t * 3) % 2 === 0) {
      ui.text(g, 'ENTER / 클릭: 시작', L.CENTER_X, 168, {
        size: 's', align: 'center', color: PALETTE[C.WHITE], outline: PALETTE[C.INK],
      });
    }
  }

  _drawHighlight(g, x, y, w, h, bright) {
    // 4변을 fillRect 로 (stroke 금지). 모서리는 1px 깎아 둥글게
    const col = bright ? PALETTE[C.YELLOW] : PALETTE[C.WHITE];
    const ink = PALETTE[C.INK];
    g.fillStyle = ink;
    g.fillRect(x, y - 1, w, 1);
    g.fillRect(x, y + h + 2, w, 1);
    g.fillRect(x - 1, y, 1, h + 2);
    g.fillRect(x + w, y, 1, h + 2);
    g.fillStyle = col;
    g.fillRect(x + 1, y, w - 2, 2);
    g.fillRect(x + 1, y + h, w - 2, 2);
    g.fillRect(x, y + 1, 2, h);
    g.fillRect(x + w - 2, y + 1, 2, h);
    // 위쪽 작은 화살표
    const ax = x + Math.floor(w / 2);
    const ay = y - 6 + (bright ? 0 : 1);
    g.fillStyle = ink;
    g.fillRect(ax - 3, ay - 1, 7, 1);
    g.fillStyle = col;
    g.fillRect(ax - 2, ay, 5, 1);
    g.fillRect(ax - 1, ay + 1, 3, 1);
    g.fillRect(ax, ay + 2, 1, 1);
  }

  _drawRoundBanner(g) {
    const game = this.game;
    const ui = game.ui;
    const L = game.config.LAYOUT;
    const tod = (game.background && game.background.timeOfDay) || game.timeOfDayFor(this.round);
    const todName = TOD_NAMES[tod] || '';
    const w = 104;
    const x = L.CENTER_X - w / 2;
    ui.box(g, x, 4, w, 30, 'gold');
    ui.bitmapText(g, `ROUND ${this.round}`, L.CENTER_X, 8, {
      scale: 2, align: 'center', color: PALETTE[C.INK],
    });
    ui.text(g, todName, L.CENTER_X, 22, { size: 's', align: 'center', color: PALETTE[C.PLUM] });
  }

  _drawTeamPanel(g, team, x, style) {
    if (!team) return;
    const ui = this.game.ui;
    const cx = x + Math.floor(PANEL_W / 2);
    ui.box(g, x, PANEL_Y, PANEL_W, PANEL_H, style);
    ui.text(g, team.name, cx, PANEL_Y + 4, {
      size: 'l', align: 'center', color: PALETTE[C.WHITE], outline: PALETTE[C.INK],
    });
    ui.text(g, `${team.size}명`, cx, PANEL_Y + 19, {
      size: 's', align: 'center', color: PALETTE[C.WHITE], shadow: PALETTE[C.INK],
    });
    if (team.multiplier > 1) {
      ui.text(g, `힘 x${team.multiplier}`, cx, PANEL_Y + 28, {
        size: 's', align: 'center', color: PALETTE[C.YELLOW], outline: PALETTE[C.INK],
      });
    }
  }
}
