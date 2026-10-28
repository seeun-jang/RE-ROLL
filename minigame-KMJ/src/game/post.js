// 화면 전체 후처리: 밝은 곳이 번지는 블룸, 영화 같은 색보정, 필름 그레인
import { grainTile } from './texture.js';

// 사파리 등 canvas filter 를 못 쓰는 브라우저에서는 블룸을 건너뜀
const FILTER_OK = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

let bloomCanvas = null;
let grain = null;

export function applyPost(ctx, { bloom = 0.5, grade = 0.35, grainAmount = 0.06 } = {}) {
  const canvas = ctx.canvas;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (FILTER_OK && bloom > 0) {
    const sw = Math.max(1, w >> 2);
    const sh = Math.max(1, h >> 2);
    if (!bloomCanvas || bloomCanvas.width !== sw || bloomCanvas.height !== sh) {
      bloomCanvas = document.createElement('canvas');
      bloomCanvas.width = sw;
      bloomCanvas.height = sh;
    }
    const b = bloomCanvas.getContext('2d');
    b.globalCompositeOperation = 'copy';
    // 어두운 곳은 지우고 밝은 곳만 남겨서 흐리게
    b.filter = 'brightness(0.7) contrast(2.6) blur(3px)';
    b.drawImage(canvas, 0, 0, sw, sh);
    b.filter = 'none';
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = bloom;
    ctx.drawImage(bloomCanvas, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  if (grade > 0) {
    // 위는 노을빛, 아래 그늘은 푸르스름하게
    ctx.globalCompositeOperation = 'soft-light';
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(255,150,80,${grade})`);
    g.addColorStop(1, `rgba(30,60,130,${grade})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  if (grainAmount > 0) {
    grain ??= grainTile(160, 5, 1.3, 1.6);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = grainAmount;
    ctx.translate(-Math.random() * 160, -Math.random() * 160);
    ctx.fillStyle = ctx.createPattern(grain, 'repeat');
    ctx.fillRect(0, 0, w + 160, h + 160);
  }

  ctx.restore();
}
