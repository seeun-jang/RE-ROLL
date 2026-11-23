"""레이싱 서버 판정 테스트 (JS 진행기와 같은 결과를 내는지는 test_racing_parity.py 가 본다)."""

from __future__ import annotations

import math
import random

from party.games.racing.config import merge_config
from party.games.racing.game import RacingGame
from party.games.racing.track import build_track, det_cos, det_sin, nearest, new_car, step_car

CFG = merge_config(None)
TRACK = build_track(CFG)
DT = 1 / 60


def players(n):
    return [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]


def drive(car, track=TRACK, look=7):
    """가운데 선의 조금 앞을 보고 달리는 간단한 운전."""
    k = (car["seg"] + look) % track["n"]
    dx, dy = track["x"][k] - car["x"], track["y"][k] - car["y"]
    fx, fy = det_cos(car["a"]), det_sin(car["a"])
    ang = math.atan2(fx * dy - fy * dx, fx * dx + fy * dy)
    return {"k": "in", "steer": max(-1.0, min(1.0, ang * 2.5)), "throttle": 1.0 if abs(ang) < 0.9 else 0.3, "drift": 0}


def test_det_sin_cos_are_accurate():
    for i in range(-4000, 4000):
        x = i / 317
        assert abs(det_sin(x) - math.sin(x)) < 1e-9 and abs(det_cos(x) - math.cos(x)) < 1e-9


def test_track_is_a_closed_loop_with_room_between_sections():
    n = TRACK["n"]
    assert n == len(CFG["TRACK"]["POINTS"]) * CFG["TRACK"]["SAMPLES_PER_POINT"]
    assert 2 < min(TRACK["len"]) and max(TRACK["len"]) < 25           # 구간 길이가 고르다
    assert 3000 < sum(TRACK["len"]) < 4500
    # 멀리 떨어진 구간끼리는 도로가 겹치지 않는다(도로 폭 + 잔디)
    for i in range(0, n, 3):
        for j in range(i + 30, n, 3):
            if n - (j - i) < 30:
                continue
            d = math.hypot(TRACK["x"][i] - TRACK["x"][j], TRACK["y"][i] - TRACK["y"][j])
            assert d > 2 * TRACK["half"] + 10, (i, j, d)
    # 화면(월드) 안에 들어 있다
    half = TRACK["half"] + 4
    assert min(TRACK["x"]) > half and max(TRACK["x"]) < CFG["WORLD"]["W"] - half
    assert min(TRACK["y"]) > half and max(TRACK["y"]) < CFG["WORLD"]["H"] - half


def test_cars_start_side_by_side_behind_the_line():
    cars = [new_car(CFG, TRACK, i, 5) for i in range(5)]
    assert all(-3 < c["total"] < 0 for c in cars)                      # 출발선 바로 뒤
    assert len({round(c["total"], 6) for c in cars}) == 1              # 모두 같은 줄(공평)
    for c in cars:
        _, _, _, _, d = nearest(TRACK, c["x"], c["y"], c["seg"])
        assert d <= TRACK["limit"]
    xs = sorted(math.hypot(c["x"] - cars[2]["x"], c["y"] - cars[2]["y"]) for c in cars)
    assert xs[0] == 0 and abs(xs[-1] - 20) < 1e-6
    # 진행 방향을 보고 있다
    c = cars[0]
    k = (c["seg"] + 1) % TRACK["n"]
    ux, uy = TRACK["x"][k] - TRACK["x"][c["seg"]], TRACK["y"][k] - TRACK["y"][c["seg"]]
    assert det_cos(c["a"]) * ux + det_sin(c["a"]) * uy > 0.99 * math.hypot(ux, uy)


def test_grass_is_an_invisible_wall():
    car = new_car(CFG, TRACK, 0, 1)
    car["throttle"], car["steer"] = 1.0, 1.0         # 계속 오른쪽으로 꺾으며 가속 → 벽으로
    hits = 0
    for _ in range(60 * 12):
        step_car(car, CFG, TRACK, DT)
        _, _, _, _, d = nearest(TRACK, car["x"], car["y"], car["seg"])
        assert d <= TRACK["limit"] + 1e-6              # 도로 밖으로 나가지 못한다
        hits += car["hit"] > 0
    assert hits > 0


def test_speed_limit_reverse_and_drift_marks():
    car = new_car(CFG, TRACK, 0, 1)
    car["throttle"] = 1.0
    for _ in range(60 * 3):
        step_car(car, CFG, TRACK, DT)
    speed = math.hypot(car["vx"], car["vy"])
    assert 150 < speed <= CFG["CAR"]["MAX_SPEED"] + 1e-6
    assert car["total"] > 0 and not car["drifting"]
    # 빠르게 달리다 드리프트로 꺾으면 옆으로 미끄러진다(타이어 자국)
    car["steer"], car["drift"] = 1.0, 1.0
    seen = False
    for _ in range(30):
        step_car(car, CFG, TRACK, DT)
        seen = seen or car["drifting"]
    assert seen
    # 후진은 최고 속도의 40% 까지
    car = new_car(CFG, TRACK, 0, 1)
    car["throttle"] = -1.0
    for _ in range(60 * 2):
        step_car(car, CFG, TRACK, DT)
    assert car["total"] < -2 and math.hypot(car["vx"], car["vy"]) <= 0.4 * CFG["CAR"]["MAX_SPEED"] + 1e-6


def run_race(game, now, drivers, until=400.0):
    events = []
    t = now
    while not game.finished and t < now + until:
        t += 1 / 30
        if game.phase == "race":
            for pid, look in drivers.items():
                if not game.cars[pid]["finished"]:
                    game.on_input(pid, drive(game.cars[pid], game.track, look), t)
        game.tick(t)
        events += [d for _to, kind, d in game.drain() if kind == "event"]
    return events


def test_full_race_three_laps_grace_period_and_rank_scores():
    game = RacingGame(players(3), {}, random.random)
    game.start(100.0)
    assert game.phase == "intro"
    game.on_input("p1", {"k": "in", "steer": 1, "throttle": 1, "drift": 0}, 101.0)       # 출발 전 입력은 무시
    assert game.cars["p1"]["throttle"] == 0
    # p1 은 잘 달리고, p2 는 조금 느리고, p3 은 가만히 있는다
    events = run_race(game, 100.0, {"p1": 7, "p2": 3})
    assert game.finished
    laps = [e for e in events if e["type"] == "lap" and e["playerId"] == "p1"]
    assert [e["lap"] for e in laps] == [1, 2, 3] and all(15 < e["time"] < 40 for e in laps)
    finishes = [e for e in events if e["type"] == "finish"]
    assert finishes[0]["playerId"] == "p1" and finishes[0]["place"] == 1
    res = {r["playerId"]: r for r in game.results}
    assert res["p1"]["rank"] == 1 and res["p1"]["score"] == 100 and res["p1"]["isWinner"] and res["p1"]["stats"]["finished"]
    assert res["p2"]["rank"] == 2 and res["p2"]["score"] == 70
    assert res["p3"]["rank"] == 3 and res["p3"]["score"] == 50 and not res["p3"]["stats"]["finished"]
    assert res["p3"]["stats"]["laps"] == 0 and res["p3"]["stats"]["progress"] == 0
    # 가만히 있던 p3 때문에: 1등이 들어온 뒤 30초가 지나면 끝난다
    first = finishes[0]["time"]
    end = game.end_frame / 60
    if not res["p2"]["stats"]["finished"]:
        assert abs(end - (first + 30.0)) < 0.05
    else:
        assert end <= first + 30.0 + 0.05 and end >= res["p2"]["stats"]["time"]
    assert abs(end - (first + 30.0)) < 0.05      # p3 이 못 들어왔으므로 마감 시각에 끝


def test_inputs_are_clamped_and_snapshot_shape():
    game = RacingGame(players(2), {"config": {"RULES": {"INTRO_TIME": 0.5, "COUNTDOWN": 0.5}}}, random.random)
    game.start(0.0)
    game.tick(1.1)
    assert game.phase == "race"
    game.on_input("p1", {"k": "in", "steer": 9, "throttle": -7, "drift": "x"}, 1.2)
    car = game.cars["p1"]
    assert (car["steer"], car["throttle"], car["drift"]) == (1.0, -1.0, 0.0)
    game.on_input("p1", {"k": "in", "steer": float("nan"), "throttle": True, "drift": 2}, 1.2)
    assert (car["steer"], car["throttle"], car["drift"]) == (0.0, 0.0, 1.0)
    game.on_input("zz", {"k": "in", "steer": 1}, 1.2)
    game.on_input("p2", {"k": "other"}, 1.2)
    snap = game.snapshot(1.3)
    assert set(snap["cars"]) == {"p1", "p2"} and len(snap["cars"]["p1"]) == 11
    assert sorted(snap["order"]) == ["p1", "p2"] and snap["deadline"] is None
    opts = game.client_options()
    assert opts["laps"] == 3 and len(opts["track"]["x"]) == game.track["n"] and opts["scores"][0] == 100
    game.on_connection("p1", False, 1.4)
    assert car["drift"] == 0.0
