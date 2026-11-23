"""레이싱: 트랙(가운데 선)과 차의 움직임. 브라우저 쪽 web/src/games/racing/sim/rules.js 와 같은 계산이다.

- 트랙은 점들을 부드러운 곡선(Catmull-Rom)으로 이어 잘게 나눈 닫힌 선이다.
  차가 가운데 선에서 (도로 폭 절반 − 여유) 보다 멀어지면 그 자리에서 막힌다 → 잔디는 보이지 않는 벽.
- 진행도 = 가운데 선을 따라 몇 번째 구간까지 왔는지(소수 포함). 한 바퀴 = 구간 수만큼.
- 서버와 브라우저가 똑같은 값을 내도록 sin·cos 은 직접 계산한다(언어마다 내장 함수의 끝자리가 다를 수 있다).
"""

from __future__ import annotations

import math

PI = 3.141592653589793
TWO_PI = 6.283185307179586


def det_sin(x: float) -> float:
    """사칙연산만으로 구한 sin (오차 1e-9 이하). 서버·브라우저 결과가 비트까지 같다."""
    x = x - TWO_PI * math.floor((x + PI) / TWO_PI)      # [-π, π)
    if x > PI / 2:
        x = PI - x
    elif x < -PI / 2:
        x = -PI - x
    x2 = x * x
    return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (
        1 / 6227020800 + x2 * (-1 / 1307674368000))))))))


def det_cos(x: float) -> float:
    return det_sin(x + PI / 2)


def sign(v: float) -> int:
    return 1 if v > 0 else -1 if v < 0 else 0


def r2(v: float) -> float:
    return math.floor(v * 100 + 0.5) / 100


def r3(v: float) -> float:
    return math.floor(v * 1000 + 0.5) / 1000


def build_track(cfg: dict) -> dict:
    """가운데 선을 잘게 나눈 점 목록과 구간 정보를 만든다."""
    T = cfg["TRACK"]
    pts = T["POINTS"]
    n = len(pts)
    per = T["SAMPLES_PER_POINT"]
    xs: list[float] = []
    ys: list[float] = []
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        for k in range(per):
            t = k / per
            t2 = t * t
            t3 = t2 * t
            for axis, out in ((0, xs), (1, ys)):
                a, b, c, d = p0[axis], p1[axis], p2[axis], p3[axis]
                v = 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
                out.append(r2(v))
    count = len(xs)
    lens = []
    for i in range(count):
        j = (i + 1) % count
        dx, dy = xs[j] - xs[i], ys[j] - ys[i]
        lens.append(math.sqrt(dx * dx + dy * dy))
    return {"x": xs, "y": ys, "len": lens, "n": count, "half": T["HALF_WIDTH"],
            "limit": T["HALF_WIDTH"] - T["WALL_MARGIN"], "search": T["SEARCH"]}


def nearest(track: dict, x: float, y: float, around: int) -> tuple[int, float, float, float, float]:
    """around 번째 구간 근처에서 (x, y) 에 가장 가까운 가운데 선 위의 점.
    돌려주는 값: (구간 번호, 구간 안 위치 0~1, 그 점 x, y, 거리)"""
    n = track["n"]
    xs, ys, lens = track["x"], track["y"], track["len"]
    best = (around % n, 0.0, xs[around % n], ys[around % n], math.inf)
    for off in range(-track["search"], track["search"] + 1):
        i = (around + off) % n
        j = (i + 1) % n
        ax, ay = xs[i], ys[i]
        bx, by = xs[j] - ax, ys[j] - ay
        l2 = lens[i] * lens[i]
        t = ((x - ax) * bx + (y - ay) * by) / l2 if l2 > 0 else 0.0
        t = max(0.0, min(1.0, t))
        px, py = ax + bx * t, ay + by * t
        dx, dy = x - px, y - py
        d = math.sqrt(dx * dx + dy * dy)
        if d < best[4]:
            best = (i, t, px, py, d)
    return best


def new_car(cfg: dict, track: dict, slot: int, slots: int) -> dict:
    """출발선 바로 뒤, 도로 폭 방향으로 나란히 세운다(서로 겹쳐 지나가므로 모두 같은 줄)."""
    C = cfg["CAR"]
    n = track["n"]
    back = C["GRID_BACK"]
    i = int(n - math.ceil(back)) % n
    t = math.ceil(back) - back
    j = (i + 1) % n
    dx, dy = track["x"][j] - track["x"][i], track["y"][j] - track["y"][i]
    length = track["len"][i]
    ux, uy = dx / length, dy / length
    lateral = (slot - (slots - 1) / 2) * C["GRID_SPACING"]
    x = track["x"][i] + dx * t - uy * lateral
    y = track["y"][i] + dy * t + ux * lateral
    # 진행 방향 각도: atan2 대신 방향 벡터를 그대로 들고 다닌다(cos, sin)
    return {
        "x": x, "y": y, "a": angle_of(ux, uy), "vx": 0.0, "vy": 0.0, "seg": i, "prog": i + t, "total": (i + t) - n,
        "drifting": False, "hit": 0.0, "finished": False, "finishTime": None, "lapTimes": [], "lapStart": 0.0,
        "steer": 0.0, "throttle": 0.0, "drift": 0.0,
    }


def angle_of(ux: float, uy: float) -> float:
    """단위 벡터 → 각도(rad). 시작할 때 한 번만 쓰므로 정밀도가 낮아도 된다(이분법, 결정적)."""
    lo, hi = -PI, PI
    for _ in range(60):
        mid = (lo + hi) / 2
        # mid 가 목표 각도보다 작으면 외적이 양수
        if det_cos(mid) * uy - det_sin(mid) * ux > 0:
            lo = mid
        else:
            hi = mid
    a = (lo + hi) / 2
    if det_cos(a) * ux + det_sin(a) * uy < 0:      # 반대 방향 해를 골랐으면 반 바퀴 돌린다
        a = a + PI if a <= 0 else a - PI
    return a


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def step_car(car: dict, cfg: dict, track: dict, dt: float) -> None:
    """차 한 대를 dt 초 진행한다 (원본 stepPhysics + 벽 + 진행도)."""
    C = cfg["CAR"]
    steer, throttle, drift = car["steer"], car["throttle"], car["drift"]
    fx, fy = det_cos(car["a"]), det_sin(car["a"])
    rx, ry = -fy, fx
    v_f = car["vx"] * fx + car["vy"] * fy
    v_l = car["vx"] * rx + car["vy"] * ry

    v_f += throttle * C["ACCEL"] * dt
    v_f *= (1 - C["DRAG"] * dt)
    v_f = clamp(v_f, -C["MAX_SPEED"] * C["REVERSE_RATIO"], C["MAX_SPEED"])

    # 옆 방향 접지력(드리프트일수록 약해져서 미끄러진다)
    grip = C["GRIP_NORMAL"] + (C["GRIP_DRIFT"] - C["GRIP_NORMAL"]) * drift
    v_l *= max(0.0, 1 - grip * dt)

    # 조향(속도에 비례, 드리프트 중엔 더 잘 돌아간다)
    speed_factor = clamp(abs(v_f) / C["TURN_SPEED_REF"], 0.0, 1.0)
    turn = C["TURN_BASE"] + drift * C["TURN_DRIFT"]
    car["a"] += steer * turn * dt * speed_factor * (sign(v_f) or 1)
    if car["a"] > PI:
        car["a"] -= TWO_PI
    elif car["a"] < -PI:
        car["a"] += TWO_PI

    car["vx"] = fx * v_f + rx * v_l
    car["vy"] = fy * v_f + ry * v_l
    car["x"] += car["vx"] * dt
    car["y"] += car["vy"] * dt
    car["drifting"] = abs(v_l) > C["SKID_SPEED"]

    # 잔디 = 보이지 않는 벽: 도로 밖으로 나가려 하면 가장자리에 붙이고 바깥쪽 속도를 없앤다
    seg, t, px, py, dist = nearest(track, car["x"], car["y"], car["seg"])
    car["hit"] = 0.0
    if dist > track["limit"]:
        nx, ny = (car["x"] - px) / dist, (car["y"] - py) / dist
        car["x"] = px + nx * track["limit"]
        car["y"] = py + ny * track["limit"]
        vn = car["vx"] * nx + car["vy"] * ny
        if vn > 0:
            car["vx"] -= vn * nx
            car["vy"] -= vn * ny
            car["vx"] *= C["WALL_KEEP"]
            car["vy"] *= C["WALL_KEEP"]
            car["hit"] = vn

    # 진행도 (한 바퀴 = 구간 수). 거꾸로 가면 줄어든다
    n = track["n"]
    prog = seg + t
    d = prog - car["prog"]
    if d < -n / 2:
        d += n
    elif d > n / 2:
        d -= n
    car["total"] += d
    car["prog"] = prog
    car["seg"] = seg
