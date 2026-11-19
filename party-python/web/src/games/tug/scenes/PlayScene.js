// =============================================================
// 플레이 장면 (핵심) — 박자 판정 → 힘 → 줄 이동 → 승패
// 입력 경로: player.powerSource.poll(game) → BeatJudge.judge → computePower → rope.addForce
// =============================================================
import { PALETTE, C } from '../palette.js';
import { computePower } from '../systems/PowerCalculator.js';
import {
  drawTopBar, drawBeatLane, drawFeverBanner, drawPlayerPanels, drawCenterBanner,
} from '../ui/HUD.js';

// ---- 연출용 상수 ----
const END_HOLD = 1.0;            // 라운드 종료 후 결과 장면으로 넘어가기까지 (초)
const START_BANNER_TIME = 0.7;   // 'START!' 글자 표시 시간 (초)
const PULSE_DECAY = 4;           // 박자 번쩍임 감쇠 (1/s)
const MAX_INPUT_LAG = 0.25;      // 입력 지연 보정 상한 (초) — 탭 복귀 등 비정상 값 방지
const HAND_OFFSET = 6;           // 발 중앙에서 손(줄 잡는 곳)까지 x 거리
const FEVER_FIRE_INTERVAL = 0.12;// 피버 중 발밑 불꽃 간격 (초)
const FEVER_ROPE_FIRE_STEP = 10; // 피버 시작 시 줄을 따라 불꽃 간격 (px)
const SLIP_DUST_INTERVAL = 0.15; // 미끄러지는 동안 흙먼지 간격 (초)
const SLIP_SOUND_INTERVAL = 0.7; // 미끄러짐 효과음 최소 간격 (초)
const ROUND_WIN_SOUND_DELAY = 0.35; // 종료 휘슬 뒤 승리 효과음 지연 (초)

const SIDES = ['left', 'right'];

export class PlayScene {
  constructor(game) {
    this.game = game;
    this.timeLeft = 0;
    this.t = 0;
    this.ended = false;
    this.endT = 0;
    this.winnerSide = null;
    this.leaving = false;
    this.pulse = 0;
    this.feverFireT = 0;
    this.slipDustT = { left: 0, right: 0 };
    this.slipSoundT = { left: 0, right: 0 };
    this.tempoRequest = null; // 피버 시작/끝 템포 변경 요청 { bpm, fever } — 다음 박을 지날 때 적용
    this.musicFever = false;  // 지금까지 예약한 박 구간의 피버 편곡 여부
  }

  enter(params = {}) {
    const game = this.game;
    const cfg = game.config;
    const beat = game.beat;
    const offset = params && params.carryBeat ? (params.beatOffset | 0) : 0;
    if (offset > 0 && beat.lastBeatIndex >= offset) {
      // 카운트다운의 박자 시계를 끊지 않고 이어받는다: START 박을 박 0 으로 다시 번호 매김.
      // (카운트다운이 이미 다음 박(1)까지 같은 격자로 예약했으므로 여기서는 예약하지 않는다 → 박이 겹치거나 어긋나지 않음)
      beat.rebase(offset);
    } else {
      // 카운트다운 없이 들어온 경우: 새 시계 + 남은 예약음 정리
      game.music.stopAll();
      beat.reset(cfg.BPM);
      game.scheduleBeatAudio([0], 'play', { fever: false });
    }
    this.tempoRequest = null;
    this.musicFever = false;
    this.timeLeft = cfg.ROUND_TIME;
    this.t = 0;
    this.ended = false;
    this.endT = 0;
    this.winnerSide = null;
    this.leaving = false;
    this.pulse = 1;
    this.feverFireT = 0;
    this.slipDustT = { left: 0, right: 0 };
    this.slipSoundT = { left: 0, right: 0 };
    game.camX = 0;
    game.world.layoutTeams();

    // 이어받은 시계는 START 박을 조금(최대 1스텝) 지나 있다 → 라운드 시계(피버·남은 시간)도 같은 시각에서 시작해
    // 피버 시작과 박 경계가 같은 스텝에 오도록 맞춘다 (어긋나면 피버 템포가 한 박 늦게 바뀜)
    const lead = Math.max(0, beat.time);
    if (lead > 0) {
      game.fever.update(lead);
      this.timeLeft = Math.max(0, cfg.ROUND_TIME - lead);
    }

    // 카운트다운 START 박 직전(Good 창 안)에 누른 입력은 박 0 기준으로 판정한다 (버리지 않음)
    const early = params && Array.isArray(params.earlyPresses) ? params.earlyPresses : [];
    if (early.length) this._processInputs(early);
  }

  exit() {}

  update(dt) {
    const game = this.game;
    const cfg = game.config;
    const beat = game.beat;
    this.t += dt;
    this.pulse = Math.max(0, this.pulse - dt * PULSE_DECAY);

    // 1) 박자 시계
    const beats = beat.update(dt);
    if (beats.length) this.pulse = 1;

    if (this.ended) {
      this._scheduleBeats(beats);
      this._updateEnded(dt);
      return;
    }

    // 2) 피버 (템포 변경은 요청만) → 음악/틱 예약 (요청된 템포를 예약과 같은 박 경계에서 적용)
    this._updateFever(dt);
    this._scheduleBeats(beats);

    // 3) 입력 → 판정 → 힘
    this._processInputs();

    // 4) 줄 물리 + 배치 + 미끄러짐
    game.rope.update(dt);
    game.world.layoutTeams();
    this._updateSlip(dt);
    for (const p of game.players) p.update(dt, game.fx.frozen);

    // 5) 카메라 + 관중 들썩임
    game.camX = Math.round(game.rope.pos * cfg.CAMERA_FOLLOW);
    const lean = Math.min(1, Math.abs(game.rope.pos) / game.rope.winDistance);
    const urgency = this.timeLeft <= 5 ? 0.2 : 0;
    game.background.setExcitement(Math.min(1, 0.25 + lean * 0.45 + (game.fever.active ? 0.3 : 0) + urgency));

    // 6) 시간 + 승패
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const winner = game.rope.winner();
    if (winner) this._endRound(winner);
    else if (this.timeLeft <= 0) this._endRound(game.rope.leader());
  }

  /**
   * 박을 지난 스텝에서 다음 박의 음악·틱을 예약한다.
   * 박 k 를 지나는 지금 예약하는 것은 'k+1 → k+2' 구간이다. 피버 템포 변경을 여기서 setBpm 하면
   * 정확히 k+1 경계(= 지금 예약하는 구간의 시작)에 적용되므로, 음악 예약 구간 길이·편곡과 실제 박 간격이 항상 같다.
   * (피버가 박 사이에 시작/끝나면 템포는 다음 박 경계 하나를 더 기다렸다 바뀐다 — 이미 예약된 박은 건드리지 않는다)
   */
  _scheduleBeats(beats) {
    if (!beats || beats.length === 0) return;
    const game = this.game;
    if (this.tempoRequest) {
      game.beat.setBpm(this.tempoRequest.bpm);
      this.musicFever = this.tempoRequest.fever;
      this.tempoRequest = null;
    }
    game.scheduleBeatAudio(beats, 'play', { fever: this.musicFever });
  }

  _updateFever(dt) {
    const game = this.game;
    const cfg = game.config;
    const ev = game.fever.update(dt);
    if (ev === 'start') {
      this.tempoRequest = { bpm: cfg.FEVER_BPM, fever: true };
      game.audio.play('fever');
      game.fx.flash(PALETTE[C.YELLOW], 0.25);
      // 줄을 따라 불꽃이 확 번진다
      const { x0, x1 } = game.world.ropeExtents();
      for (let x = x0; x <= x1; x += FEVER_ROPE_FIRE_STEP) {
        game.particles.emit('fire', x, cfg.LAYOUT.ROPE_Y, { count: 2 });
      }
    } else if (ev === 'end') {
      this.tempoRequest = { bpm: cfg.BPM, fever: false };
    }

    // 피버 중: 선수 발밑에서 가끔 불꽃
    if (game.fever.active) {
      this.feverFireT -= dt;
      if (this.feverFireT <= 0) {
        this.feverFireT = FEVER_FIRE_INTERVAL;
        const members = game.players.filter((p) => p.side);
        if (members.length) {
          const p = members[Math.floor(Math.random() * members.length)];
          game.particles.emit('fire', Math.round(p.x), cfg.LAYOUT.GROUND_Y, { count: 2 });
        }
      }
    } else {
      this.feverFireT = 0;
    }
  }

  /**
   * 입력 → 판정 → 힘. preset 이 있으면 poll 대신 그 목록 [{ player, ev }] 을 판정한다
   * (카운트다운이 START 직전에 모아 넘긴 입력).
   */
  _processInputs(preset = null) {
    const game = this.game;
    const cfg = game.config;
    const L = cfg.LAYOUT;
    const beat = game.beat;
    const fever = game.fever;
    const played = new Set(); // 이번 스텝에 이미 낸 효과음 (같은 등급 중복 방지)
    const now = performance.now();

    const attempts = [];
    if (preset) {
      for (const a of preset) if (a && a.player && a.ev) attempts.push(a);
    } else {
      for (const player of game.players) {
        if (!player.side || !player.powerSource) continue;
        const events = player.powerSource.poll(game) || [];
        for (const ev of events) attempts.push({ player, ev });
      }
    }

    for (const { player, ev } of attempts) {
      if (!player.side) continue;
      // 키를 누른 실제 시각(timeStamp)과 지금의 차이만큼 판정 시각을 되돌린다
      const ts = typeof ev.timeStamp === 'number' ? ev.timeStamp : now;
      const lag = Math.min(MAX_INPUT_LAG, Math.max(0, (now - ts) / 1000));
      const t = beat.time - lag - cfg.INPUT_OFFSET;
      const { grade } = beat.judge(player.id, t);
      const team = game.teams[player.side];

      // TODO(AI): AI 판정(퀴즈 정답 등) 보너스는 PowerSource.poll() 이 돌려주는 ev.bonus 로 들어온다.
      //           bonus.powerMult → computePower 의 힘 배율, bonus.scorePoints → 점수 가산.
      const power = computePower({
        grade,
        config: cfg,
        teamMultiplier: team ? team.multiplier : 1,
        fever: fever.active,
        bonus: ev.bonus ?? null,
      });
      game.rope.addForce(player.side, power);
      game.scoreBoard.record(player.id, grade, {
        fever: fever.active,
        bonusPoints: ev.bonus?.scorePoints ?? 0,
      });
      game.scoreBoard.addPower(player.id, power);
      player.onPull(grade);

      // ---- 판정별 손맛 연출 ----
      const dir = player.side === 'left' ? 1 : -1;      // 바라보는 방향
      const handX = Math.round(player.x) + dir * HAND_OFFSET;
      const pan = player.side === 'left' ? -0.3 : 0.3;
      if (!played.has(grade)) {
        played.add(grade);
        game.audio.play(grade, { pan });
      }
      if (grade === 'perfect') {
        game.fx.hitstop(cfg.HITSTOP);
        game.rope.kick(2);
        game.fx.shake(cfg.SHAKE_PERFECT.intensity, cfg.SHAKE_PERFECT.duration);
        game.particles.emit('sparkle', handX, L.ROPE_Y, { count: 6 });
      } else if (grade === 'good') {
        game.particles.emit('dust', Math.round(player.x), L.GROUND_Y, { count: 3, dir: -dir });
      } else if (grade === 'spam') {
        game.particles.emit('spark', handX, L.ROPE_Y, { count: 2 });
      }
    }
  }

  _updateSlip(dt) {
    const game = this.game;
    const cfg = game.config;
    const vel = game.rope.vel;
    for (const side of SIDES) {
      const team = game.teams[side];
      if (!team) continue;
      // 상대 쪽으로 빠르게 끌려가면 미끄러짐 (왼쪽 팀은 +, 오른쪽 팀은 - 방향이 상대 쪽)
      const dragged = side === 'left' ? vel > cfg.SLIP_SPEED : vel < -cfg.SLIP_SPEED;
      this.slipSoundT[side] = Math.max(0, this.slipSoundT[side] - dt);
      if (dragged) {
        let started = false;
        for (const p of team.members) {
          if (p.anim !== 'slip') {
            p.setAnim('slip');
            started = true;
          }
        }
        this.slipDustT[side] -= dt;
        if (this.slipDustT[side] <= 0) {
          this.slipDustT[side] = SLIP_DUST_INTERVAL;
          const dir = side === 'left' ? 1 : -1; // 끌려가는 방향
          for (const p of team.members) {
            game.particles.emit('dust', Math.round(p.x), cfg.LAYOUT.GROUND_Y, { count: 1, dir: -dir });
          }
        }
        if (started && this.slipSoundT[side] <= 0) {
          this.slipSoundT[side] = SLIP_SOUND_INTERVAL;
          game.audio.play('slip', { pan: side === 'left' ? -0.3 : 0.3 });
        }
      } else {
        this.slipDustT[side] = 0;
        for (const p of team.members) {
          if (p.anim === 'slip') p.setAnim('pull');
        }
      }
    }
  }

  _endRound(winnerSide) {
    const game = this.game;
    const cfg = game.config;
    this.ended = true;
    this.endT = 0;
    this.winnerSide = winnerSide || null;

    game.audio.play('whistleEnd');
    if (this.winnerSide) game.audio.play('roundWin', { delay: ROUND_WIN_SOUND_DELAY });
    game.fx.shake(cfg.SHAKE_ROUND_END.intensity, cfg.SHAKE_ROUND_END.duration);

    if (this.winnerSide) {
      const loserSide = this.winnerSide === 'left' ? 'right' : 'left';
      const winners = game.teams[this.winnerSide];
      const losers = game.teams[loserSide];
      for (const p of winners.members) p.setAnim('win', true);
      for (const p of losers.members) p.setAnim('fall', true);
      // 진 팀 맨 앞 선수가 진흙 웅덩이로 철퍽
      const front = losers.members[0];
      if (front) {
        game.particles.emit('mud', Math.round(front.x), cfg.LAYOUT.GROUND_Y, {
          count: 14, dir: loserSide === 'left' ? 1 : -1,
        });
      }
    } else {
      for (const p of game.players) if (p.side) p.setAnim('idle', true);
    }
    game.background.setExcitement(1);
  }

  _updateEnded(dt) {
    const game = this.game;
    this.endT += dt;
    // 줄은 멈춘 채로, 선수 애니메이션(승리 점프/넘어짐)만 진행
    for (const p of game.players) p.update(dt, game.fx.frozen);
    // 전환 중이라 goto 가 거절되면 다음 스텝에 다시 시도한다 (endRound 는 정확히 1회)
    if (!this.leaving && this.endT >= END_HOLD && !game.fx.transitioning) {
      this.leaving = true;
      const result = game.endRound(this.winnerSide);
      game.goto('roundResult', { result }, { transition: 'none' });
    }
  }

  render(g) {
    const game = this.game;
    const cfg = game.config;
    const L = cfg.LAYOUT;
    const ui = game.ui;
    const beat = game.beat;
    const fever = game.fever;

    game.world.drawWorld(g, { labels: true, pops: !this.ended });

    drawTopBar(g, ui, {
      round: game.round,
      rounds: cfg.ROUNDS,
      timeLeft: this.timeLeft,
      ropePos: game.rope.pos,
      winDistance: game.rope.winDistance,
      fever: fever.active,
      feverWarning: fever.warning,
    });
    drawBeatLane(g, ui, {
      time: beat.time,
      lastBeatTime: beat.lastBeatTime,
      nextBeatTime: beat.nextBeatTime,
      // 템포 변경이 예약돼 있으면 다음 박 이후 노트는 새 간격으로 온다
      interval: beat.pendingBpm > 0 ? 60 / beat.pendingBpm : beat.interval,
      fever: fever.active,
      pulse: this.pulse,
    });
    if (!this.ended) {
      drawFeverBanner(g, ui, {
        active: fever.active,
        warning: fever.warning,
        remaining: fever.remaining,
        t: this.t,
      });
    }
    drawPlayerPanels(g, ui, game.world.buildPanels());

    // 카운트다운에서 이어지는 'START!' (깜빡이며 사라짐)
    if (this.t < START_BANNER_TIME && Math.floor(this.t * 12) % 2 === 0) {
      ui.bitmapText(g, 'START!', L.CENTER_X, 52, {
        scale: 4, align: 'center', color: PALETTE[C.YELLOW], shadow: PALETTE[C.INK],
      });
    }

    if (this.ended) {
      drawCenterBanner(g, ui, 'FINISH!', { style: 'gold', y: 60, size: 'xl' });
    }
  }
}
