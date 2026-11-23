"""가든 디펜스 서버 판정 테스트."""

from __future__ import annotations

import random

from party.games.garden.config import DEFAULT_CONFIG, merge_config
from party.games.garden.game import GardenGame
from party.games.garden.world import World, build_boss_dirs, build_spawns

PLAYERS = [{"id": "p1", "name": "가", "index": 0}, {"id": "p2", "name": "나", "index": 1}]
T0 = 100.0


def world(spawns, cfg=None, dirs=None):
    return World(merge_config(cfg), spawns, dirs or [1, -1])


def sp(t, lane, etype="normal", speed=1.0, hp=1.0):
    return {"t": t, "lane": lane, "type": etype, "speedMul": speed, "hpMul": hp}


def run(w, seconds):
    for _ in range(int(round(seconds * 60))):
        w.step()


def kinds(w):
    return [e["type"] for e in w.events]


def test_spawn_list_is_shared_sorted_and_gets_harder():
    cfg = merge_config(None)
    a = build_spawns(random.Random(3).random, cfg)
    b = build_spawns(random.Random(3).random, cfg)
    assert a == b
    assert [s["t"] for s in a] == sorted(s["t"] for s in a)
    assert all(0 <= s["lane"] <= 4 and 0 < s["t"] < 120 for s in a)
    assert sum(1 for s in a if s["type"] == "boss") == 1
    # 마지막 26초에 나오는 좀비가 처음 26초보다 훨씬 많다
    first = sum(1 for s in a if s["t"] < 26)
    last = sum(1 for s in a if s["t"] >= 94)
    assert last >= first * 2.5
    assert len(build_boss_dirs(random.Random(1).random)) == 16


def test_shooting_kills_zombie_in_same_lane_only():
    w = world([sp(0.1, 2), sp(0.1, 0)])
    run(w, 0.5)
    assert len(w.enemies) == 2
    w.set_input(2, True)
    run(w, 4.0)
    # 일반 좀비 체력 10, 권총 2 → 5발. 다른 레인 좀비는 그대로
    assert w.kills == 1 and w.score == 10
    assert [e["lane"] for e in w.enemies] == [0]
    assert kinds(w) == ["kill"]
    assert w.events[0]["pts"] == 10 and w.events[0]["etype"] == "normal"
    # 초당 5발
    assert 19 <= w.shots <= 21


def test_fire_rate_and_bullets_leave_screen():
    w = world([])
    w.set_input(1, True)
    run(w, 1.0)
    assert w.shots == 5
    w.set_input(1, False)
    run(w, 2.0)
    assert w.bullets == [] and w.hits == 0


def test_breach_costs_points_and_resets_combo_but_no_elimination():
    cfg = {"ENEMIES": {**DEFAULT_CONFIG["ENEMIES"], "normal": {"hp": 10, "speed": 200, "score": 10, "hitL": 4, "hitR": 13}}}
    w = world([sp(0.1, 1), sp(3.0, 3)], cfg)
    w.score = 100
    w.combo, w.combo_timer = 3, 9.0
    run(w, 2.0)
    assert w.breaches == 1 and w.score == 70 and w.combo == 0
    assert w.events[-1] == {"type": "breach", "lane": 1, "boss": False, "lost": 30}
    run(w, 3.0)
    assert w.breaches == 2 and w.score == 40
    w.score = 10
    w.spawn("normal", 0, 60.0, 1.0, 1.0)
    run(w, 1.0)
    assert w.score == 0       # 0점 아래로는 내려가지 않는다


def test_combo_multiplier_grows_every_four_kills_and_expires():
    spawns = [sp(0.1 + i * 0.01, 2) for i in range(9)]
    cfg = {"ENEMIES": {**DEFAULT_CONFIG["ENEMIES"], "normal": {"hp": 2, "speed": 1, "score": 10, "hitL": 4, "hitR": 13}}}
    w = world(spawns, cfg)
    w.set_input(2, True)
    run(w, 4.0)
    assert w.kills == 9
    pts = [e["pts"] for e in w.events if e["type"] == "kill"]
    assert pts == [10, 10, 10, 15, 15, 15, 15, 20, 20]      # 4번째 처치부터 1.5배, 8번째부터 2배
    assert w.best_combo == 9
    w.set_input(2, False)
    run(w, 2.1)
    assert w.combo == 0


def test_helmet_breaks_first_then_walks_at_normal_speed():
    w = world([sp(0.1, 2, "helmet")])
    run(w, 0.3)
    e = w.enemies[0]
    assert e["helmetHp"] == 14 and e["speed"] == 7
    w.set_input(2, True)
    run(w, 3.0)
    assert "helmet" in kinds(w)
    assert w.score >= 5
    if w.enemies:
        assert w.enemies[0]["helmetHp"] == 0 and w.enemies[0]["speed"] == 9
    run(w, 3.0)
    assert w.kills == 1 and w.score == 5 + 25


def test_boss_summons_switches_lane_and_bites_at_the_door():
    cfg = {"ENEMIES": {**DEFAULT_CONFIG["ENEMIES"], "boss": {**DEFAULT_CONFIG["ENEMIES"]["boss"], "speed": 60}}}
    w = world([sp(0.1, 2, "boss")], cfg, dirs=[1, 1, 1])
    w.score = 500
    run(w, 6.5)
    assert kinds(w).count("summon") == 1
    assert sum(1 for e in w.enemies if e["type"] == "normal") == 2
    boss = next(e for e in w.enemies if e["type"] == "boss")
    assert boss["state"] == "eat"            # 문 앞 도착
    first = w.breaches
    assert first >= 1
    run(w, 3.1)
    assert w.breaches >= first + 1            # 3초마다 계속 감점
    assert any(e["type"] == "breach" and e["boss"] for e in w.events)


def test_boss_lane_stays_in_the_middle_lanes():
    w = world([sp(0.1, 2, "boss")], dirs=[1, 1, 1, -1, -1, -1, -1])
    lanes = set()
    for _ in range(60 * 70):
        w.step()
        for e in w.enemies:
            if e["type"] == "boss":
                lanes.add(e["lane"])
    assert lanes and lanes <= {1, 2, 3} and len(lanes) >= 2


def make(seed=1, config=None):
    game = GardenGame(PLAYERS, {"config": config} if config else {}, random.Random(seed).random)
    game.start(T0)
    game.drain()
    return game


def run_game(game, gt_to, step=0.05):
    t = getattr(game, "_test_t", -game.R["COUNTDOWN"] - game.R["INTRO_TIME"])
    while t < gt_to:
        t = min(gt_to, t + step)
        game.tick(game.start_at + t)
    game._test_t = gt_to


def test_game_phases_inputs_and_results():
    game = make()
    assert game.phase == "intro"
    game.on_input("p1", {"k": "in", "lane": 0, "fire": True}, T0 + 1)      # 시작 전 입력은 받아 두기만 한다
    run_game(game, -2.5)
    assert game.phase == "countdown"
    run_game(game, 0.5)
    assert game.phase == "play"
    assert game.worlds["p1"].frame == 30 and game.worlds["p1"].shots >= 2
    game.on_input("p1", {"k": "in", "lane": 9, "fire": False}, game.start_at + 0.6)
    assert game.worlds["p1"].lane == 4
    game.on_input("p1", {"k": "in", "lane": "x", "fire": 1}, game.start_at + 0.7)
    assert game.worlds["p1"].lane == 4 and game.worlds["p1"].fire is False
    game.on_input("zz", {"k": "in", "lane": 1, "fire": True}, game.start_at + 0.7)
    game.on_input("p2", {"k": "no"}, game.start_at + 0.7)
    game.drain()
    run_game(game, 0.8)
    out = game.drain()
    mine = [d for to, kind, d in out if kind == "state" and to == "p1"]
    assert mine and mine[-1]["me"]["lane"] == 4 and "enemies" in mine[-1]["me"]
    assert set(mine[-1]["players"]) == {"p1", "p2"}
    run_game(game, 120.5)
    assert game.phase == "timeup"
    assert game.worlds["p1"].frame == 7200            # 120초에서 멈춘다
    run_game(game, 122.1)
    assert game.phase == "final" and not game.finished
    run_game(game, 131)
    assert game.finished and [r["rank"] for r in game.results] in ([1, 2], [1, 1])
    assert set(game.results[0]["stats"]) == {"kills", "breaches", "bestCombo", "accuracy", "bossKilled"}


def test_both_players_get_the_same_zombies_and_idle_player_loses():
    game = make(seed=5)
    run_game(game, 0.1)
    # p1 은 가장 앞선 좀비를 따라가며 쏘고, p2 는 가만히 있는다
    t = 0.1
    while t < 60:
        t += 0.25
        w = game.worlds["p1"]
        if w.enemies:
            target = min(w.enemies, key=lambda e: e["x"])
            game.on_input("p1", {"k": "in", "lane": target["lane"], "fire": True}, game.start_at + t)
        run_game(game, t)
    w1, w2 = game.worlds["p1"], game.worlds["p2"]
    assert w1.spawn_i == w2.spawn_i > 20          # 같은 일정
    assert w1.kills > 15 and w2.kills == 0
    assert w1.score > w2.score == 0 and w2.breaches > 0
    opts = game.client_options()
    assert opts["duration"] == 120.0 and len(opts["waves"]) == 6 and opts["waves"][-1]["boss"]
