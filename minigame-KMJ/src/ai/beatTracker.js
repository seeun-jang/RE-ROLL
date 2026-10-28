// 노래에서 박자(비트)를 찾는 신호 처리 코드입니다. (AI 모델 없이 수학으로 계산)
//
// 1. 소리를 아주 짧은 조각으로 잘라 주파수 성분을 봅니다 (FFT).
// 2. 소리가 갑자기 커지는 순간(북, 기타, 목소리 시작)을 찾아 "온셋 곡선"을 만듭니다.
// 3. 온셋 곡선이 몇 프레임마다 반복되는지 보고 템포(BPM)를 추정합니다.
// 4. 템포 간격을 지키면서 온셋이 강한 지점을 따라가며 박자 위치를 고릅니다.
//    (Ellis 2007, "Beat Tracking by Dynamic Programming" 방식)

const N_FFT = 1024;
const HOP = 256;

// ---------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// ---------------------------------------------------------------------
// 1~2. 온셋(소리가 시작되는 순간) 분석
// ---------------------------------------------------------------------

/**
 * pcm: 모노 Float32Array, sr: 샘플레이트
 * 돌려주는 값 (모두 프레임 단위 배열):
 *   flux  전체 온셋 세기     low  저음(킥, 베이스) 온셋     high 고음(하이햇, 스네어) 온셋
 *   rms   소리 크기
 */
export function analyzeOnsets(pcm, sr, onProgress) {
  const nFrames = Math.max(1, Math.floor((pcm.length - N_FFT) / HOP) + 1);
  const half = N_FFT / 2;
  const win = new Float32Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);

  const binHz = sr / N_FFT;
  const lowMax = Math.max(2, Math.round(180 / binHz));
  const highMin = Math.round(2500 / binHz);

  const re = new Float32Array(N_FFT);
  const im = new Float32Array(N_FFT);
  let prev = new Float32Array(half);
  let cur = new Float32Array(half);
  const flux = new Float32Array(nFrames);
  const low = new Float32Array(nFrames);
  const high = new Float32Array(nFrames);
  const rms = new Float32Array(nFrames);

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    let energy = 0;
    for (let i = 0; i < N_FFT; i++) {
      const s = pcm[off + i] || 0;
      energy += s * s;
      re[i] = s * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(energy / N_FFT);
    fft(re, im);
    let fl = 0;
    let lo = 0;
    let hi = 0;
    for (let k = 1; k < half; k++) {
      const mag = Math.log1p(1000 * Math.hypot(re[k], im[k]));
      cur[k] = mag;
      const d = mag - prev[k];
      if (d > 0) {
        fl += d;
        if (k <= lowMax) lo += d;
        else if (k >= highMin) hi += d;
      }
    }
    flux[f] = fl;
    low[f] = lo;
    high[f] = hi;
    [prev, cur] = [cur, prev];
    if (onProgress && f % 2000 === 0) onProgress(f / nFrames);
  }
  flux[0] = low[0] = high[0] = 0;

  // 측정해 보니 온셋 봉우리가 실제 소리보다 약 11ms 일찍 잡혀서 보정
  const latency = 0.011;
  return { fps: sr / HOP, frameTime: (f) => (f * HOP + N_FFT / 2) / sr + latency, flux, low, high, rms, nFrames };
}

// 온셋 곡선: 주변 평균을 빼서 "튀는 부분"만 남기고, 크기를 맞춤
export function onsetEnvelope(flux, fps) {
  const n = flux.length;
  const radius = Math.max(1, Math.round(fps * 0.15));
  const out = new Float32Array(n);
  let sum = 0;
  let count = 0;
  for (let i = -radius; i < n; i++) {
    const add = i + radius;
    if (add < n) {
      sum += flux[add];
      count++;
    }
    const drop = i - radius - 1;
    if (drop >= 0) {
      sum -= flux[drop];
      count--;
    }
    if (i >= 0) out[i] = Math.max(0, flux[i] - sum / count);
  }
  let sq = 0;
  for (let i = 0; i < n; i++) sq += out[i] * out[i];
  const std = Math.sqrt(sq / n) || 1;
  for (let i = 0; i < n; i++) out[i] /= std;
  return out;
}

// ---------------------------------------------------------------------
// 3. 템포 추정
// ---------------------------------------------------------------------

function autocorr(env, lag) {
  let s = 0;
  const n = env.length - lag;
  for (let i = 0; i < n; i++) s += env[i] * env[i + lag];
  return s / Math.max(1, n);
}

/** 한 박자가 몇 프레임인지 (소수점 포함) */
export function estimateTempo(env, fps, { minBpm = 70, maxBpm = 190, centerBpm = 120 } = {}) {
  const minLag = Math.floor((fps * 60) / maxBpm);
  const maxLag = Math.ceil((fps * 60) / minBpm);
  const ac = new Float32Array(maxLag * 2 + 2);
  for (let lag = 1; lag < ac.length; lag++) ac[lag] = autocorr(env, lag);

  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    // 사람이 느끼기 쉬운 템포(120 근처)에 가중치 + 2배 간격도 맞으면 가산점
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / centerBpm) / 0.9, 2));
    const score = (ac[lag] + 0.5 * ac[lag * 2] + 0.25 * (ac[Math.round(lag / 2)] || 0)) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // 포물선 보간으로 소수점 아래까지
  const y0 = ac[best - 1];
  const y1 = ac[best];
  const y2 = ac[best + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
  return best + shift;
}

// ---------------------------------------------------------------------
// 4. 박자 위치 추적 (동적 계획법)
// ---------------------------------------------------------------------

/** 박자가 있는 프레임 번호 배열 (소수점 포함, 오름차순) */
export function trackBeats(env, period, tightness = 100) {
  const n = env.length;

  // 박자 근처의 온셋을 부드럽게 퍼뜨린 점수
  const sigma = period / 32;
  const radius = Math.ceil(sigma * 3);
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) s += env[j] * Math.exp(-0.5 * (k / sigma) ** 2);
    }
    local[i] = s;
  }

  const cum = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period * 2);
  const hi = Math.round(period / 2);
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let bj = -1;
    for (let j = Math.max(0, i - lo); j <= i - hi; j++) {
      const s = cum[j] - tightness * Math.log((i - j) / period) ** 2;
      if (s > best) {
        best = s;
        bj = j;
      }
    }
    cum[i] = local[i] + (bj >= 0 ? best : 0);
    back[i] = bj;
  }

  // 마지막 박자: 끝부분에서 점수가 가장 높은 곳
  let last = n - 1;
  let bestEnd = -Infinity;
  for (let i = Math.max(0, n - Math.round(period * 2)); i < n; i++) {
    if (cum[i] > bestEnd) {
      bestEnd = cum[i];
      last = i;
    }
  }
  const beats = [];
  for (let i = last; i >= 0; i = back[i]) beats.push(i);
  beats.reverse();

  // 박자 위치를 실제 온셋 봉우리에 맞춰 미세 조정
  return beats.map((b) => {
    let peak = b;
    for (let k = -2; k <= 2; k++) {
      const j = b + k;
      if (j > 0 && j < n - 1 && env[j] > env[peak]) peak = j;
    }
    const y0 = env[peak - 1] ?? 0;
    const y1 = env[peak];
    const y2 = env[peak + 1] ?? 0;
    const denom = y0 - 2 * y1 + y2;
    const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom)) : 0;
    // 온셋이 약하면 원래 격자 위치를 믿음
    return env[peak] > 0.5 ? peak + shift : b;
  });
}
