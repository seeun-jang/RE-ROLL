"""야구 규칙 — 원본 js/baseball.js 를 Python 으로 옮긴 것.

투구 목록 · 맞았나 · 타구가 어디로 · 점수.
  좌표(m): x = 오른쪽(+) / y = 높이 / z = 홈 플레이트에서 투수 쪽으로
  타구 방향 dir(도): 0 = 가운데, - = 3루(왼쪽), + = 1루(오른쪽) · 45도 넘으면 파울

브라우저 쪽 같은 계산: web/src/games/homerun/sim/rules.js (테스트가 두 쪽 결과를 비교한다)
"""

from __future__ import annotations

import math

PITCH_TYPES = {
    "fast": {"name": "직구", "kmh": [142, 153], "frames": [30, 34], "breakX": 0, "drop": 0.08, "k": 2},
    "slider": {"name": "슬라이더", "kmh": [128, 137], "frames": [36, 40], "breakX": 0.28, "drop": 0.1, "k": 4},
    "curve": {"name": "커브", "kmh": [108, 119], "frames": [44, 49], "breakX": -0.2, "drop": 0.5, "k": 2},
    "change": {"name": "체인지업", "kmh": [118, 127], "frames": [41, 45], "breakX": 0.08, "drop": 0.22, "k": 3},
}
PITCH_ORDER = ["fast", "slider", "curve", "change"]

#: 수비수 자리 (방향 도, 거리 m). of = 외야수
FIELDERS = [
    {"id": "LF", "dir": -28, "r": 82, "of": True},
    {"id": "CF", "dir": 0, "r": 94, "of": True},
    {"id": "RF", "dir": 28, "r": 82, "of": True},
    {"id": "SS", "dir": -14, "r": 36, "of": False},
    {"id": "2B", "dir": 15, "r": 37, "of": False},
    {"id": "3B", "dir": -36, "r": 29, "of": False},
    {"id": "1B", "dir": 37, "r": 29, "of": False},
    {"id": "P", "dir": 0, "r": 18, "of": False},
]

HIT_RESULTS = ("hr", "triple", "double", "single")          # 안타로 치는 결과
OUT_RESULTS = ("fly", "pop", "ground", "foul")              # 맞았지만 점수 없는 결과


def js_round(x: float) -> int:
    """JavaScript 의 Math.round 와 같은 반올림(.5 는 올림)."""
    return math.floor(x + 0.5)


def _imul(a: int, b: int) -> int:
    return (a * b) & 0xFFFFFFFF


def mulberry32(seed: int):
    """원본과 같은 난수 생성기 — 같은 시드면 브라우저와 같은 수열이 나온다."""
    state = [int(seed) & 0xFFFFFFFF]

    def rnd() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        a = state[0]
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rnd


def make_pitches(seed: int, cfg: dict) -> list[dict]:
    """모든 타자가 받을 같은 공 순서: 스트라이크 CHANCES 개 + 사이사이 볼.

    원본은 여유로 스트라이크 2개를 더 만들지만, 여기서는 CHANCES 번째 스트라이크에서 끊는다
    (모두 같은 공을 같은 시각에 받으므로 그 뒤의 공은 쓰이지 않는다).
    """
    rnd = mulberry32(seed)
    Z = cfg["ZONE"]
    chances = cfg["CHANCES"]
    pitches: list[dict] = []
    strikes = 0
    while strikes < chances + 2:
        type_id = PITCH_ORDER[int(rnd() * len(PITCH_ORDER))]
        T = PITCH_TYPES[type_id]
        ball = len(pitches) > 0 and strikes < chances and rnd() < 0.28
        tx = (rnd() * 2 - 1) * Z["HALF_W"] * 0.85
        ty = Z["LOW"] + 0.08 + rnd() * (Z["HIGH"] - Z["LOW"] - 0.16)
        if ball:
            # 존 밖: 옆으로 빠지거나 낮게 떨어짐
            if rnd() < 0.6:
                v = rnd() - 0.5
                sign = (v > 0) - (v < 0)
                tx = sign * (Z["HALF_W"] + 0.1 + rnd() * 0.14)
            else:
                ty = Z["LOW"] - 0.12 - rnd() * 0.15
        kmh = js_round(T["kmh"][0] + rnd() * (T["kmh"][1] - T["kmh"][0]))
        frames = js_round(T["frames"][0] + rnd() * (T["frames"][1] - T["frames"][0]))
        pitches.append({
            "id": len(pitches), "typeId": type_id, "name": T["name"], "kmh": kmh, "frames": frames,
            "tx": tx, "ty": ty, "ball": ball, "gold": False,
        })
        if not ball:
            strikes += 1
    # 잭팟 볼: 정해진 순서의 스트라이크 하나
    strikes_only = [p for p in pitches if not p["ball"]]
    strikes_only[min(cfg["GOLD_AT"], len(strikes_only) - 1)]["gold"] = True
    # CHANCES 번째 스트라이크까지만 쓴다
    last = strikes_only[chances - 1]["id"]
    return pitches[: last + 1]


def plate_scale(cfg: dict) -> float:
    """홈 플레이트 높이의 1m = 몇 px"""
    return cfg["FOCAL"] / cfg["CAM_BACK"]


def polar(direction: float, r: float) -> tuple[float, float]:
    a = direction * math.pi / 180
    return math.sin(a) * r, math.cos(a) * r


def fence_at(direction: float, cfg: dict) -> float:
    """펜스까지 거리 (방향에 따라)"""
    return cfg["FENCE_LINE"] + (cfg["FENCE_CENTER"] - cfg["FENCE_LINE"]) * math.cos(direction * 2 * math.pi / 180)


def nearest_fielder(h: dict, outfield: bool) -> dict:
    lx, lz = polar(h["dir"], min(h["dist"], 40) if h["ground"] else h["dist"])
    best, bd = None, math.inf
    for f in FIELDERS:
        if outfield and not f["of"]:
            continue
        fx, fz = polar(f["dir"], f["r"])
        d = math.hypot(lx - fx, lz - fz)
        if d < bd:
            bd, best = d, f
    return best


def make_hit(pt: dict, dt: float, dx: float, cfg: dict) -> dict:
    """맞았을 때 타구 계산 (같은 입력이면 언제나 같은 결과).

    dt: 타이밍 (프레임, - = 빠름) / dx: 배트 - 공 (px, + = 배트가 공 오른쪽)
    """
    qx = 1 - abs(dx) / cfg["HIT_DX"]
    qt = 1 - abs(dt) / cfg["HIT_DT"]
    q = max(0.0, math.pow(max(0.0, qx), 0.8) * (0.55 + 0.45 * qt))
    v0 = cfg["EXIT_MIN"] + (cfg["EXIT_MAX"] - cfg["EXIT_MIN"]) * q + (pt["kmh"] - 130) * 0.06
    # 발사각: 배트가 공 가운데면 26도 · 오른쪽으로 빗맞으면 뜬공, 왼쪽이면 땅볼
    angle = 26 + (dx / cfg["HIT_DX"]) * 38
    # 방향: 일찍 치면 당겨서 왼쪽, 늦으면 밀어서 오른쪽
    direction = (dt / cfg["HIT_DT"]) * 52
    hit = {"v0": v0, "angle": angle, "dir": direction, "q": q, "gold": bool(pt["gold"]),
           "result": "", "dist": 0.0, "hang": 0.0, "ground": False, "fence": None, "fielder": None}
    return judge_hit(hit, cfg)


def judge_hit(h: dict, cfg: dict) -> dict:
    """타구 판정: 파울 · 땅볼 · 뜬공 · 홈런 · 안타. fielder 는 잡으러 가는 수비수 id."""
    G, DRAG = cfg["GRAV"], cfg["DRAG"]
    a = h["angle"] * math.pi / 180
    v0 = h["v0"]
    if abs(h["dir"]) > 45:
        h["result"] = "foul"
        h["dist"] = max(20.0, (v0 * v0 * abs(math.sin(2 * a)) / G) * DRAG * 0.6)
        h["hang"] = max(0.8, ((2 * v0 * max(0.2, math.sin(a))) / G) * 0.9)
        h["ground"] = h["angle"] < 8
        return h
    if h["angle"] < 8:
        # 땅볼: 빠르고 수비 사이로 가면 안타
        h["ground"] = True
        h["dist"] = 30 + v0 * 1.2
        h["hang"] = h["dist"] / (v0 * 0.7)
        gap = min(abs(f["dir"] - h["dir"]) for f in FIELDERS if not f["of"])
        h["result"] = "single" if v0 > 37 and gap > 7 else "ground"
        h["fielder"] = nearest_fielder(h, False)["id"]
        return h
    h["ground"] = False
    h["dist"] = ((v0 * v0 * math.sin(2 * a)) / G) * DRAG
    h["hang"] = ((2 * v0 * math.sin(a)) / G) * 0.9
    h["fence"] = fence_at(h["dir"], cfg)
    if h["angle"] > 52:
        h["result"] = "pop"
        h["fielder"] = nearest_fielder(h, False)["id"]
        return h
    if h["dist"] > h["fence"] and h["angle"] >= 14:
        h["result"] = "hr"
        return h
    if h["dist"] > h["fence"]:
        h["dist"] = h["fence"] - 2      # 낮은 총알 타구는 펜스 맞고 떨어짐
    # 외야수가 따라가서 잡을 수 있나
    lx, lz = polar(h["dir"], h["dist"])
    f = nearest_fielder(h, h["dist"] > 42)
    fx, fz = polar(f["dir"], f["r"])
    need = math.hypot(lx - fx, lz - fz)
    reach = cfg["FIELDER_RUN"] * h["hang"] + (4 if f["of"] else 2)
    h["fielder"] = f["id"]
    if need <= reach and not (h["dist"] < 42 and h["angle"] < 20):
        h["result"] = "pop" if h["dist"] < 42 else "fly"
    else:
        h["result"] = "single" if h["dist"] < 70 else "double" if h["dist"] < h["fence"] - 10 else "triple"
    return h


def hit_points(h: dict, cfg: dict) -> int:
    """점수: 홈런 = 비거리(m), 3루타 30 · 2루타 20 · 안타 10. 잭팟 볼은 2배."""
    pts = js_round(h["dist"]) if h["result"] == "hr" else cfg["POINTS"].get(h["result"], 0)
    return pts * cfg["GOLD_MULT"] if h["gold"] else pts


def flight_frames(h: dict, cfg: dict) -> tuple[int, int]:
    """타구 연출 길이(프레임): (맞은 뒤 결과 글자가 뜰 때까지, 연출이 끝날 때까지).

    화면(net/Flight.js)이 원본대로 그리는 타구 연출의 길이를 미리 계산한다.
    서버는 이 값으로 "모두의 연출이 끝나는 시각"을 정해 다음 공을 던진다.
    """
    dur = max(cfg["FLIGHT_MIN"], js_round(h["hang"] * 60 / cfg["FLIGHT_SPEED"]))
    shown = cfg["FLIGHT_HOLD"] + dur
    if h["ground"] and h["result"] == "ground":
        # 땅볼 아웃: 내야수가 잡아 1루로 던지고(1루수가 잡으면 직접 밟고) 나서 "아웃!"
        b = cfg["BASE_DIST"] / math.sqrt(2)
        fx, fz = polar(h["dir"], min(h["dist"], 38))
        to = math.hypot(b - fx, b - fz)
        run = cfg["RUN_MPS"] * cfg["FLIGHT_SPEED"] / 60
        throw = cfg["THROW_MPS"] * cfg["FLIGHT_SPEED"] / 60
        if h["fielder"] == "1B":
            shown += math.ceil(to / run) + 1
        else:
            shown += cfg["FIELD_PAUSE"] + max(14, math.ceil(to / throw))
    return shown, shown + cfg["RESULT_TIME"]
