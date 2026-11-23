// =============================================================
// 음성 퀴즈 UI 스타일 (원본 css/style.css 에서 필요한 부분만. 모두 .vq-root 안에서만 적용)
// 빌드 없이도 돌아가도록 CSS 파일 대신 문자열로 넣는다.
// =============================================================
const CSS = `
.vq-root {
  --c0: #1a1c2c; --c1: #5d275d; --c2: #b13e53; --c3: #ef7d57;
  --c4: #ffcd75; --c5: #a7f070; --c6: #38b764; --c7: #257179;
  --c8: #29366f; --c9: #3b5dc9; --ca: #41a6f6; --cb: #73eff7;
  --cc: #f4f4f4; --cd: #94b0c2; --ce: #566c86; --cf: #333c57;
  --font: 'Galmuri11', 'Galmuri9', 'DungGeunMo', monospace;
  --font-big: 'Galmuri14', 'Galmuri11', 'DungGeunMo', monospace;
  position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--c0);
}
.vq-root * { box-sizing: border-box; }
.vq-stage {
  position: absolute; left: 0; top: 0; width: 640px; height: 360px; transform-origin: 0 0;
  overflow: hidden; background: var(--c0); color: var(--cc);
  font-family: var(--font); font-size: 11px; line-height: 1.25; user-select: none;
  -webkit-font-smoothing: none;
}
.vq-shake { position: absolute; inset: 0; }
.vq-stage canvas.pixel {
  position: absolute; left: 0; top: 0; width: 640px; height: 360px;
  image-rendering: pixelated; image-rendering: crisp-edges;
}
.vq-ui { position: absolute; inset: 0; z-index: 10; }
.vq-root img.icon { width: 16px; height: 16px; image-rendering: pixelated; vertical-align: middle; }

.vq-root .pbox {
  border: 6px solid transparent; border-image: var(--nine-default) 3 fill / 6px;
  image-rendering: pixelated; padding: 4px 8px;
}
.vq-root .pbox.question { border-image-source: var(--nine-question); }
.vq-root .pbox.red { border-image-source: var(--nine-red); }
.vq-root .pbox.blue { border-image-source: var(--nine-blue); }
.vq-root .pbox.green { border-image-source: var(--nine-green); color: var(--c0); }

.vq-root .pbtn {
  font-family: var(--font); font-size: 11px; color: var(--c0); background: none;
  border: 6px solid transparent; border-image: var(--nine-button) 3 fill / 6px; image-rendering: pixelated;
  padding: 0 6px; white-space: nowrap; cursor: pointer; position: relative; top: 0;
  box-shadow: 0 2px 0 var(--c0); outline: none;
}
.vq-root .pbtn:active { top: 2px; box-shadow: none; }

.vq-root input.pinput {
  font-family: var(--font); font-size: 11px; color: var(--c0); background: var(--cc);
  border: 2px solid var(--c0); box-shadow: inset 2px 2px 0 var(--cd); padding: 3px 6px; outline: none; width: 100%;
  user-select: text;
}
.vq-root input.pinput:focus { box-shadow: inset 2px 2px 0 var(--cd), 0 0 0 2px var(--c4); }

.vq-root .abs { position: absolute; }
.vq-root .center-x { left: 50%; transform: translateX(-50%); }
.vq-root .row { display: flex; align-items: center; gap: 6px; }
.vq-root .shadow-text { text-shadow: 2px 0 0 var(--c0), -2px 0 0 var(--c0), 0 2px 0 var(--c0), 0 -2px 0 var(--c0), 2px 2px 0 var(--c0); }
.vq-root .t-yellow { color: var(--c4); }
.vq-root .t-mint { color: var(--cb); }
.vq-root .t-gray { color: var(--cd); }
.vq-root .t-green { color: var(--c5); }
.vq-root .t-red { color: var(--c3); }
.vq-root .t-big { font-family: var(--font-big); font-size: 14px; }
.vq-root .t-huge { font-family: var(--font-big); font-size: 28px; line-height: 1; }
.vq-root .blink { animation: vq-blink 1s steps(1) infinite; }
@keyframes vq-blink { 50% { opacity: 0; } }
.vq-root .pop { animation: vq-pop 0.25s steps(4) both; }
@keyframes vq-pop { 0% { transform: scale(0.4); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
.vq-root .center-x.pop { animation-name: vq-pop-x; }
@keyframes vq-pop-x { 0% { transform: translateX(-50%) scale(0.4); } 60% { transform: translateX(-50%) scale(1.15); } 100% { transform: translateX(-50%) scale(1); } }

.vq-root .timerbar { height: 10px; background: var(--c0); border: 2px solid var(--c0); box-shadow: 0 0 0 2px var(--cd); position: relative; }
.vq-root .timerbar > div { height: 100%; background: var(--c5); }
.vq-root .timerbar.warn > div { background: var(--c4); }
.vq-root .timerbar.danger > div { background: var(--c2); }
.vq-root .timerbar .notch { position: absolute; top: -4px; width: 2px; height: 14px; background: var(--c4); }

.vq-root .hint-slot { width: 200px; white-space: nowrap; min-height: 30px; display: flex; align-items: center; gap: 6px; }
.vq-root .hint-slot.locked { opacity: 0.55; }
.vq-root .hint-slot .val { flex-shrink: 0; font-family: var(--font-big); font-size: 14px; color: var(--c4); letter-spacing: 2px; }

.vq-root .chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border: 2px solid var(--c0); background: var(--cf); white-space: nowrap; }
.vq-root .chip.ok { background: var(--c6); color: var(--c0); }
.vq-root .chip.bad { background: var(--c2); }
.vq-root .chip.wait { background: var(--ce); }

.vq-root .bubble {
  background: var(--cc); color: var(--c0); border: 2px solid var(--c0); padding: 2px 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 19px;
}
.vq-root .bubble.dim { color: var(--ce); }

.vq-root .meter { height: 6px; flex: 1; background: var(--c0); border: 2px solid var(--c0); box-shadow: 0 0 0 1px var(--cd); }
.vq-root .meter > div { height: 100%; width: 0; background: var(--c5); }
.vq-root .meter.live > div { background: var(--c3); }

.vq-root .panels { position: absolute; left: 6px; right: 6px; top: 296px; display: flex; gap: 4px; justify-content: center; }
.vq-root .panel {
  flex: 1 1 0; max-width: 170px; min-width: 0; background: var(--c8); border: 2px solid var(--c0);
  box-shadow: inset 0 3px 0 var(--pc, var(--cd)); padding: 6px 6px 3px;
}
.vq-root .panel.me { box-shadow: inset 0 3px 0 var(--pc, var(--cd)), 0 0 0 2px var(--cc); }
.vq-root .panel.active { background: var(--c9); }
.vq-root .panel.locked { background: var(--cf); }
.vq-root .panel .name { font-family: var(--font-big); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vq-root .panel .score { font-family: var(--font-big); font-size: 21px; line-height: 1; color: var(--c4); }
.vq-root .panel .status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 14px; }

.vq-root .overlay {
  position: absolute; inset: 0; background: rgba(26, 28, 44, 0.72);
  display: flex; align-items: center; justify-content: center; z-index: 40;
}
.vq-root table.rank { border-collapse: collapse; width: 100%; }
.vq-root table.rank td { padding: 2px 6px; white-space: nowrap; }
.vq-root table.rank tr.win td { color: var(--c4); }
.vq-root table.rank tr.me td:nth-child(2) { text-decoration: underline; }
.vq-root kbd { font-family: var(--font); background: var(--cd); color: var(--c0); padding: 0 3px; border-bottom: 2px solid var(--ce); }
`;

let injected = false;
export function injectStyle() {
  if (injected) return;
  injected = true;
  const el = document.createElement('style');
  el.dataset.game = 'quiz';
  el.textContent = CSS;
  document.head.appendChild(el);
}
