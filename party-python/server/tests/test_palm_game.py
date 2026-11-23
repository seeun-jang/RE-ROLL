"""손바닥 밀치기: 대진표, 입력 처리, 순위 규칙."""

from __future__ import annotations

import random
from itertools import combinations

import pytest

from party.games.palm.game import PalmGame, make_schedule

FAST = {"MATCH": {"TIME_LIMIT": 8, "WOBBLE_START": 3}, "FLOW": {"INTRO_TIME": 0.2, "END_HOLD": 0.5, "RESULT_TIME": 0.2, "FINAL_TIME": 0.2}}


def players(n):
    return [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]


@pytest.mark.parametrize("n", [3, 4, 5])
def test_schedule_everyone_meets_everyone_once(n):
    ids = [f"p{i + 1}" for i in range(n)]
    plan = make_schedule(ids, random.Random(3).random, 3)
    seen = []
    for rnd in plan:
        busy = [x for m in rnd["matches"] for x in m]
        assert len(busy) == len(set(busy))                      # 한 라운드에 한 사람은 한 경기만
        assert sorted(busy + rnd["resting"]) == sorted(ids)     # 빠지는 사람 없음
        assert len(rnd["resting"]) == n % 2                     # 홀수면 한 명이 쉰다
        seen += [frozenset(m) for m in rnd["matches"]]
    assert sorted(map(sorted, seen)) == sorted(map(list, combinations(ids, 2)))
    if n % 2:
        rests = [x for rnd in plan for x in rnd["resting"]]
        assert sorted(rests) == sorted(ids)                     # 모두 한 번씩 쉰다


def test_schedule_two_players_plays_three_rounds():
    plan = make_schedule(["p1", "p2"], random.Random(1).random, 3)
    assert len(plan) == 3 and all(len(r["matches"]) == 1 and not r["resting"] for r in plan)


def run(game, now, seconds, inputs=None, dt=1 / 30):
    """inputs(t) → [(playerId, data)]"""
    events = []
    steps = int(seconds / dt)
    for i in range(1, steps + 1):
        t = now + i * dt
        for pid, data in (inputs(i) if inputs else []):
            game.on_input(pid, data, t)
        game.tick(t)
        events += [d for _to, kind, d in game.drain() if kind == "event"]
        if game.finished:
            break
    return events


def test_pusher_beats_idle_player_and_ranks_by_wins():
    game = PalmGame(players(2), {"config": FAST}, random.Random(5).random)
    game.start(100.0)
    game.drain()

    def inputs(i):
        # p1 만 계속 툭툭 민다. p2 는 아무것도 하지 않는다.
        phase = i % 20
        if phase == 0:
            return [("p1", {"k": "in", "lean": 0, "push": True, "hold": False})]
        if phase == 2:
            return [("p1", {"k": "in", "lean": 0, "push": False, "hold": False})]
        return []

    run(game, 100.0, 60, inputs)
    assert game.finished
    res = {r["playerId"]: r for r in game.results}
    assert res["p1"]["rank"] == 1 and res["p1"]["isWinner"]
    assert res["p2"]["rank"] == 2 and not res["p2"]["isWinner"]
    assert res["p1"]["stats"]["wins"] > res["p2"]["stats"]["wins"]
    assert res["p1"]["stats"]["wins"] + res["p1"]["stats"]["draws"] + res["p1"]["stats"]["losses"] == 3


def test_resting_player_and_unknown_input_are_ignored():
    game = PalmGame(players(3), {"config": FAST}, random.Random(9).random)
    game.start(10.0)
    game.drain()
    snap = game.state_for("p1", 10.0)
    rest = snap["resting"][0]
    run(game, 10.0, 0.9)  # 대결 시작까지

    def inputs(i):
        return [
            (rest, {"k": "in", "lean": 1, "push": True, "hold": False}),      # 쉬는 사람의 입력
            ("nobody", {"k": "in", "lean": 1, "push": True, "hold": False}),  # 없는 사람
            (rest, "이상한 값"),
            (rest, {"k": "???"}),
        ]

    events = run(game, 10.0 + 0.9, 2.0, inputs)
    assert not [e for e in events if e["type"] in ("pushStart", "chargeStart", "hit")]


def test_wins_come_before_score_in_ranking():
    game = PalmGame(players(3), {"config": FAST}, random.Random(2).random)
    game.standings["p1"].update(wins=1, score=100)
    game.standings["p2"].update(wins=2, score=10)
    game.standings["p3"].update(wins=1, score=900)
    order = [r["playerId"] for r in game._build_results()]
    assert order == ["p2", "p3", "p1"]
