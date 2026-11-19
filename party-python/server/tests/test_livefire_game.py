"""실거리 사격 서버 판정 테스트 (가짜 시계로 start/tick/on_input/drain)."""

from __future__ import annotations

import random
import time

from party.games.livefire.config import DOWN, LEFT, RIGHT, UP, merge_config
from party.games.livefire.game import LivefireGame
from party.games.livefire.range import Range, grade_of, make_schedule, target_rect

T0 = 100.0
NAMES = ["가", "나", "다", "라", "마"]


def players(n):
    return [{"id": f"p{i + 1}", "name": NAMES[i], "index": i} for i in range(n)]


class FakeGemini:
    """tests/test_caster.py 와 같은 방식의 가짜 Gemini."""

    def __init__(self, lines=None, verdict=None):
        self.lines, self.verdict, self.calls = lines, verdict, 0

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls += 1
        if schema and "headline" in schema.get("properties", {}):
            return self.verdict
        return self.lines


# ---------------------------------------------------------------- 규칙
def test_schedule_is_seeded_and_shaped_like_the_original():
    cfg = merge_config(None)
    a = make_schedule(random.Random(7).random, cfg)
    b = make_schedule(random.Random(7).random, cfg)
    assert a == b and len(a) == 20
    assert a[0]["dist"] == 100                                  # 첫 표적은 100m
    assert sorted(t["dist"] for t in a) == [100] * 7 + [200] * 7 + [250] * 6
    for k, t in enumerate(a):
        d = cfg["DISTANCES"][t["dist"]]
        assert t["x"] in d["slots"]
        assert t["time"] == (int(d["time"] * 0.85 + 0.5) if k >= 10 else d["time"])
    assert make_schedule(random.Random(8).random, cfg) != a


def test_grades_and_target_rect():
    cfg = merge_config(None)
    assert [grade_of(h, cfg)["name"] for h in (20, 18, 15, 12, 10, 9, 0)] == \
        ["특등사수", "특등사수", "1급", "2급", "3급", "불합격", "불합격"]
    assert target_rect({"dist": 100, "x": 12}, 1.0, cfg) == (5.5, 48, 13, 20)
    assert target_rect({"dist": 250, "x": 0}, 0.5, cfg) == (-3.5, 23, 7, 5)


def quiet_range(n=1, **over):
    """흔들림을 끈 사격장 (판정만 보기 위해)."""
    cfg = merge_config({"SWAY": 0, **over})
    ids = [f"p{i + 1}" for i in range(n)]
    sched = [{"dist": 100, "x": 0, "time": 170}, {"dist": 250, "x": 9, "time": 230}] * 10
    return Range(cfg, ids, sched[:cfg["TARGETS"]], {}), cfg


def steps(rg, n):
    for _ in range(n):
        rg.step()


def shots(rg):
    return [e for e in rg.events if e["type"] == "shot"]


def test_brief_script_then_fire_and_hit_scoring():
    rg, cfg = quiet_range()
    lane = rg.lanes["p1"]
    rg.fire("p1")                                               # 준비 방송 중에는 못 쏜다
    assert lane.shots == 0
    steps(rg, 300)
    assert rg.phase == "fire" and [e["text"] for e in rg.events if e["type"] == "tower"] == \
        ["사수 준비!", "탄알집 결합!", "조정간 단발!", "준비된 사수부터 사격 개시!"]
    rg.events = []
    steps(rg, 36)
    assert rg.t_phase == "rise" and rg.events[0] == {"type": "popup", "k": 0, "dist": 100}
    lane.ax, lane.ay = 0.0, 58.0                                # 표적 한가운데
    steps(rg, 4)
    rg.fire("p1")                                               # 아직 절반도 안 올라옴 → 빗나감
    assert shots(rg)[-1]["hit"] is False and lane.mag == 9 and lane.miss_run == 1
    steps(rg, 18)                                               # 다 올라옴(up 12프레임째), 반동도 가라앉음
    lane.kick = 0.0
    rg.fire("p1")
    e = shots(rg)[-1]
    assert e["hit"] and e["pts"] == 15 and e["quick"] == 5 and e["streak"] == 1
    assert lane.hits == 1 and lane.quick == 5 and lane.score(cfg) == 15 and lane.miss_run == 0
    steps(rg, 18)
    lane.kick = 0.0
    rg.fire("p1")                                               # 이미 맞힌 표적은 다시 맞지 않는다
    assert shots(rg)[-1]["hit"] is False and lane.hits == 1


def test_quick_bonus_shrinks_every_half_second_and_cooldown():
    rg, cfg = quiet_range()
    lane = rg.lanes["p1"]
    steps(rg, 300 + 36 + 10 + 95)                               # up 95프레임째 → 5 - 95//30 = 2
    lane.ax, lane.ay = 0.0, 58.0
    rg.fire("p1")
    assert shots(rg)[-1]["quick"] == 2 and shots(rg)[-1]["pts"] == 12
    rg.fire("p1")                                               # 연속 격발 간격(18프레임) 안
    assert lane.shots == 1


def test_all_hit_drops_target_early_and_records():
    rg, cfg = quiet_range(2)
    steps(rg, 300 + 36 + 10 + 1)
    for pid in ("p1", "p2"):
        rg.lanes[pid].ax, rg.lanes[pid].ay = 0.0, 58.0
        rg.fire(pid)
    steps(rg, 25 + 10)                                          # 25프레임 넘게 서 있었으면 일찍 내려간다
    assert rg.k == 1 and rg.lanes["p1"].record == [True] and rg.lanes["p2"].record == [True]
    down = [e for e in rg.events if e["type"] == "down"][0]
    assert down["hitters"] == ["p1", "p2"]
    # 끊긴 사람은 빼고 센다
    rg2, _ = quiet_range(2)
    rg2.away.add("p2")
    steps(rg2, 300 + 36 + 10 + 1)
    rg2.lanes["p1"].ax, rg2.lanes["p1"].ay = 0.0, 58.0
    rg2.fire("p1")
    steps(rg2, 25 + 10)
    assert rg2.k == 1 and rg2.lanes["p2"].record == [False]


def test_magazine_reload_and_dry_fire():
    rg, cfg = quiet_range(TARGETS=20)
    lane = rg.lanes["p1"]
    steps(rg, 300 + 50)
    lane.ay = 12.0                                              # 허공에 쏜다
    for _ in range(10):
        rg.fire("p1")
        steps(rg, 18)
    assert lane.shots == 10 and lane.mag == 0 and lane.reload_t > 0 and shots(rg)[-1]["reload"] is True
    rg.fire("p1")                                               # 교체 중에는 못 쏜다
    assert lane.shots == 10
    steps(rg, 80)
    assert lane.mag == 10 and lane.spare == 0
    for _ in range(10):
        rg.fire("p1")
        steps(rg, 18)
    assert lane.shots == 20 and lane.out_of_ammo()
    rg.fire("p1")
    assert rg.events[-1] == {"type": "dry", "playerId": "p1"} and lane.shots == 20


def test_aim_moves_with_held_keys_clamps_and_steadies():
    rg, cfg = quiet_range(SWAY=1.8)
    lane = rg.lanes["p1"]
    rg.set_held("p1", RIGHT | UP)
    steps(rg, 10)
    assert abs(lane.ax - 6.0) < 1e-9 and abs(lane.ay - 53.0) < 1e-9 and lane.still == 0
    steps(rg, 200)
    assert lane.ax == 27 and lane.ay == 12                      # 한계에서 멈춘다
    rg.set_held("p1", LEFT | DOWN)
    steps(rg, 300)
    assert lane.ax == -27 and lane.ay == 78
    rg.set_held("p1", 0)
    steps(rg, 41)
    assert lane.still == 41
    assert abs(lane.sx) <= 1.8 * 0.55 * 1.4 + 1e-9              # 숨을 고르면 흔들림이 줄어든다


# ---------------------------------------------------------------- 게임
def make(n=2, seed=1, config=None, services=None):
    game = LivefireGame(players(n), {"config": config} if config else {}, random.Random(seed).random)
    if services is not None:
        game.services = services
    game.start(T0)
    return game


def keys_toward(game, pid, skill_ok=True):
    """시험용 사수: 지금 표적 한가운데로 조준 키를 누른다. 다 왔으면 0."""
    rg = game.range
    lane, tg = rg.lanes[pid], rg.target
    if tg is None or rg.t_phase == "gap" or lane.hit_k == rg.k:
        return 0, False
    d = game.cfg["DISTANCES"][tg["dist"]]
    dx, dy = tg["x"] - lane.ax, (d["y"] - d["h"] * 0.5) - lane.ay
    held = 0
    if abs(dx) > 1.3:
        held |= RIGHT if dx > 0 else LEFT
    if abs(dy) > 1.5:
        held |= DOWN if dy > 0 else UP
    return held, held == 0 and rg.t_phase == "up" and lane.kick < 0.5


def play(game, shooters, until=200.0, step=1 / 30):
    """끝날 때까지 돌린다. shooters 에 든 사람만 표적을 따라가며 쏜다."""
    t = T0
    sent = {}
    out = []
    while not game.finished and t < T0 + until:
        t += step
        for pid in shooters:
            held, ready = keys_toward(game, pid)
            if sent.get(pid) != held:
                sent[pid] = held
                game.on_input(pid, {"k": "in", "held": held}, t)
            if ready:
                game.on_input(pid, {"k": "fire", "held": held}, t)
        game.tick(t)
        out += game.drain()
    return out


def test_phases_inputs_state_and_events():
    game = make(2)
    first = game.drain()
    assert game.phase == "brief" and {to for to, kind, _ in first if kind == "state"} == {"p1", "p2"}
    opts = game.client_options()
    assert opts["caster"] == "호랑대장" and opts["config"]["TARGETS"] == 20 and "100" in opts["config"]["DISTANCES"]
    assert "schedule" not in opts                                # 표적 순서는 미리 알려 주지 않는다
    # 잘못된 입력은 무시
    game.on_input("zz", {"k": "in", "held": 1}, T0 + 0.1)
    game.on_input("p1", "x", T0 + 0.1)
    game.on_input("p1", {"k": "in", "held": 99}, T0 + 0.1)
    game.on_input("p1", {"k": "in", "held": True}, T0 + 0.1)
    game.on_input("p1", {"k": "no", "held": 1}, T0 + 0.1)
    assert game.range.lanes["p1"].held == 0
    # 준비 방송 중에도 조준은 움직인다. 발사는 안 된다
    game.on_input("p1", {"k": "in", "held": RIGHT}, T0 + 1.0)
    game.on_input("p1", {"k": "fire"}, T0 + 1.5)
    game.tick(T0 + 2.0)
    lane = game.range.lanes["p1"]
    assert abs(lane.ax - 27) < 1e-9 or abs(lane.ax - 0.6 * 60) < 1e-6
    assert lane.shots == 0 and game.range.frame == 120
    out = game.drain()
    towers = [d["text"] for _, kind, d in out if kind == "event" and d["type"] == "tower"]
    assert towers == ["사수 준비!", "탄알집 결합!"]
    mine = [d for to, kind, d in out if kind == "state" and to == "p1"][-1]
    assert mine["phase"] == "brief" and mine["target"] is None and mine["me"]["held"] == RIGHT
    assert set(mine["lanes"]) == {"p1", "p2"} and mine["lanes"]["p2"]["aim"][1] != 0
    assert mine["tower"]["source"] == "script" and mine["results"] is None
    game.tick(T0 + 5.01)
    assert game.phase == "fire"
    game.tick(T0 + 5.01 + 40 / 60)
    snap = game.state_for("p2", T0 + 5.7)
    assert snap["target"]["dist"] == 100 and snap["tPhase"] == "rise" and "ax" in snap["me"]
    assert game.state_for("zz", T0 + 5.7).get("me") is None


def run_full(n, shooters, seed=3):
    game = make(n, seed=seed)
    out = play(game, shooters)
    assert game.finished and game.phase == "done"
    res = game.results
    assert len(res) == n and {r["playerId"] for r in res} == {f"p{i + 1}" for i in range(n)}
    assert [r["score"] for r in res] == sorted((r["score"] for r in res), reverse=True)
    assert res[0]["rank"] == 1 and res[0]["isWinner"]
    for r in res:
        assert set(r) == {"playerId", "name", "score", "rank", "isWinner", "stats"}
        assert set(r["stats"]) == {"hits", "shots", "quick", "grade", "accuracy", "bestStreak"}
        assert r["score"] == r["stats"]["hits"] * 10 + r["stats"]["quick"] <= 300
        assert r["stats"]["shots"] <= 20
    return game, out


def test_full_game_two_players_shooter_beats_idle():
    game, out = run_full(2, ["p1"])
    res = {r["playerId"]: r for r in game.results}
    assert res["p1"]["stats"]["hits"] >= 10 and res["p1"]["rank"] == 1
    assert res["p2"]["score"] == 0 and res["p2"]["stats"]["grade"] == "불합격" and res["p2"]["rank"] == 2
    events = [d for _, kind, d in out if kind == "event"]
    kinds = {d["type"] for d in events}
    assert {"tower", "shot", "say"} <= kinds and "verdict" not in kinds      # Gemini 꺼짐 → 총평 없음
    says = [d for d in events if d["type"] == "say"]
    assert all(d["source"] == "canned" and d["who"] == "호랑대장" and d["text"] for d in says)
    assert says[0]["kind"] == "first_hit" and any(d["kind"] == "cease" for d in says)
    towers = [d["text"] for d in events if d["type"] == "tower"]
    assert "탄알집 교체 후 계속 사격!" in towers and towers[-1] == "조정간 안전! 탄알집 제거!"
    # 마지막 상태에 결과가 실려 있다(다시 접속한 사람용)
    final = [d for to, kind, d in out if kind == "state" and to == "p2"][-1]
    assert final["phase"] == "done" and final["results"] == game.results
    assert final["lanes"]["p1"]["rec"].count("1") == res["p1"]["stats"]["hits"] and len(final["lanes"]["p1"]["rec"]) == 20


def test_full_game_three_and_five_players():
    game, _ = run_full(3, ["p1", "p3"], seed=5)
    assert {r["playerId"] for r in game.results if r["score"] > 0} == {"p1", "p3"}
    game, _ = run_full(5, ["p1", "p2", "p3", "p4", "p5"], seed=9)
    assert all(r["stats"]["hits"] >= 8 for r in game.results)


def test_says_keep_a_minimum_gap():
    game = make(2, seed=4)
    t, last = T0, None
    while not game.finished and t < T0 + 200:
        t += 1 / 30
        for pid in ("p1", "p2"):
            held, ready = keys_toward(game, pid)
            game.on_input(pid, {"k": "fire" if ready else "in", "held": held}, t)
        game.tick(t)
        for _, kind, d in game.drain():
            if kind == "event" and d["type"] == "say":
                assert last is None or t - last >= 3.0 - 1e-6
                last = t
    assert last is not None


def test_gemini_lines_and_verdict_are_used():
    lines = {k: ["{name} 잘 쐈다!"] for k in
             ("first_hit", "long_hit", "fast_hit", "streak", "miss_streak", "all_miss", "halfway", "perfect", "cease")}
    fake = FakeGemini(lines, {"headline": "명사수의 날", "mvp": "가 최고다", "cheer": "나 다음엔 된다"})
    game = make(2, seed=3, services={"gemini": fake})
    for _ in range(300):
        if game.book.ready:
            break
        time.sleep(0.01)
    t, out, sent = T0, [], None
    while not game.finished and t < T0 + 200:
        t += 1 / 30
        held, ready = keys_toward(game, "p1")
        if held != sent:
            sent = held
            game.on_input("p1", {"k": "in", "held": held}, t)
        if ready:
            game.on_input("p1", {"k": "fire"}, t)
        if game.phase == "final":
            time.sleep(0.002)                                   # 총평 스레드가 끝날 틈
        game.tick(t)
        out += game.drain()
    events = [d for _, kind, d in out if kind == "event"]
    says = [d for d in events if d["type"] == "say"]
    assert says and says[0] == {"type": "say", "text": "가 잘 쐈다!", "source": "gemini", "who": "호랑대장", "kind": "first_hit"}
    verdicts = [d for d in events if d["type"] == "verdict"]
    assert verdicts == [{"type": "verdict", "headline": "명사수의 날", "mvp": "가 최고다", "cheer": "나 다음엔 된다"}]
    assert game.verdict and game.state_for("p2", t)["verdict"]["headline"] == "명사수의 날"
    assert fake.calls == 2                                       # 대사 묶음 1번 + 총평 1번


def test_disconnected_player_releases_keys_and_game_still_ends():
    game = make(2, seed=2)
    game.on_input("p2", {"k": "in", "held": LEFT}, T0 + 0.5)
    game.on_connection("p2", False, T0 + 1.0)
    assert game.range.lanes["p2"].held == 0 and "p2" in game.range.away
    game.on_connection("p2", True, T0 + 2.0)
    assert "p2" not in game.range.away
    game.on_connection("p2", False, T0 + 3.0)
    play(game, ["p1"])
    assert game.finished and len(game.results) == 2
