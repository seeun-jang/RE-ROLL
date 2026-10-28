// Hugging Face AI 모델로 노래의 구간별 분위기와 장르를 알아내는 파일입니다.
//
// 모델: MIT AST (Audio Spectrogram Transformer), AudioSet 527개 소리 종류로 학습됨
//   https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593
// transformers.js 로 브라우저 안에서 바로 실행돼요 (서버, API 키 필요 없음).
// 그래픽카드(WebGPU)가 되면 4비트 모델(약 51MB)로 구간당 0.4초,
// 안 되면 CPU용 8비트 모델(약 91MB)로 구간당 15초 이상 걸려서 구간 수를 줄여요.
// 처음 한 번만 내려받고, 그다음부터는 브라우저에 저장된 것을 써요.

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

export const MODEL_ID = 'Xenova/ast-finetuned-audioset-10-10-0.4593';
const SAMPLE_RATE = 16000;
const WINDOW = 10; // 모델이 한 번에 듣는 길이 (초)
const MAX_WINDOWS = { webgpu: 16, wasm: 4 };

// 이 소리들이 많을수록 "격렬한 구간" → 노트를 빽빽하게
const INTENSE = {
  Drum: 1,
  'Drum kit': 1,
  'Snare drum': 0.8,
  'Bass drum': 1,
  Drumbeat: 1,
  'Drum machine': 1,
  'Electronic dance music': 1,
  Techno: 1,
  Dubstep: 1,
  'Drum and bass': 1,
  'House music': 0.8,
  Trance: 0.8,
  'Heavy metal': 1,
  'Rock music': 0.8,
  'Punk rock': 1,
  'Hip hop music': 0.8,
  Rapping: 0.7,
  'Electric guitar': 0.6,
  Cheering: 0.5,
};
// 이 소리들이 많을수록 "잔잔한 구간" → 노트를 듬성듬성
const CALM = {
  'Ambient music': 1,
  'New-age music': 1,
  Lullaby: 1,
  'Sad music': 0.8,
  'Tender music': 0.8,
  'Classical music': 0.5,
  Piano: 0.4,
  Silence: 1,
  Speech: 0.8,
  Harp: 0.6,
};
// 결과 화면에 보여줄 장르 후보
const GENRES = [
  'Pop music', 'Hip hop music', 'Rock music', 'Heavy metal', 'Punk rock', 'Electronic dance music',
  'Techno', 'House music', 'Dubstep', 'Drum and bass', 'Trance', 'Electronic music', 'Jazz', 'Blues',
  'Classical music', 'Ambient music', 'Funk', 'Disco', 'Reggae', 'Country', 'Soul music', 'Rhythm and blues',
  'Latin music', 'Folk music', 'Orchestra', 'Video game music', 'Soundtrack music', 'Christian music', 'Ska',
  'Flamenco', 'Afrobeat', 'K-pop', 'Vocal music', 'A capella', 'Music of Asia', 'Swing music', 'Bluegrass',
];

let classifierPromise = null;

async function hasWebGPU() {
  try {
    return !!(await self.navigator?.gpu?.requestAdapter());
  } catch {
    return false;
  }
}

function loadModel(onProgress) {
  if (!classifierPromise) {
    const files = {};
    const progress_callback = (p) => {
        if (p.status !== 'progress' || !p.total) return;
        files[p.file] = [p.loaded, p.total];
        let loaded = 0;
        let total = 0;
        for (const [l, t] of Object.values(files)) {
          loaded += l;
          total += t;
        }
        onProgress?.({ phase: loaded >= total ? 'load' : 'download', ratio: loaded / total, loaded, total });
    };
    classifierPromise = (async () => {
      if (await hasWebGPU()) {
        try {
          const run = await pipeline('audio-classification', MODEL_ID, { device: 'webgpu', dtype: 'q4f16', progress_callback });
          return { run, device: 'webgpu' };
        } catch {
          // 그래픽카드로 못 돌리면 CPU로
        }
      }
      const run = await pipeline('audio-classification', MODEL_ID, { device: 'wasm', dtype: 'q8', progress_callback });
      return { run, device: 'wasm' };
    })();
    classifierPromise.catch(() => {
      classifierPromise = null;
    });
  }
  return classifierPromise;
}

const weigh = (labels, table) => labels.reduce((s, { label, score }) => s + (table[label] ?? 0) * score, 0);

/**
 * pcm: 16kHz 모노 Float32Array
 * 돌려주는 값: {
 *   windows: [{ t0, t1, intensity(0~1), top: [{label, score}] }],
 *   genres: [{ label, score }],   // 곡 전체에서 가장 그럴듯한 장르
 * }
 */
export async function tagAudio(pcm, onProgress, onWindow) {
  const { run: classify, device } = await loadModel(onProgress);
  const duration = pcm.length / SAMPLE_RATE;
  const count = Math.max(1, Math.min(MAX_WINDOWS[device], Math.floor(duration / WINDOW)));
  const step = count > 1 ? (duration - WINDOW) / (count - 1) : 0;
  const windows = [];
  const genreSum = {};

  for (let i = 0; i < count; i++) {
    const t0 = Math.max(0, i * step);
    const t1 = Math.min(duration, t0 + WINDOW);
    const clip = pcm.subarray(Math.floor(t0 * SAMPLE_RATE), Math.floor(t1 * SAMPLE_RATE));
    const labels = await classify(clip, { top_k: 40 });
    const raw = weigh(labels, INTENSE) - weigh(labels, CALM);
    const window = { t0, t1, intensity: Math.max(0, Math.min(1, 0.4 + raw * 1.4)), top: labels.slice(0, 5) };
    windows.push(window);
    onWindow?.(window);
    for (const { label, score } of labels) {
      if (GENRES.includes(label)) genreSum[label] = (genreSum[label] ?? 0) + score / count;
    }
    onProgress?.({ phase: 'analyze', ratio: (i + 1) / count });
  }

  const genres = Object.entries(genreSum)
    .map(([label, score]) => ({ label, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return { windows, genres, device };
}
