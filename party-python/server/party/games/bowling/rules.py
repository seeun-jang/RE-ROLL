"""볼링 규칙 계산 — 원본 js/bowling.js (Rack · scoreFrames · frameState) 를 Python 으로 옮긴 것.

브라우저(web/src/games/bowling/sim/rules.js)와 **숫자 하나까지 같은 결과**가 나와야 한다.
(브라우저는 같은 계산으로 핀이 쓰러지는 모습을 바로 그리고, 서버가 같은 계산으로 판정한다.)
그래서 두 쪽이 다르게 계산할 수 있는 것은 쓰지 않는다:
  - 난수: Math.random 대신 씨앗으로 만드는 간단한 난수(make_rng)
  - sin · cos: 라이브러리 대신 사칙연산 다항식(det_sin, det_cos) — 각도가 ±0.35 로 작아서 충분히 정확하다
  - hypot: sqrt(dx*dx + dy*dy)
"""

from __future__ import annotations

import math


# ----- 양쪽이 같은 값을 내는 난수 · 삼각함수 -----
def make_rng(seed: int):
    """씨앗 → 0 이상 1 미만 난수 함수 (선형 합동법). JS 쪽과 같은 수열."""
    state = [int(seed) % 4294967296]

    def rng() -> float:
        state[0] = (state[0] * 1664525 + 1013904223) % 4294967296
        return state[0] / 4294967296

    return rng


def throw_seed(seed: int, n: int, salt: int = 0) -> int:
    """n 번째 투구의 씨앗. 모든 참가자가 같은 값을 쓴다(salt 0 = 핀 물리, 1 = 방향 화살표 시작 위치)."""
    return (int(seed) + n * 7919 + salt * 104729 + 1) % 4294967296


def det_sin(x: float) -> float:
    x2 = x * x
    return x * (1 - (x2 / 6) * (1 - x2 / 20))


def det_cos(x: float) -> float:
    x2 = x * x
    return 1 - (x2 / 2) * (1 - (x2 / 12) * (1 - x2 / 30))


# ----- 핀 배치 (1번 핀이 앞, 뒤로 갈수록 넓어지는 삼각형) -----
def pin_spots(cfg: dict) -> list[tuple[float, float]]:
    L = cfg["LANE"]
    return [((j - row / 2) * L["PIN_GAP_X"], L["HEAD_Y"] + row * L["PIN_GAP_Y"]) for row in range(4) for j in range(row + 1)]


class Rack:
    """핀 10개 + 공 하나의 움직임 (공→핀, 핀→핀 충돌, 옆벽 튕김)."""

    def __init__(self, cfg: dict, rng):
        self.cfg = cfg
        self.rng = rng
        self.pins = [
            {"id": i, "x": x, "y": y, "vx": 0.0, "vy": 0.0, "up": True, "gone": False, "fall": 0.0, "gold": False}
            for i, (x, y) in enumerate(pin_spots(cfg))
        ]
        self.ball = None

    def set_up(self, up: list, gold: int = -1) -> None:
        """핀을 제자리에 다시 놓는다. up[i] 가 거짓인 핀은 치워진 것(없음)."""
        for i, (x, y) in enumerate(pin_spots(self.cfg)):
            self.pins[i].update(x=x, y=y, vx=0.0, vy=0.0, up=True, gone=not up[i], fall=0.0, gold=i == gold)
        self.ball = None

    def up_mask(self) -> list[int]:
        return [1 if p["up"] and not p["gone"] else 0 for p in self.pins]

    @property
    def standing(self) -> int:
        return sum(self.up_mask())

    def launch(self, x: float, angle: float, speed: float) -> None:
        self.ball = {"x": x, "y": -4.0, "vx": angle * speed, "vy": speed, "gutter": False, "gone": False,
                     "spin": self.cfg["THROW"]["SPIN_BUDGET"], "hits": 0}

    def step(self, spin_dir: int = 0) -> dict:
        """한 프레임 진행. spin_dir: -1 왼쪽 / 0 / 1 오른쪽. 돌려주는 값: 이번 프레임에 일어난 일."""
        ev = {"pinHits": 0, "gutter": False, "wall": False}
        L, T = self.cfg["LANE"], self.cfg["THROW"]
        b = self.ball
        rng = self.rng
        if b and not b["gone"]:
            # 스핀: 핀에 닿기 전까지만, 남은 양만큼
            if spin_dir and b["spin"] > 0 and b["y"] < L["HEAD_Y"] - 4 and not b["gutter"]:
                a = min(b["spin"], T["SPIN_ACCEL"])
                b["vx"] += spin_dir * a
                b["spin"] -= a
        # 2번 나눠서 움직임 (빠른 공이 핀을 뚫고 지나가지 않게)
        for _sub in range(2):
            if b and not b["gone"]:
                b["x"] += b["vx"] / 2
                b["y"] += b["vy"] / 2
                if not b["gutter"] and abs(b["x"]) > L["HALF"]:
                    # 거터: 홈에 빠져서 끝까지 굴러감
                    b["gutter"] = True
                    b["x"] = (1 if b["x"] > 0 else -1) * (L["HALF"] + 2.5)
                    b["vx"] = 0.0
                    ev["gutter"] = True
                if b["y"] > L["PIT_Y"]:
                    b["gone"] = True
                if not b["gutter"]:
                    mn = L["BALL_R"] + L["PIN_R"]
                    for p in self.pins:
                        if p["gone"]:
                            continue
                        dx = p["x"] - b["x"]
                        dy = p["y"] - b["y"]
                        d = math.sqrt(dx * dx + dy * dy)
                        if d < mn and d > 0:
                            nx = dx / d
                            ny = dy / d
                            sp = math.sqrt(b["vx"] * b["vx"] + b["vy"] * b["vy"])
                            # 핀이 맞은 방향으로 튕겨 나감 (조금 흩어짐)
                            k = sp * (1.05 + rng() * 0.35) + 0.3
                            rot = (rng() - 0.5) * 0.5
                            c = det_cos(rot)
                            s = det_sin(rot)
                            p["vx"] = (nx * c - ny * s) * k
                            p["vy"] = (nx * s + ny * c) * k
                            if p["up"]:
                                ev["pinHits"] += 1
                            p["up"] = False
                            # 공은 살짝 밀리고 느려짐 (무거워서 거의 직진)
                            dot = b["vx"] * nx + b["vy"] * ny
                            b["vx"] -= nx * dot * 0.22
                            b["vy"] -= ny * dot * 0.08
                            b["vy"] = max(b["vy"], 0.5)
                            b["x"] = p["x"] - nx * mn
                            b["y"] = p["y"] - ny * mn
                            b["hits"] += 1
            # 핀끼리 충돌
            for p in self.pins:
                if p["gone"]:
                    continue
                if math.sqrt(p["vx"] * p["vx"] + p["vy"] * p["vy"]) < 0.25:
                    continue
                for q in self.pins:
                    if q is p or q["gone"]:
                        continue
                    dx = q["x"] - p["x"]
                    dy = q["y"] - p["y"]
                    d = math.sqrt(dx * dx + dy * dy)
                    if d < L["PIN_R"] * 2 and d > 0:
                        nx = dx / d
                        ny = dy / d
                        dot = p["vx"] * nx + p["vy"] * ny
                        if dot <= 0:
                            continue
                        rot = (rng() - 0.5) * 0.7
                        c = det_cos(rot)
                        s = det_sin(rot)
                        k = dot * (0.75 + rng() * 0.3)
                        q["vx"] += (nx * c - ny * s) * k
                        q["vy"] += (nx * s + ny * c) * k
                        p["vx"] -= nx * dot * 0.55
                        p["vy"] -= ny * dot * 0.55
                        if q["up"]:
                            ev["pinHits"] += 1
                        q["up"] = False
                        q["x"] = p["x"] + nx * L["PIN_R"] * 2
                        q["y"] = p["y"] + ny * L["PIN_R"] * 2
            for p in self.pins:
                if p["gone"]:
                    continue
                p["x"] += p["vx"] / 2
                p["y"] += p["vy"] / 2
                # 옆벽에 튕겨서 다시 들어옴
                if abs(p["x"]) > L["WALL"]:
                    p["x"] = (1 if p["x"] > 0 else -1) * L["WALL"]
                    p["vx"] *= -0.55
                    ev["wall"] = True
                if p["y"] > L["PIT_Y"] or p["y"] < L["HEAD_Y"] - 14:
                    p["gone"] = True
        for p in self.pins:
            p["vx"] *= 0.94
            p["vy"] *= 0.94
            if not p["up"] and p["fall"] < 1:
                p["fall"] = min(1, p["fall"] + 0.12)
        return ev

    @property
    def settled(self) -> bool:
        """공도 들어갔고 핀도 다 멈췄나."""
        if self.ball and not self.ball["gone"]:
            return False
        return all(p["gone"] or math.sqrt(p["vx"] * p["vx"] + p["vy"] * p["vy"]) < 0.05 for p in self.pins)


def simulate_throw(cfg: dict, up: list, gold: int, x: float, angle: float, power: float, spin: list, seed: int) -> dict:
    """투구 하나를 끝까지 굴린다. 브라우저의 simulateThrow 와 같은 결과를 낸다.

    up: 던지기 전에 서 있는 핀(10칸), gold: 잭팟 핀 번호(-1 = 없음), spin: 프레임별 스핀 입력(-1/0/1).
    """
    T = cfg["THROW"]
    rack = Rack(cfg, make_rng(seed))
    rack.set_up(up, gold)
    before = rack.standing
    rack.launch(x, angle, T["SPEED_MIN"] + power * (T["SPEED_MAX"] - T["SPEED_MIN"]))
    frames = 0
    settle = 0
    while True:
        rack.step(spin[frames] if frames < len(spin) else 0)
        frames += 1
        if rack.ball["gone"]:
            settle += 1
        if (rack.ball["gone"] and rack.settled) or settle > cfg["FLOW"]["SETTLE_TIME"]:
            break
    mask = rack.up_mask()
    return {
        "frames": frames,                      # 굴러간 프레임 수 (연출 길이)
        "up": mask,
        "knocked": before - sum(mask),
        "gutter": bool(rack.ball["gutter"]),
        "goldHit": bool(gold >= 0 and up[gold] and not mask[gold]),
        "rack": rack,
    }


def is_split(cfg: dict, up: list) -> bool:
    """남은 핀이 두 덩어리 이상으로 떨어져 있고 1번 핀이 없으면 스플릿."""
    spots = pin_spots(cfg)
    ids = [i for i in range(10) if up[i]]
    if len(ids) < 2 or 0 in ids:
        return False
    seen = {ids[0]}
    queue = [ids[0]]
    while queue:
        a = queue.pop()
        for b in ids:
            if b in seen:
                continue
            dx = spots[a][0] - spots[b][0]
            dy = spots[a][1] - spots[b][1]
            if math.sqrt(dx * dx + dy * dy) < 9.6:
                seen.add(b)
                queue.append(b)
    return len(seen) < len(ids)


# ----- 정식 볼링 점수 -----
def mark(v: int) -> str:
    return "-" if v == 0 else str(v)


def score_frames(rolls: list[int], n: int) -> list[dict]:
    """rolls = [쓰러뜨린 핀 수...] → [{rolls, marks:['X','/','-','7'...], cum: 누적 점수|None}]"""
    frames = []
    i = 0
    cum = 0
    ok = True      # 앞 프레임이 모두 확정됐나 (보너스를 기다리는 중이면 누적을 비워 둔다)

    def at(k):
        return rolls[k] if k < len(rolls) else None

    for f in range(n):
        last = f == n - 1
        fr = {"rolls": [], "marks": [], "cum": None}
        score = None
        if i < len(rolls) and not last:
            if at(i) == 10:
                fr["rolls"], fr["marks"] = [10], ["X"]
                if at(i + 1) is not None and at(i + 2) is not None:
                    score = 10 + at(i + 1) + at(i + 2)
                i += 1
            else:
                fr["rolls"] = rolls[i:i + 2]
                fr["marks"] = [mark(at(i))]
                if at(i + 1) is not None:
                    spare = at(i) + at(i + 1) == 10
                    fr["marks"].append("/" if spare else mark(at(i + 1)))
                    if not spare:
                        score = at(i) + at(i + 1)
                    elif at(i + 2) is not None:
                        score = 10 + at(i + 2)
                i += 2
        elif i < len(rolls):
            # 마지막 프레임: 스트라이크/스페어면 보너스 투구 (최대 3구)
            r = rolls[i:i + 3]
            fr["rolls"] = r
            for k, v in enumerate(r):
                if k == 0:
                    fr["marks"].append("X" if v == 10 else mark(v))
                elif k == 1:
                    if r[0] == 10:
                        fr["marks"].append("X" if v == 10 else mark(v))
                    else:
                        fr["marks"].append("/" if r[0] + v == 10 else mark(v))
                else:
                    fresh = r[0] != 10 or r[1] == 10     # 3구째 앞에 핀이 새로 세워졌나
                    if fresh:
                        fr["marks"].append("X" if v == 10 else mark(v))
                    else:
                        fr["marks"].append("/" if r[1] + v == 10 else mark(v))
            need = 2 if len(r) >= 2 and r[0] + r[1] < 10 else 3
            if len(r) >= need:
                score = sum(r[:need])
            i += len(r)
        if ok and score is not None:
            cum += score
            fr["cum"] = cum
        else:
            ok = False
        frames.append(fr)
    return frames


def running_score(rolls: list[int], n: int) -> int:
    """지금까지 확정된 점수."""
    best = 0
    for f in score_frames(rolls, n):
        if f["cum"] is not None:
            best = f["cum"]
    return best


def frame_state(rolls: list[int], n: int) -> dict:
    """다음에 몇 번째 프레임 · 몇 구째를 던지나 / 다 끝났나."""
    i = 0
    for f in range(n):
        if f < n - 1:
            if i >= len(rolls):
                return {"frame": f, "ball": 0, "done": False}
            if rolls[i] == 10:
                i += 1
                continue
            if i + 1 >= len(rolls):
                return {"frame": f, "ball": 1, "done": False}
            i += 2
        else:
            r = rolls[i:]
            if len(r) == 0:
                return {"frame": f, "ball": 0, "done": False}
            if len(r) == 1:
                return {"frame": f, "ball": 1, "done": False}
            if len(r) == 2:
                return {"frame": f, "ball": 2, "done": not (r[0] == 10 or r[0] + r[1] == 10)}
            return {"frame": f, "ball": 3, "done": True}
    return {"frame": n, "ball": 0, "done": True}


# ----- 게이지 (제한 시간이 지나 서버가 대신 던질 때 쓰는 값) -----
def aim_angle(cfg: dict, phase0: float, frames: int) -> float:
    T = cfg["THROW"]
    return math.sin(phase0 + T["AIM_SPEED"] * frames) * T["AIM_MAX"]


def power_at(cfg: dict, frames: int) -> float:
    u = (frames / (cfg["THROW"]["POWER_PERIOD"] / 2)) % 2
    return 1 - abs(1 - u)
