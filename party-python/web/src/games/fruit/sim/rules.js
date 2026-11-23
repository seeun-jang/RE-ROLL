// =============================================================
// 과일자르기 규칙 값과 계산식 — 서버(server/party/games/fruit/config.py, schedule.py)와 같은 내용.
// 화면(궤적 계산)과 시험용 진행기(FruitSim)가 함께 쓴다. 테스트가 서버와 결과를 비교한다.
// =============================================================

export const DEFAULT_CONFIG = {
  VIEW: { W: 320, H: 180 },
  RULES: { DURATION: 60.0, INTRO_TIME: 4.0, COUNTDOWN: 3.0, END_DELAY: 1.6, FINAL_TIME: 8.0 },
  SCORE: { BOMB_PENALTY: 20, COMBO_MIN: 3, COMBO_BONUS_PER_FRUIT: 5, COMBO_WINDOW: 0.32, ITEM_POINTS: 5, MAX: 999999 },
  PHYSICS: {
    GRAVITY: 150.0, SPAWN_Y: 198.0, APEX_MIN_Y: 20.0, APEX_MAX_Y: 74.0, SPAWN_X_MIN: 36.0, SPAWN_X_MAX: 284.0,
    TARGET_X_MIN: 70.0, TARGET_X_MAX: 250.0, OFFSCREEN_MARGIN: 28.0,
  },
  SPAWN: {
    FIRST_WAVE: 0.6, INTERVAL_START: 1.45, INTERVAL_END: 0.72, WAVE_MIN_START: 1, WAVE_MAX_START: 2, WAVE_MIN_END: 2,
    WAVE_MAX_END: 5, STAGGER: 0.13, BOMB_CHANCE_START: 0.1, BOMB_CHANCE_END: 0.3, ITEM_CHANCE: 0.09, ITEM_COOLDOWN: 8.0,
    FIRST_ITEM_AFTER: 6.0, FRENZY_MULTIPLIER: 3, FRENZY_MAX: 9, FRENZY_BOMB_SCALE: 0.35, FRENZY_STAGGER: 0.6,
    ITEM_VY_SCALE: 0.97,
  },
  ITEMS: { DOUBLE_TIME: 8.0, DOUBLE_MULT: 2, TRIPLE_TIME: 6.0, ACTIVATE_DELAY: 0.14 },
  BLADE: { MIN_SLICE_SPEED: 60.0 },
  NET: { MAX_LAG: 0.35, HIT_TOLERANCE: 2.0, MAX_SEGS: 64, STATE_HZ: 5 },
  FRUITS: [
    { id: 'apple', points: 10, radius: 8, weight: 3 },
    { id: 'orange', points: 10, radius: 8, weight: 3 },
    { id: 'lemon', points: 10, radius: 8, weight: 2 },
    { id: 'berry', points: 15, radius: 8, weight: 2 },
    { id: 'melon', points: 20, radius: 10, weight: 1 },
  ],
  BOMB: { id: 'bomb', radius: 7 },
  ITEM_DEFS: [{ id: 'double', radius: 9 }, { id: 'triple', radius: 9 }],
};

export function mergeConfig(override) {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const [section, values] of Object.entries(override || {})) {
    if (values && typeof values === 'object' && !Array.isArray(values) && cfg[section] && !Array.isArray(cfg[section])) {
      Object.assign(cfg[section], values);
    } else cfg[section] = values;
  }
  return cfg;
}

export const r2 = (v) => Math.floor(v * 100 + 0.5) / 100;
export const lerp = (a, b, t) => a + (b - a) * t;
const randInt = (rng, a, b) => a + Math.min(b - a, Math.floor(rng() * (b - a + 1)));

export function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return Math.sqrt(dx * dx + dy * dy);
}

/** 던진 뒤 age 초가 지났을 때의 위치 [x, y] */
export function posAt(obj, age, cfg = DEFAULT_CONFIG) {
  const P = cfg.PHYSICS;
  return [obj.x + obj.vx * age, P.SPAWN_Y + obj.vy * age + 0.5 * P.GRAVITY * age * age];
}

function launch(rng, sx, cfg, vyScale = 1) {
  const P = cfg.PHYSICS;
  const g = P.GRAVITY;
  const apex = P.APEX_MIN_Y + rng() * (P.APEX_MAX_Y - P.APEX_MIN_Y);
  let vy = -Math.sqrt(2 * g * (P.SPAWN_Y - apex));
  const flight = (2 * -vy) / g;
  const target = P.TARGET_X_MIN + rng() * (P.TARGET_X_MAX - P.TARGET_X_MIN);
  const vx = r2((target - sx) / flight);
  vy = r2(vy * vyScale);
  const life = (-vy + Math.sqrt(vy * vy + 2 * g * P.OFFSCREEN_MARGIN)) / g;
  return { x: r2(sx), vx, vy, life: r2(life) };
}

function pickFruit(rng, cfg) {
  let total = 0;
  for (const f of cfg.FRUITS) total += f.weight;
  let v = rng() * total;
  for (const f of cfg.FRUITS) {
    v -= f.weight;
    if (v <= 0) return f;
  }
  return cfg.FRUITS[0];
}

function makeSlots(rng, count, cfg) {
  const P = cfg.PHYSICS;
  const slots = [];
  for (let i = 0; i < count; i++) slots.push(lerp(P.SPAWN_X_MIN, P.SPAWN_X_MAX, (i + rng()) / count));
  for (let i = count - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return slots;
}

/** 한 판에 던질 물체를 전부 만든다 (서버 schedule.py 의 build_schedule 과 같다) */
export function buildSchedule(rng, cfg = DEFAULT_CONFIG) {
  const S = cfg.SPAWN;
  const duration = cfg.RULES.DURATION;
  const items = Object.fromEntries(cfg.ITEM_DEFS.map((d) => [d.id, d]));
  const out = [];
  const add = (kind, d, t, l, mode, group) => {
    const o = { id: out.length, kind, def: d.id, t: r2(t), x: l.x, vx: l.vx, vy: l.vy, r: d.radius, life: l.life, mode, group };
    out.push(o);
    return o;
  };
  const waveCount = (p) => {
    const lo = Math.floor(lerp(S.WAVE_MIN_START, S.WAVE_MIN_END, p) + 0.5);
    const hi = Math.floor(lerp(S.WAVE_MAX_START, S.WAVE_MAX_END, p) + 0.5);
    return randInt(rng, lo, hi);
  };
  const frenzyWave = (p, baseT, count, mode, group) => {
    if (count <= 0) return;
    const chance = lerp(S.BOMB_CHANCE_START, S.BOMB_CHANCE_END, p) * S.FRENZY_BOMB_SCALE;
    let bombs = 0;
    const slots = makeSlots(rng, count, cfg);
    for (let i = 0; i < slots.length; i++) {
      const t = baseT + i * S.STAGGER * S.FRENZY_STAGGER;
      if (mode === 1 && t >= duration) continue;
      if (bombs < 2 && rng() < chance) {
        bombs++;
        add('bomb', cfg.BOMB, t, launch(rng, slots[i], cfg), mode, group);
      } else {
        const d = pickFruit(rng, cfg);
        add('fruit', d, t, launch(rng, slots[i], cfg), mode, group);
      }
    }
  };

  let T = S.FIRST_WAVE;
  let nextItemAt = S.FIRST_ITEM_AFTER;
  while (T < duration) {
    const p = Math.min(1, T / duration);
    const count = waveCount(p);
    const chance = lerp(S.BOMB_CHANCE_START, S.BOMB_CHANCE_END, p);
    let bombs = 0;
    let itemPlaced = false;
    const tripleItems = [];
    const slots = makeSlots(rng, count, cfg);
    for (let i = 0; i < slots.length; i++) {
      const sx = slots[i];
      const t = T + i * S.STAGGER;
      if (t >= duration) continue;
      let made = false;
      if (!itemPlaced && T >= nextItemAt) {
        if (rng() < S.ITEM_CHANCE * 3) {
          itemPlaced = true;
          made = true;
          nextItemAt = T + S.ITEM_COOLDOWN;
          const d = rng() < 0.5 ? items.double : items.triple;
          const obj = add('item', d, t, launch(rng, sx, cfg, S.ITEM_VY_SCALE), 0, -1);
          if (d.id === 'triple') tripleItems.push(obj);
        }
      }
      if (!made && bombs < 2) {
        if (rng() < chance) {
          bombs++;
          made = true;
          add('bomb', cfg.BOMB, t, launch(rng, sx, cfg), 0, -1);
        }
      }
      if (!made) {
        const d = pickFruit(rng, cfg);
        add('fruit', d, t, launch(rng, sx, cfg), 0, -1);
      }
    }
    const extra = Math.min(S.FRENZY_MAX, count * S.FRENZY_MULTIPLIER) - count;
    frenzyWave(p, T + S.STAGGER * 0.5, extra, 1, -1);
    for (const item of tripleItems) {
      const n = Math.min(S.FRENZY_MAX, waveCount(p) * S.FRENZY_MULTIPLIER);
      frenzyWave(p, 0.0, n, 2, item.id);
    }
    T += lerp(S.INTERVAL_START, S.INTERVAL_END, p);
  }
  return out;
}

export const OBJECT_KEYS = ['id', 'kind', 'def', 't', 'x', 'vx', 'vy', 'r', 'life', 'mode', 'group'];
