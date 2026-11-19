// =============================================================
// Match.js — 한 판(플레이어 1명 vs CPU 챔피언)의 순수 게임 로직
//   - 렌더링/사운드와 분리: 일어난 일은 events 배열에 쌓고 Scene이 꺼내 연출한다
//   - 승패: 발이 떨어지면(|균형| ≥ 100) 패배, 시간 종료 시 |균형|이 작은 쪽 승리
// =============================================================
import { Fighter, EMPTY_INPUT } from './Fighter.js';
import { SwayField } from './BalanceSystem.js';
import { resolveCombat } from './Combat.js';

export class Match {
  constructor({ cfg, playerName, playerLook, cpuName, cpuLook }) {
    this.cfg = cfg;
    const S = cfg.STAGE;
    this.player = new Fighter({ cfg, side: 'left', name: playerName, lookId: playerLook, baseX: S.P1_X });
    this.cpu = new Fighter({ cfg, side: 'right', name: cpuName, lookId: cpuLook, baseX: S.P2_X });
    this.player.opponent = this.cpu;
    this.cpu.opponent = this.player;
    // 같은 시드 → 모든 도전자가 같은 흔들림 패턴을 겪는다
    this.swayP = new SwayField(cfg, cfg.MATCH.SEED);
    this.swayC = new SwayField(cfg, cfg.MATCH.SEED + 7919);
    this.frame = 0; // 경기 진행 프레임 (히트스톱 중엔 멈춤)
    this.hitstop = 0;
    this.events = [];
    this.running = false;
    this.over = false;
    this.result = null; // { winner: 'player'|'cpu'|'draw', reason: 'ko'|'time', loser }
    this.emit = (e) => this.events.push(e);
    // 히트스톱 중에 들어온 순간 입력(K, 짧은 J)을 버리지 않고 모아 두었다가 멈춤이 끝나면 전달
    this.bufP = { feint: false, push: false };
    this.bufC = { feint: false, push: false };
  }

  get timeLimitFrames() {
    return this.cfg.MATCH.TIME_LIMIT * this.cfg.SCREEN.LOGIC_FPS;
  }
  get timeLeft() {
    return Math.max(0, (this.timeLimitFrames - this.frame) / this.cfg.SCREEN.LOGIC_FPS);
  }
  get elapsedSec() {
    return this.frame / this.cfg.SCREEN.LOGIC_FPS;
  }
  // 받침대 흔들림 정도 0~1
  get wobble() {
    return this.swayP.growth(this.frame);
  }

  start() {
    this.running = true;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /**
   * @param {number} dt 프레임 (슬로모션이면 < 1)
   * @param {object} pInput 플레이어 InputFrame
   * @param {object} cInput CPU InputFrame
   */
  update(dt, pInput, cInput) {
    // 히트스톱: 손바닥이 맞부딪친 순간 잠깐 정지
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      bufferEdges(this.bufP, pInput);
      bufferEdges(this.bufC, cInput);
      return;
    }
    pInput = flushEdges(this.bufP, pInput);
    cInput = flushEdges(this.bufC, cInput);
    const active = this.running && !this.over;
    const env = {
      cfg: this.cfg,
      frame: this.frame,
      emit: this.emit,
      sway: 0,
    };
    // 승부가 난 뒤에는 입력 무시 (넘어지는 연출만 진행)
    const pi = active ? pInput : EMPTY_INPUT;
    const ci = active ? cInput : EMPTY_INPUT;

    env.sway = active ? this.swayP.force(this.frame, dt) : 0;
    this.player.update(dt, pi, env);
    env.sway = active ? this.swayC.force(this.frame, dt) : 0;
    this.cpu.update(dt, ci, env);

    if (active) {
      resolveCombat(this.player, this.cpu, env);
      this.frame += dt;
      this.checkEnd();
    }
  }

  checkEnd() {
    const p = this.player;
    const c = this.cpu;
    if (p.fallen || c.fallen) {
      // 둘 다 같은 프레임에 넘어지면 한계를 더 많이 넘은 쪽이 패배 (거의 같으면 무승부)
      if (p.fallen && c.fallen) {
        const diff = p.fallOvershoot - c.fallOvershoot;
        if (Math.abs(diff) < 0.05) {
          this.finish('draw', 'ko');
          return;
        }
        this.finish(diff > 0 ? 'cpu' : 'player', 'ko');
        return;
      }
      const winner = p.fallen ? c : p;
      winner.won = true;
      winner.endAction();
      this.finish(winner === p ? 'player' : 'cpu', 'ko');
      return;
    }
    if (this.frame >= this.timeLimitFrames) {
      // 시간 종료 — 균형이 더 안정적인(|균형|이 작은) 쪽 승리
      const dp = Math.abs(p.body.b);
      const dc = Math.abs(c.body.b);
      let winner = 'draw';
      if (dp + 0.5 < dc) winner = 'player';
      else if (dc + 0.5 < dp) winner = 'cpu';
      for (const f of [p, c]) {
        f.endAction();
        f.frozen = true; // 판정이 난 자세 그대로 멈춤
      }
      if (winner === 'player') p.won = true;
      if (winner === 'cpu') c.won = true;
      this.emit({ type: 'timeUp', winner });
      this.finish(winner, 'time');
    }
  }

  finish(winner, reason) {
    this.over = true;
    this.running = false;
    this.result = {
      winner,
      reason,
      timeLeft: this.timeLeft,
      playerStability: this.player.fallen ? 0 : this.player.body.stability,
      cpuStability: this.cpu.fallen ? 0 : this.cpu.body.stability,
    };
    this.emit({ type: 'matchEnd', result: this.result });
  }

  // 받침대 흔들림 오프셋(px) — 시간이 지날수록 커진다
  stoneWobble(which) {
    const g = this.wobble;
    if (g <= 0 || this.over) return 0;
    const phase = which === 'player' ? 0 : 1.7;
    return Math.round(Math.sin(this.frame * 0.35 + phase) * (0.4 + g * 1.2));
  }

  // CPU 결정 모듈에 넘기는 gameState 스냅샷 (JSON 직렬화 가능)
  snapshotForCpu() {
    return {
      frame: Math.floor(this.frame),
      timeLeft: Math.round(this.timeLeft * 100) / 100,
      timeLimit: this.cfg.MATCH.TIME_LIMIT,
      playerName: this.player.name,
      self: this.cpu.view(),
      opponent: this.player.view(),
      opponentHistory: this.player.history.map((h) => ({ ...h })),
      selfHistory: this.cpu.history.map((h) => ({ ...h })),
    };
  }
}

// 히트스톱 동안 들어온 순간 입력 기록
function bufferEdges(buf, input) {
  if (!input) return;
  if (input.feintPressed) buf.feint = true;
  if (input.pushDown) buf.push = true;
}

// 멈춤이 끝난 첫 프레임에 모아 둔 입력을 합쳐서 전달
function flushEdges(buf, input) {
  if (!buf.feint && !buf.push) return input;
  const base = input || EMPTY_INPUT;
  const out = { ...base, feintPressed: base.feintPressed || buf.feint, pushDown: base.pushDown || buf.push };
  buf.feint = false;
  buf.push = false;
  return out;
}
