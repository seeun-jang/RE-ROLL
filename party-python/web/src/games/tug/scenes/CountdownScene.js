// =============================================================
// 카운트다운 장면 — 줄을 잡고 버티는 자세로 3, 2, 1 → START!
// 박자 시계는 플레이 템포(BPM)로 미리 돌려서 행진곡이 이미 제 속도로 흐르게 한다.
// 카운트다운 길이는 '정수 박'(beatOffset 박)으로 맞추고, START 는 시간 누적이 아니라 박자 시계가
// beatOffset 박을 지나는 순간에 낸다 → 어떤 BPM 이어도 START = 정확히 박 경계.
// 플레이 장면은 이 박자 시계를 끊지 않고 이어받아(rebase) START 박을 박 0 으로 쓴다.
// =============================================================
import { PALETTE, C } from '../palette.js';
import { drawTopBar, drawBeatLane, drawPlayerPanels } from '../ui/HUD.js';

// ---- 연출용 상수 ----
const STEP_TIME = 1.0;                 // 숫자 하나당 목표 시간 (초) — 실제로는 정수 박에 맞춰 조금 늘거나 줄어든다
const POP_SCALES = [8, 7, 6];          // 숫자 등장 시 정수 배율 변화 (크게 → 기본)
const POP_FRAME_TIME = 0.05;           // 배율 한 단계 유지 시간 (초)
const NUMBER_CENTER_Y = 66;            // 숫자 세로 중심 (px)
const GLYPH_H = 7;                     // 비트맵 폰트 글자 높이 (PixelFont GLYPH_H 와 동일)
const PULSE_DECAY = 4;                 // 박자 레인 번쩍임 감쇠 (1/s)

export class CountdownScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.step = 0;      // 지금 보여주는 숫자 index (0 → COUNTDOWN)
    this.pulse = 0;
    this.leaving = false;
    this.beatOffset = 0;
    this.stepTime = STEP_TIME;
    this.earlyPresses = [];   // START 박 직전(Good 창 안)에 들어온 입력 — 플레이 장면이 박 0 기준으로 판정
  }

  enter() {
    const game = this.game;
    const cfg = game.config;
    this.t = 0;
    this.step = 0;
    this.pulse = 0;
    this.leaving = false;
    this.earlyPresses = [];

    // 선수 배치 + 줄 잡고 버티기 자세 (pull 0프레임). update 를 돌리지 않으므로 0프레임 유지
    game.camX = 0;
    game.world.layoutTeams();
    // resetForRound: pull 0프레임에서 멈춘 상태 → 플레이 시작 때 저절로 당기기 동작이 재생되지 않는다
    for (const p of game.players) {
      if (p.side) p.resetForRound();
    }

    // 플레이 템포 박자 시계 시작 (행진곡)
    if (game.music) game.music.stopAll();
    game.beat.reset(cfg.BPM);
    // 멀티플레이: 박자 시계의 0 을 서버가 정한 카운트다운 시작 시각에 맞춘다
    if (game.net && game.net.snap) game.beat.syncTo(game.net.snap.countdownAt);
    // 카운트다운 = 정확히 beatOffset 박 (120BPM·3카운트면 6박). 숫자 하나당 시간은 그 박들을 균등 분할
    const count = Math.max(1, cfg.COUNTDOWN | 0);
    this.beatOffset = Math.max(1, Math.round((count * STEP_TIME) / game.beat.interval));
    this.stepTime = (this.beatOffset * game.beat.interval) / count;
    // 카운트다운 박은 음수 index 로 예약한다 (-5..0) → START 박(플레이 박 0)이 행진곡 0박(첫 마디)과 맞는다
    game.scheduleBeatAudio([0], 'play', { indexOffset: -this.beatOffset, fever: false });

    // 첫 숫자 '3'
    if (game.audio) game.audio.play('countdown');
  }

  exit() {}

  update(dt) {
    const game = this.game;
    const cfg = game.config;
    const beat = game.beat;
    this.t += dt;
    this.pulse = Math.max(0, this.pulse - dt * PULSE_DECAY);

    const beats = beat.update(dt);
    if (beats.length) this.pulse = 1;
    // START 박을 지나는 스텝에서도 예약을 계속한다 (다음 박 = 플레이 1박).
    // 플레이 장면은 시계를 이어받으므로 따로 예약하지 않는다 → 끊김·중복 없음
    if (!this.leaving) {
      game.scheduleBeatAudio(beats, 'play', { indexOffset: -this.beatOffset, fever: false });
    }

    game.world.layoutTeams();
    if (this.leaving) return;

    // START 박 직전 Good 창 안의 입력은 버리지 않고 모아 두었다가 플레이 장면에 넘긴다
    const startReached = beat.lastBeatIndex >= this.beatOffset;
    const nearStart = beat.nextBeatIndex === this.beatOffset && beat.timeToNextBeat() <= cfg.GOOD_WINDOW;
    if (startReached || nearStart) this._collectEarlyPresses();

    // 숫자 단계는 박자 시계 기준 (START 는 박 경계를 지난 순간에만)
    const count = Math.max(1, cfg.COUNTDOWN | 0);
    const step = startReached ? count : Math.min(count - 1, Math.floor(beat.time / this.stepTime));
    if (step !== this.step) {
      this.step = step;
      if (step < count) {
        if (game.audio) game.audio.play('countdown');
      } else if (game.audio) {
        // START! → 휘슬 (START! 글자는 플레이 장면이 이어서 보여준다)
        game.audio.play('whistle');
      }
    }
    // 바로 플레이 장면으로 (박자 시계 이어받기). goto 가 거절되면(전환 중) 다음 스텝에 다시 시도한다
    if (startReached) {
      this.leaving = game.goto('play', {
        carryBeat: true,
        beatOffset: this.beatOffset,
        earlyPresses: this.earlyPresses,
      }, { transition: 'none' });
    }
  }

  /** 이번 스텝의 당기기 시도를 모아 둔다 (플레이 장면이 박 0 기준으로 판정) */
  _collectEarlyPresses() {
    for (const player of this.game.players) {
      if (!player.side || !player.powerSource) continue;
      const events = player.powerSource.poll(this.game) || [];
      for (const ev of events) this.earlyPresses.push({ player, ev });
    }
  }

  render(g) {
    const game = this.game;
    const cfg = game.config;
    const L = cfg.LAYOUT;
    const ui = game.ui;
    const beat = game.beat;

    game.world.drawWorld(g, { labels: true, pops: false });

    // 상단 바 (시간은 가득) + 박자 레인 + 하단 패널: 플레이 장면과 같은 배치라 화면이 튀지 않는다
    drawTopBar(g, ui, {
      round: game.round,
      rounds: cfg.ROUNDS,
      timeLeft: cfg.ROUND_TIME,
      ropePos: 0,
      winDistance: cfg.WIN_DISTANCE,
      fever: false,
      feverWarning: false,
    });
    drawBeatLane(g, ui, {
      time: beat.time,
      lastBeatTime: beat.lastBeatTime,
      nextBeatTime: beat.nextBeatTime,
      interval: beat.interval,
      fever: false,
      pulse: this.pulse,
    });
    drawPlayerPanels(g, ui, game.world.buildPanels());

    // ---- 큰 숫자 (팝인: 정수 배율 8 → 7 → 6) ----
    const remain = Math.max(1, cfg.COUNTDOWN | 0) - this.step;
    const text = remain > 0 ? String(remain) : 'START!';
    const local = beat.time - this.step * this.stepTime;
    const idx = Math.min(POP_SCALES.length - 1, Math.max(0, Math.floor(local / POP_FRAME_TIME)));
    const scale = remain > 0 ? POP_SCALES[idx] : 4;
    const y = NUMBER_CENTER_Y - Math.round((GLYPH_H * scale) / 2);
    const color = remain > 0 ? PALETTE[C.WHITE] : PALETTE[C.YELLOW];
    ui.bitmapText(g, text, L.CENTER_X, y, {
      scale, align: 'center', color, shadow: PALETTE[C.INK],
    });
  }
}
