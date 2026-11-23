// 칩튠 배경음 — 16분음표 스텝 시퀀서 (베이스 / 리드 / 드럼). 보스 모드는 템포 상승.
const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI 번호 → Hz
const R = null; // 쉼표

// 2마디(32스텝) 패턴. 긴장감 있는 단조 + 살짝 코믹한 점프 리드.
const PATTERNS = {
  play: {
    bpm: 118,
    bass: [45, R, 45, 45, R, 45, 48, R, 45, R, 45, 45, R, 52, 50, R, 41, R, 41, 41, R, 41, 44, R, 43, R, 43, 43, R, 43, 47, R],
    lead: [69, R, 72, R, 76, R, 72, R, 69, R, R, 67, R, 69, R, R, 65, R, 69, R, 72, R, 69, R, 67, R, R, 64, R, 67, 71, R],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
  },
  boss: {
    bpm: 152,
    bass: [40, 40, R, 40, 43, R, 40, 40, 46, R, 40, 40, R, 47, 46, R, 40, 40, R, 40, 43, R, 40, 40, 38, R, 38, 38, R, 39, 39, R],
    lead: [76, R, 75, R, 76, R, 71, R, 67, R, 71, R, 74, R, 73, R, 76, R, 75, R, 76, R, 79, R, 78, R, 76, R, 74, 73, 71, R],
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  title: {
    bpm: 96,
    bass: [45, R, R, R, 45, R, R, R, 41, R, R, R, 43, R, R, R, 45, R, R, R, 45, R, R, R, 41, R, R, R, 43, R, 47, R],
    lead: [69, R, 72, R, 76, R, R, R, 77, R, 76, R, 72, R, R, R, 69, R, 71, R, 72, R, R, R, 74, R, 72, R, 71, R, R, R],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    hat: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  },
};

export class Music {
  constructor(audio) {
    this.audio = audio;
    this.mode = 'none';
    this.pausedMode = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.enabled = true;
  }

  setMode(mode) {
    this.pausedMode = null; // 명시적 모드 변경은 저장된 일시정지 모드를 무효화
    if (mode === this.mode) return;
    this.mode = mode;
    this.step = 0;
    if (mode === 'none' || !PATTERNS[mode]) this.stop();
    else this.start();
  }

  pause() { if (this.mode !== 'none') { const m = this.mode; this.setMode('none'); this.pausedMode = m; } }
  resume() { if (this.pausedMode) { const m = this.pausedMode; this.setMode(m); } }

  start() {
    this.stop();
    if (!this.audio.ctx) { // 오디오가 아직 잠겨 있으면 잠시 후 재시도 (잠금 해제되면 바로 시작)
      this.timer = setInterval(() => { if (this.audio.closed) this.stop(); else if (this.audio.ctx) this.start(); }, 300);
      return;
    }
    this.nextTime = this.audio.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  // 0.12초 앞까지 미리 스케줄
  schedule() {
    const a = this.audio, p = PATTERNS[this.mode];
    if (!p || !a.ctx || !this.enabled) return;
    const stepDur = 60 / p.bpm / 4;
    const now = a.ctx.currentTime;
    if (this.nextTime < now - stepDur) { // 탭 전환 등으로 타이머가 밀렸으면 놓친 스텝은 건너뛴다
      const missed = Math.ceil((now - this.nextTime) / stepDur);
      this.step += missed; this.nextTime += missed * stepDur;
    }
    while (this.nextTime < a.ctx.currentTime + 0.12) {
      const i = this.step % 32;
      const t = this.nextTime - a.ctx.currentTime;
      const dest = a.musicGain;
      const bass = p.bass[i];
      if (bass !== R) a.tone({ type: 'triangle', f0: N(bass), dur: stepDur * 0.9, vol: 0.5, delay: t, dest });
      const lead = p.lead[i];
      if (lead !== R) a.tone({ type: 'square', f0: N(lead), dur: stepDur * 1.6, vol: 0.14, delay: t, dest, attack: 0.002 });
      if (p.kick[i]) a.tone({ type: 'square', f0: 150, f1: 40, dur: 0.1, vol: 0.4, delay: t, dest });
      if (p.hat[i]) a.noise({ dur: 0.03, vol: 0.08, delay: t, filter: 'highpass', freq: 6000, dest });
      this.nextTime += stepDur;
      this.step++;
    }
  }
}
