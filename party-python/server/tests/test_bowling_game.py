"""잭팟 볼링 서버 판정 테스트 (가짜 시계로 start / tick / on_input / drain)."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from party.games.bowling import rules
from party.games.bowling.config import DEFAULT_CONFIG, merge_config
from party.games.bowling.game import SAY_CANNED, SAY_KINDS, BowlingGame

CFG = merge_config(None)
T0 = 100.0
WEB = Path(__file__).resolve().parents[2] / "web"
NODE = shutil.which("node")


def people(n):
    return [{"id": f"p{i + 1}", "name": "가나다라마"[i], "index": i} for i in range(n)]


def make(n=2, seed=1, services=None):
    game = BowlingGame(people(n), {}, random.Random(seed).random)
    if services is not None:
        game.services = services
    game.start(T0)
    return game


def events(game, kind=None, to="any"):
    out = []
    for target, what, data in game.drain():
        if what == "event" and (kind is None or data["type"] == kind) and (to == "any" or target == to):
            out.append(data)
    return out


def throw(game, pid, now, x=0.0, angle=0.0, power=0.8, spin=()):
    game.on_input(pid, {"k": "throw", "n": game.P[pid]["n"], "x": x, "angle": angle, "power": power, "spin": list(spin)}, now)


def play_out(game, picker=None, step=0.05, limit=400.0):
    """모두가 차례가 오면 바로 던지게 해서 끝까지 돌린다. picker(pid, 투구 번호) → (x, angle, power)"""
    t = T0
    seen = []
    while not game.finished and t < T0 + limit:
        t += step
        if game.phase == "play" and picker:
            for pid, st in game.P.items():
                if not st["done"] and t >= st["aimAt"]:
                    x, angle, power = picker(pid, st["n"])
                    throw(game, pid, t, x, angle, power)
        game.tick(t)
        seen += [(to, kind, data) for to, kind, data in game.drain()]
    return t, seen


# ----- 규칙 계산 -----
def test_score_frames_standard_bowling():
    perfect = rules.score_frames([10] * 12, 10)
    assert perfect[-1]["cum"] == 300 and perfect[-1]["marks"] == ["X", "X", "X"]
    spares = rules.score_frames([5, 5] * 10 + [5], 10)
    assert spares[-1]["cum"] == 150 and spares[0]["marks"] == ["5", "/"]
    # 보너스를 기다리는 프레임은 누적이 비어 있다
    waiting = rules.score_frames([10, 3], 3)
    assert waiting[0] == {"rolls": [10], "marks": ["X"], "cum": None}
    assert rules.running_score([10, 3, 4], 3) == 24
    assert rules.score_frames([0, 0, 9, 1, 7, 2], 3)[2]["marks"] == ["7", "2"]
    assert rules.score_frames([0, 0, 0, 0, 10, 4, 6], 3)[2]["marks"] == ["X", "4", "/"]


def test_frame_state():
    assert rules.frame_state([], 3) == {"frame": 0, "ball": 0, "done": False}
    assert rules.frame_state([10], 3) == {"frame": 1, "ball": 0, "done": False}
    assert rules.frame_state([3], 3) == {"frame": 0, "ball": 1, "done": False}
    assert rules.frame_state([3, 4, 10, 2, 3], 3)["done"]
    assert rules.frame_state([3, 4, 10, 2, 8], 3) == {"frame": 2, "ball": 2, "done": False}
    assert rules.frame_state([3, 4, 10, 10, 10, 10], 3)["done"]


def test_split():
    up = [0] * 10
    up[6] = up[9] = 1                     # 7번 · 10번 핀
    assert rules.is_split(CFG, up)
    up[0] = 1
    assert not rules.is_split(CFG, up)    # 1번 핀이 서 있으면 스플릿이 아니다
    assert not rules.is_split(CFG, [0, 1, 0, 1, 0, 0, 0, 0, 0, 0])  # 붙어 있는 핀


def test_throw_is_deterministic_and_gutter():
    args = dict(up=[1] * 10, gold=3, x=1.5, angle=0.02, power=0.8, spin=[1] * 10, seed=77)
    a = rules.simulate_throw(CFG, **args)
    b = rules.simulate_throw(CFG, **args)
    assert a["up"] == b["up"] and a["frames"] == b["frames"] and a["knocked"] > 0
    assert [p["x"] for p in a["rack"].pins] == [p["x"] for p in b["rack"].pins]
    gutter = rules.simulate_throw(CFG, [1] * 10, -1, 17.0, 0.2, 0.5, [], 1)
    assert gutter["gutter"] and gutter["knocked"] == 0 and gutter["up"] == [1] * 10
    # 치워진 핀은 다시 맞지 않는다
    again = rules.simulate_throw(CFG, a["up"], 3, 1.5, 0.02, 0.8, [], 78)
    assert all(not v or u for u, v in zip(a["up"], again["up"]))


def test_spin_bends_the_ball_within_budget():
    straight = rules.simulate_throw(CFG, [0] * 10, -1, 0.0, 0.0, 0.0, [], 1)
    bent = rules.simulate_throw(CFG, [0] * 10, -1, 0.0, 0.0, 0.0, [1] * 90, 1)
    assert straight["rack"].ball["x"] == 0.0
    assert bent["rack"].ball["x"] > 5 and bent["rack"].ball["spin"] <= 1e-9


# ----- 게임 진행 -----
def test_options_and_same_conditions_for_everyone():
    game = make(3)
    opt = game.client_options()
    assert opt["frames"] == DEFAULT_CONFIG["FRAMES"] == 5 and len(opt["golds"]) == 5
    assert [len(g) for g in opt["golds"]] == [1, 1, 1, 1, 3]
    assert all(-1 <= g <= 9 for row in opt["golds"] for g in row)
    assert {st["gold"] for st in game.P.values()} == {opt["golds"][0][0]}
    states = [(to, d) for to, kind, d in game.drain() if kind == "state"]
    assert sorted(to for to, _ in states) == ["p1", "p2", "p3"]
    assert all(d["phase"] == "intro" and d["me"]["n"] == 0 and set(d["players"]) == {"p1", "p2", "p3"} for _, d in states)


def test_throw_is_judged_by_server_and_reported_only_to_thrower():
    game = make(2)
    game.tick(T0 + 1.0)
    throw(game, "p1", T0 + 1.0)                       # 시작 안내 중에는 받지 않는다
    assert game.P["p1"]["n"] == 0
    t = game.start_at + 1.0
    game.tick(t)
    game.drain()
    throw(game, "p1", t, x=2.0, angle=0.004, power=0.8, spin=[0] * 20)
    rolls = events(game, "roll")
    assert len(rolls) == 1
    ev = rolls[0]
    expect = rules.simulate_throw(CFG, [1] * 10, game.golds[0][0], 2.0, 0.004, 0.8, [0] * 20, rules.throw_seed(game.seed, 0))
    assert ev["knocked"] == expect["knocked"] and ev["up"] == expect["up"] and ev["rolls"] == [expect["knocked"]]
    assert ev["n"] == 0 and not ev["auto"] and game.P["p1"]["n"] == 1 and game.P["p2"]["n"] == 0
    # 다음 차례는 연출(남은 굴러가기 + 결과 표시 + 스위퍼)이 끝난 뒤에 열린다
    assert ev["aimAt"] > t + 1.0 and ev["deadline"] == pytest.approx(ev["aimAt"] + 10.0)
    # 같은 번호의 투구를 또 보내거나, 연출이 끝나기 전에 보내면 무시한다
    game.on_input("p1", {"k": "throw", "n": 0, "x": 0, "angle": 0, "power": 1, "spin": []}, t + 0.1)
    throw(game, "p1", t + 0.2)
    assert game.P["p1"]["n"] == 1 and not events(game, "roll")


def test_roll_event_goes_only_to_the_thrower():
    game = make(2)
    t = game.start_at + 0.5
    game.tick(t)
    game.drain()
    throw(game, "p2", t)
    out = [(to, d) for to, kind, d in game.drain() if kind == "event" and d["type"] == "roll"]
    assert [to for to, _ in out] == ["p2"]


def test_bad_input_is_ignored_or_clamped():
    game = make(2)
    t = game.start_at + 0.5
    game.tick(t)
    for bad in (None, {}, {"k": "x"}, {"k": "throw", "n": 0, "x": "a", "angle": 0, "power": 1, "spin": []},
                {"k": "throw", "n": 0, "x": 0, "angle": float("nan"), "power": 1, "spin": []},
                {"k": "throw", "n": 0, "x": 0, "angle": 0, "power": 1, "spin": "LLL"},
                {"k": "throw", "n": 3, "x": 0, "angle": 0, "power": 1, "spin": []}):
        game.on_input("p1", bad, t)
    game.on_input("zz", {"k": "throw", "n": 0, "x": 0, "angle": 0, "power": 1, "spin": []}, t)
    assert game.P["p1"]["n"] == 0
    game.drain()
    game.on_input("p1", {"k": "throw", "n": 0, "x": 999, "angle": -9, "power": 7, "spin": [5, "a", True, -1]}, t)
    ev = events(game, "roll")[0]
    assert (ev["x"], ev["angle"], ev["power"], ev["spin"]) == (17, -0.2, 1.0, [0, 0, 0, -1])


def test_time_limit_makes_server_throw():
    game = make(2)
    st = game.P["p1"]
    game.tick(st["deadline"] + 1.0)                   # 제한 시간 + 여유(1.5초) 전에는 기다린다
    assert st["n"] == 0
    game.drain()
    game.tick(st["deadline"] + 1.6)
    autos = events(game, "roll")
    assert len(autos) == 2 and all(e["auto"] and e["spin"] == [] for e in autos)
    assert st["n"] == 1 and abs(autos[0]["angle"]) <= 0.2 and 0 <= autos[0]["power"] <= 1
    # 아무도 안 쳐도 끝까지 진행된다
    t, _ = play_out(game, None, step=0.1, limit=400)
    assert game.finished and len(game.results) == 2


def test_disconnected_player_does_not_stall():
    game = make(2)
    game.on_connection("p2", False, T0)
    t, _ = play_out(game, lambda pid, n: (0.0, 0.0, 0.8), limit=200)
    assert game.finished
    game2 = make(2)
    game2.on_connection("p2", False, T0)
    t = game2.start_at + game2.R["AWAY_LIMIT"] + 0.1
    game2.tick(t)
    assert game2.P["p2"]["n"] == 1 and game2.P["p1"]["n"] == 0     # 끊긴 사람만 바로 대신 던진다
    game2.on_connection("p2", True, t)
    assert not game2.P["p2"]["away"]


@pytest.mark.parametrize("n,seed", [(2, 3), (3, 4), (5, 5)])
def test_full_game_results(n, seed):
    game = make(n, seed)
    pick = random.Random(seed)
    t, seen = play_out(game, lambda pid, k: (round(pick.uniform(-6, 6), 2), round(pick.uniform(-0.05, 0.05), 4), 0.85))
    assert game.finished and t - T0 < 180
    res = game.results
    assert len(res) == n and res[0]["rank"] == 1 and res[0]["isWinner"]
    for i, r in enumerate(res):
        assert set(r) == {"playerId", "name", "score", "rank", "isWinner", "stats"}
        st = r["stats"]
        assert rules.frame_state(st["rolls"], 5)["done"]
        assert r["score"] == rules.score_frames(st["rolls"], 5)[-1]["cum"] + st["bonus"] == st["bowling"] + st["bonus"]
        assert st["bonus"] % 3 == 0 and r["isWinner"] == (r["rank"] == 1)
        if i:
            prev = res[i - 1]
            assert (prev["score"], prev["stats"]["strikes"], prev["stats"]["spares"]) >= (r["score"], st["strikes"], st["spares"])
            assert prev["rank"] <= r["rank"]
    # 최종 결과 화면(final)을 몇 초 유지한 뒤 끝난다
    finals = [d for _to, kind, d in seen if kind == "state" and d["phase"] == "final"]
    assert finals and finals[0]["results"] == res and finals[-1]["now"] - finals[0]["now"] >= 7.5
    assert not any(d["type"] == "verdict" for _to, kind, d in seen if kind == "event")     # Gemini 꺼짐


def test_ranking_tiebreak_strikes_then_spares():
    game = make(3)
    game.P["p1"].update(rolls=[9, 0, 9, 0, 9, 0, 9, 0, 9, 0], strikes=0, spares=0)              # 45
    game.P["p2"].update(rolls=[10, 0, 0, 5, 5, 0, 0, 9, 0], strikes=1, spares=1, bonus=16)    # 10+0+10+0+9 = 29, 잭팟 +16 가정
    game.P["p3"].update(rolls=[9, 0, 9, 0, 9, 0, 9, 0, 9, 0], strikes=0, spares=0)
    res = game.build_results()
    assert [r["playerId"] for r in res] == ["p2", "p1", "p3"]
    assert [r["score"] for r in res] == [45, 45, 45]
    assert [r["rank"] for r in res] == [1, 2, 2] and [r["isWinner"] for r in res] == [True, False, False]


def test_strike_streak_spare_jackpot_bookkeeping(monkeypatch):
    """핀 물리 결과를 정해 놓고 프레임 진행 · 핀 다시 세우기 · 기록을 확인한다."""
    game = make(2)
    game.golds = [[2], [-1], [-1], [-1], [4, -1, 9]]
    game.P["p1"]["gold"] = 2
    script = iter([
        ([0] * 10, False),                                  # 1프레임 스트라이크 + 잭팟 핀
        ([0] * 10, False),                                  # 2프레임 스트라이크 (더블)
        ([0, 0, 0, 0, 0, 0, 1, 0, 0, 1], False),            # 3프레임 7-10 스플릿
        ([0] * 10, False),                                  # 스페어
        ([1] * 10, True),                                   # 4프레임 거터
        ([1, 1, 1, 0, 0, 0, 0, 0, 0, 0], False),
        ([0] * 10, False),                                  # 5프레임 스트라이크 (잭팟 핀 4번)
        ([0] * 10, False),                                  # 보너스 스트라이크
        ([0] * 10, False),                                  # 보너스 스트라이크 (잭팟 핀 9번)
    ])

    def fake(cfg, up, gold, x, angle, power, spin, seed):
        after, gutter = next(script)
        after = [a and b for a, b in zip(after, up)]
        return {"frames": 80, "up": after, "knocked": sum(up) - sum(after), "gutter": gutter,
                "goldHit": bool(gold >= 0 and up[gold] and not after[gold]), "rack": None}

    monkeypatch.setattr(rules, "simulate_throw", fake)
    t = game.start_at
    game.tick(t)
    game.drain()
    got = []
    for _ in range(9):
        t = game.P["p1"]["aimAt"] + 0.1
        throw(game, "p1", t)
        got.append(events(game, "roll")[0])
    assert [e["kind"] for e in got] == ["strike", "strike", "split", "spare", "gutter", None, "strike", "strike", "strike"]
    assert [e["streak"] for e in got] == [1, 2, 0, 0, 0, 0, 1, 2, 3]
    assert [e["jackpot"] for e in got] == [True, False, False, False, False, False, True, False, True]
    assert [e["next"] and e["next"]["reset"] for e in got] == [True, True, False, True, False, True, True, True, None]
    assert got[2]["next"]["up"] == [0, 0, 0, 0, 0, 0, 1, 0, 0, 1]
    assert got[5]["next"]["gold"] == 4 and got[6]["next"]["gold"] == -1 and got[7]["next"]["gold"] == 9
    assert got[-1]["done"] and got[-1]["rolls"] == [10, 10, 8, 2, 0, 7, 10, 10, 10]
    st = game.P["p1"]
    assert (st["strikes"], st["spares"], st["gutters"], st["splits"], st["bonus"], st["bestStreak"]) == (5, 1, 1, 1, 9, 3)
    assert game.total("p1") == 28 + 20 + 10 + 7 + 30 + 9
    # 화면 연출 길이만큼 기다린 뒤에야 다음 투구를 받는다 (스트라이크 연출 100 + 스위퍼 54 프레임)
    assert got[0]["aimAt"] == pytest.approx(game.start_at + 0.1 + (80 + 100 + 54) / 60)


# ----- AI 해설 · 총평 -----
def test_say_events_use_canned_lines_without_gemini():
    game = make(2)
    assert set(SAY_KINDS) == set(SAY_CANNED) and all(len(v) >= 2 for v in SAY_CANNED.values()) and 6 <= len(SAY_KINDS) <= 10
    _, seen = play_out(game, lambda pid, n: (2.2, 0.0, 0.9))
    says = [d for _to, kind, d in seen if kind == "event" and d["type"] == "say"]
    assert says and says[0]["kind"] == "start"
    assert all(s["source"] == "canned" and s["who"] == "해설자" and s["text"] for s in says)
    assert "last" in {s["kind"] for s in says}
    # 너무 자주 말하지 않는다 (최소 간격 3초)
    times = [d["now"] for _to, kind, d in seen if kind == "state"]
    assert len(says) <= (times[-1] - T0) / 3.0 + 1


def test_say_min_gap_and_delay():
    game = make(2)
    game.tick(T0 + 0.6)
    assert [e["kind"] for e in events(game, "say")] == ["start"]
    game._queue_say("strike", "가", T0 + 1.0)
    game._queue_say("last", "", T0 + 1.0, ttl=5.0)
    game.tick(T0 + 1.1)
    assert not events(game, "say")                      # 간격 3초 안
    game.tick(T0 + 3.7)
    assert [e["kind"] for e in events(game, "say")] == ["last"]    # 오래 밀린 것은 버리고, 기다릴 수 있는 것만 말한다


class FakeGemini:
    """tests/test_caster.py 와 같은 가짜 Gemini."""

    def __init__(self):
        self.calls = []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append(prompt)
        if "경기 결과" in prompt:
            return {"headline": "핀이 춤춘 명승부", "mvp": "스트라이크 장인", "cheer": "다음엔 터키 가자"}
        return {kind: [f"AI {kind} {{name}}"] for kind in SAY_KINDS}


def test_gemini_lines_and_verdict():
    fake = FakeGemini()
    game = make(2, services={"gemini": fake})
    for _ in range(300):
        if game.book.ready:
            break
        time.sleep(0.01)
    t = T0
    seen = []
    while not game.finished and t < T0 + 300:
        t += 0.05
        if game.phase == "play":
            for pid, st in game.P.items():
                if not st["done"] and t >= st["aimAt"]:
                    throw(game, pid, t, 2.2, 0.0, 0.9)
        if game.phase == "final":
            time.sleep(0.002)                           # 총평 스레드가 끝날 틈
        game.tick(t)
        seen += [d for _to, kind, d in game.drain() if kind in ("event", "state")]
    says = [d for d in seen if d.get("type") == "say"]
    assert says and all(s["source"] == "gemini" and s["text"].startswith("AI ") for s in says)
    verdicts = [d for d in seen if d.get("type") == "verdict"]
    assert verdicts == [{"type": "verdict", "headline": "핀이 춤춘 명승부", "mvp": "스트라이크 장인", "cheer": "다음엔 터키 가자"}]
    assert game.state_for("p1", t)["verdict"]["headline"] == "핀이 춤춘 명승부"     # 다시 접속한 사람도 본다
    assert len(fake.calls) == 2                          # 대사 묶음 1번 + 총평 1번


def test_reconnect_state_has_my_lane():
    game = make(2)
    t = game.start_at + 0.5
    game.tick(t)
    throw(game, "p1", t, 2.0, 0.0, 0.8)
    snap = game.state_for("p1", t + 0.1)
    me = snap["me"]
    assert me["n"] == 1 and me["up"] == game.P["p1"]["up"] and me["aimAt"] == game.P["p1"]["aimAt"]
    assert snap["players"]["p1"]["rolls"] == game.P["p1"]["rolls"] and snap["players"]["p2"]["rolls"] == []
    assert "me" not in game.state_for("nobody", t)


# ----- 브라우저 쪽 계산(JS)과 같은지 -----
def node(args, text=""):
    out = subprocess.run([NODE, "tests/bowling-sim.mjs", *args], cwd=WEB, input=text.encode("utf-8"), capture_output=True, check=True)
    return json.loads(out.stdout.decode("utf-8"))


@pytest.mark.skipif(NODE is None, reason="node 가 없음")
def test_config_matches_js():
    assert node(["--config"]) == DEFAULT_CONFIG


@pytest.mark.skipif(NODE is None, reason="node 가 없음")
def test_pin_physics_matches_js_exactly():
    """같은 투구를 Python 과 JS 로 굴려 핀 · 공의 마지막 상태가 숫자 하나까지 같은지 본다."""
    rnd = random.Random(2024)
    throws = []
    for i in range(300):
        up = [1] * 10 if i % 3 else [rnd.randint(0, 1) for _ in range(10)]
        throws.append({
            "up": up, "gold": rnd.randint(-1, 9), "x": round(rnd.uniform(-17, 17), 2), "angle": round(rnd.uniform(-0.2, 0.2), 4),
            "power": round(rnd.random(), 3), "spin": [rnd.choice([-1, 0, 0, 1]) for _ in range(rnd.randint(0, 60))],
            "seed": rnd.randrange(2 ** 32),
        })
    js = node(["--rack"], json.dumps(throws))
    hits = 0
    for t, j in zip(throws, js):
        res = rules.simulate_throw(CFG, **t)
        rack = res["rack"]
        py = {
            "frames": res["frames"], "up": res["up"], "knocked": res["knocked"], "gutter": res["gutter"], "goldHit": res["goldHit"],
            "pins": [[p["x"], p["y"], p["vx"], p["vy"], int(p["up"]), int(p["gone"]), p["fall"]] for p in rack.pins],
            "ball": [rack.ball[k] for k in ("x", "y", "vx", "vy", "spin")],
        }
        assert py == j, t
        hits += res["knocked"] > 0
    assert hits > 100       # 비교가 의미 있도록: 핀이 맞은 투구가 충분히 많다
