"""인형뽑기 기계 하나의 규칙 · 물리 (원본 js/claw.js 를 Python 으로 옮긴 것).

- 인형: 동그란 몸(중력 · 서로 밀어내기 · 벽 · 배출구 칸막이)
- 집게: 대기(idle) → 옮기기(move) → 내려가기(drop) → 오므리기(close) → 올리기(lift) → 배출구로(carry) → 놓기(open) → 돌아오기(back)
- 집는 힘은 시도마다 다르다. 모든 기계가 같은 seed 라서 n번째 시도의 힘은 기계끼리 같다(공정).

브라우저의 시험용 진행기(web/src/games/claw/sim/rules.js)와 한 줄씩 같은 계산이다.
두 쪽이 완전히 같은 값을 내도록 거리는 sqrt(dx*dx + dy*dy) 로만 구한다(테스트가 비교한다).
"""

from __future__ import annotations

from math import sqrt

_M = 0xFFFFFFFF
INF = float("inf")


def _imul(a: int, b: int) -> int:
    return (a * b) & _M


def make_rng(seed: int):
    """원본 makeRng 와 같은 32비트 난수(같은 seed → 같은 수열)."""
    state = [int(seed) & _M]

    def rng() -> float:
        a = (state[0] + 0x6D2B79F5) & _M
        state[0] = a
        t = a
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & _M
        return ((t ^ (t >> 14)) & _M) / 4294967296

    return rng


class Prize:
    __slots__ = ("id", "type", "r", "value", "weight", "x", "y", "vx", "vy", "held", "free")

    def __init__(self, pid, ptype, r, value, weight, x, y):
        self.id, self.type, self.r, self.value, self.weight = pid, ptype, r, value, weight
        self.x, self.y, self.vx, self.vy = x, y, 0.0, 0.0
        self.held = False       # 집게에 잡혀 있는지
        self.free = False       # 집게가 놓친(놓은) 인형 — 이것만 배출구로 넘어갈 수 있다

    def copy(self) -> "Prize":
        p = Prize(self.id, self.type, self.r, self.value, self.weight, self.x, self.y)
        p.vx, p.vy, p.held, p.free = self.vx, self.vy, self.held, self.free
        return p


class Claw:
    __slots__ = ("x", "y", "open", "state", "t", "grab", "slip_at", "moved", "grip")

    def __init__(self, x, y):
        self.x, self.y, self.open, self.state, self.t = x, y, 1.0, "idle", 0
        self.grab: Prize | None = None
        self.slip_at, self.moved, self.grip = INF, 0.0, 0.0


class Machine:
    def __init__(self, cfg: dict, seed: int, prizes: list[Prize] | None = None):
        self.cfg = cfg
        self.B, self.K = cfg["BOX"], cfg["CLAW"]
        self.rng = make_rng(seed * 7 + 3)
        self.prizes: list[Prize] = [p.copy() for p in (prizes or [])]
        self.won: list[Prize] = []          # 뽑은 인형(배출구로 나온 것)
        self.claw = Claw(self.B["HOME_X"], self.B["RAIL_Y"])
        self.events: list[dict] = []        # 화면 · 해설에 알려 줄 일
        self.settle = False                 # 처음 쌓는 동안에는 배출구를 막아 둔다
        self.coins = int(cfg["COINS"])
        self.frame = 0
        # 입력(누르고 있는 방향, 방금 누른 내리기)
        self.dir = 0
        self.drop_pending = False
        # 기록
        self.tries = 0
        self.grabs = 0
        self.slips = 0
        self.slipped_ids: set[int] = set()

    # ----- 인형 물리 한 프레임 -----
    def physics(self) -> None:
        B = self.B
        W, H, HOLE, WALL = B["W"], B["H"], B["HOLE_W"], B["WALL_TOP"]
        gravity = self.cfg["GRAVITY"]
        ps = self.prizes
        for p in ps:
            if p.held:
                continue
            p.vy += gravity
            p.vx *= 0.96
            p.vy *= 0.99
            p.x += p.vx
            p.y += p.vy
        n = len(ps)
        # 여러 번 반복해서 겹침 풀기(더미가 안정적으로 쌓이게)
        for _ in range(4):
            for i in range(n):
                a = ps[i]
                for j in range(i + 1, n):
                    b = ps[j]
                    dx = b.x - a.x
                    dy = b.y - a.y
                    mn = a.r + b.r - 0.5
                    d2 = dx * dx + dy * dy
                    if d2 >= mn * mn:
                        continue
                    d = sqrt(d2) or 0.01
                    push = (mn - d) / 2
                    nx = dx / d
                    ny = dy / d
                    wa = 0 if a.held else (2 if b.held else 1)
                    wb = 0 if b.held else (2 if a.held else 1)
                    a.x -= nx * push * wa
                    a.y -= ny * push * wa
                    b.x += nx * push * wb
                    b.y += ny * push * wb
                    # 부딪힌 방향 속도 줄이기
                    rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
                    if rv < 0:
                        if not a.held:
                            a.vx += nx * rv * 0.5
                            a.vy += ny * rv * 0.5
                        if not b.held:
                            b.vx -= nx * rv * 0.5
                            b.vy -= ny * rv * 0.5
            for p in ps:
                if p.held:
                    continue
                # 집게가 놓친 인형만 배출구 쪽으로 넘어갈 수 있다(가만히 있는 더미가 저절로 굴러 들어가지 않게)
                if (self.settle or not p.free) and p.x < HOLE + p.r + 1:
                    p.x = HOLE + p.r + 1
                    if p.vx < 0:
                        p.vx = 0.0
                # 옆벽
                if p.x < p.r:
                    p.x = p.r
                    p.vx = abs(p.vx) * 0.3
                if p.x > W - p.r:
                    p.x = W - p.r
                    p.vx = -abs(p.vx) * 0.3
                # 배출구 칸막이(x = HOLE_W 에 세로 벽)
                if p.y + p.r > WALL and abs(p.x - HOLE) < p.r + 1:
                    if p.y < WALL + 1 and abs(p.x - HOLE) < 2:
                        p.y = WALL - p.r        # 칸막이 꼭대기에 걸침
                        p.vy = 0.0
                        p.vx += -0.05 if p.x < HOLE else 0.05
                    elif p.x < HOLE:
                        p.x = HOLE - p.r - 1
                    else:
                        p.x = HOLE + p.r + 1
                # 바닥(배출구 쪽은 뚫려 있다)
                if p.x > HOLE and p.y > H - p.r:
                    p.y = H - p.r
                    p.vy = 0.0
                    p.vx *= 0.8
        # 배출구로 떨어진 인형 → 획득
        for p in list(ps):
            if p.x < HOLE and p.y > H + p.r:
                ps.remove(p)
                self.won.append(p)
                self.events.append({
                    "type": "won", "id": p.id, "prize": p.type, "value": p.value,
                    "lucky": p.id in self.slipped_ids, "score": self.score,
                })

    # ----- 집게 -----
    def start(self) -> None:
        """코인 넣고 시작."""
        c = self.claw
        c.state, c.t, c.open = "move", 0, 1.0

    def update(self, left: bool, right: bool, drop: bool) -> None:
        B, K = self.B, self.K
        c = self.claw
        c.t += 1
        if c.state == "move":
            dx = (1 if right else 0) - (1 if left else 0)
            c.x = max(B["HOME_X"], min(B["MAX_X"], c.x + dx * K["MOVE"]))
            if (drop and c.t > 8) or c.t >= self.cfg["MOVE_TIME"]:
                c.state, c.t = "drop", 0
                self.tries += 1
                self.events.append({"type": "drop"})
        elif c.state == "drop":
            c.y += K["DROP"]
            tx, ty = c.x, c.y + 9
            touch = False
            for p in self.prizes:
                ddx = p.x - tx
                ddy = p.y - ty
                if sqrt(ddx * ddx + ddy * ddy) < p.r + K["REACH"] and p.y > ty - 2:
                    touch = True
                    break
            # 내려가며 집게발이 옆 인형을 살짝 밀어낸다
            for p in self.prizes:
                ddx = p.x - c.x
                if abs(ddx) < p.r + 4 and abs(p.y - (c.y + 6)) < p.r + 2:
                    p.vx += (-0.04 if ddx < 0 else 0.04)
            if touch or ty >= B["H"] - 2:
                c.state, c.t = "close", 0
        elif c.state == "close":
            c.open = max(0.0, 1 - c.t / K["CLOSE_TIME"])
            if c.t >= K["CLOSE_TIME"]:
                self.try_grab()
        elif c.state in ("lift", "carry"):
            if c.state == "lift":
                c.y -= K["LIFT"]
                c.moved += K["LIFT"]
                if c.y <= B["RAIL_Y"]:
                    c.y = B["RAIL_Y"]
                    c.state = "carry"
            else:
                c.x -= K["CARRY"]
                c.moved += K["CARRY"]
                if c.x <= B["HOME_X"]:
                    c.x = B["HOME_X"]
                    c.state, c.t = "open", 0
            if c.grab is not None and c.moved >= c.slip_at:      # 미끄러짐
                self.release("slip")
        elif c.state == "open":
            c.open = min(1.0, c.t / K["OPEN_TIME"])
            if c.t == 4 and c.grab is not None:
                self.release("drop")
            if c.t >= K["OPEN_TIME"]:
                c.state, c.t = "back", 0
        elif c.state == "back":
            if c.t >= 24:
                c.state = "idle"
        # 잡은 인형은 집게를 따라간다
        g = c.grab
        if g is not None:
            g.x = c.x
            g.y = c.y + 9 + g.r - 2
            g.vx = 0.0
            g.vy = 0.0
        self.physics()

    def try_grab(self) -> None:
        """집게를 다 오므렸을 때: 가장 가까운 인형을 집는지 정한다."""
        c = self.claw
        K = self.K
        tx, ty = c.x, c.y + 9
        best, bd = None, INF
        for p in self.prizes:
            ddx = p.x - tx
            ddy = (p.y - ty) * 0.8
            d = sqrt(ddx * ddx + ddy * ddy)
            if d < p.r + K["REACH"] + 1 and d < bd:
                best, bd = p, d
        c.grip = self.cfg["GRIP_MIN"] + self.rng() * (self.cfg["GRIP_MAX"] - self.cfg["GRIP_MIN"])
        slip_roll = self.rng()
        slip_frac = 0.05 + self.rng() * 0.75        # 대부분 올라가는 도중에 미끄러진다
        c.state, c.t, c.moved, c.slip_at = "lift", 0, 0.0, INF
        if best is None:
            self.events.append({"type": "miss"})
            return
        # 가운데를 집을수록 · 힘이 셀수록 · 가벼울수록 안 미끄러진다
        centered = max(0.0, 1 - abs(best.x - c.x) / (best.r + 1))
        hold = (0.05 + 0.95 * centered * centered) * c.grip / best.weight
        best.held = True
        c.grab = best
        self.grabs += 1
        if slip_roll > hold:
            path = (c.y - self.B["RAIL_Y"]) + (c.x - self.B["HOME_X"])
            c.slip_at = path * slip_frac
        self.events.append({"type": "grab", "id": best.id, "prize": best.type})

    def release(self, why: str) -> None:
        p = self.claw.grab
        if p is None:
            return
        p.held = False
        p.free = True
        p.vx = (self.rng() - 0.5) * 0.6 if why == "slip" else 0.0
        p.vy = 0.3
        self.claw.grab = None
        if why == "slip":
            self.slips += 1
            self.slipped_ids.add(p.id)
            self.events.append({"type": "slip", "id": p.id, "prize": p.type})

    # ----- 한 프레임(코인 넣기 + 집게 + 물리) -----
    def step(self) -> None:
        if self.claw.state == "idle" and self.coins > 0:
            self.coins -= 1
            self.start()
            self.events.append({"type": "coin", "left": self.coins})
        self.update(self.dir < 0, self.dir > 0, self.drop_pending)
        self.drop_pending = False       # 내리기는 누른 순간 한 프레임만 유효(원본과 같다)
        self.frame += 1

    def set_input(self, direction=None, drop: bool = False) -> None:
        if direction in (-1, 0, 1) and not isinstance(direction, bool):
            self.dir = int(direction)
        if drop:
            self.drop_pending = True

    @property
    def done(self) -> bool:
        return self.coins == 0 and self.claw.state == "idle"

    @property
    def score(self) -> int:
        return sum(p.value for p in self.won)

    @property
    def gold(self) -> int:
        return sum(1 for p in self.won if p.type == "gold")

    def rank_key(self) -> tuple:
        """순위 기준: 점수 → 뽑은 개수 → 황금곰 수."""
        return (self.score, len(self.won), self.gold)

    def stats(self) -> dict:
        return {
            "prizes": len(self.won), "gold": self.gold, "won": [p.type for p in self.won],
            "tries": self.tries, "grabs": self.grabs, "slips": self.slips,
        }

    def view(self) -> dict:
        """화면에 그릴 기계 상태(본인에게만 보낸다)."""
        types = self.cfg["PRIZE_TYPES"]
        c = self.claw
        return {
            "frame": self.frame, "coins": self.coins, "score": self.score, "dir": self.dir,
            "claw": {"x": round(c.x, 2), "y": round(c.y, 2), "open": round(c.open, 3), "state": c.state, "t": c.t,
                     "grab": c.grab.id if c.grab is not None else -1},
            "prizes": [[p.id, types.index(p.type), round(p.x, 2), round(p.y, 2)] for p in self.prizes],
            "won": [types.index(p.type) for p in self.won],
        }


def make_pile(cfg: dict, seed: int) -> list[Prize]:
    """인형 배치(seed 가 같으면 같은 더미) — 떨어뜨려서 쌓은 뒤 가라앉힌다."""
    rng = make_rng(seed)
    B = cfg["BOX"]
    order = list(cfg["LINEUP"])
    for i in range(len(order) - 1, 0, -1):
        j = int(rng() * (i + 1))
        order[i], order[j] = order[j], order[i]
    m = Machine(cfg, seed)
    m.settle = True
    for i, ptype in enumerate(order):
        P = cfg["PRIZES"][ptype]
        x = B["HOLE_W"] + 4 + P["r"] + rng() * (B["W"] - B["HOLE_W"] - 8 - P["r"] * 2)
        m.prizes.append(Prize(i, ptype, P["r"], P["value"], P["weight"], x, float(10 + i * 6)))
    for _ in range(400):
        m.physics()
    for p in m.prizes:
        p.vx = 0.0
        p.vy = 0.0
    return [p.copy() for p in m.prizes]
