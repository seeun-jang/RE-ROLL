// 파형 그리기: 열마다 정수 높이의 1px 세로 막대를 중심선 기준 위아래 대칭으로 그린다.
// 선 그리기(lineTo)는 쓰지 않는다. 두 파형이 겹치면 한쪽을 opts.dither=true(체커보드)로 그린다.
import { rect, dither } from '../engine/draw.js';
import { C } from '../palette.js';

const clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0); // NaN → 0

// 오디오 샘플 → 열 수만큼 다운샘플한 피크(각 열의 최대 절댓값 0~1)
export function peaks(float32, columns) {
  const n = Math.max(0, Math.floor(columns) || 0);
  const out = new Float32Array(n);
  const len = float32 ? float32.length : 0;
  if (!len || !n) return out;
  for (let i = 0; i < n; i++) {
    const s = Math.floor((i * len) / n);
    const e = Math.max(s + 1, Math.floor(((i + 1) * len) / n));
    let m = 0;
    for (let j = s; j < e && j < len; j++) {
      const v = Math.abs(float32[j]);
      if (v > m) m = v;
    }
    out[i] = clamp01(m);
  }
  return out;
}

// 피크 배열 그리기. 폭 w 열에 맞춰 pk를 구간 최댓값으로 다시 나눈다(pk 길이가 w와 달라도 됨).
// opts: {progress:null|0~1, playheadColor, dither:false, ditherPhase:0}
export function drawWave(ctx, pk, x, y, w, h, color, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  const half = Math.floor((h - 1) / 2); // 중심선에서 위(아래)로 그릴 수 있는 최대 칸
  const mid = y + half;
  const n = pk ? pk.length : 0;
  const useDither = !!opts.dither;
  const phase = opts.ditherPhase || 0;
  for (let i = 0; i < w; i++) {
    let v = 0;
    if (n > 0) {
      const s = Math.floor((i * n) / w);
      const e = Math.max(s + 1, Math.floor(((i + 1) * n) / w));
      for (let j = s; j < e && j < n; j++) if (pk[j] > v) v = pk[j];
    }
    const a = Math.round(clamp01(v) * half); // 정수 높이
    if (useDither) dither(ctx, x + i, mid - a, 1, a * 2 + 1, color, phase);
    else rect(ctx, x + i, mid - a, 1, a * 2 + 1, color);
  }
  // 재생 위치 세로선
  if (opts.progress != null && Number.isFinite(opts.progress)) {
    const px = x + Math.round(clamp01(opts.progress) * (w - 1));
    rect(ctx, px, y, 1, h, opts.playheadColor || C.text);
  }
}

// 실시간 파형(AnalyserNode 시간 영역 값 -1~1). 열마다 구간의 최솟값~최댓값을 정수 막대로.
// opts.gain: 화면 표시 배율(기본 2, 마이크 입력이 작아도 모양이 보이도록)
export function drawLiveWave(ctx, timeDomain, x, y, w, h, color, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  const half = Math.floor((h - 1) / 2);
  const mid = y + half;
  const gain = opts.gain != null ? opts.gain : 2;
  const n = timeDomain ? timeDomain.length : 0;
  for (let i = 0; i < w; i++) {
    let lo = 0, hi = 0; // 0을 포함하므로 무음이면 중심선 1px
    if (n > 0) {
      const s = Math.floor((i * n) / w);
      const e = Math.max(s + 1, Math.floor(((i + 1) * n) / w));
      for (let j = s; j < e && j < n; j++) {
        const v = timeDomain[j];
        if (v > hi) hi = v;
        else if (v < lo) lo = v;
      }
    }
    const top = mid - Math.round(clamp01(hi * gain) * half);
    const bottom = mid + Math.round(clamp01(-lo * gain) * half);
    rect(ctx, x + i, top, 1, bottom - top + 1, color);
  }
}
