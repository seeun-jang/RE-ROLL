// 노래 분석은 무거워서 화면이 멈추지 않게 별도 작업자(Web Worker)에서 돌립니다.
//
// 받는 값:  { pcm: 16kHz 모노 Float32Array, seed }
// 보내는 값: { type: 'progress', step, ratio, detail } 여러 번
//           { type: 'done', chart, tags, aiError } 또는 { type: 'error', message }

import { analyzeOnsets, onsetEnvelope, estimateTempo, trackBeats } from './beatTracker.js';
import { tagAudio } from './audioTagger.js';
import { makeChart } from './chartMaker.js';

const SAMPLE_RATE = 16000;

const progress = (step, ratio, detail) => self.postMessage({ type: 'progress', step, ratio, detail });

self.onmessage = async ({ data }) => {
  const { pcm, seed } = data;
  try {
    // 1. 박자 추적 (신호 처리)
    progress('beats', 0);
    const onsets = analyzeOnsets(pcm, SAMPLE_RATE, (r) => progress('beats', r * 0.8));
    const env = onsetEnvelope(onsets.flux, onsets.fps);
    const period = estimateTempo(env, onsets.fps);
    const beatFrames = trackBeats(env, period);
    self.postMessage({ type: 'beats', beats: beatFrames.map(onsets.frameTime), bpm: (60 * onsets.fps) / period });
    progress('beats', 1);

    // 2. AI 분석 (Hugging Face 모델). 실패해도 채보는 만들 수 있게
    let tags = null;
    let aiError = null;
    try {
      progress('ai', 0, { phase: 'load' });
      tags = await tagAudio(
        pcm,
        (p) => progress('ai', p.phase === 'download' ? p.ratio * 0.5 : 0.5 + p.ratio * 0.5, p),
        (window) => self.postMessage({ type: 'window', window }),
      );
    } catch (err) {
      aiError = String(err?.message ?? err);
    }
    progress('ai', 1);

    // 3. 채보 만들기
    progress('chart', 0);
    const chart = makeChart({ onsets, env, beatFrames, tags, seed });
    progress('chart', 1);

    self.postMessage({ type: 'done', chart, tags, aiError });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message ?? err) });
  }
};
