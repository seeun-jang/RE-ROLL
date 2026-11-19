"""과일자르기 서버 판정 테스트."""

from __future__ import annotations

import random

from party.games.fruit.config import DEFAULT_CONFIG, merge_config
from party.games.fruit.game import FruitGame
from party.games.fruit.schedule import build_schedule, pos_at

PLAYERS = [{"id": "p1", "name": "가", "index": 0}, {"id": "p2", "name": "나", "index": 1}]
T0 = 100.0


def make(seed=1, config=None, players=PLAYERS):
    game = FruitGame(players, {"config": config} if config else {}, random.Random(seed).random)
    game.start(T0)
    game.drain()
    return game


def at(game, gt):
    """게임 시각 gt 에 해당하는 서버 시각."""
    return game.start_at + gt


def run_to(game, gt, step=0.05):
    t = getattr(game, "_test_t", -game.R["COUNTDOWN"] - game.R["INTRO_TIME"])
    while t < gt:
        t = min(gt, t + step)
        game.tick(at(game, t))
    game._test_t = gt


def cut_through(game, pid, obj, gt, t0=None):
    """gt 시각에 obj 를 가로지르는 칼질을 보낸다."""
    x, y = pos_at(obj, gt - (obj["t"] if t0 is None else t0), game.cfg)
    game.on_input(pid, {"k": "cut", "segs": [[gt - 0.02, x - 10, y, gt, x + 10, y]]}, at(game, gt))


def events(game, pid=None):
    return [d for to, kind, d in game.drain() if kind == "event" and (pid is None or to == pid)]


def first(game, kind, mode=0, after=0.0, d=None):
    return next(o for o in game.objects if o["kind"] == kind and o["mode"] == mode and o["t"] >= after and (d is None or o["def"] == d))


def test_schedule_is_same_for_same_seed_and_has_everything():
    cfg = merge_config(None)
    a = build_schedule(random.Random(5).random, cfg)
    b = build_schedule(random.Random(5).random, cfg)
    assert a == b
    assert [o["id"] for o in a] == list(range(len(a)))
    kinds = {(o["kind"], o["mode"]) for o in a}
    assert {("fruit", 0), ("bomb", 0), ("item", 0), ("fruit", 1)} <= kinds
    assert all(0 <= o["t"] < 60 for o in a if o["mode"] != 2)
    # 던진 물체는 화면 안쪽 위로 올라갔다가 내려온다
    for o in a:
        _, top = pos_at(o, -o["vy"] / cfg["PHYSICS"]["GRAVITY"], cfg)
        assert 15 <= top <= 90
        _, end = pos_at(o, o["life"], cfg)
        assert end >= 180 + 20


def test_phases_and_timing():
    game = make()
    assert game.phase == "intro"
    run_to(game, -2.9)
    assert game.phase == "countdown"
    run_to(game, 0.01)
    assert game.phase == "play"
    run_to(game, 60.01)
    assert game.phase == "timeup"
    run_to(game, 61.7)
    assert game.phase == "final" and not game.finished
    run_to(game, 61.7 + 8.1)
    assert game.finished and len(game.results) == 2


def test_slicing_fruit_scores_only_for_that_player():
    game = make()
    fruit = first(game, "fruit")
    gt = fruit["t"] + 1.0
    run_to(game, gt)
    game.drain()
    cut_through(game, "p1", fruit, gt)
    ev = events(game)
    pts = game.points[fruit["def"]]
    assert len(ev) == 1 and abs(ev[0].pop("t") - gt) < 1e-6
    assert ev == [{"type": "slice", "id": fruit["id"], "kind": "fruit", "pts": pts, "score": pts}]
    assert game.P["p1"]["score"] == pts and game.P["p2"]["score"] == 0
    # 같은 과일을 다시 벨 수는 없지만, 다른 사람은 자기 화면의 같은 과일을 벨 수 있다
    cut_through(game, "p1", fruit, gt + 0.01)
    assert events(game) == []
    cut_through(game, "p2", fruit, gt + 0.01)
    assert game.P["p2"]["score"] == pts


def test_miss_slow_and_bad_input_are_ignored():
    game = make()
    fruit = first(game, "fruit")
    gt = fruit["t"] + 1.0
    run_to(game, gt)
    x, y = pos_at(fruit, 1.0, game.cfg)
    game.on_input("p1", {"k": "cut", "segs": [[gt - 0.02, x - 10, y + 40, gt, x + 10, y + 40]]}, at(game, gt))   # 빗나감
    game.on_input("p1", {"k": "cut", "segs": [[gt - 1.0, x - 10, y, gt, x + 10, y]]}, at(game, gt))             # 너무 느림
    game.on_input("p1", {"k": "cut", "segs": [[gt, x, y], "x", [1, 2, 3, 4, 5, float("nan")]]}, at(game, gt))
    game.on_input("p1", {"k": "cut", "segs": "no"}, at(game, gt))
    game.on_input("zz", {"k": "cut", "segs": [[gt - 0.02, x - 10, y, gt, x + 10, y]]}, at(game, gt))
    assert game.P["p1"]["score"] == 0


def test_bomb_only_deducts_points_and_never_below_zero():
    game = make()
    bomb = first(game, "bomb")
    fruit = first(game, "fruit")
    gt = fruit["t"] + 0.8
    run_to(game, gt)
    cut_through(game, "p1", fruit, gt)
    run_to(game, max(gt, bomb["t"] + 0.8))
    before = game.P["p1"]["score"]
    cut_through(game, "p1", bomb, game._test_t)
    assert game.P["p1"]["bombs"] == 1
    assert game.P["p1"]["score"] == max(0, before - 20)
    # 0점에서 폭탄을 베도 음수가 되지 않는다
    cut_through(game, "p2", bomb, game._test_t)
    assert game.P["p2"]["score"] == 0
    assert game.phase == "play"      # 탈락 없음


def test_combo_bonus_after_three_quick_slices():
    game = make(config={"SPAWN": {"WAVE_MIN_START": 5, "WAVE_MAX_START": 5, "BOMB_CHANCE_START": 0.0, "BOMB_CHANCE_END": 0.0}})
    fruits = [o for o in game.objects if o["kind"] == "fruit" and o["mode"] == 0][:4]
    gt = fruits[-1]["t"] + 0.6
    run_to(game, gt)
    game.drain()
    for i, f in enumerate(fruits):
        cut_through(game, "p1", f, gt + i * 0.01)
    base = sum(game.points[f["def"]] for f in fruits)
    assert game.P["p1"]["score"] == base and game.P["p1"]["combo"] == 4
    run_to(game, gt + 1.0)
    combo = [e for e in events(game, "p1") if e["type"] == "combo"]
    assert combo == [{"type": "combo", "n": 4, "bonus": 20, "score": base + 20}]
    assert game.P["p1"]["maxCombo"] == 4


def test_double_item_doubles_points_for_eight_seconds():
    game = make(seed=3)
    item = first(game, "item", d="double")
    gt = item["t"] + 1.0
    run_to(game, gt)
    cut_through(game, "p1", item, gt)
    assert game.P["p1"]["score"] == 5 and game.P["p1"]["items"] == 1
    fruit = first(game, "fruit", after=gt + 0.5)
    g2 = fruit["t"] + 0.8
    run_to(game, g2)
    cut_through(game, "p1", fruit, g2)
    cut_through(game, "p2", fruit, g2)
    assert game.P["p1"]["score"] == 5 + 2 * game.points[fruit["def"]]
    assert game.P["p2"]["score"] == game.points[fruit["def"]]
    late = first(game, "fruit", after=gt + 9.0)
    before = game.P["p1"]["score"]
    run_to(game, late["t"] + 0.8)
    cut_through(game, "p1", late, late["t"] + 0.8)
    assert game.P["p1"]["score"] >= before + game.points[late["def"]]
    assert game.P["p1"]["score"] <= before + game.points[late["def"]] + 60     # 2배가 아님(콤보 보너스만 가능)


def test_triple_item_gives_extra_fruit_only_to_the_slicer():
    game = make(seed=3)
    item = first(game, "item", d="triple")
    gt = item["t"] + 1.0
    run_to(game, gt)
    cut_through(game, "p1", item, gt)
    act = gt + 0.14
    burst = [o for o in game.objects if o["mode"] == 2 and o["group"] == item["id"]]
    assert burst and len(game.P["p1"]["extra"]) == len(burst)
    # 쏟아지는 묶음: 벤 사람만 벨 수 있다
    b = next(o for o in burst if o["kind"] == "fruit")
    g2 = act + b["t"] + 0.8
    run_to(game, g2)
    cut_through(game, "p2", b, g2, t0=act + b["t"])
    assert b["id"] not in game.P["p2"]["cut"]
    cut_through(game, "p1", b, g2, t0=act + b["t"])
    assert b["id"] in game.P["p1"]["cut"]
    # 3배 효과 중에 추가로 나오는 과일도 벤 사람에게만
    extra = next(o for o in game.objects if o["mode"] == 1 and o["kind"] == "fruit" and act <= o["t"] < act + 6)
    g3 = max(g2, extra["t"] + 0.8)
    run_to(game, g3)
    cut_through(game, "p2", extra, g3)
    cut_through(game, "p1", extra, g3)
    assert extra["id"] in game.P["p1"]["cut"] and extra["id"] not in game.P["p2"]["cut"]
    # 효과가 끝난 뒤의 추가 과일은 나오지 않는다
    later = next(o for o in game.objects if o["mode"] == 1 and o["kind"] == "fruit" and o["t"] >= act + 6.5
                 and not any(a <= o["t"] < b2 for a, b2 in game.P["p1"]["triples"]))
    run_to(game, later["t"] + 0.8)
    cut_through(game, "p1", later, later["t"] + 0.8)
    assert later["id"] not in game.P["p1"]["cut"]


def test_late_cut_uses_reported_time_within_lag_limit():
    game = make()
    fruit = first(game, "fruit")
    gt = fruit["t"] + 1.0
    run_to(game, gt + 0.2)
    x, y = pos_at(fruit, 1.0, game.cfg)
    # 0.2초 전에 벤 칼질이 지금 도착 — 그때 위치로 판정한다
    game.on_input("p1", {"k": "cut", "segs": [[gt - 0.02, x - 10, y, gt, x + 10, y]]}, at(game, gt + 0.2))
    assert fruit["id"] in game.P["p1"]["cut"]
    # 2초 전이라고 주장하는 칼질은 (지금 - 0.35초) 위치로 판정 → 빗나간다
    f2 = first(game, "fruit", after=gt + 3.0)
    g2 = f2["t"] + 2.4
    run_to(game, g2)
    x2, y2 = pos_at(f2, 0.4, game.cfg)
    game.on_input("p1", {"k": "cut", "segs": [[f2["t"] + 0.38, x2 - 6, y2, f2["t"] + 0.4, x2 + 6, y2]]}, at(game, g2))
    assert f2["id"] not in game.P["p1"]["cut"]


def test_no_cuts_before_start_or_after_time_up_and_results_ranked():
    game = make()
    fruit = first(game, "fruit")
    game.on_input("p1", {"k": "cut", "segs": [[-1.02, 100, 100, -1.0, 140, 100]]}, at(game, -1.0))
    assert game.P["p1"]["score"] == 0
    gt = fruit["t"] + 1.0
    run_to(game, gt)
    cut_through(game, "p2", fruit, gt)
    last = [o for o in game.objects if o["mode"] == 0 and o["kind"] == "fruit"][-1]
    run_to(game, 60.5)
    cut_through(game, "p1", last, 60.5)
    assert game.P["p1"]["score"] == 0
    run_to(game, 75)
    assert game.finished
    res = game.results
    assert [r["playerId"] for r in res] == ["p2", "p1"]
    assert res[0]["rank"] == 1 and res[0]["isWinner"] and res[1]["rank"] == 2 and not res[1]["isWinner"]
    assert set(res[0]["stats"]) == {"sliced", "bombs", "maxCombo", "items"}


def test_state_and_reconnect_info():
    game = make()
    fruit = first(game, "fruit")
    gt = fruit["t"] + 1.0
    run_to(game, gt)
    cut_through(game, "p1", fruit, gt)
    snap = game.state_for("p1", at(game, gt))
    assert snap["phase"] == "play" and snap["me"]["cut"] == [fruit["id"]]
    assert snap["players"]["p1"]["score"] > 0
    opts = game.client_options()
    assert len(opts["objects"]) == len(game.objects) and opts["duration"] == DEFAULT_CONFIG["RULES"]["DURATION"]
