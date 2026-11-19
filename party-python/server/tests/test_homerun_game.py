"""잭팟 홈런 더비 서버 판정 테스트 (가짜 시계로 start / tick / on_input / drain)."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from party.games.homerun.baseball import flight_frames, hit_points, make_hit, make_pitches, plate_scale
from party.games.homerun.config import DEFAULT_CONFIG, merge_config
from party.games.homerun.game import SAY_CANNED, SAY_KINDS, HomerunGame

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
SIM_TOOL = WEB_DIR / "tests" / "homerun-sim.mjs"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")

T0 = 100.0
F = 1 / 60
CFG = merge_config(None)


def players(n):
    return [{"id": f"p{i + 1}", "name": f"선수{i + 1}", "index": i} for i in range(n)]


def make(n=2, seed=7, services=None):
    game = HomerunGame(players(n), {"seed": seed}, random.Random(seed).random)
    if services is not None:
        game.services = services
    game.start(T0)
    game.drain()
    return game


class Clock:
    """가짜 시계: 1/30초씩 tick 하면서 나온 메시지를 모은다."""

    def __init__(self, game):
        self.game, self.t, self.out = game, T0, []

    def to(self, t):
        while self.t < t - 1e-9:
            self.t = min(t, self.t + 1 / 30)
            self.game.tick(self.t)
            self.out += self.game.drain()

    def until(self, cond, limit=600.0):
        end = self.t + limit
        while not cond() and self.t < end:
            self.to(self.t + 1 / 30)
        assert cond()

    def events(self, kind=None, to=None):
        return [d for who, k, d in self.out if k == "event" and (kind is None or d["type"] == kind) and (to is None or who == to)]


def swing(game, clock, pid, frame, x):
    """공이 떠난 뒤 frame 번째 프레임에 배트 위치 x 로 스윙."""
    t = game.release_at + frame * F
    clock.to(t)
    game.on_input(pid, {"k": "swing", "t": t, "x": x}, clock.t)
    clock.out += game.drain()


def perfect(game):
    """지금 공을 정타로 치는 (프레임, 배트 위치)."""
    pt = game.pitches[game.idx]
    return pt["frames"] - CFG["SWING_CONTACT"], pt["tx"] * plate_scale(CFG)


def next_pitch(game, clock):
    idx = game.idx
    clock.until(lambda: game.idx != idx or game.phase != "play")


# ---------------------------------------------------------------- 규칙
def test_pitches_are_same_for_same_seed():
    a, b = make_pitches(1234, CFG), make_pitches(1234, CFG)
    assert a == b and a != make_pitches(1235, CFG)
    for seed in range(40):
        ps = make_pitches(seed, CFG)
        strikes = [p for p in ps if not p["ball"]]
        assert len(strikes) == CFG["CHANCES"] and not ps[-1]["ball"] and not ps[0]["ball"]
        assert [p["gold"] for p in strikes].index(True) == CFG["GOLD_AT"] and sum(p["gold"] for p in ps) == 1
        for p in ps:
            inside = abs(p["tx"]) <= CFG["ZONE"]["HALF_W"] and CFG["ZONE"]["LOW"] <= p["ty"] <= CFG["ZONE"]["HIGH"]
            assert inside != p["ball"]


def test_hit_rules():
    pt = {"kmh": 150, "gold": False}
    hr = make_hit(pt, 0, 0, CFG)                     # 정타: 가운데 방향 26도 → 홈런
    assert hr["result"] == "hr" and hit_points(hr, CFG) == round(hr["dist"]) and 100 < hr["dist"] < 160
    gold = make_hit({"kmh": 150, "gold": True}, 0, 0, CFG)
    assert hit_points(gold, CFG) == 2 * hit_points(hr, CFG)
    assert make_hit(pt, -11, 0, CFG)["result"] == "foul"            # 너무 일찍 → 왼쪽 파울
    ground = make_hit(pt, 0, -10, CFG)                              # 배트가 공 왼쪽 → 땅볼
    assert ground["ground"] and ground["result"] in ("ground", "single")
    assert make_hit(pt, 0, 13, CFG)["result"] == "pop"              # 배트가 공 오른쪽 → 높이 뜬 공
    for dt in range(-11, 7):
        for dx in range(-14, 15):
            h = make_hit(pt, dt, dx, CFG)
            shown, total = flight_frames(h, CFG)
            assert h["result"] and total == shown + CFG["RESULT_TIME"] and 60 < total < 600
            assert hit_points(h, CFG) >= 0


# ---------------------------------------------------------------- 진행
def test_flow_and_scoring():
    game = make(2)
    c = Clock(game)
    assert game.phase == "intro"
    c.to(T0 + CFG["FLOW"]["INTRO_TIME"] + 0.05)
    assert game.phase == "play" and game.idx == 0
    assert abs(game.release_at - (T0 + CFG["FLOW"]["INTRO_TIME"] + CFG["WINDUP"] * F)) < 1e-9
    # p1 은 정타, p2 는 가만히 있는다
    f, x = perfect(game)
    swing(game, c, "p1", f, x)
    contact = c.events("contact", "p1")[0]
    assert contact["hit"]["result"] == "hr" and contact["dt"] == 0 and abs(contact["dx"]) < 1e-9
    assert abs(contact["at"] - (game.release_at + game.pitches[0]["frames"] * F)) < 1e-9
    assert not c.events("contact", "p2")
    # 판정이 끝날 때까지는 점수가 오르지 않는다(타구 연출이 끝나야 반영)
    c.until(lambda: game.judged)
    assert game.P["p1"]["total"] == 0
    calls = {to: d for to, k, d in c.out if k == "event" and d["type"] == "call"}
    assert calls["p1"]["result"] == "hr" and calls["p1"]["pts"] == contact["pts"] and calls["p1"]["chances"] == 7
    assert calls["p2"]["result"] == "strike" and calls["p2"]["total"] == 0 and calls["p2"]["chances"] == 7
    # 다음 공은 p1 의 타구 연출이 끝난 뒤에 던진다
    _, total = flight_frames(contact["hit"], CFG)
    assert game.next_at >= contact["at"] + total * F
    next_pitch(game, c)
    assert game.idx == 1 and game.windup_at == pytest.approx(c.t, abs=0.05)
    assert game.P["p1"]["total"] == contact["pts"] and game.P["p1"]["hr"] == 1
    assert game.P["p1"]["longest"] == round(contact["hit"]["dist"]) and game.P["p2"]["total"] == 0
    assert game.P["p1"]["chances"] == 7 and game.P["p2"]["chances"] == 7
    assert game.snapshot(c.t)["players"]["p1"]["last"] == "hr"


def test_miss_ball_and_chances():
    seed = next(s for s in range(100) if any(p["ball"] for p in make_pitches(s, CFG)))
    game = make(2, seed=seed)
    c = Clock(game)
    c.until(lambda: game.phase == "play")
    ball_idx = next(p["id"] for p in game.pitches if p["ball"])
    while game.idx < ball_idx:
        # p1: 배트를 엉뚱한 곳에 두고 스윙 → 헛스윙
        pt = game.pitches[game.idx]
        swing(game, c, "p1", pt["frames"] - 6, 34 if pt["tx"] < 0 else -34)
        assert c.events("whiff", "p1")[-1]["idx"] == game.idx
        next_pitch(game, c)
    used = ball_idx
    assert game.P["p1"]["chances"] == 8 - used and game.P["p2"]["chances"] == 8 - used
    assert all(e["result"] == "miss" for e in game.P["p1"]["log"])
    assert all(e["result"] == "strike" for e in game.P["p2"]["log"])
    # 볼: p1 은 스윙(기회를 쓴다), p2 는 골라낸다(기회 그대로)
    pt = game.pitches[game.idx]
    swing(game, c, "p1", pt["frames"] - 6, 34 if pt["tx"] < 0 else -34)
    next_pitch(game, c)
    assert game.P["p1"]["log"][-1]["result"] == "miss" and game.P["p1"]["chances"] == 8 - used - 1
    assert game.P["p2"]["log"][-1]["result"] == "ball" and game.P["p2"]["chances"] == 8 - used
    # 끝까지: p1 은 계속 스윙 → 기회가 먼저 바닥나 마지막 공은 못 친다
    while game.phase == "play":
        pt = game.pitches[game.idx]
        before = len(c.events("whiff", "p1")) + len(c.events("contact", "p1"))
        swing(game, c, "p1", pt["frames"] - 6, 34 if pt["tx"] < 0 else -34)
        after = len(c.events("whiff", "p1")) + len(c.events("contact", "p1"))
        assert (after > before) == (game.P["p1"]["chances"] > 0)
        next_pitch(game, c)
    assert game.P["p1"]["chances"] == 0 and len([e for e in game.P["p1"]["log"] if e["result"] != "ball"]) == 8
    assert game.P["p2"]["chances"] == 0


def test_swing_time_is_clamped_and_bad_input_ignored():
    game = make(2)
    c = Clock(game)
    c.until(lambda: game.phase == "play")
    # 와인드업 중의 스윙 · 이상한 입력은 무시
    game.on_input("p1", {"k": "swing", "t": c.t, "x": 0}, c.t)
    game.on_input("p1", {"k": "nope"}, c.t)
    game.on_input("p1", "swing", c.t)
    game.on_input("zz", {"k": "swing", "t": c.t, "x": 0}, c.t)
    assert game.P["p1"]["cur"] is None
    # 0.2초 늦게 도착한 스윙: 누른 시각 그대로 판정 / 배트 위치는 범위로 자른다
    f, x = perfect(game)
    t = game.release_at + f * F
    c.to(t + 0.2)
    game.on_input("p1", {"k": "swing", "t": t, "x": x}, c.t)
    assert game.P["p1"]["cur"]["f"] == f and game.P["p1"]["cur"]["hit"]["result"] == "hr"
    # 한 공에 스윙은 한 번
    game.on_input("p1", {"k": "swing", "t": t, "x": 0}, c.t)
    assert game.P["p1"]["cur"]["x"] == x
    # 0.35초보다 더 옛날 시각을 보내면 (지금 − 0.35초) 로 당겨진다 / x 는 ±34 로
    game.on_input("p2", {"k": "swing", "t": t - 5, "x": 999, "extra": [1]}, c.t)
    cur = game.P["p2"]["cur"]
    assert cur["x"] == 34 and cur["f"] == max(1, round((c.t - 0.35 - game.release_at) / F))
    # 공이 미트에 들어간 뒤의 스윙은 무시
    next_pitch(game, c)
    c.to(game.mitt_at + 0.01)
    game.on_input("p1", {"k": "swing", "t": c.t, "x": 0}, c.t)
    assert game.P["p1"]["cur"] is None


@pytest.mark.parametrize("n", [2, 3, 5])
def test_full_game_results(n):
    game = make(n, seed=40 + n)
    c = Clock(game)
    r = random.Random(n)
    skill = {f"p{i + 1}": i for i in range(n)}       # p1 이 가장 잘 친다. 마지막 사람은 접속이 끊긴 것처럼 입력이 없다.
    c.until(lambda: game.phase == "play")
    while game.phase == "play":
        f, x = perfect(game)
        for pid, s in skill.items():
            if s == n - 1 or game.pitches[game.idx]["ball"]:
                continue
            swing(game, c, pid, f + (r.randint(-s, s) if s else 0), x + (r.uniform(-4, 4) * s))
        next_pitch(game, c)
    assert game.phase == "final" and not game.finished
    snap = game.snapshot(c.t)
    assert snap["results"] == game.final_results and snap["verdict"] is None
    c.to(c.t + CFG["FLOW"]["FINAL_TIME"] + 0.1)
    assert game.finished
    res = game.results
    assert [set(x) for x in res] == [{"playerId", "name", "score", "rank", "isWinner", "stats"}] * n
    assert [x["score"] for x in res] == sorted((x["score"] for x in res), reverse=True)
    assert res[0]["rank"] == 1 and res[0]["isWinner"] and res[0]["playerId"] == "p1"
    assert res[-1]["playerId"] == f"p{n}" and res[-1]["score"] == 0
    assert [x for x in res[-1]["stats"]["log"] if x != "ball"] == ["strike"] * 8
    assert res[0]["stats"]["homeRuns"] == 8 and res[0]["stats"]["longest"] >= 100
    assert res[0]["score"] > 900          # 홈런 8개(비거리 합) + 잭팟 볼 2배
    assert not c.events("verdict")        # Gemini 가 없으면 총평을 보내지 않는다
    assert 60 < c.t - T0 < 180            # 한 판은 1~3분


def test_ranking_tie_break():
    game = make(3)
    game.P["p1"].update(total=100, hr=1, longest=100)
    game.P["p2"].update(total=100, hr=0, longest=0)
    game.P["p3"].update(total=100, hr=1, longest=100)
    res = game.build_results()
    assert [(x["playerId"], x["rank"], x["isWinner"]) for x in res] == [("p1", 1, True), ("p3", 1, True), ("p2", 3, False)]


def test_reconnect_state():
    game = make(2)
    c = Clock(game)
    c.until(lambda: game.phase == "play")
    f, x = perfect(game)
    swing(game, c, "p1", f, x)
    st = game.state_for("p1", c.t)
    assert st["phase"] == "play" and st["me"]["cur"]["hit"]["result"] == "hr" and st["me"]["cur"]["idx"] == 0
    assert game.state_for("p2", c.t)["me"]["cur"] is None
    json.dumps(st)                        # JSON 으로 보낼 수 있어야 한다
    json.dumps(game.client_options())


# ---------------------------------------------------------------- AI
def test_commentary_without_gemini_is_canned_and_spaced():
    assert set(SAY_KINDS) == set(SAY_CANNED) and all(len(v) >= 2 for v in SAY_CANNED.values())
    game = make(2)
    c = Clock(game)
    c.until(lambda: game.phase == "play")
    while game.phase == "play":
        f, x = perfect(game)
        if not game.pitches[game.idx]["ball"]:
            swing(game, c, "p1", f, x)
        next_pitch(game, c)
    says = [(c_t, to, d) for (to, k, d), c_t in zip(c.out, range(len(c.out))) if k == "event" and d["type"] == "say"]
    assert says and all(d["source"] == "canned" and d["who"] == "해설자" and d["text"] for _, _, d in says)
    kinds = {d["kind"] for _, _, d in says}
    assert {"hr", "last", "lead"} <= kinds or {"monster", "last", "lead"} <= kinds
    assert "{" not in "".join(d["text"] for _, _, d in says)


def test_say_gap():
    game = make(2)
    game._says += [{"at": 0, "to": "p1", "kind": "hr", "name": "가"}, {"at": 0, "to": "p1", "kind": "hit", "name": "가"},
                   {"at": 0, "to": "p2", "kind": "hr", "name": "나"}]
    game._flush_says(200.0)
    assert [to for to, _, d in game.drain() if d.get("type") == "say"] == ["p1", "p2"]
    game._says.append({"at": 0, "to": "p1", "kind": "hr", "name": "가"})
    game._flush_says(202.0)                      # 3초가 안 지났다
    assert not game.drain()
    game._says.append({"at": 0, "to": None, "kind": "lead", "name": "가"})
    game._flush_says(203.5)
    assert [to for to, _, d in game.drain()] == [None]


class FakeGemini:
    """tests/test_caster.py 와 같은 가짜 Gemini: 대사 묶음과 총평을 돌려준다."""

    def __init__(self):
        self.calls = []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append(prompt)
        if "headline" in (schema or {}).get("properties", {}):
            return {"headline": "담장이 남아나질 않았다", "mvp": "선수1 방망이가 뜨거웠다", "cheer": "선수2 다음엔 넘긴다"}
        return {kind: [f"AI {kind} {{name}}"] for kind in SAY_KINDS}


def test_gemini_lines_and_verdict():
    fake = FakeGemini()
    game = make(2, services={"gemini": fake})
    for _ in range(200):
        if game.book.ready:
            break
        time.sleep(0.01)
    c = Clock(game)
    c.until(lambda: game.phase == "play")
    while game.phase == "play":
        f, x = perfect(game)
        if not game.pitches[game.idx]["ball"]:
            swing(game, c, "p1", f, x)
        next_pitch(game, c)
    says = c.events("say")
    assert says and all(d["source"] == "gemini" and d["text"].startswith("AI ") for d in says)
    assert any("선수1" in d["text"] for d in says)
    # 최종 결과 화면 동안 총평이 도착하면 사건 + 상태로 보낸다
    for _ in range(200):
        if game._verdict_job is None or game._verdict_job.done():
            break
        time.sleep(0.01)
    c.to(c.t + 0.2)
    verdicts = c.events("verdict")
    assert len(verdicts) == 1 and verdicts[0]["headline"] == "담장이 남아나질 않았다"
    assert game.snapshot(c.t)["verdict"]["mvp"] == "선수1 방망이가 뜨거웠다"
    assert game.state_for("p2", c.t)["verdict"] is not None
    assert len(fake.calls) == 2           # 대사 묶음 1번 + 총평 1번
    c.to(c.t + CFG["FLOW"]["FINAL_TIME"])
    assert game.finished


# ---------------------------------------------------------------- 브라우저 쪽(JS)과 비교
def node(args, stdin=None):
    proc = subprocess.run(["node", str(SIM_TOOL), *args], input=stdin, capture_output=True, text=True,
                          encoding="utf-8", cwd=str(WEB_DIR), timeout=180)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout)


@needs_node
def test_config_is_the_same_on_both_sides():
    assert node(["--config"]) == DEFAULT_CONFIG


@needs_node
@pytest.mark.parametrize("n,seed", [(2, 3), (5, 9)])
def test_js_sim_gives_same_results(n, seed):
    """같은 조작을 Python 서버 판정과 JS 시험용 진행기에 넣으면 같은 사건 · 같은 결과가 나와야 한다."""
    r = random.Random(seed)
    rng = [r.random() for _ in range(97)]
    ps = players(n)
    pitches = make_pitches(int(rng[0] * 1e9), CFG)
    ops: list = [["start", T0]]
    game = HomerunGame(ps, {}, lambda it=iter(rng * 50): next(it))
    game.start(T0)
    game.drain()
    c = Clock(game)

    def tick_to(t):
        while c.t < t - 1e-9:
            c.t = min(t, c.t + 1 / 30)
            ops.append(["tick", c.t])
            game.tick(c.t)
            c.out += game.drain()

    assert game.pitches == pitches
    tick_to(T0 + CFG["FLOW"]["INTRO_TIME"] + 0.05)
    while game.phase == "play":
        idx = game.idx
        pt = game.pitches[idx]
        plans = sorted((game.release_at + r.randint(pt["frames"] - 18, pt["frames"] + 3) * F,
                        p["id"], pt["tx"] * plate_scale(CFG) + r.uniform(-16, 16)) for p in ps if r.random() < 0.85)
        for t, pid, x in plans:
            tick_to(t)
            data = {"k": "swing", "t": t - r.choice([0, 0, 0.1, 0.5]), "x": x}
            ops.append(["input", pid, data, c.t])
            game.on_input(pid, data, c.t)
            c.out += game.drain()
        while game.idx == idx and game.phase == "play":
            tick_to(c.t + 1 / 30)
    tick_to(c.t + CFG["FLOW"]["FINAL_TIME"] + 0.2)
    assert game.finished
    js = node(["--replay"], json.dumps({"players": ps, "rng": rng, "ops": ops}))
    assert js["finished"] and js["options"]["pitches"] == pitches
    mine = [[to, d] for to, k, d in c.out if k == "event" and d["type"] != "say"]
    assert len(js["events"]) == len(mine)
    for (jto, jd), (pto, pd) in zip(js["events"], mine):
        assert jto == pto and jd["type"] == pd["type"]
        _close(jd, pd)
    _close(js["results"], game.results)


def _close(a, b, path=""):
    """숫자는 아주 작은 오차까지 같다고 본다(삼각함수 계산 차이)."""
    if isinstance(b, dict):
        assert isinstance(a, dict) and set(a) == set(b), path
        for k in b:
            _close(a[k], b[k], f"{path}.{k}")
    elif isinstance(b, list):
        assert isinstance(a, list) and len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b)):
            _close(x, y, f"{path}[{i}]")
    elif isinstance(b, float) or isinstance(a, float):
        assert a == pytest.approx(b, rel=1e-9, abs=1e-9), path
    else:
        assert a == b, path
