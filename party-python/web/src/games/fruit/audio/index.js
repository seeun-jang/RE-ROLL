// 오디오 묶음 생성 — 게임과 UI가 같은 인스턴스를 공유한다
import { AudioEngine } from './AudioEngine.js';
import { Music } from './Music.js';
import { Sfx } from './Sfx.js';

export function createAudio() {
  const engine = new AudioEngine();
  return { engine, sfx: new Sfx(engine), music: new Music(engine) };
}
