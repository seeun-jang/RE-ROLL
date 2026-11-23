"""잭팟 탁구왕: 경기 규칙(서브 · 득점 · 듀스), 리그전 진행, 입력 처리, AI 해설, JS 진행기와의 비교."""

from __future__ import annotations

import copy
import json
import random
import shutil
import subprocess
import time
from itertools import combinations
from pathlib import Path

import pytest

from party.games.pingpong.config import DEFAULT_CONFIG, merge_config
from party.games.pingpong.game import SAY_CANNED, SAY_KINDS, PingpongGame, make_schedule
from party.games.pingpong.rules import NO_INPUT, Duel

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
SIM_TOOL = WEB_DIR / "tests" / "pingpong-sim.mjs"
# 장면 시간을 줄여 빨리 돌린다
FAST = {"FLOW": {"INTRO_TIME": 0.2, "END_HOLD": 0.2, "RESULT_TIME": 0.2, "FINAL_TIME": 0.5}}
HIT = {"fwd": False, "back": False, "hit": True, "hitPressed": True}


def players(n):
    return [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]


def new_duel(seed=1, **over):
    return Duel(merge_config(over), {"id": "p1", "name": "가"}, {"id": "p2", "name": "나"}, random.Random(seed).random)


def run(game, now, seconds, inputs=None, dt=1 / 30):
    """inputs(i) → [(playerId, data)]. 일어난 사건을 모아 돌려준다."""
    events = []
    for i in range(1, int(seconds / dt) + 1):
        t = now + i * dt
        for pid, data in (inputs(i) if inputs else []):
            game.on_input(pid, data, t)
        game.tick(t)
        events += [d for _to, kind, d in game.drain() if kind == "event"]
        if game.finished:
            break
    return events


# ----- 대진표 -----
@pytest.mark.parametrize("n", [3, 4, 5])
def test_schedule_everyone_meets_everyone_once(n):
    ids = [f"p{i + 1}" for i in range(n)]
    plan = make_schedule(ids, random.Random(3).random, 1)
    seen = []
    for rnd in plan:
        busy = [x for m in rnd["matches"] for x in m]
        assert len(busy) == len(set(busy))
        assert sorted(busy + rnd["resting"]) == sorted(ids)
        assert len(rnd["resting"]) == n % 2
        seen += [frozenset(m) for m in rnd["matches"]]
    assert sorted(map(sorted, seen)) == sorted(map(list, combinations(ids, 2)))


def test_schedule_two_players_one_match():
    plan = make_schedule(["p1", "p2"], random.Random(1).random, 1)
    assert len(plan) == 1 and len(plan[0]["matches"]) == 1


# ----- 한 경기의 규칙 -----
def step_until(duel, kind, limit=3000, left=NO_INPUT, right=NO_INPUT):
    seen = []
    for _ in range(limit):
        duel.step(left, right)
        evs = duel.pop_events()
        seen += evs
        for e in evs:
            if e["type"] == kind:
                return e, seen
    raise AssertionError(f"{kind} 사건이 일어나지 않음: {[e['type'] for e in seen]}")


def test_auto_serve_bounces_own_court_then_opponent_and_server_scores():
    d = new_duel()
    server = d.server.side
    point, seen = step_until(d, "point")
    kinds = [e["type"] for e in seen]
    assert kinds[:3] == ["serve", "toss", "hit"]                   # 4초 뒤 자동 서브
    bounces = [e["side"] for e in seen if e["type"] == "bounce"]
    assert bounces[:2] == [server, 1 - server]                     # 내 코트 → 상대 코트
    assert point["side"] == server and point["reason"] in ("missed", "unreturned")
    assert d.frame >= d.cfg["MATCH_INTRO"] + d.cfg["AUTO_SERVE"]


def test_tap_serves_immediately_and_receiver_can_return():
    d = new_duel(seed=4)
    step_until(d, "serve")
    server, receiver = d.server, d.fighters[1 - d.server.side]
    ins = [dict(NO_INPUT), dict(NO_INPUT)]
    ins[server.side] = HIT
    d.step(*ins)                                                   # 톡 → 다음 프레임에 떼면 토스
    d.step(NO_INPUT, NO_INPUT)
    assert d.ball.state == "toss" and d.state == "serve"
    step_until(d, "hit")
    # 받는 쪽: 어느 프레임에 휘둘러야 맞는지 찾아본다(복사본으로 시험)
    returned = None
    for wait in range(0, 90):
        trial = copy.deepcopy(d)
        tap = [dict(NO_INPUT), dict(NO_INPUT)]
        tap[receiver.side] = HIT
        events = []
        for i in range(wait + 30):
            trial.step(*(tap if i == wait else (NO_INPUT, NO_INPUT)))
            events += trial.pop_events()
        hits = [e for e in events if e["type"] == "hit" and e["side"] == receiver.side]
        if hits:
            returned = (trial, hits[0])
            break
    assert returned, "받는 쪽이 어떤 타이밍에도 공을 못 침"
    trial, hit = returned
    assert hit["shot"] == "drive" and hit["rally"] == 2 and 0 <= hit["q"] <= 1
    assert trial.ball.last_hitter == receiver.side


@pytest.mark.parametrize("held,frames,expect", [
    ({"fwd": False, "back": False}, 25, "smash"), ({"fwd": True, "back": False}, 3, "drop"),
    ({"fwd": False, "back": True}, 3, "lob"), ({"fwd": False, "back": False}, 3, "drive"),
])
def test_hold_makes_smash_and_direction_makes_drop_and_lob(held, frames, expect):
    d = new_duel()
    step_until(d, "hit")                       # 자동 서브가 나간 뒤(랠리 중)
    while d.hitstop > 0:
        d.step(NO_INPUT, NO_INPUT)
    p = d.fighters[1 - d.server.side]          # 받는 쪽 선수로 시험
    swing = None
    for i in range(frames + 3):
        ins = [dict(NO_INPUT), dict(NO_INPUT)]
        ins[p.side] = {**held, "hit": i < frames, "hitPressed": False}
        d.step(*ins)
        swing = swing or next((e for e in d.pop_events() if e["type"] == "swing" and e["side"] == p.side), None)
    assert swing and swing["shot"] == expect


def test_deuce_and_cap_rules():
    d = new_duel()
    for side in (0, 0):
        d.state = "rally"
        d.point_to(side, "net")
    assert d.match_point_side == 0 and not d.is_deuce
    for side in (1, 1):
        d.state = "rally"
        d.point_to(side, "net")
    assert d.is_deuce and d.match_point_side is None            # 2:2 듀스
    d.point_to(0, "net")
    assert d.winner is None and d.match_point_side == 0         # 3:2 — 아직 2점 차가 아님
    d.point_to(0, "net")
    assert d.winner is d.left and d.state == "end"              # 4:2

    d = new_duel()
    d.left.pts, d.right.pts, d.state = 5, 5, "rally"
    d.point_to(1, "smash")
    assert d.winner is d.right                                   # 6점이면 무조건 승리

    d = new_duel()
    d.left.pts, d.state = 2, "rally"
    d.point_to(0, "out")
    assert d.winner is d.left                                    # 3:0


def test_serve_alternates_every_two_points_and_every_point_in_deuce():
    d = new_duel()
    first = d.server.side
    servers = []
    while d.state != "end":
        ev, _seen = step_until(d, "serve")
        servers.append(ev["side"])
        step_until(d, "point")
    # 아무도 안 치면 서브한 쪽이 계속 득점: 2점씩 번갈아 → 2:2 듀스부터는 1점마다
    assert servers[:8] == [first, first, 1 - first, 1 - first, first, 1 - first, first, 1 - first]
    assert max(d.left.pts, d.right.pts) == DEFAULT_CONFIG["DEUCE_CAP"]


def test_time_limit_ends_match_at_next_point():
    d = new_duel(FLOW={**DEFAULT_CONFIG["FLOW"], "MATCH_LIMIT": 1.0})
    step_until(d, "end")
    assert sorted([d.left.pts, d.right.pts]) == [0, 1]


# ----- 게임 진행 -----
@pytest.mark.parametrize("n", [2, 3, 5])
def test_full_game_with_idle_players_finishes_with_common_results(n):
    game = PingpongGame(players(n), {"config": FAST}, random.Random(n).random)
    game.start(50.0)
    first = [d for _to, kind, d in game.drain() if kind == "state"]
    assert first and first[0]["phase"] == "intro"
    events = run(game, 50.0, 1200)
    assert game.finished
    res = game.results
    assert len(res) == n
    assert {tuple(sorted(r)) for r in res} == {("isWinner", "name", "playerId", "rank", "score", "stats")}
    assert [r["score"] for r in res] == sorted((r["score"] for r in res), reverse=True)
    assert all(r["isWinner"] == (r["rank"] == 1) for r in res) and res[0]["rank"] == 1
    matches = 1 if n == 2 else n * (n - 1) // 2
    assert sum(r["stats"]["wins"] for r in res) == matches
    assert all(r["stats"]["matches"] == (1 if n == 2 else n - 1) for r in res)
    # 순위는 이긴 횟수 → 득실차 순
    keys = [(r["stats"]["wins"], r["stats"]["scored"] - r["stats"]["conceded"]) for r in res]
    assert keys == sorted(keys, reverse=True)
    says = [e for e in events if e["type"] == "say"]
    assert says and all(e["source"] == "canned" and e["who"] == "해설자" and e["text"] for e in says)
    assert {"start", "win"} <= {e["kind"] for e in says}
    assert not [e for e in events if e["type"] == "verdict"]         # Gemini 가 꺼져 있으면 총평은 보내지 않는다


def test_wins_come_before_point_difference():
    game = PingpongGame(players(3), {"config": FAST}, random.Random(2).random)
    game.standings["p1"].update(wins=1, losses=1, scored=6, conceded=3, matches=2)
    game.standings["p2"].update(wins=2, losses=0, scored=8, conceded=7, matches=2)
    game.standings["p3"].update(wins=1, losses=1, scored=5, conceded=5, matches=2)
    res = game._build_results()
    assert [r["playerId"] for r in res] == ["p2", "p1", "p3"]
    game.standings["p3"].update(scored=8, conceded=5)
    assert [r["rank"] for r in game._build_results()] == [1, 2, 2]   # 승수와 득실차가 같으면 공동 순위


def test_resting_player_garbage_input_and_reconnect_state():
    game = PingpongGame(players(3), {"config": FAST}, random.Random(9).random)
    game.start(10.0)
    game.drain()
    snap = game.state_for("p1", 10.0)
    rest = snap["resting"][0]
    assert snap["phase"] == "intro" and len(snap["matches"]) == 1 and snap["rounds"] == 3

    def inputs(i):
        return [
            (rest, {"k": "in", "held": 7, "press": ["hit"]}),       # 쉬는 사람의 입력
            ("nobody", {"k": "in", "held": 7, "press": ["hit"]}),   # 없는 사람
            (rest, "이상한 값"), (rest, {"k": "???"}), (rest, {"k": "in", "held": "x", "press": 3}),
        ]

    events = run(game, 10.0, 3.0, inputs)
    assert not [e for e in events if e["type"] in ("swing", "toss")]
    snap = game.state_for(rest, 13.0)
    duel = snap["duels"][0]
    assert snap["phase"] == "fight" and snap["simFrame"] > 0
    assert set(duel) >= {"frame", "state", "pts", "server", "ball", "left", "right", "rally", "winner"}
    assert set(duel["ball"]) >= {"x", "y", "vx", "vy", "state", "ticks"}


def test_player_input_serves_and_disconnect_releases_keys():
    game = PingpongGame(players(2), {"config": FAST}, random.Random(3).random)
    game.start(0.0)
    run(game, 0.0, 0.2 + 1.6)                                       # 대진 안내 + 경기 안내(90프레임)
    d = game.duels[0]
    assert d.state == "serve"
    server = d.server.player_id
    game.on_input(server, {"k": "in", "held": 4, "press": ["hit"]}, 1.85)
    game.on_input(server, {"k": "in", "held": 0}, 1.9)
    events = run(game, 1.9, 0.5)
    assert [e for e in events if e["type"] == "toss"]               # 4초를 기다리지 않고 바로 서브
    game.on_input(server, {"k": "in", "held": 6}, 2.5)
    assert game.held[server] == 6
    game.on_connection(server, False, 2.6)
    assert game.held[server] == 0


# ----- AI -----
class FakeGemini:
    def __init__(self, data):
        self.data, self.calls = data, []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append({"prompt": prompt, "schema": schema, "system": system})
        if schema and "headline" in schema.get("properties", {}):
            return {"headline": "명승부였다", "mvp": "최고의 스매시", "cheer": "다음엔 이긴다"}
        return self.data


def test_canned_lines_cover_every_kind():
    assert set(SAY_KINDS) == set(SAY_CANNED)
    assert all(len(lines) >= 2 for lines in SAY_CANNED.values())


def test_gemini_lines_and_verdict_are_used():
    fake = FakeGemini({kind: [f"AI {kind} {{name}}"] for kind in SAY_KINDS})
    game = PingpongGame(players(2), {"config": FAST}, random.Random(5).random)
    game.services = {"gemini": fake}
    game.start(0.0)
    for _ in range(200):
        if game.book.ready:
            break
        time.sleep(0.01)
    events = []
    t = 0.0
    while game.phase != "final" and t < 600:
        events += run(game, t, 1.0)
        t += 1.0
    says = [e for e in events if e["type"] == "say"]
    assert says and all(e["source"] == "gemini" and e["text"].startswith("AI ") for e in says)
    win = [e for e in says if e["kind"] == "win"][0]
    assert win["text"].split()[-1] in ("N1", "N2")                  # {name} 자리에 이긴 선수 이름
    for _ in range(200):
        if game.verdict is not None or game.verdict_job is None or game.verdict_job.done():
            break
        time.sleep(0.01)
    events += run(game, t, 0.2)
    verdict = [e for e in events if e["type"] == "verdict"]
    assert verdict == [{"type": "verdict", "headline": "명승부였다", "mvp": "최고의 스매시", "cheer": "다음엔 이긴다"}]
    assert game.state_for("p1", t + 0.2)["verdict"]["headline"] == "명승부였다"   # 재접속한 사람도 본다
    assert len(fake.calls) == 2                                      # 대사 묶음 1번 + 총평 1번
    run(game, t + 0.2, 2.0)
    assert game.finished


# ----- JS 진행기(web/src/games/pingpong/sim)와 같은 입력에 같은 결과를 내는지 -----
def close(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), f"{path}: 키가 다름 {set(a) ^ set(b)}"
        for k in a:
            close(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        assert len(a) == len(b), f"{path}: 길이가 다름 {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            close(x, y, f"{path}[{i}]")
    elif isinstance(a, bool) or isinstance(b, bool) or a is None or b is None or isinstance(a, str):
        assert a == b, f"{path}: {a!r} != {b!r}"
    else:
        assert abs(a - b) <= 2e-3, f"{path}: {a!r} != {b!r}"


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")
@pytest.mark.parametrize("n,seed", [(2, 21), (3, 22), (5, 23)])
def test_python_and_js_sim_agree(n, seed):
    proc = subprocess.run(
        ["node", str(SIM_TOOL), "--trace", str(n), str(seed)],
        capture_output=True, text=True, encoding="utf-8", cwd=str(WEB_DIR), timeout=180,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    js = json.loads(proc.stdout)
    values = js["rng"]
    idx = {"i": 0}

    def rng():
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    game = PingpongGame(js["players"], {"config": js["config"]}, rng)
    events, states = [], []
    for op in js["ops"]:
        if op[0] == "start":
            game.start(op[1])
        elif op[0] == "tick":
            game.tick(op[1])
        else:
            game.on_input(op[1], op[2], op[3])
        for _to, kind, data in game.drain():
            if kind == "event":
                events.append({"type": "say", "kind": data["kind"], "match": data["match"]} if data["type"] == "say" else data)
            elif data["phase"] != "fight" or data["simFrame"] % 20 == 0:
                states.append(data)
    assert js["finished"] and game.finished
    # 봇끼리 실제로 공을 주고받았는지(비교가 의미 있도록)
    assert max(e.get("rally", 0) for e in events if e["type"] == "hit") >= 3
    close(events, js["events"], "events")
    close(states, js["states"], "states")
    close(game.results, js["results"], "results")
