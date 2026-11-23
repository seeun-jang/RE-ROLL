// 박자 + 온셋 + AI 분석 결과로 채보(노트 배치)를 만드는 파일입니다.
//
// - 곡에서 가장 신나는 약 60초(하이라이트)를 골라요. AI가 격렬하다고 판단한 구간에 가산점.
// - 박자마다 16분음표 격자를 깔고, 실제로 소리가 튀는 자리에만 노트를 놓아요.
// - 잔잔한 구간은 정박 위주, 격렬한 구간은 엇박과 16분음표, 동시 노트까지.
// - 소리가 저음(킥) → 고음(하이햇, 목소리)으로 바뀌면 노트도 왼쪽 → 오른쪽으로 움직여요.

import { LANES } from '../game/config.js';

const TARGET_LENGTH = 60;
const MIN_GAP = 0.11; // 노트 사이 최소 간격 (초)
const MAX_DENSITY = 5.0; // 초당 노트 수 상한
const MIN_DENSITY = 2.2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// 같은 노래면 항상 같은 채보가 나오도록 고정된 난수
function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(values, p) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[clamp(Math.floor(p * sorted.length), 0, sorted.length - 1)] ?? 0;
}

function normalize(values) {
  const lo = percentile(values, 0.1);
  const hi = percentile(values, 0.95) || 1;
  return values.map((v) => clamp((v - lo) / (hi - lo || 1), 0, 1));
}

function median(values) {
  return percentile(values, 0.5);
}

/**
 * onsets: beatTracker.analyzeOnsets 결과, env: 온셋 곡선, beatFrames: 박자 프레임 배열
 * tags: audioTagger.tagAudio 결과 (AI 실패 시 null), seed: 정수
 */
export function makeChart({ onsets, env, beatFrames, tags, seed, targetLength = TARGET_LENGTH }) {
  const { fps, frameTime, low, high, rms } = onsets;
  const beats = beatFrames.map(frameTime);
  if (beats.length < 20) throw new Error('박자를 찾지 못했어요. 리듬이 있는 노래로 다시 시도해 주세요.');

  const t0 = frameTime(0);
  const frameAt = (t) => clamp(Math.round((t - t0) * fps), 0, env.length - 1);
  const nB = beats.length - 1;

  // ---------- 박자별 특징 ----------
  const rmsBeat = [];
  const onsetBeat = [];
  for (let i = 0; i < nB; i++) {
    const a = frameAt(beats[i]);
    const b = Math.max(a + 1, frameAt(beats[i + 1]));
    let r = 0;
    let o = 0;
    for (let f = a; f < b; f++) {
      r += rms[f];
      o += env[f];
    }
    rmsBeat.push(r / (b - a));
    onsetBeat.push(o / (b - a));
  }
  const rmsN = normalize(rmsBeat);
  const onsetN = normalize(onsetBeat);

  // AI 분위기 (구간 사이는 보간)
  const aiAt = (t) => {
    const w = tags?.windows;
    if (!w?.length) return null;
    const centers = w.map((x) => (x.t0 + x.t1) / 2);
    if (t <= centers[0]) return w[0].intensity;
    for (let k = 1; k < w.length; k++) {
      if (t <= centers[k]) {
        const u = (t - centers[k - 1]) / (centers[k] - centers[k - 1] || 1);
        return lerp(w[k - 1].intensity, w[k].intensity, u);
      }
    }
    return w[w.length - 1].intensity;
  };

  const rawEnergy = beats.slice(0, nB).map((t, i) => {
    const ai = aiAt(t);
    return ai === null ? 0.6 * rmsN[i] + 0.4 * onsetN[i] : 0.4 * rmsN[i] + 0.25 * onsetN[i] + 0.35 * ai;
  });
  const energy = rawEnergy.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = -2; k <= 2; k++) {
      if (rawEnergy[i + k] !== undefined) {
        s += rawEnergy[i + k];
        c++;
      }
    }
    return s / c;
  });

  // ---------- 마디 첫 박 찾기 (킥이 가장 세게 들어가는 위치) ----------
  let phase = 0;
  let phaseScore = -1;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    for (let i = p; i < nB; i += 4) s += low[frameAt(beats[i])];
    if (s > phaseScore) {
      phaseScore = s;
      phase = p;
    }
  }

  // ---------- 하이라이트 구간 고르기 ----------
  const period = median(beats.slice(1).map((t, i) => t - beats[i]));
  let winBeats = Math.max(16, Math.round(targetLength / period / 4) * 4);
  winBeats = Math.min(winBeats, Math.floor((nB - phase) / 4) * 4);
  let start = phase;
  let bestScore = -Infinity;
  for (let s = phase; s + winBeats <= nB; s += 4) {
    let sum = 0;
    for (let i = s; i < s + winBeats; i++) sum += energy[i];
    // 너무 앞(인트로)보다는 곡 중반을 살짝 선호
    const score = sum / winBeats - (s < 8 ? 0.05 : 0);
    if (score > bestScore) {
      bestScore = score;
      start = s;
    }
  }
  const segStart = beats[start];
  const segEnd = beats[start + winBeats];

  // 구간 안의 박자 간격을 직선으로 맞춰 정확한 BPM 계산
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const m = winBeats + 1;
  for (let k = 0; k < m; k++) {
    const y = beats[start + k];
    sx += k;
    sy += y;
    sxx += k * k;
    sxy += k * y;
  }
  const beat = (m * sxy - sx * sy) / (m * sxx - sx * sx);

  // ---------- 노트 배치 ----------
  // 주변 4초 안에서 온셋이 얼마나 센지 (곡마다 크기가 달라서 상대값으로 비교)
  const normCache = new Map();
  const localNorm = (i) => {
    if (!normCache.has(i)) {
      const a = frameAt(beats[i] - 4);
      const b = frameAt(beats[i] + 4);
      normCache.set(i, percentile(env.subarray(a, b + 1), 0.9) || 1);
    }
    return normCache.get(i);
  };

  const place = (bias) => {
    const rand = seededRandom(seed);
    const notes = [];
    let lastT = -1;
    let prevLane = Math.floor(rand() * LANES);
    let prevTone = 0;
    for (let i = start; i < start + winBeats; i++) {
      const b0 = beats[i];
      const b1 = beats[i + 1];
      const e = energy[i];
      const warm = i - start < 8; // 처음 두 마디는 정박만
      const norm = localNorm(i);
      for (let k = 0; k < 4; k++) {
        const t = b0 + ((b1 - b0) * k) / 4;
        const f = frameAt(t);
        const strength = Math.max(env[f - 1] ?? 0, env[f], env[f + 1] ?? 0) / norm;
        let take;
        if (k === 0) take = strength > 0.12 + bias * 0.5 || e > 0.3 + bias;
        else if (warm) take = false;
        else if (k === 2) take = strength > lerp(0.95, 0.45, e) + bias;
        else take = e > 0.55 + bias * 0.5 && strength > lerp(1.3, 0.8, e) + bias;
        if (!take || t - lastT < MIN_GAP) continue;

        // 음색: 저음 위주면 -1, 고음 위주면 +1
        const tone = (high[f] - low[f]) / (high[f] + low[f] + 1e-6);
        const diff = tone - prevTone;
        const dir = diff > 0.15 ? 1 : diff < -0.15 ? -1 : rand() < 0.5 ? 1 : -1;
        const step = rand() < 0.25 ? 2 : 1;
        let lane = prevLane + dir * step;
        if (lane < 0 || lane >= LANES) lane = prevLane - dir * step;
        lane = clamp(lane, 0, LANES - 1);
        if (lane === prevLane && t - lastT < 0.25) lane = (lane + 1) % LANES;

        notes.push({ t: t - segStart, lane });
        // 격렬한 구간의 마디 첫 박은 동시 노트
        const downbeat = k === 0 && (i - phase) % 4 === 0;
        if (downbeat && !warm && e > 0.6 && strength > 0.7 && rand() < 0.6) {
          const pair = LANES - 1 - lane !== lane ? LANES - 1 - lane : (lane + 2) % LANES;
          notes.push({ t: t - segStart, lane: pair });
        }
        lastT = t;
        prevLane = lane;
        prevTone = tone;
      }
    }
    return notes;
  };

  // 너무 빽빽하거나 너무 듬성하면 기준을 조절해서 다시
  const length = segEnd - segStart;
  let bias = 0;
  let notes = place(bias);
  for (let tries = 0; tries < 8; tries++) {
    const density = notes.length / length;
    if (density > MAX_DENSITY) bias += 0.1;
    else if (density < MIN_DENSITY && bias > -0.4) bias -= 0.1;
    else break;
    notes = place(bias);
  }

  // 마지막 구간 (최대 12초, 마디 단위)
  const finalBeats = Math.max(4, Math.round(Math.min(12, length * 0.2) / beat / 4) * 4);
  const finalAt = beats[start + winBeats - finalBeats] - segStart;

  return {
    segStart,
    length,
    beat,
    bpm: 60 / beat,
    notes,
    finalAt,
    energy: energy.slice(start, start + winBeats),
  };
}
