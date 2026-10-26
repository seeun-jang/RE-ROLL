// =============================================================
//  효과음 (Web Audio API로 직접 합성 — 소리 파일 없음)
//    - 관중 함성: 잡음을 걸러 "와아~" 하는 소리를 만들고, 열기(hype)에 따라 크기 조절
//    - 타격음: 펀치(짧은 퍽), 킥(묵직한 퍽), 필살기(쾅)
//    - 가드: 탁 막는 소리
//    - 공 소리: 경기 시작 땡, K.O./시간 종료 땡땡땡
//
//  브라우저는 사용자가 키를 누르거나 클릭한 뒤에만 소리를 낼 수 있습니다.
//  (타이틀에서 시작 버튼/키를 누른 뒤 경기 화면에서 만들어지므로 문제없음)
// =============================================================

function makeNoiseBuffer(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // 핑크 노이즈에 가까운 잡음 (사람 목소리 무리처럼 부드러움)
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
  }
  return buffer;
}

/**
 * @param {{enabled: boolean, volume: number}} options
 */
export function createCrowdAudio({ enabled = true, volume = 0.8 } = {}) {
  let ctx = null;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = AudioCtx ? new AudioCtx() : null;
  } catch {
    ctx = null;
  }

  // 소리를 낼 수 없는 환경이면 아무것도 하지 않는 객체를 돌려줌
  if (!ctx) {
    return { play() {}, update() {}, setMuted() {}, isMuted: () => true, dispose() {} };
  }

  let muted = !enabled;
  const master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;
  master.connect(ctx.destination);

  const noise = makeNoiseBuffer(ctx, 3);

  // ---- 관중 함성 (계속 재생) ----
  const crowdSource = ctx.createBufferSource();
  crowdSource.buffer = noise;
  crowdSource.loop = true;
  const crowdBand = ctx.createBiquadFilter();
  crowdBand.type = 'bandpass';
  crowdBand.frequency.value = 700;
  crowdBand.Q.value = 0.7;
  const crowdVowel = ctx.createBiquadFilter(); // "아~" 느낌의 울림
  crowdVowel.type = 'peaking';
  crowdVowel.frequency.value = 1100;
  crowdVowel.Q.value = 1.2;
  crowdVowel.gain.value = 8;
  const crowdGain = ctx.createGain();
  crowdGain.gain.value = 0.0001;
  crowdSource.connect(crowdBand).connect(crowdVowel).connect(crowdGain).connect(master);
  crowdSource.start();

  const now = () => ctx.currentTime;

  // 짧은 잡음 터짐 (타격, 가드)
  function noiseBurst({ duration, freq, type = 'lowpass', gain = 0.6, q = 1 }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = now();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(master);
    src.start(t, Math.random() * 2);
    src.stop(t + duration + 0.05);
  }

  // 낮게 떨어지는 음 (묵직한 타격감)
  function thump({ from, to, duration, gain = 0.8 }) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const t = now();
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // 링 공 소리
  function bell(times = 1) {
    for (let i = 0; i < times; i++) {
      const t = now() + i * 0.28;
      for (const [freq, amp] of [
        [1320, 0.35],
        [2640, 0.12],
        [3960, 0.06],
      ]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(amp, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
        osc.connect(g).connect(master);
        osc.start(t);
        osc.stop(t + 1.5);
      }
    }
  }

  // 함성이 확 커졌다가 돌아옴
  let swell = 0;
  function cheerSwell(amount) {
    swell = Math.min(1, swell + amount);
  }

  return {
    /** 경기 사건에 맞는 소리 재생 */
    play(event) {
      if (ctx.state === 'suspended') ctx.resume();
      switch (event.type) {
        case 'hit':
          if (event.attack === 'punch') {
            noiseBurst({ duration: 0.09, freq: 1400, gain: 0.7 });
            thump({ from: 160, to: 60, duration: 0.12, gain: 0.7 });
            cheerSwell(0.15);
          } else if (event.attack === 'kick') {
            noiseBurst({ duration: 0.14, freq: 1000, gain: 0.85 });
            thump({ from: 120, to: 45, duration: 0.2, gain: 0.9 });
            cheerSwell(0.3);
          } else {
            noiseBurst({ duration: 0.3, freq: 2200, gain: 0.9 });
            thump({ from: 110, to: 35, duration: 0.45, gain: 1 });
            cheerSwell(0.7);
          }
          break;
        case 'block':
          noiseBurst({ duration: 0.06, freq: 2600, type: 'bandpass', gain: 0.6, q: 2 });
          thump({ from: 220, to: 120, duration: 0.06, gain: 0.35 });
          break;
        case 'break':
          noiseBurst({ duration: 0.18, freq: 1800, gain: 0.8 });
          thump({ from: 140, to: 50, duration: 0.25, gain: 0.9 });
          cheerSwell(0.5);
          break;
        case 'bell':
          bell(1);
          cheerSwell(0.5);
          break;
        case 'ko':
          thump({ from: 90, to: 30, duration: 0.7, gain: 1 });
          bell(3);
          cheerSwell(1);
          break;
        case 'timeup':
          bell(3);
          cheerSwell(0.6);
          break;
        case 'cheer':
        case 'crowd-start':
          cheerSwell(0.6);
          break;
        default:
          break;
      }
    },
    /** 매 프레임: 관중 열기에 맞춰 함성 크기 조절 */
    update(hype, dt) {
      swell = Math.max(0, swell - dt * 0.8);
      const level = 0.05 + hype * 0.22 + swell * 0.35;
      crowdGain.gain.setTargetAtTime(level, now(), 0.12);
      crowdBand.frequency.setTargetAtTime(600 + hype * 500 + swell * 300, now(), 0.2);
    },
    setMuted(value) {
      muted = value;
      master.gain.setTargetAtTime(muted ? 0 : volume, now(), 0.05);
      if (!muted && ctx.state === 'suspended') ctx.resume();
    },
    isMuted: () => muted,
    dispose() {
      try {
        crowdSource.stop();
        ctx.close();
      } catch {
        /* 이미 닫힘 */
      }
    },
  };
}
