// =============================================================
//  효과음 (소리 파일 없이 Web Audio로 합성)
//    타격음, 가드, 휘두르는 소리, 마법(미사일, 파이어볼, 번개, 메테오, 블링크), 포효, 공 소리, 관중 함성
// =============================================================

import { PLAYERS, SOUND } from '../config.js';

const kindOf = (id) => PLAYERS.find((p) => p.id === id)?.kind;

export function createSfx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return { play() {}, update() {}, setMuted() {}, isMuted: () => true, dispose() {} };

  const ctx = new AudioCtx();
  let muted = !SOUND.enabled;
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : SOUND.volume;
  // 살짝 압축해서 타격음이 단단하게
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  // 관중 함성 (계속)
  const crowd = ctx.createBufferSource();
  crowd.buffer = noise;
  crowd.loop = true;
  const crowdFilter = ctx.createBiquadFilter();
  crowdFilter.type = 'bandpass';
  crowdFilter.frequency.value = 700;
  crowdFilter.Q.value = 0.6;
  const crowdGain = ctx.createGain();
  crowdGain.gain.value = 0.0001;
  crowd.connect(crowdFilter).connect(crowdGain).connect(master);
  crowd.start();

  const now = () => ctx.currentTime;

  function burst({ duration, freq, type = 'lowpass', gain = 0.6, q = 1, delay = 0, sweep = null }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = now() + delay;
    filter.frequency.setValueAtTime(freq, t);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(sweep, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, duration / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  function tone({ from, to = from, duration, gain = 0.5, type = 'sine', delay = 0 }) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const t = now() + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  const bell = (times) => {
    for (let i = 0; i < times; i++) for (const [f, a] of [[1180, 0.3], [2360, 0.1], [3540, 0.05]]) tone({ from: f, duration: 1.4, gain: a, delay: i * 0.32 });
  };

  let swell = 0;
  const cheer = (v) => {
    swell = Math.min(1, swell + v);
  };

  return {
    play(ev) {
      if (ctx.state === 'suspended') ctx.resume();
      switch (ev.type) {
        case 'start': {
          const m = ev.move;
          if (m === 'roll' || m === 'backstep' || m === 'dash' || m === 'whiteTiger') {
            burst({ duration: 0.22, freq: 500, sweep: 2400, type: 'bandpass', gain: 0.25, q: 1 });
          } else if (m === 'pounce') {
            burst({ duration: 0.25, freq: 400, sweep: 1800, type: 'bandpass', gain: 0.25 });
          } else if (m === 'meteor') {
            tone({ from: 120, to: 480, duration: 0.8, gain: 0.25, type: 'sawtooth' });
          } else if (['jab', 'cross', 'claw', 'knee', 'palm'].includes(m)) {
            burst({ duration: 0.11, freq: 1600, sweep: 3400, type: 'bandpass', gain: 0.2, q: 1.2 });
          }
          break;
        }
        case 'cast':
          if (ev.kind === 'missile') {
            tone({ from: 900, to: 1700, duration: 0.14, gain: 0.12, type: 'triangle' });
          } else if (ev.kind === 'fireball') {
            burst({ duration: 0.45, freq: 300, sweep: 900, gain: 0.5 });
            tone({ from: 90, to: 160, duration: 0.4, gain: 0.3, type: 'sawtooth' });
          } else if (ev.kind === 'lightning') {
            tone({ from: 1400, to: 2800, duration: 0.5, gain: 0.07, type: 'square' });
          }
          break;
        case 'hit': {
          const heavy = ev.big;
          burst({ duration: heavy ? 0.16 : 0.08, freq: heavy ? 900 : 1500, gain: heavy ? 0.9 : 0.6 });
          tone({ from: heavy ? 150 : 200, to: 45, duration: heavy ? 0.24 : 0.12, gain: heavy ? 1 : 0.55 });
          if (kindOf(ev.attacker) === 'professor') {
            for (const [i, f] of [880, 1320, 1760].entries()) tone({ from: f, to: f * 1.5, duration: 0.25, gain: 0.07, type: 'triangle', delay: i * 0.03 });
          } else {
            burst({ duration: 0.12, freq: 3200, type: 'highpass', gain: 0.25, delay: 0.01 });
          }
          cheer(heavy ? 0.35 : 0.1);
          break;
        }
        case 'block':
          burst({ duration: 0.06, freq: 2400, type: 'bandpass', gain: 0.5, q: 2 });
          tone({ from: 300, to: 160, duration: 0.07, gain: 0.25 });
          break;
        case 'guardbreak':
          burst({ duration: 0.25, freq: 2000, gain: 0.9 });
          tone({ from: 160, to: 40, duration: 0.35, gain: 0.9 });
          cheer(0.5);
          break;
        case 'explode':
          if (ev.kind === 'fireball') {
            burst({ duration: 0.5, freq: 500, gain: 0.9 });
            tone({ from: 120, to: 35, duration: 0.5, gain: 0.8 });
          } else {
            burst({ duration: 0.12, freq: 2200, type: 'bandpass', gain: 0.3 });
          }
          break;
        case 'strike':
          if (ev.kind === 'lightning') {
            burst({ duration: 0.5, freq: 4000, type: 'highpass', gain: 0.8 });
            burst({ duration: 0.8, freq: 200, gain: 0.7, delay: 0.05 });
          } else {
            const big = ev.kind === 'meteor';
            burst({ duration: big ? 1.1 : 0.5, freq: big ? 220 : 400, gain: 1 });
            tone({ from: big ? 70 : 110, to: 25, duration: big ? 1 : 0.5, gain: 1 });
          }
          cheer(0.5);
          break;
        case 'roar':
          tone({ from: 220, to: 80, duration: 0.6, gain: 0.5, type: 'sawtooth' });
          burst({ duration: 0.6, freq: 300, gain: 0.5 });
          cheer(0.5);
          break;
        case 'blink':
          for (const [i, f] of [1200, 1800, 2400].entries()) tone({ from: f, to: f * 0.5, duration: 0.2, gain: 0.08, type: 'sine', delay: i * 0.03 });
          break;
        case 'deflect':
          tone({ from: 2600, to: 1400, duration: 0.15, gain: 0.2, type: 'triangle' });
          cheer(0.3);
          break;
        case 'area':
          if (ev.move === 'blast') {
            burst({ duration: 0.35, freq: 700, sweep: 200, gain: 0.7 });
            tone({ from: 300, to: 90, duration: 0.3, gain: 0.5, type: 'triangle' });
          } else {
            tone({ from: 110, to: 40, duration: 0.3, gain: 0.8 });
          }
          break;
        case 'superConnect':
          tone({ from: 300, to: 900, duration: 0.4, gain: 0.3, type: 'sawtooth' });
          cheer(1);
          break;
        case 'stun':
          tone({ from: 1500, to: 900, duration: 0.3, gain: 0.12, type: 'square' });
          break;
        case 'bell':
          bell(ev.times ?? 1);
          cheer(0.5);
          break;
        case 'ko':
          tone({ from: 80, to: 25, duration: 1, gain: 1 });
          burst({ duration: 0.6, freq: 300, gain: 0.9, delay: 0.5 });
          bell(3);
          cheer(1);
          break;
        case 'victory':
        case 'round':
          cheer(0.7);
          break;
        default:
          break;
      }
    },
    update(hype, dt) {
      swell = Math.max(0, swell - dt * 0.6);
      crowdGain.gain.setTargetAtTime(0.03 + hype * 0.15 + swell * 0.3, now(), 0.12);
      crowdFilter.frequency.setTargetAtTime(550 + hype * 450 + swell * 300, now(), 0.2);
    },
    setMuted(v) {
      muted = v;
      master.gain.setTargetAtTime(muted ? 0 : SOUND.volume, now(), 0.05);
      if (!muted && ctx.state === 'suspended') ctx.resume();
    },
    isMuted: () => muted,
    dispose() {
      try {
        crowd.stop();
        ctx.close();
      } catch {
        /* 이미 닫힘 */
      }
    },
  };
}
