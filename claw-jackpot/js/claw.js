// =====================================================
// 인형뽑기 기계 하나 (그림과 분리된 규칙 · 물리)
//  - 인형: 동그란 몸 (중력 · 서로 밀어내기 · 벽 · 배출구 칸막이)
//  - 집게: 대기 → 옮기기 → 내려가기 → 오므리기 → 올리기 → 배출구로 → 놓기 → 돌아오기
//  - 집는 힘은 시도마다 다름. 모든 기계가 같은 seed 라서 n번째 시도의 힘은 기계끼리 같음 (공정)
// =====================================================
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 오늘 날짜 seed (개인 화면 기본값: 같은 날엔 모두 같은 인형 배치)
function dateSeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// 인형 배치 (seed 가 같으면 같은 더미) — 떨어뜨려서 쌓은 뒤 가라앉힘
function makePile(seed) {
  const rng = makeRng(seed);
  const B = CONFIG.BOX;
  const list = [...CONFIG.LINEUP];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const m = new Machine(seed);
  m.settle = true; // 쌓는 동안엔 배출구를 막아 둠 (인형이 처음부터 빠지지 않게)
  list.forEach((type, i) => {
    const P = CONFIG.PRIZES[type];
    m.prizes.push({
      id: i, type, r: P.r, value: P.value, weight: P.weight,
      x: B.HOLE_W + 4 + P.r + rng() * (B.W - B.HOLE_W - 8 - P.r * 2),
      y: 10 + i * 6, vx: 0, vy: 0, held: false,
    });
  });
  for (let k = 0; k < 400; k++) m.physics();
  m.prizes.forEach((p) => {
    p.vx = 0;
    p.vy = 0;
  });
  return m.prizes.map((p) => ({ ...p }));
}

class Machine {
  constructor(seed) {
    this.rng = makeRng(seed * 7 + 3);
    this.prizes = [];
    this.won = []; // 뽑은 인형 (배출구로 나온 것)
    const B = CONFIG.BOX;
    this.claw = { x: B.HOME_X, y: B.RAIL_Y, open: 1, state: 'idle', t: 0, grab: null, slipAt: Infinity, moved: 0, grip: 0 };
    this.events = []; // 그림/소리 쪽에 알려 줄 일 (집음, 미끄러짐, 획득 …)
  }

  // 인형 물리 한 프레임
  physics() {
    const B = CONFIG.BOX;
    const ps = this.prizes;
    for (const p of ps) {
      if (p.held) continue;
      p.vy += CONFIG.GRAVITY;
      p.vx *= 0.96;
      p.vy *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
    }
    // 여러 번 반복해서 겹침 풀기 (더미가 안정적으로 쌓이게)
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i];
          const b = ps[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const min = a.r + b.r - 0.5;
          if (d >= min) continue;
          const push = (min - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          const wa = a.held ? 0 : b.held ? 2 : 1;
          const wb = b.held ? 0 : a.held ? 2 : 1;
          a.x -= nx * push * wa;
          a.y -= ny * push * wa;
          b.x += nx * push * wb;
          b.y += ny * push * wb;
          // 부딪힌 방향 속도 줄이기
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            if (!a.held) {
              a.vx += nx * rv * 0.5;
              a.vy += ny * rv * 0.5;
            }
            if (!b.held) {
              b.vx -= nx * rv * 0.5;
              b.vy -= ny * rv * 0.5;
            }
          }
        }
      }
      for (const p of ps) {
        if (p.held) continue;
        // 집게가 놓친(놓은) 인형만 배출구 쪽으로 넘어갈 수 있음 — 가만히 있는 더미가 저절로 굴러 들어가지 않게
        if ((this.settle || !p.free) && p.x < B.HOLE_W + p.r + 1) {
          p.x = B.HOLE_W + p.r + 1;
          if (p.vx < 0) p.vx = 0;
        }
        // 옆벽
        if (p.x < p.r) {
          p.x = p.r;
          p.vx = Math.abs(p.vx) * 0.3;
        }
        if (p.x > B.W - p.r) {
          p.x = B.W - p.r;
          p.vx = -Math.abs(p.vx) * 0.3;
        }
        // 배출구 칸막이 (x = HOLE_W 에 세로 벽)
        if (p.y + p.r > B.WALL_TOP && Math.abs(p.x - B.HOLE_W) < p.r + 1) {
          if (p.y < B.WALL_TOP + 1 && Math.abs(p.x - B.HOLE_W) < 2) {
            p.y = B.WALL_TOP - p.r; // 칸막이 꼭대기에 걸침
            p.vy = 0;
            p.vx += p.x < B.HOLE_W ? -0.05 : 0.05;
          } else if (p.x < B.HOLE_W) p.x = B.HOLE_W - p.r - 1;
          else p.x = B.HOLE_W + p.r + 1;
        }
        // 바닥 (배출구 쪽은 뚫려 있음)
        if (p.x > B.HOLE_W && p.y > B.H - p.r) {
          p.y = B.H - p.r;
          p.vy = 0;
          p.vx *= 0.8;
        }
      }
    }
    // 배출구로 떨어진 인형 → 획득
    for (const p of [...ps]) {
      if (p.x < B.HOLE_W && p.y > B.H + p.r) {
        this.prizes.splice(this.prizes.indexOf(p), 1);
        this.won.push(p);
        this.events.push({ type: 'won', prize: p });
      }
    }
  }

  // 집게 아래쪽 끝 (집게발 사이)
  get tip() {
    return { x: this.claw.x, y: this.claw.y + 9 };
  }

  // 코인 넣고 시작
  start() {
    Object.assign(this.claw, { state: 'move', t: 0, open: 1 });
  }

  // inp: { left, right, drop }
  update(inp) {
    const B = CONFIG.BOX;
    const K = CONFIG.CLAW;
    const c = this.claw;
    c.t++;
    if (c.state === 'move') {
      const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      c.x = Math.max(B.HOME_X, Math.min(B.MAX_X, c.x + dx * K.MOVE));
      if ((inp.drop && c.t > 8) || c.t >= CONFIG.MOVE_TIME) {
        c.state = 'drop';
        c.t = 0;
        this.events.push({ type: 'drop' });
      }
    } else if (c.state === 'drop') {
      c.y += K.DROP;
      const tip = this.tip;
      const touch = this.prizes.some((p) => Math.hypot(p.x - tip.x, p.y - tip.y) < p.r + K.REACH && p.y > tip.y - 2);
      // 내려가며 집게발이 옆 인형을 살짝 밀어냄
      for (const p of this.prizes) {
        const dx = p.x - c.x;
        if (Math.abs(dx) < p.r + 4 && Math.abs(p.y - (c.y + 6)) < p.r + 2) p.vx += Math.sign(dx || 1) * 0.04;
      }
      if (touch || tip.y >= B.H - 2) {
        c.state = 'close';
        c.t = 0;
      }
    } else if (c.state === 'close') {
      c.open = Math.max(0, 1 - c.t / K.CLOSE_TIME);
      if (c.t >= K.CLOSE_TIME) this.tryGrab();
    } else if (c.state === 'lift' || c.state === 'carry') {
      if (c.state === 'lift') {
        c.y -= K.LIFT;
        c.moved += K.LIFT;
        if (c.y <= B.RAIL_Y) {
          c.y = B.RAIL_Y;
          c.state = 'carry';
        }
      } else {
        c.x -= K.CARRY;
        c.moved += K.CARRY;
        if (c.x <= B.HOME_X) {
          c.x = B.HOME_X;
          c.state = 'open';
          c.t = 0;
        }
      }
      // 미끄러짐
      if (c.grab && c.moved >= c.slipAt) {
        this.release('slip');
      }
    } else if (c.state === 'open') {
      c.open = Math.min(1, c.t / K.OPEN_TIME);
      if (c.t === 4 && c.grab) this.release('drop');
      if (c.t >= K.OPEN_TIME) {
        c.state = 'back';
        c.t = 0;
      }
    } else if (c.state === 'back') {
      if (c.t >= 24) c.state = 'idle';
    }
    // 잡은 인형은 집게를 따라감
    if (c.grab) {
      c.grab.x = c.x;
      c.grab.y = c.y + 9 + c.grab.r - 2;
      c.grab.vx = 0;
      c.grab.vy = 0;
    }
    this.physics();
  }

  // 집게를 다 오므렸을 때: 가장 가까운 인형을 집는지 결정
  tryGrab() {
    const c = this.claw;
    const tip = this.tip;
    let best = null;
    let bd = Infinity;
    for (const p of this.prizes) {
      const d = Math.hypot(p.x - tip.x, (p.y - tip.y) * 0.8);
      if (d < p.r + CONFIG.CLAW.REACH + 1 && d < bd) {
        best = p;
        bd = d;
      }
    }
    c.grip = CONFIG.GRIP_MIN + this.rng() * (CONFIG.GRIP_MAX - CONFIG.GRIP_MIN);
    const slipRoll = this.rng();
    const slipFrac = 0.05 + this.rng() * 0.75; // 대부분 올라가는 도중에 미끄러짐
    c.state = 'lift';
    c.t = 0;
    c.moved = 0;
    c.slipAt = Infinity;
    if (!best) {
      this.events.push({ type: 'miss' });
      return;
    }
    // 가운데를 집을수록 · 힘이 셀수록 · 가벼울수록 안 미끄러짐
    const centered = Math.max(0, 1 - Math.abs(best.x - c.x) / (best.r + 1));
    const hold = (0.05 + 0.95 * centered * centered) * c.grip / best.weight;
    best.held = true;
    c.grab = best;
    if (slipRoll > hold) {
      const path = (c.y - CONFIG.BOX.RAIL_Y) + (c.x - CONFIG.BOX.HOME_X);
      c.slipAt = path * slipFrac;
    }
    this.events.push({ type: 'grab', prize: best, hold });
  }

  release(why) {
    const p = this.claw.grab;
    if (!p) return;
    p.held = false;
    p.free = true;
    p.vx = why === 'slip' ? (this.rng() - 0.5) * 0.6 : 0;
    p.vy = 0.3;
    this.claw.grab = null;
    if (why === 'slip') this.events.push({ type: 'slip', prize: p });
  }

  get busy() {
    return this.claw.state !== 'idle' && this.claw.state !== 'move';
  }

  get score() {
    return this.won.reduce((s, p) => s + p.value, 0);
  }
}
