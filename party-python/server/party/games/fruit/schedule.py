"""과일자르기: 던질 물체 목록(스케줄)과 궤적 계산.

모든 참가자가 "같은 과일"을 받도록, 한 판에 던질 물체를 시작할 때 전부 정한다.
물체의 위치는 던진 뒤 흐른 시간만으로 계산된다(서버와 브라우저가 같은 식을 쓴다).

물체 dict
    id      번호(만든 순서)
    kind    "fruit" | "bomb" | "item"
    def     과일·아이템 종류 id
    t       던지는 시각(게임 시작 뒤 초). mode 2 는 아이템이 켜진 시각부터의 지연
    x, vx, vy   던지는 위치(x)와 속도. y 는 항상 SPAWN_Y 에서 시작
    r       판정 반지름
    life    화면에 머무는 시간(초)
    mode    0 = 모두에게, 1 = "과일 3배" 효과 중인 사람에게만, 2 = "과일 3배" 를 벤 사람에게 바로 쏟아지는 묶음
    group   mode 2 일 때 그 아이템의 id
"""

from __future__ import annotations

import math


def r2(v: float) -> float:
    """소수 둘째 자리로 맞춘다(브라우저로 보내는 값과 서버가 쓰는 값이 같도록)."""
    return math.floor(v * 100 + 0.5) / 100


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def rand_int(rng, a: int, b: int) -> int:
    return a + min(b - a, math.floor(rng() * (b - a + 1)))


def dist_to_segment(px, py, ax, ay, bx, by) -> float:
    vx, vy = bx - ax, by - ay
    l2 = vx * vx + vy * vy
    t = ((px - ax) * vx + (py - ay) * vy) / l2 if l2 > 0 else 0.0
    t = max(0.0, min(1.0, t))
    dx, dy = px - (ax + vx * t), py - (ay + vy * t)
    return math.sqrt(dx * dx + dy * dy)


def pos_at(obj: dict, age: float, cfg: dict) -> tuple[float, float]:
    """던진 뒤 age 초가 지났을 때의 위치."""
    P = cfg["PHYSICS"]
    return obj["x"] + obj["vx"] * age, P["SPAWN_Y"] + obj["vy"] * age + 0.5 * P["GRAVITY"] * age * age


def _launch(rng, sx: float, cfg: dict, vy_scale: float = 1.0) -> dict:
    """아래에서 위로 던질 속도 — 최고점 높이를 정하고 역산한다."""
    P = cfg["PHYSICS"]
    g = P["GRAVITY"]
    apex = P["APEX_MIN_Y"] + rng() * (P["APEX_MAX_Y"] - P["APEX_MIN_Y"])
    vy = -math.sqrt(2 * g * (P["SPAWN_Y"] - apex))
    flight = (2 * -vy) / g
    target = P["TARGET_X_MIN"] + rng() * (P["TARGET_X_MAX"] - P["TARGET_X_MIN"])
    vx = r2((target - sx) / flight)
    vy = r2(vy * vy_scale)
    # 내려오다 화면 아래로 완전히 사라질 때까지의 시간
    life = (-vy + math.sqrt(vy * vy + 2 * g * P["OFFSCREEN_MARGIN"])) / g
    return {"x": r2(sx), "vx": vx, "vy": vy, "life": r2(life)}


def _pick_fruit(rng, cfg: dict) -> dict:
    fruits = cfg["FRUITS"]
    total = 0
    for f in fruits:
        total += f["weight"]
    v = rng() * total
    for f in fruits:
        v -= f["weight"]
        if v <= 0:
            return f
    return fruits[0]


def _slots(rng, count: int, cfg: dict) -> list[float]:
    """화면 가로를 count 칸으로 나눠 고르게 던질 위치를 정하고 순서를 섞는다."""
    P = cfg["PHYSICS"]
    slots = [lerp(P["SPAWN_X_MIN"], P["SPAWN_X_MAX"], (i + rng()) / count) for i in range(count)]
    for i in range(count - 1, 0, -1):
        j = min(i, math.floor(rng() * (i + 1)))
        slots[i], slots[j] = slots[j], slots[i]
    return slots


def build_schedule(rng, cfg: dict) -> list[dict]:
    """한 판에 던질 물체를 전부 만든다."""
    S, R = cfg["SPAWN"], cfg["RULES"]
    duration = R["DURATION"]
    items = {d["id"]: d for d in cfg["ITEM_DEFS"]}
    out: list[dict] = []

    def add(kind, d, t, launch, mode, group):
        out.append({
            "id": len(out), "kind": kind, "def": d["id"], "t": r2(t), "x": launch["x"], "vx": launch["vx"],
            "vy": launch["vy"], "r": d["radius"], "life": launch["life"], "mode": mode, "group": group,
        })
        return out[-1]

    def wave_count(p):
        lo = math.floor(lerp(S["WAVE_MIN_START"], S["WAVE_MIN_END"], p) + 0.5)
        hi = math.floor(lerp(S["WAVE_MAX_START"], S["WAVE_MAX_END"], p) + 0.5)
        return rand_int(rng, lo, hi)

    def frenzy_wave(p, base_t, count, mode, group):
        """과일 3배용 물체 count 개. 폭탄 확률은 낮춘다."""
        if count <= 0:
            return
        chance = lerp(S["BOMB_CHANCE_START"], S["BOMB_CHANCE_END"], p) * S["FRENZY_BOMB_SCALE"]
        bombs = 0
        for i, sx in enumerate(_slots(rng, count, cfg)):
            t = base_t + i * S["STAGGER"] * S["FRENZY_STAGGER"]
            if mode == 1 and t >= duration:
                continue
            if bombs < 2 and rng() < chance:
                bombs += 1
                add("bomb", cfg["BOMB"], t, _launch(rng, sx, cfg), mode, group)
            else:
                add("fruit", _pick_fruit(rng, cfg), t, _launch(rng, sx, cfg), mode, group)

    T = S["FIRST_WAVE"]
    next_item_at = S["FIRST_ITEM_AFTER"]
    while T < duration:
        p = min(1.0, T / duration)
        count = wave_count(p)
        chance = lerp(S["BOMB_CHANCE_START"], S["BOMB_CHANCE_END"], p)
        bombs = 0
        item_placed = False
        triple_items: list[dict] = []
        for i, sx in enumerate(_slots(rng, count, cfg)):
            t = T + i * S["STAGGER"]
            if t >= duration:
                continue
            made = False
            if not item_placed and T >= next_item_at:
                if rng() < S["ITEM_CHANCE"] * 3:
                    item_placed = True
                    made = True
                    next_item_at = T + S["ITEM_COOLDOWN"]
                    d = items["double"] if rng() < 0.5 else items["triple"]
                    obj = add("item", d, t, _launch(rng, sx, cfg, S["ITEM_VY_SCALE"]), 0, -1)
                    if d["id"] == "triple":
                        triple_items.append(obj)
            if not made and bombs < 2:
                if rng() < chance:
                    bombs += 1
                    made = True
                    add("bomb", cfg["BOMB"], t, _launch(rng, sx, cfg), 0, -1)
            if not made:
                add("fruit", _pick_fruit(rng, cfg), t, _launch(rng, sx, cfg), 0, -1)
        # 과일 3배 효과 중인 사람에게만 추가로 나오는 물체
        extra = min(S["FRENZY_MAX"], count * S["FRENZY_MULTIPLIER"]) - count
        frenzy_wave(p, T + S["STAGGER"] * 0.5, extra, 1, -1)
        # 과일 3배 아이템을 벤 순간 바로 쏟아지는 묶음
        for item in triple_items:
            n = min(S["FRENZY_MAX"], wave_count(p) * S["FRENZY_MULTIPLIER"])
            frenzy_wave(p, 0.0, n, 2, item["id"])
        T += lerp(S["INTERVAL_START"], S["INTERVAL_END"], p)
    return out
