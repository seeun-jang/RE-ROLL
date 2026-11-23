// 음악과 효과음을 파일 없이 Web Audio 로 직접 만들어 냅니다.
// 브라우저 정책상 사용자가 클릭/키 입력을 한 뒤에 unlockAudio() 를 불러야 소리가 나요.

let ctx = null;
let master = null;
let muted = false;
let noiseBuffer = null;
const VOLUME = 0.5;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = value ? 0 : VOLUME;
}

export const isMuted = () => muted;

// 오디오 시계 (노래 박자에 정확히 맞추기 위해 사용). 소리를 못 내는 환경이면 null
export function audioClock() {
  if (!ctx || ctx.state !== 'running') return null;
  return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function voice({ freq, to, dur = 0.12, type = 'square', vol = 0.3, at, attack = 0.004, filter, dest }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(vol, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let node = osc;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    osc.connect(f);
    node = f;
  }
  node.connect(gain).connect(dest || master);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

function noise({ dur = 0.3, vol = 0.5, freq = 1200, to, type = 'lowpass', at, dest }) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, at);
  if (to) f.frequency.exponentialRampToValueAtTime(to, at + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(gain).connect(dest || master);
  src.start(at);
  src.stop(at + dur + 0.05);
}

// ---------- 노래 ----------

function playMusicEvent(ev, at, dest) {
  switch (ev.kind) {
    case 'stick':
      voice({ freq: ev.accent ? 1800 : 1400, dur: 0.05, type: 'square', vol: 0.12, at, dest });
      break;
    case 'kick':
      voice({ freq: 150, to: 42, dur: 0.32, type: 'sine', vol: 0.9, at, dest });
      break;
    case 'snare':
      noise({ dur: 0.16, vol: ev.soft ? 0.2 : 0.45, freq: 1900, type: 'bandpass', at, dest });
      voice({ freq: 210, to: 160, dur: 0.1, type: 'triangle', vol: ev.soft ? 0.1 : 0.2, at, dest });
      break;
    case 'hat':
      noise({ dur: 0.04, vol: 0.12, freq: 7500, type: 'highpass', at, dest });
      break;
    case 'tom':
      voice({ freq: 120, to: 70, dur: 0.35, type: 'sine', vol: 0.55, at, dest });
      break;
    case 'bass':
      voice({ freq: mtof(ev.midi), dur: ev.dur, type: 'sawtooth', vol: 0.22, at, filter: 420, dest });
      break;
    case 'lead': {
      const f = mtof(ev.midi);
      voice({ freq: f, dur: ev.dur, type: 'triangle', vol: 0.2, at, dest });
      voice({ freq: f * 1.003, dur: ev.dur * 0.8, type: 'sawtooth', vol: 0.06, at, filter: 2600, dest });
      break;
    }
    case 'horn':
      for (const iv of [0, 7, 12]) {
        voice({ freq: mtof(ev.midi + iv), dur: ev.dur, type: 'sawtooth', vol: 0.05, at, attack: 0.25, filter: 1300, dest });
      }
      break;
    default:
      break;
  }
}

// 노래 전체를 미리 예약합니다. 돌려주는 값: { startAt(오디오 시계 기준), stop() }
export function startSong(song, delay = 0.4) {
  if (!ctx) return null;
  const bus = ctx.createGain();
  bus.connect(master);
  const startAt = ctx.currentTime + delay;
  for (const ev of song.music) playMusicEvent(ev, startAt + ev.t, bus);
  if (song.audio) playUploadedSong(song, startAt, bus);
  return {
    startAt: startAt - (ctx.outputLatency || ctx.baseLatency || 0),
    stop() {
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      setTimeout(() => bus.disconnect(), 300);
    },
  };
}

// 사용자가 올린 노래: 카운트인 동안 서서히 커지고, 끝에서 서서히 작아짐
function playUploadedSong(song, startAt, bus) {
  const { buffer, offset, preRoll } = song.audio;
  const level = 0.9;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  src.connect(gain).connect(bus);
  const begin = startAt + song.countIn - preRoll;
  const end = startAt + song.end;
  gain.gain.setValueAtTime(0.0001, begin);
  gain.gain.linearRampToValueAtTime(level, begin + Math.max(0.05, preRoll * 0.9));
  gain.gain.setValueAtTime(level, end - 1.2);
  gain.gain.linearRampToValueAtTime(0.0001, end + 0.4);
  src.start(begin, offset - preRoll);
  src.stop(end + 0.5);
}

// 올린 음악 파일을 소리 데이터로 바꿈
export async function decodeAudioFile(arrayBuffer) {
  unlockAudio();
  if (!ctx) throw new Error('이 브라우저는 오디오를 지원하지 않아요.');
  return ctx.decodeAudioData(arrayBuffer);
}

// 군대의 함성: 낮게 웅웅대는 소음이 부풀었다 가라앉음 + 전쟁 나팔
function roar(at) {
  const src = ctx.createBufferSource();
  if (!noiseBuffer) noise({ dur: 0.01, vol: 0, at });
  src.buffer = noiseBuffer;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 520;
  band.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(0.5, at + 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
  src.connect(band).connect(gain).connect(master);
  src.start(at);
  src.stop(at + 1.9);
  for (const m of [50, 57, 62]) voice({ freq: mtof(m), dur: 1.2, type: 'sawtooth', vol: 0.06, at, attack: 0.15, filter: 1100 });
}

// ---------- 효과음 ----------

export function playSfx(ev) {
  if (!ctx || muted) return;
  const at = ctx.currentTime;
  switch (ev.type) {
    case 'miss':
      voice({ freq: 110, to: 80, dur: 0.08, type: 'square', vol: 0.06, at });
      break;
    case 'divine':
      noise({ dur: 0.7, vol: 0.5, freq: 3000, to: 300, at });
      voice({ freq: 200, to: 1400, dur: 0.5, type: 'sawtooth', vol: 0.12, at });
      roar(at + 0.2);
      break;
    case 'hit': {
      // 쿵 하는 둔탁한 저음 + 살 찢기는 소리 (+ 방패면 쇳소리)
      const p = Math.min(1.5, ev.power ?? 1);
      voice({ freq: ev.heavy ? 95 : 135, to: 36, dur: ev.heavy ? 0.34 : 0.18, type: 'sine', vol: 0.75 * p, at });
      noise({ dur: 0.08, vol: 0.45 * p, freq: 2200, to: 500, at });
      noise({ dur: ev.heavy ? 0.32 : 0.16, vol: 0.3 * p, freq: 650, type: 'bandpass', at: at + 0.01 });
      if (ev.move === 'bash') {
        voice({ freq: 830, dur: 0.22, type: 'square', vol: 0.06, at });
        voice({ freq: 1240, dur: 0.3, type: 'triangle', vol: 0.08, at });
      }
      if (ev.heavy) voice({ freq: 58, to: 28, dur: 0.6, type: 'square', vol: 0.22, at });
      break;
    }
    case 'impact':
      noise({ dur: 0.9, vol: 0.7, freq: 2500, to: 150, at });
      voice({ freq: 90, to: 35, dur: 0.6, type: 'square', vol: 0.25, at });
      break;
    default:
      break;
  }
}
