// AI 분석 화면의 파형 그림: 파형 → 박자선 → AI 구간 색 → 하이라이트 순서로 채워짐
import { useEffect, useRef } from 'react';

const W = 900;
const H = 180;

// 잔잔함(파랑) → 격렬함(빨강)
function heat(v, a) {
  const r = Math.round(60 + 195 * v);
  const g = Math.round(130 - 60 * v);
  const b = Math.round(255 - 215 * v);
  return `rgba(${r},${g},${b},${a})`;
}

export default function SongScope({ viz, highlight, done }) {
  const ref = useRef(null);
  const data = useRef({});
  data.current = { viz, highlight, done };

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const seen = new Map(); // 처음 나타난 시각 (애니메이션용)
    const firstSeen = (key, now) => {
      if (!seen.has(key)) seen.set(key, now);
      return now - seen.get(key);
    };
    let raf = 0;

    const draw = (ms) => {
      const now = ms / 1000;
      const { viz: v = {}, highlight: hl, done: finished } = data.current;
      const dur = v.duration || 1;
      const xOf = (t) => (t / dur) * W;
      const mid = H / 2 + 8;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 바탕
      ctx.fillStyle = 'rgba(10,4,0,0.72)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(242,195,91,0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, H);
        ctx.stroke();
      }

      // AI 구간 색 (곡 안에서 상대적으로: 가장 잔잔 = 파랑, 가장 격렬 = 빨강)
      const wins = v.windows ?? [];
      let lo = 1;
      let hi = 0;
      for (const win of wins) {
        lo = Math.min(lo, win.intensity);
        hi = Math.max(hi, win.intensity);
      }
      const rel = (x) => (hi - lo > 0.05 ? (x - lo) / (hi - lo) : x);
      for (const win of wins) {
        const age = Math.min(1, firstSeen(`w${win.t0}`, now) / 0.5);
        const x0 = xOf(win.t0);
        const x1 = xOf(win.t1);
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, heat(rel(win.intensity), 0.05));
        g.addColorStop(0.5, heat(rel(win.intensity), 0.7 * age));
        g.addColorStop(1, heat(rel(win.intensity), 0.05));
        ctx.fillStyle = g;
        ctx.fillRect(x0, 0, (x1 - x0) * (0.3 + 0.7 * age), H);
      }

      // 파형
      if (v.peaks) {
        const peaks = v.peaks;
        const grow = Math.min(1, firstSeen('wave', now) / 0.6);
        const bw = W / peaks.length;
        let max = 0.0001;
        for (const p of peaks) max = Math.max(max, p);
        for (let i = 0; i < peaks.length; i++) {
          if (i / peaks.length > grow) break;
          const t = (i / peaks.length) * dur;
          const inside = hl && t >= hl.start && t <= hl.start + hl.length;
          const h = (peaks[i] / max) * (H * 0.36);
          ctx.fillStyle = hl ? (inside ? '#fff2c0' : 'rgba(242,195,91,0.28)') : '#f2c35b';
          ctx.fillRect(i * bw, mid - h, Math.max(1, bw - 0.6), h * 2);
        }
      }

      // 박자선 (왼쪽부터 촤라락)
      if (v.beats) {
        const reveal = Math.min(1, firstSeen('beats', now) / 1.0);
        const limit = dur * reveal;
        for (let i = 0; i < v.beats.length; i++) {
          const t = v.beats[i];
          if (t > limit) break;
          const x = xOf(t);
          const bar = i % 4 === 0;
          ctx.fillStyle = bar ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.16)';
          const h = bar ? H * 0.42 : H * 0.28;
          ctx.fillRect(x, mid - h, 1, h * 2);
        }
        // 막 그려지는 끝부분 반짝임
        if (reveal < 1) {
          const x = xOf(limit);
          const g = ctx.createRadialGradient(x, mid, 0, x, mid, 40);
          g.addColorStop(0, 'rgba(255,255,255,0.9)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - 40, mid - 40, 80, 80);
        }
      }

      // AI 격렬함 띠 (맨 아래, 파형 위에)
      for (const win of wins) {
        const age = Math.min(1, firstSeen(`w${win.t0}`, now) / 0.5);
        ctx.fillStyle = heat(rel(win.intensity), age);
        ctx.fillRect(xOf(win.t0), H - 9, xOf(win.t1) - xOf(win.t0) - 1, 9);
      }

      // 분석 중 스캔 빛
      if (!finished) {
        const x = ((now * 0.6) % 1) * W;
        const g = ctx.createLinearGradient(x - 80, 0, x, 0);
        g.addColorStop(0, 'rgba(255,220,140,0)');
        g.addColorStop(1, 'rgba(255,220,140,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 80, 0, 80, H);
        ctx.fillStyle = 'rgba(255,240,200,0.9)';
        ctx.fillRect(x, 0, 2, H);
      }

      // 하이라이트 구간
      if (hl) {
        const age = Math.min(1, firstSeen('hl', now) / 0.6);
        const cx = xOf(hl.start + hl.length / 2);
        const half = ((xOf(hl.start + hl.length) - xOf(hl.start)) / 2) * (0.2 + 0.8 * age);
        const x0 = cx - half;
        const x1 = cx + half;
        const pulse = 0.6 + 0.4 * Math.sin(now * 4);
        ctx.save();
        ctx.shadowColor = '#ffcf5a';
        ctx.shadowBlur = 18 * pulse;
        ctx.strokeStyle = `rgba(255,230,150,${age})`;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x0, 6, x1 - x0, H - 18);
        ctx.restore();
        // 모서리 꺾쇠
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        for (const [x, dir] of [
          [x0, 1],
          [x1, -1],
        ]) {
          ctx.beginPath();
          ctx.moveTo(x + dir * 16, 6);
          ctx.lineTo(x, 6);
          ctx.lineTo(x, 22);
          ctx.moveTo(x + dir * 16, H - 12);
          ctx.lineTo(x, H - 12);
          ctx.lineTo(x, H - 28);
          ctx.stroke();
        }
      }

      // BPM
      if (v.bpm) {
        const a = Math.min(1, firstSeen('bpm', now) / 0.4);
        ctx.globalAlpha = a;
        ctx.font = '700 30px "Cinzel", serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff4dc';
        ctx.shadowColor = 'rgba(255,170,60,0.8)';
        ctx.shadowBlur = 14;
        const bpmText = `${Math.round(v.bpm)}`;
        ctx.fillText(bpmText, 14, 10);
        const bpmWidth = ctx.measureText(bpmText).width;
        ctx.shadowBlur = 0;
        ctx.font = '700 11px "Cinzel", serif';
        ctx.fillStyle = '#f2c35b';
        ctx.fillText('BPM', 14 + bpmWidth + 6, 26);
        ctx.globalAlpha = 1;
      }

      // 테두리
      ctx.strokeStyle = 'rgba(242,195,91,0.6)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="kmj-scope" />;
}

