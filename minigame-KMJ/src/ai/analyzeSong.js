// 올린 노래 파일 → 게임에서 쓸 수 있는 노래(채보 포함)로 바꾸는 입구입니다.
//
//   const job = analyzeSongFile(file, (p) => ...진행 상황...);
//   const song = await job.promise;   // 취소하려면 job.cancel()

import { decodeAudioFile } from '../game/audio.js';

const SAMPLE_RATE = 16000;
const MAX_SECONDS = 8 * 60;

// 노래를 16kHz 모노로 바꿈 (AI 모델과 박자 분석이 쓰는 형식)
async function toMono16k(buffer) {
  const seconds = Math.min(buffer.duration, MAX_SECONDS);
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// 분석 화면에 그릴 파형 (구간별 최대 크기)
function wavePeaks(pcm, bins = 480) {
  const peaks = new Float32Array(bins);
  const size = Math.max(1, Math.floor(pcm.length / bins));
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = b * size; i < (b + 1) * size && i < pcm.length; i += 4) m = Math.max(m, Math.abs(pcm[i]));
    peaks[b] = m;
  }
  return peaks;
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// 채보 분석 결과 → 게임 엔진이 쓰는 노래 형식 (song.js 의 buildSong 과 같은 모양)
function buildUploadedSong({ name, buffer, chart, tags }) {
  const beat = chart.beat;
  const countIn = beat * 8;
  const music = [];
  for (let i = 0; i < 8; i++) music.push({ kind: 'stick', t: i * beat, accent: i >= 4 });
  const end = countIn + chart.length;
  return {
    title: name,
    bpm: chart.bpm,
    beat,
    countIn,
    end,
    duration: end + beat * 2,
    finalStart: countIn + chart.finalAt,
    sections: [],
    music,
    notes: chart.notes.map((n) => ({ t: countIn + n.t, lane: n.lane })).sort((a, b) => a.t - b.t || a.lane - b.lane),
    // 노래 시간 countIn = 원곡의 chart.segStart. 카운트인 동안 앞부분을 미리 깔아줌
    audio: { buffer, offset: chart.segStart, preRoll: Math.min(countIn, chart.segStart) },
    meta: { genres: tags?.genres ?? [], segStart: chart.segStart, length: chart.length },
  };
}

export function analyzeSongFile(file, onProgress) {
  let worker = null;
  let cancelled = false;

  const promise = (async () => {
    await null; // 호출한 쪽이 job 을 받은 뒤에 진행 상황을 알리도록 한 박자 쉼
    onProgress?.({ step: 'decode', ratio: 0 });
    const buffer = await decodeAudioFile(await file.arrayBuffer());
    const pcm = await toMono16k(buffer);
    onProgress?.({ type: 'wave', peaks: wavePeaks(pcm), duration: pcm.length / SAMPLE_RATE });
    onProgress?.({ step: 'decode', ratio: 1 });
    if (cancelled) throw new Error('cancelled');

    const result = await new Promise((resolve, reject) => {
      worker = new Worker(new URL('./chartWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.type === 'done') resolve(data);
        else if (data.type === 'error') reject(new Error(data.message));
        else onProgress?.(data); // 진행 상황, 박자, AI 구간 결과
      };
      worker.onerror = (e) => reject(new Error(e.message || '분석 중 오류가 났어요.'));
      worker.postMessage({ pcm, seed: hashString(`${file.name}:${file.size}`) }, [pcm.buffer]);
    });
    worker.terminate();

    const name = file.name.replace(/\.[^.]+$/, '');
    return { song: buildUploadedSong({ name, buffer, chart: result.chart, tags: result.tags }), aiError: result.aiError };
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      worker?.terminate();
    },
  };
}
