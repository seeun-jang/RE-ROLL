// 원본 검도 코드 전체(그림·글자·소리·AI·시합 장면)를 원본 index.html 과 같은 순서로 불러온다.
import './core.js';
import './data/sprites_data.js';
import './data/font_data.js';
import './engine/assets.js';
import './engine/renderer.js';
import './engine/font.js';
import './engine/audio.js';
import './engine/particles.js';
import './engine/ui.js';
import './game/fighter_renderer.js';
import './game/player.js';
import './game/ai.js';
import './game/referee.js';
import './game/stage.js';
import './scenes/match_scene.js';

export const PK = globalThis.PK;
