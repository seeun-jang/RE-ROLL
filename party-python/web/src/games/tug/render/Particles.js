// =============================================================
// Particles — 픽셀 사각형(1~2px) 입자.
// 객체 풀을 미리 만들어 두고 재사용한다 (매 프레임 new 없음).
// 타입: dust(흙먼지) sparkle(반짝임) fire(피버 불꽃) confetti(꽃가루) mud(진흙) spark(작은 불티)
// =============================================================
import { PALETTE, C } from '../palette.js';

const MAX_PARTICLES = 800;      // 풀 크기 (넘치면 가장 오래된 입자를 덮어쓴다)
const CULL_MARGIN = 6;          // 화면 밖 여유 (px)
const KILL_Y = 260;             // 이 아래로 떨어지면 제거

// 타입 번호 (문자열 비교 대신 정수)
const T_DUST = 0, T_SPARKLE = 1, T_FIRE = 2, T_CONFETTI = 3, T_MUD = 4, T_SPARK = 5;
const TYPE_ID = { dust: T_DUST, sparkle: T_SPARKLE, fire: T_FIRE, confetti: T_CONFETTI, mud: T_MUD, spark: T_SPARK };

// 타입별 기본 개수
const DEFAULT_COUNT = { dust: 4, sparkle: 6, fire: 3, confetti: 36, mud: 6, spark: 8 };

// 타입별 색 (팔레트 HEX)
const DUST_COLORS = [PALETTE[C.ORANGE], PALETTE[C.YELLOW], PALETTE[C.SILVER], PALETTE[C.ORANGE]];
const SPARKLE_COLORS = [PALETTE[C.YELLOW], PALETTE[C.WHITE], PALETTE[C.CYAN]];
const FIRE_COLORS = [PALETTE[C.RED], PALETTE[C.ORANGE], PALETTE[C.YELLOW]]; // 수명이 줄면 노랑→주황→빨강
const CONFETTI_COLORS = [
  PALETTE[C.RED], PALETTE[C.ORANGE], PALETTE[C.YELLOW], PALETTE[C.LIME], PALETTE[C.GREEN],
  PALETTE[C.CYAN], PALETTE[C.SKY], PALETTE[C.BLUE], PALETTE[C.WHITE], PALETTE[C.PLUM],
];
const MUD_COLORS = [PALETTE[C.PLUM], PALETTE[C.CHARCOAL], PALETTE[C.INK], PALETTE[C.PLUM]];
const SPARK_COLORS = [PALETTE[C.WHITE], PALETTE[C.WHITE], PALETTE[C.YELLOW]];

function makeParticle() {
  return {
    type: 0, x: 0, y: 0, vx: 0, vy: 0,
    grav: 0, drag: 0, life: 0, max: 1, age: 0,
    color: '#000000', size: 1, floor: Infinity, landed: false, seed: 0,
  };
}

export class Particles {
  /** @param {() => number} [rng] 난수 함수 (테스트용 주입 가능) */
  constructor(rng = Math.random) {
    this._rng = rng;
    this._pool = new Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) this._pool[i] = makeParticle();
    this._n = 0;          // 살아있는 입자 수 (풀 앞쪽 _n 개가 살아있음)
    this._cursor = 0;     // 풀이 꽉 찼을 때 덮어쓸 위치
  }

  /** 살아있는 입자 수 */
  get count() {
    return this._n;
  }

  clear() {
    this._n = 0;
    this._cursor = 0;
  }

  /** 풀에서 입자 하나 꺼내기 (꽉 차면 오래된 것 재사용) */
  _alloc() {
    if (this._n < MAX_PARTICLES) return this._pool[this._n++];
    const p = this._pool[this._cursor];
    this._cursor = (this._cursor + 1) % MAX_PARTICLES;
    return p;
  }

  _pick(arr) {
    return arr[(this._rng() * arr.length) | 0];
  }

  _range(a, b) {
    return a + this._rng() * (b - a);
  }

  /**
   * 입자 생성
   * @param {'dust'|'sparkle'|'fire'|'confetti'|'mud'|'spark'} type
   * @param {number} x 월드 x
   * @param {number} y 월드 y
   * @param {{count?: number, dir?: -1|1, floor?: number}} opts
   */
  emit(type, x, y, opts = {}) {
    const id = TYPE_ID[type];
    if (id === undefined) return;
    const count = Math.max(0, Math.floor(opts.count ?? DEFAULT_COUNT[type]));
    const dir = opts.dir === -1 || opts.dir === 1 ? opts.dir : 0;
    const R = () => this._rng();

    for (let i = 0; i < count; i++) {
      const p = this._alloc();
      p.type = id;
      p.x = x;
      p.y = y;
      p.age = 0;
      p.landed = false;
      p.floor = Infinity;
      p.seed = R() * 100;
      p.size = 1;

      switch (id) {
        case T_DUST: {
          // 발밑에서 옆으로 퍼지는 흙먼지 (dir 방향 위주)
          const side = dir !== 0 ? dir : (R() < 0.5 ? -1 : 1);
          p.x = x + this._range(-2, 2);
          p.vx = side * this._range(12, 34);
          p.vy = -this._range(6, 22);
          p.grav = 40;
          p.drag = 3.5;
          p.max = p.life = this._range(0.3, 0.6);
          p.color = this._pick(DUST_COLORS);
          p.size = R() < 0.5 ? 2 : 1;
          p.floor = opts.floor ?? y;
          break;
        }
        case T_SPARKLE: {
          // 짧게 반짝이는 별 모양 (사방으로 천천히 퍼짐)
          const a = R() * Math.PI * 2;
          const sp = this._range(14, 46);
          p.x = x + this._range(-3, 3);
          p.y = y + this._range(-3, 3);
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp - 10;
          p.grav = 0;
          p.drag = 4;
          p.max = p.life = this._range(0.3, 0.55);
          p.color = this._pick(SPARKLE_COLORS);
          p.size = R() < 0.4 ? 2 : 1; // 2 = 십자 별
          break;
        }
        case T_FIRE: {
          // 피버 불꽃: 위로 솟으며 노랑→주황→빨강
          p.x = x + this._range(-4, 4);
          p.vx = this._range(-8, 8) + dir * 6;
          p.vy = -this._range(22, 46);
          p.grav = -18; // 위로 가속 (뜨거운 공기)
          p.drag = 1.5;
          p.max = p.life = this._range(0.35, 0.7);
          p.color = FIRE_COLORS[2];
          p.size = 2;
          break;
        }
        case T_CONFETTI: {
          // 꽃가루: 위로 터진 뒤 흔들리며 천천히 떨어짐
          p.x = x + this._range(-6, 6);
          p.vx = this._range(-70, 70) + dir * 30;
          p.vy = -this._range(50, 120);
          p.grav = 110;
          p.drag = 2.2;
          p.max = p.life = this._range(2.0, 3.4);
          p.color = this._pick(CONFETTI_COLORS);
          p.size = 2;
          if (opts.floor !== undefined) p.floor = opts.floor;
          break;
        }
        case T_MUD: {
          // 진흙 튀김: 포물선으로 튀었다가 바닥에 납작하게 붙음
          const side = dir !== 0 ? dir : (R() < 0.5 ? -1 : 1);
          p.vx = side * this._range(10, 45) * (R() < 0.25 ? -0.5 : 1);
          p.vy = -this._range(35, 75);
          p.grav = 230;
          p.drag = 0.6;
          p.max = p.life = this._range(0.6, 1.0);
          p.color = this._pick(MUD_COLORS);
          p.size = R() < 0.6 ? 2 : 1;
          p.floor = (opts.floor ?? y) + this._range(-1, 3);
          break;
        }
        case T_SPARK: {
          // 작은 흰 불티: 빠르게 사방으로 터지고 금방 사라짐
          const a = R() * Math.PI * 2;
          const sp = this._range(55, 115);
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp;
          p.grav = 60;
          p.drag = 7;
          p.max = p.life = this._range(0.14, 0.3);
          p.color = this._pick(SPARK_COLORS);
          p.size = 1;
          break;
        }
        default:
          break;
      }
    }
  }

  update(dt) {
    const pool = this._pool;
    let i = 0;
    while (i < this._n) {
      const p = pool[i];
      p.life -= dt;
      p.age += dt;
      if (p.life <= 0 || p.y > KILL_Y) {
        // 죽은 입자는 마지막 살아있는 입자와 자리를 바꿔 제거 (풀 객체는 그대로 보존)
        const last = this._n - 1;
        pool[i] = pool[last];
        pool[last] = p;
        this._n = last;
        if (this._cursor >= this._n) this._cursor = 0;
        continue;
      }
      if (!p.landed) {
        // 공기 저항 (지수 감쇠 근사) + 중력
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        if (p.type !== T_CONFETTI) p.vy *= Math.max(0, 1 - p.drag * 0.3 * dt);
        p.vy += p.grav * dt;
        // 꽃가루는 낙하 속도 제한 (팔랑팔랑)
        if (p.type === T_CONFETTI && p.vy > 26) p.vy = 26;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // 바닥 충돌
        if (p.vy > 0 && p.y >= p.floor) {
          p.y = p.floor;
          if (p.type === T_MUD) {
            // 진흙: 납작하게 붙어서 잠깐 남음
            p.landed = true;
            p.vx = 0;
            p.vy = 0;
            p.life = Math.min(p.life, 0.5);
          } else if (p.type === T_DUST) {
            p.vy = 0;
            p.vx *= 0.5;
          } else if (p.type === T_CONFETTI) {
            p.landed = true;
            p.vx = 0;
            p.vy = 0;
          }
        }
      }
      i++;
    }
  }

  /** 1~2px 사각형만, 정수 좌표로 그린다 */
  render(g, camX = 0) {
    const n = this._n;
    if (n === 0) return;
    const pool = this._pool;
    const viewW = (g.canvas && g.canvas.width) || 320;
    const viewH = (g.canvas && g.canvas.height) || 180;
    const cam = Math.round(camX);

    for (let i = 0; i < n; i++) {
      const p = pool[i];
      const sx = Math.round(p.x) - cam;
      const sy = Math.round(p.y);
      if (sx < -CULL_MARGIN || sx > viewW + CULL_MARGIN || sy < -CULL_MARGIN || sy > viewH + CULL_MARGIN) continue;
      const k = p.life / p.max; // 남은 수명 비율 (1 → 0)
      // 사라지기 직전엔 깜빡임 (반투명 대신)
      const blink = ((p.age * 30) | 0) & 1;
      if (k < 0.18 && blink) continue;

      switch (p.type) {
        case T_DUST: {
          g.fillStyle = p.color;
          const s = k > 0.5 ? p.size : 1;
          g.fillRect(sx, sy - s + 1, s, s);
          break;
        }
        case T_SPARKLE: {
          // 반짝임: 큰 별은 수명 중반에 십자 모양, 아니면 1px 점이 깜빡
          const tw = ((p.age * 16 + p.seed) | 0) & 1;
          g.fillStyle = p.color;
          g.fillRect(sx, sy, 1, 1);
          if (p.size === 2 && k > 0.35 && tw) {
            g.fillRect(sx - 1, sy, 1, 1);
            g.fillRect(sx + 1, sy, 1, 1);
            g.fillRect(sx, sy - 1, 1, 1);
            g.fillRect(sx, sy + 1, 1, 1);
          }
          break;
        }
        case T_FIRE: {
          // 수명에 따라 색 단계 변경, 크기 2 → 1
          g.fillStyle = k > 0.66 ? FIRE_COLORS[2] : k > 0.33 ? FIRE_COLORS[1] : FIRE_COLORS[0];
          const s = k > 0.45 ? 2 : 1;
          g.fillRect(sx, sy, s, s);
          break;
        }
        case T_CONFETTI: {
          // 좌우로 흔들림 + 뒤집히는 느낌 (2×2 / 2×1 / 1×2 교대)
          const sway = p.landed ? 0 : Math.round(Math.sin(p.age * 6 + p.seed) * 2);
          const f = ((p.age * 9 + p.seed) | 0) % 3;
          const w = f === 2 ? 1 : 2;
          const h = f === 1 ? 1 : 2;
          g.fillStyle = p.color;
          if (p.landed) g.fillRect(sx, sy, 2, 1);
          else g.fillRect(sx + sway, sy, w, h);
          break;
        }
        case T_MUD: {
          g.fillStyle = p.color;
          if (p.landed) g.fillRect(sx - 1, sy, p.size + 1, 1); // 납작한 자국
          else g.fillRect(sx, sy, p.size, p.size);
          break;
        }
        case T_SPARK: {
          g.fillStyle = p.color;
          g.fillRect(sx, sy, 1, 1);
          // 초반엔 진행 방향 뒤로 1px 꼬리
          if (k > 0.5) {
            const tx = p.vx > 20 ? -1 : p.vx < -20 ? 1 : 0;
            const ty = p.vy > 20 ? -1 : p.vy < -20 ? 1 : 0;
            if (tx !== 0 || ty !== 0) g.fillRect(sx + tx, sy + ty, 1, 1);
          }
          break;
        }
        default:
          break;
      }
    }
  }
}
