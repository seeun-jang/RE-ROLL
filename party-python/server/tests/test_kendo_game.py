"""검도 서버 판정 테스트 (원본과 같은 결과를 내는지는 test_kendo_parity.py 가 본다)."""

from __future__ import annotations

import itertools
import random

from party.games.kendo import judge
from party.games.kendo.config import merge_config
from party.games.kendo.duel import Duel
from party.games.kendo.game import KendoGame, make_schedule

CFG = merge_config(None)


def players(n):
    return [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]


def inp(left=False, right=False, kiai=False, block=False, pressed=()):
    return {"left": left, "right": right, "kiai": kiai, "block": block, "pressed": set(pressed)}


def new_duel(seed=1, cfg=CFG):
    d = Duel(cfg, {"id": "a", "name": "가"}, {"id": "b", "name": "나"}, random.Random(seed).random)
    d.start()
    return d


def run_until_play(d):
    for _ in range(400):
        d.step()
        if d.flow["name"] == "play":
            return
    raise AssertionError("시합이 시작되지 않음")


def test_schedule_everyone_meets_once_and_rests_equally():
    for n in (3, 4, 5):
        ids = [f"p{i}" for i in range(n)]
        sched = make_schedule(ids, random.Random(n).random, 1)
        pairs = [frozenset(m) for r in sched for m in r["matches"]]
        assert sorted(map(sorted, pairs)) == sorted(map(list, itertools.combinations(ids, 2)))
        rests = [pid for r in sched for pid in r["resting"]]
        assert sorted(rests) == (sorted(ids) if n % 2 else [])
        assert len(sched) == (n if n % 2 else n - 1)
    two = make_schedule(["a", "b"], random.Random(1).random, 1)
    assert len(two) == 1 and len(two[0]["matches"]) == 1


def base_rec(**over):
    rec = {"type": "men", "dist": 29.0, "band": judge.band(CFG, "men"), "tooClose": False, "opening": 1.0, "kiaiOk": True,
           "kiaiGauge": 80, "kiaiTimed": True, "zanshinBroken": None, "aiuchi": False, "counter": False, "debana": False,
           "momentum": 100, "backward": False}
    rec.update(over)
    return rec


def test_judge_valid_strike_and_each_failure_reason():
    ev = judge.evaluate_strike(CFG, base_rec())
    assert ev["valid"] and abs(ev["quality"] - 1.0) < 1e-9 and ev["tags"] == ["기검체일치"]
    assert judge.evaluate_strike(CFG, base_rec(kiaiOk=False, kiaiGauge=12))["mainReason"] == "기합 부족 (12/45)"
    assert judge.evaluate_strike(CFG, base_rec(tooClose=True, dist=18.4))["mainReason"] == "너무 가까움 (코등이 거리) (18)"
    assert judge.evaluate_strike(CFG, base_rec(zanshinBroken="잔심 중 물러남"))["mainReason"] == "잔심 중 물러남"
    assert not judge.evaluate_strike(CFG, base_rec(aiuchi=True))["valid"]
    # 빈틈이 작으면 유효하지만 점수가 낮다
    low = judge.evaluate_strike(CFG, base_rec(opening=0.3, kiaiTimed=False))
    assert low["valid"] and low["quality"] < 0.62
    # 받아치기 보너스, 감점
    assert judge.evaluate_strike(CFG, base_rec(opening=0.5, counter=True))["quality"] > judge.evaluate_strike(CFG, base_rec(opening=0.5))["quality"]
    assert judge.evaluate_strike(CFG, base_rec(backward=True, momentum=10))["quality"] < 0.9


def test_duel_starts_and_idle_match_goes_to_referee_decision():
    d = new_duel()
    assert d.red.state == "sonkyo" and d.flow["name"] == "intro"
    run_until_play(d)
    assert d.red.state in ("idle", "move") and d.red.kiai >= 60
    events = d.pop_events()
    assert events[0]["type"] == "hajime" and events[0]["label"] == "시작!"
    # 아무도 움직이지 않으면 60초 뒤 시간 종료 → 동점 → 심판 판정으로 반드시 승자가 난다(연장전 없음)
    for _ in range(60 * 70):
        d.step()
        if d.over:
            break
    kinds = [e["type"] for e in d.pop_events()]
    assert kinds == ["timeup", "hantei", "end"]
    assert d.over and d.rules.winner in ("red", "white") and d.rules.decided_by == "hantei"


def test_strike_without_kiai_or_out_of_range_is_not_ippon():
    d = new_duel()
    run_until_play(d)
    d.pop_events()
    # 제자리(간격 68)에서 머리 → 헛침
    d.step(inp(pressed=["men"]), None)
    for _ in range(40):
        d.step()
    ev = [e for e in d.pop_events() if e["type"] == "strike"]
    assert ev and ev[0]["kind"] == "whiff" and ev[0]["side"] == "red"
    assert d.red.momentum < 100 and d.rules.points == {"red": [], "white": []}


def test_ippon_on_opponent_who_whiffed_and_two_points_win():
    cfg = merge_config({"REF_NOISE": 0.0})
    d = new_duel(cfg=cfg)
    points = 0
    for _ in range(4):
        run_until_play(d)
        d.pop_events()
        # 백이 멀리서 머리를 헛치게 하고(큰 빈틈), 홍은 기합을 모으며 다가가 그 틈에 손목을 친다
        d.step(inp(kiai=True), inp(pressed=["men"]))
        hit = False
        for _ in range(200):
            dist = abs(d.red.x - d.white.x)
            white_open = d.white.state == "strike" and d.white.strike["bad"]
            if white_open and 30 <= dist - 6 <= 36 and d.red.can_act:
                d.step(inp(kiai=True, pressed=["kote", "kiai"]), None)
                hit = True
                break
            d.step(inp(right=dist > 40, kiai=True), None)
            if d.flow["name"] != "play":
                break
        if not hit:
            # 헛친 뒤 굳어 있는 시간이 지났으면 다시 시도
            for _ in range(60):
                d.step(inp(kiai=True), None)
            continue
        for _ in range(60):
            d.step(inp(kiai=True), None)
            if d.flow["name"] != "play":
                break
        ev = d.pop_events()
        judged = [e for e in ev if e["type"] == "judge"]
        if judged and judged[-1]["ippon"]:
            points += 1
            assert judged[-1]["side"] == "red" and judged[-1]["strike"] == "kote"
            assert len(d.rules.points["red"]) == points
        if d.rules.winner:
            break
    assert points >= 1
    if points >= 2:
        assert d.rules.winner == "red" and d.rules.decided_by == "points"


def test_leader_wins_on_time_and_hansoku_twice_gives_a_point():
    d = new_duel()
    run_until_play(d)
    d.rules.points["white"].append("men")
    for _ in range(60 * 70):
        d.step()
        if d.over:
            break
    assert d.rules.winner == "white" and d.rules.decided_by == "time"

    d = new_duel()
    for n in range(2):
        run_until_play(d)
        d.pop_events()
        for _ in range(600):          # 홍이 뒤로 계속 물러나 경기장 밖으로
            d.step(inp(left=True), None)
            if d.flow["name"] != "play":
                break
        ev = [e for e in d.pop_events() if e["type"] == "hansoku"]
        assert ev and ev[0]["side"] == "red" and ev[0]["converted"] == (n == 1)
    assert d.rules.points["white"] == ["hansoku"] and d.rules.hansoku["red"] == 0


def test_game_flow_practice_then_league_and_inputs():
    cfg = {"MATCH": {"TIME_SEC": 5}, "FLOW": {"PRACTICE_TIME": 2.0, "INTRO_TIME": 1.0, "END_HOLD": 0.2, "RESULT_TIME": 1.0, "FINAL_TIME": 1.0}}
    game = KendoGame(players(3), {"config": cfg}, random.Random(2).random)
    game.start(100.0)
    assert game.phase == "practice"
    game.on_input("p1", {"k": "in", "held": 6, "press": ["men"]}, 100.5)       # 연습 중 입력은 서버가 받지 않는다
    assert game.held["p1"] == 0
    game.tick(102.1)
    assert game.phase == "intro" and game.round == 1 and len(game.duels) == 1
    snap = game.snapshot(102.1)
    assert len(snap["matches"]) == 1 and len(snap["resting"]) == 1
    game.tick(103.2)
    assert game.phase == "fight"
    red = game.duels[0].red.player_id
    game.on_input(red, {"k": "in", "held": 99, "press": ["men", "zzz", 3]}, 103.3)
    assert game.held[red] == 99 & 15 and game.pressed[red] == {"men"}
    game.on_input(red, {"k": "in", "held": "x", "press": "men"}, 103.3)
    game.on_input("nobody", {"k": "in", "held": 1}, 103.3)
    assert game.held[red] == 3
    game.on_connection(red, False, 103.4)
    assert game.held[red] == 0
    t = 103.4
    while not game.finished and t < 200:
        t += 1 / 30
        game.tick(t)
    assert game.finished and game.round == 3
    res = game.results
    assert len(res) == 3 and sum(r["stats"]["wins"] for r in res) == 3 and all(r["stats"]["matches"] == 2 for r in res)
    assert res[0]["isWinner"] and res[0]["score"] == res[0]["stats"]["wins"] * 100 + res[0]["stats"]["ippons"] * 10
    assert game.client_options() == {"rounds": 3, "practice": 2.0, "timeSec": 5, "toWin": 2}
