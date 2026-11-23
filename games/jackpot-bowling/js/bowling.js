// =====================================================
// 볼링 물리 + 점수 계산 (그림과 분리 → 따로 시험 가능)
//  - Rack: 핀 10개 + 공 하나의 움직임 (공→핀, 핀→핀 충돌, 옆벽 튕김)
//  - scoreFrames: 정식 볼링 점수 (스트라이크 = 10 + 다음 2구, 스페어 = 10 + 다음 1구)
// =====================================================

// 핀 배치 (1번 핀이 앞, 뒤로 갈수록 넓어지는 삼각형)
function pinSpots() {
  const L = CONFIG.LANE;
  const spots = [];
  for (let row = 0; row < 4; row++) {
    for (let j = 0; j <= row; j++) {
      spots.push({ x: (j - row / 2) * L.PIN_GAP_X, y: L.HEAD_Y + row * L.PIN_GAP_Y });
    }
  }
  return spots;
}

class Rack {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.pins = pinSpots().map((s, i) => ({ id: i, x: s.x, y: s.y, vx: 0, vy: 0, up: true, gone: false, fall: 0, gold: false }));
    this.ball = null;
  }

  // 새 판 (핀 10개 다시 세움). gold: 잭팟 핀 번호 (-1 이면 없음)
  reset(gold = -1) {
    const spots = pinSpots();
    this.pins.forEach((p, i) => Object.assign(p, { x: spots[i].x, y: spots[i].y, vx: 0, vy: 0, up: true, gone: false, fall: 0, gold: i === gold }));
  }

  // 쓰러진 핀 치우기 (2구째 전에)
  sweep() {
    for (const p of this.pins) if (!p.up) p.gone = true;
  }

  get standing() {
    return this.pins.filter((p) => p.up && !p.gone).length;
  }

  // 공 굴리기 시작
  launch(x, angle, speed) {
    this.ball = { x, y: -4, vx: angle * speed, vy: speed, gutter: false, gone: false, spin: CONFIG.SPIN_BUDGET, hits: 0 };
  }

  // spinDir: -1 왼쪽 / 0 / 1 오른쪽 (굴러가는 중 스핀 입력)
  // 반환: 이번 프레임에 일어난 일 { pinHits, gutter }
  step(spinDir = 0) {
    const ev = { pinHits: 0, gutter: false, wall: false };
    const L = CONFIG.LANE;
    const b = this.ball;
    if (b && !b.gone) {
      // 스핀: 핀에 닿기 전까지만, 남은 양만큼
      if (spinDir && b.spin > 0 && b.y < L.HEAD_Y - 4 && !b.gutter) {
        const a = Math.min(b.spin, CONFIG.SPIN_ACCEL);
        b.vx += spinDir * a;
        b.spin -= a;
      }
    }
    // 2번 나눠서 움직임 (빠른 공이 핀을 뚫고 지나가지 않게)
    for (let sub = 0; sub < 2; sub++) {
      if (b && !b.gone) {
        b.x += b.vx / 2;
        b.y += b.vy / 2;
        if (!b.gutter && Math.abs(b.x) > L.HALF) {
          // 거터: 홈에 빠져서 끝까지 굴러감
          b.gutter = true;
          b.x = Math.sign(b.x) * (L.HALF + 2.5);
          b.vx = 0;
          ev.gutter = true;
        }
        if (b.y > L.PIT_Y) b.gone = true;
        if (!b.gutter) {
          for (const p of this.pins) {
            if (p.gone) continue;
            const dx = p.x - b.x;
            const dy = p.y - b.y;
            const d = Math.hypot(dx, dy);
            const min = L.BALL_R + L.PIN_R;
            if (d < min && d > 0) {
              const nx = dx / d;
              const ny = dy / d;
              const sp = Math.hypot(b.vx, b.vy);
              // 핀이 맞은 방향으로 튕겨 나감 (조금 흩어짐)
              const k = sp * (1.05 + this.rng() * 0.35) + 0.3;
              const rot = (this.rng() - 0.5) * 0.5;
              const c = Math.cos(rot);
              const s = Math.sin(rot);
              p.vx = (nx * c - ny * s) * k;
              p.vy = (nx * s + ny * c) * k;
              if (p.up) ev.pinHits++;
              p.up = false;
              // 공은 살짝 밀리고 느려짐 (무거워서 거의 직진)
              const dot = b.vx * nx + b.vy * ny;
              b.vx -= nx * dot * 0.22;
              b.vy -= ny * dot * 0.08;
              b.vy = Math.max(b.vy, 0.5);
              b.x = p.x - nx * min;
              b.y = p.y - ny * min;
              b.hits++;
            }
          }
        }
      }
      // 핀끼리 충돌
      for (const p of this.pins) {
        if (p.gone) continue;
        const ps = Math.hypot(p.vx, p.vy);
        if (ps < 0.25) continue;
        for (const q of this.pins) {
          if (q === p || q.gone) continue;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < L.PIN_R * 2 && d > 0) {
            const nx = dx / d;
            const ny = dy / d;
            const dot = p.vx * nx + p.vy * ny;
            if (dot <= 0) continue;
            const rot = (this.rng() - 0.5) * 0.7;
            const c = Math.cos(rot);
            const s = Math.sin(rot);
            const k = dot * (0.75 + this.rng() * 0.3);
            q.vx += (nx * c - ny * s) * k;
            q.vy += (nx * s + ny * c) * k;
            p.vx -= nx * dot * 0.55;
            p.vy -= ny * dot * 0.55;
            if (q.up) ev.pinHits++;
            q.up = false;
            q.x = p.x + nx * L.PIN_R * 2;
            q.y = p.y + ny * L.PIN_R * 2;
          }
        }
      }
      for (const p of this.pins) {
        if (p.gone) continue;
        p.x += p.vx / 2;
        p.y += p.vy / 2;
        // 옆벽에 튕겨서 다시 들어옴 (메신저 핀)
        if (Math.abs(p.x) > L.WALL) {
          p.x = Math.sign(p.x) * L.WALL;
          p.vx *= -0.55;
          ev.wall = true;
        }
        if (p.y > L.PIT_Y || p.y < L.HEAD_Y - 14) p.gone = true;
      }
    }
    for (const p of this.pins) {
      p.vx *= 0.94;
      p.vy *= 0.94;
      if (!p.up && p.fall < 1) p.fall = Math.min(1, p.fall + 0.12);
    }
    return ev;
  }

  // 공도 들어갔고 핀도 다 멈췄나
  get settled() {
    if (this.ball && !this.ball.gone) return false;
    return this.pins.every((p) => p.gone || Math.hypot(p.vx, p.vy) < 0.05);
  }
}

// 정식 볼링 점수. rolls = [쓰러뜨린 핀 수...]
// 반환: [{ rolls:[...], marks:['X','/','-','7'...], cum: 누적점수|null }]
function scoreFrames(rolls, N = CONFIG.FRAMES) {
  const frames = [];
  let i = 0;
  let cum = 0;
  let ok = true; // 앞 프레임이 모두 확정됐나 (보너스 기다리는 중이면 누적 표시 안 함)
  const at = (k) => rolls[k];
  for (let f = 0; f < N; f++) {
    const last = f === N - 1;
    const fr = { rolls: [], marks: [], cum: null };
    let score = null;
    if (i < rolls.length && !last) {
      if (at(i) === 10) {
        fr.rolls = [10];
        fr.marks = ['X'];
        if (at(i + 1) != null && at(i + 2) != null) score = 10 + at(i + 1) + at(i + 2);
        i += 1;
      } else {
        fr.rolls = rolls.slice(i, i + 2);
        fr.marks = [mark(at(i))];
        if (at(i + 1) != null) {
          const spare = at(i) + at(i + 1) === 10;
          fr.marks.push(spare ? '/' : mark(at(i + 1)));
          if (!spare) score = at(i) + at(i + 1);
          else if (at(i + 2) != null) score = 10 + at(i + 2);
        }
        i += 2;
      }
    } else if (i < rolls.length) {
      // 마지막 프레임: 스트라이크/스페어면 보너스 투구 (최대 3구)
      const r = rolls.slice(i, i + 3);
      fr.rolls = r;
      r.forEach((v, k) => {
        if (k === 0) fr.marks.push(v === 10 ? 'X' : mark(v));
        else if (k === 1) fr.marks.push(r[0] === 10 ? (v === 10 ? 'X' : mark(v)) : r[0] + v === 10 ? '/' : mark(v));
        else {
          // 3구째 앞에 핀이 새로 세워졌나 (X X 또는 스페어 뒤)
          const fresh = r[0] !== 10 || r[1] === 10;
          fr.marks.push(fresh ? (v === 10 ? 'X' : mark(v)) : r[1] + v === 10 ? '/' : mark(v));
        }
      });
      const need = r.length >= 2 && r[0] + r[1] < 10 ? 2 : 3;
      if (r.length >= need) score = r.slice(0, need).reduce((a, b) => a + b, 0);
      i += r.length;
    }
    if (ok && score != null) {
      cum += score;
      fr.cum = cum;
    } else ok = false;
    frames.push(fr);
  }
  return frames;
}

function mark(v) {
  return v === 0 ? '-' : String(v);
}

// 지금까지 확정된 점수 (보너스를 아직 기다리는 프레임은 기본 점수만 더한 '최소' 점수)
function runningScore(rolls, N = CONFIG.FRAMES) {
  const fr = scoreFrames(rolls, N);
  let best = 0;
  for (const f of fr) if (f.cum != null) best = f.cum;
  return best;
}

// 이 선수는 다음에 몇 번째 프레임·몇 구째를 던지나 / 다 끝났나
function frameState(rolls, N = CONFIG.FRAMES) {
  let i = 0;
  for (let f = 0; f < N; f++) {
    const last = f === N - 1;
    if (!last) {
      if (i >= rolls.length) return { frame: f, ball: 0, done: false };
      if (rolls[i] === 10) {
        i += 1;
        continue;
      }
      if (i + 1 >= rolls.length) return { frame: f, ball: 1, done: false };
      i += 2;
    } else {
      const r = rolls.slice(i);
      if (r.length === 0) return { frame: f, ball: 0, done: false };
      if (r.length === 1) return { frame: f, ball: 1, done: false };
      if (r.length === 2) {
        if (r[0] === 10 || r[0] + r[1] === 10) return { frame: f, ball: 2, done: false };
        return { frame: f, ball: 2, done: true };
      }
      return { frame: f, ball: 3, done: true };
    }
  }
  return { frame: N, ball: 0, done: true };
}

if (typeof module !== 'undefined') module.exports = { Rack, scoreFrames, runningScore, frameState, pinSpots };
