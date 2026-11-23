// =============================================================
// 인형뽑기 기계 하나 (그림과 분리된 규칙 · 물리) — 원본 js/claw.js 를 ES 모듈로 옮긴 것
//  - 인형: 동그란 몸 (중력 · 서로 밀어내기 · 벽 · 배출구 칸막이)
//  - 집게: 대기 → 옮기기 → 내려가기 → 오므리기 → 올리기 → 배출구로 → 놓기 → 돌아오기
//  - 집는 힘은 시도마다 다름. 모든 기계가 같은 seed 라서 n번째 시도의 힘은 기계끼리 같음 (공정)
//
// 실제 판정은 Python 서버(server/party/games/claw/machine.py)가 한다. 이 파일은 시험용 진행기(Sim.js)가 쓰며,
// 서버와 한 줄씩 같은 계산이다(거리는 Math.sqrt(dx*dx + dy*dy) 로만 구한다 → 두 쪽 값이 완전히 같다).
// =============================================================

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Machine {
  constructor(cfg, seed, prizes = null) {
    this.cfg = cfg;
    this.rng = makeRng(seed * 7 + 3);
    this.prizes = (prizes || []).map((p) => ({ ...p }));
    this.won = []; // 뽑은 인형 (배출구로 나온 것)
    const B = cfg.BOX;
    this.claw = { x: B.HOME_X, y: B.RAIL_Y, open: 1, state: 'idle', t: 0, grab: null, slipAt: Infinity, moved: 0, grip: 0 };
    this.events = []; // 화면 · 해설에 알려 줄 일 (집음, 미끄러짐, 획득 …)
    this.settle = false;
    this.coins = cfg.COINS;
    this.frame = 0;
    // 입력 (누르고 있는 방향, 방금 누른 내리기)
    this.dir = 0;
    this.dropPending = false;
    // 기록
    this.tries = 0;
    this.grabs = 0;
    this.slips = 0;
    this.slippedIds = new Set();
  }

  // 인형 물리 한 프레임
  physics() {
    const B = this.cfg.BOX;
    const ps = this.prizes;
    for (const p of ps) {
      if (p.held) continue;
      p.vy += this.cfg.GRAVITY;
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
          const min = a.r + b.r - 0.5;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 0.01;
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
        this.events.push({ type: 'won', id: p.id, prize: p.type, value: p.value, lucky: this.slippedIds.has(p.id), score: this.score });
      }
    }
  }

  // 코인 넣고 시작
  start() {
    Object.assign(this.claw, { state: 'move', t: 0, open: 1 });
  }

  update(left, right, drop) {
    const B = this.cfg.BOX;
    const K = this.cfg.CLAW;
    const c = this.claw;
    c.t++;
    if (c.state === 'move') {
      const dx = (right ? 1 : 0) - (left ? 1 : 0);
      c.x = Math.max(B.HOME_X, Math.min(B.MAX_X, c.x + dx * K.MOVE));
      if ((drop && c.t > 8) || c.t >= this.cfg.MOVE_TIME) {
        c.state = 'drop';
        c.t = 0;
        this.tries++;
        this.events.push({ type: 'drop' });
      }
    } else if (c.state === 'drop') {
      c.y += K.DROP;
      const tx = c.x;
      const ty = c.y + 9;
      let touch = false;
      for (const p of this.prizes) {
        const ddx = p.x - tx;
        const ddy = p.y - ty;
        if (Math.sqrt(ddx * ddx + ddy * ddy) < p.r + K.REACH && p.y > ty - 2) {
          touch = true;
          break;
        }
      }
      // 내려가며 집게발이 옆 인형을 살짝 밀어냄
      for (const p of this.prizes) {
        const ddx = p.x - c.x;
        if (Math.abs(ddx) < p.r + 4 && Math.abs(p.y - (c.y + 6)) < p.r + 2) p.vx += ddx < 0 ? -0.04 : 0.04;
      }
      if (touch || ty >= B.H - 2) {
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
      if (c.grab && c.moved >= c.slipAt) this.release('slip');
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
    const K = this.cfg.CLAW;
    const tx = c.x;
    const ty = c.y + 9;
    let best = null;
    let bd = Infinity;
    for (const p of this.prizes) {
      const ddx = p.x - tx;
      const ddy = (p.y - ty) * 0.8;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < p.r + K.REACH + 1 && d < bd) {
        best = p;
        bd = d;
      }
    }
    c.grip = this.cfg.GRIP_MIN + this.rng() * (this.cfg.GRIP_MAX - this.cfg.GRIP_MIN);
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
    this.grabs++;
    if (slipRoll > hold) {
      const path = (c.y - this.cfg.BOX.RAIL_Y) + (c.x - this.cfg.BOX.HOME_X);
      c.slipAt = path * slipFrac;
    }
    this.events.push({ type: 'grab', id: best.id, prize: best.type });
  }

  release(why) {
    const p = this.claw.grab;
    if (!p) return;
    p.held = false;
    p.free = true;
    p.vx = why === 'slip' ? (this.rng() - 0.5) * 0.6 : 0;
    p.vy = 0.3;
    this.claw.grab = null;
    if (why === 'slip') {
      this.slips++;
      this.slippedIds.add(p.id);
      this.events.push({ type: 'slip', id: p.id, prize: p.type });
    }
  }

  // 한 프레임 (코인 넣기 + 집게 + 물리)
  step() {
    if (this.claw.state === 'idle' && this.coins > 0) {
      this.coins--;
      this.start();
      this.events.push({ type: 'coin', left: this.coins });
    }
    this.update(this.dir < 0, this.dir > 0, this.dropPending);
    this.dropPending = false; // 내리기는 누른 순간 한 프레임만 유효
    this.frame++;
  }

  setInput(dir, drop) {
    if (dir === -1 || dir === 0 || dir === 1) this.dir = dir;
    if (drop) this.dropPending = true;
  }

  get done() {
    return this.coins === 0 && this.claw.state === 'idle';
  }

  get score() {
    return this.won.reduce((s, p) => s + p.value, 0);
  }

  get gold() {
    return this.won.filter((p) => p.type === 'gold').length;
  }

  // 순위 기준: 점수 → 뽑은 개수 → 황금곰 수
  rankKey() {
    return [this.score, this.won.length, this.gold];
  }

  stats() {
    return {
      prizes: this.won.length, gold: this.gold, won: this.won.map((p) => p.type),
      tries: this.tries, grabs: this.grabs, slips: this.slips,
    };
  }

  // 화면에 그릴 기계 상태
  view() {
    const types = this.cfg.PRIZE_TYPES;
    const c = this.claw;
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      frame: this.frame, coins: this.coins, score: this.score, dir: this.dir,
      claw: { x: r2(c.x), y: r2(c.y), open: Math.round(c.open * 1000) / 1000, state: c.state, t: c.t, grab: c.grab ? c.grab.id : -1 },
      prizes: this.prizes.map((p) => [p.id, types.indexOf(p.type), r2(p.x), r2(p.y)]),
      won: this.won.map((p) => types.indexOf(p.type)),
    };
  }
}

// 인형 배치 (seed 가 같으면 같은 더미) — 떨어뜨려서 쌓은 뒤 가라앉힘
export function makePile(cfg, seed) {
  const rng = makeRng(seed);
  const B = cfg.BOX;
  const list = [...cfg.LINEUP];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const m = new Machine(cfg, seed);
  m.settle = true; // 쌓는 동안엔 배출구를 막아 둠 (인형이 처음부터 빠지지 않게)
  list.forEach((type, i) => {
    const P = cfg.PRIZES[type];
    m.prizes.push({
      id: i, type, r: P.r, value: P.value, weight: P.weight,
      x: B.HOLE_W + 4 + P.r + rng() * (B.W - B.HOLE_W - 8 - P.r * 2),
      y: 10 + i * 6, vx: 0, vy: 0, held: false, free: false,
    });
  });
  for (let k = 0; k < 400; k++) m.physics();
  m.prizes.forEach((p) => {
    p.vx = 0;
    p.vy = 0;
  });
  return m.prizes.map((p) => ({ ...p }));
}

// =====================================================
// 시험용 봇 (원본 js/bot.js 의 CPU 손님)
//  위가 비어 있는(다른 인형에 안 깔린) 인형 중 점수가 높은 걸 골라
//  그 위로 집게를 옮기고 내림. skill 0~1: 높을수록 정확하게 가운데를 노림
// =====================================================
export class ClawBot {
  constructor(skill, rng = Math.random) {
    this.skill = skill;
    this.rng = rng;
    this.plan = null;
  }

  // 위에 다른 인형이 덮고 있지 않은 인형
  static exposed(m) {
    return m.prizes.filter((p) => p.x > m.cfg.BOX.HOLE_W && !m.prizes.some((q) => q !== p && q.y < p.y - 2 && Math.abs(q.x - p.x) < q.r + p.r - 3));
  }

  // m: Machine → 이번 입력 { left, right, drop }
  think(m) {
    const out = { left: false, right: false, drop: false };
    const c = m.claw;
    const rnd = this.rng;
    if (c.state !== 'move') {
      this.plan = null;
      return out;
    }
    if (!this.plan) {
      const s = this.skill;
      // 점수 높고 가벼운 걸 좋아함 (+ 약간의 변덕)
      const scored = ClawBot.exposed(m).map((p) => ({ p, v: p.value / Math.pow(p.weight, 1.5) + rnd() * (4 + (1 - s) * 30) }));
      scored.sort((a, b) => b.v - a.v);
      const tg = scored.length ? scored[0].p : m.prizes[0];
      this.plan = {
        x: tg ? tg.x + (rnd() - 0.5) * (1 - s) * 22 : 30,
        wait: 15 + Math.floor(rnd() * 40),
      };
    }
    const P = this.plan;
    if (P.wait > 0) {
      P.wait -= 2;       // 진행기가 초당 30번 부른다(원본은 60번)
      return out;
    }
    const dx = P.x - c.x;
    if (Math.abs(dx) > m.cfg.CLAW.MOVE * 2) {
      out.left = dx < 0;
      out.right = dx > 0;
    } else out.drop = true;
    return out;
  }
}
