"""잭팟 그루브 서버 판정 테스트 (가짜 시계로 start/tick/on_input/drain)."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from party.games import GAMES
from party.games.groove.chart import build_chart, chart_judge_count
from party.games.groove.config import DEFAULT_CONFIG
from party.games.groove.game import SAY_CANNED, SAY_KINDS, GrooveGame
from party.games.groove.songs import SONG_ORDER, SONGS, expand_song

T0 = 100.0
STEP = 1 / 30
SIM = Path(__file__).resolve().parents[2] / "web" / "tests" / "groove-sim.mjs"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")


def players(n):
    return [{"id": f"p{i + 1}", "name": f"선수{i + 1}", "index": i} for i in range(n)]


def make(n=2, seed=1, services=None, **options):
    game = GrooveGame(players(n), options, random.Random(seed).random)
    if services is not None:
        game.services = services
    game.start(T0)
    return game


def at(game, gt):
    """곡 시간 gt 에 해당하는 서버 시각."""
    return game.start_at + gt


def key(game, pid, lane, down, t, lag=0.0):
    """곡 시간 t 에 누른(뗀) 입력이 lag 초 뒤 서버에 도착한다."""
    game.on_input(pid, {"k": "key", "lane": lane, "down": down, "t": t}, at(game, t + lag))


def run(game, plans=None, until=None):
    """게임을 끝까지(또는 곡 시간 until 까지) 돌린다.

    plans: {pid: 함수(note) → 누르는 시각 오차(초) 또는 None(안 누름)}. 롱노트는 끝까지 누른다.
    돌려주는 값: 그동안 나온 (대상, 종류, 내용) 목록.
    """
    plans = plans or {}
    todo = {}
    for pid, plan in plans.items():
        evs = []
        for n in game.chart:
            off = plan(n)
            if off is None:
                continue
            evs.append((n["time"] + off, n["lane"], True))
            evs.append(((n["endTime"] if n["endTime"] is not None else n["time"] + off + 0.03), n["lane"], False))
        todo[pid] = sorted(evs, key=lambda e: e[0])
    out = []
    gt = getattr(game, "_test_gt", -game.lead - game.F["INTRO_TIME"])
    guard = 0
    while not game.finished and (until is None or gt < until):
        gt += STEP
        for pid, evs in todo.items():
            while evs and evs[0][0] <= gt:
                t, lane, down = evs.pop(0)
                game.on_input(pid, {"k": "key", "lane": lane, "down": down, "t": t}, at(game, gt))
        game.tick(at(game, gt))
        out += game.drain()
        guard += 1
        assert guard < 30 * 200, "한 판이 200초 안에 끝나야 한다"
    game._test_gt = gt
    return out


def events(out, kind=None):
    return [d for _, k, d in out if k == "event" and (kind is None or d["type"] == kind)]


class FakeGemini:
    """tests/test_caster.py 와 같은 방식의 가짜 Gemini"""

    def __init__(self, lines=None, verdict=None):
        self.lines, self.verdict, self.calls = lines, verdict, []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append(prompt)
        return self.verdict if "경기 결과" in prompt else self.lines


# ----------------------------------------------------------------------
def test_registered_and_song_choice():
    assert GAMES["groove"] is GrooveGame
    assert make(song="neon", difficulty="hard").client_options()["song"] == "neon"
    seen = {make(seed=s).song_id for s in range(30)}
    assert seen == set(SONG_ORDER)                      # 판마다 무작위로 고른다
    assert make(seed=3).song_id == make(seed=3).song_id  # 같은 난수면 같은 곡
    assert make(difficulty="???").difficulty == "normal"


def test_chart_matches_original_readme_counts():
    counts = [len(build_chart(SONGS["groove"], d)) for d in ("easy", "normal", "hard")]
    assert counts == [102, 183, 254]
    for sid in SONG_ORDER:
        ex = expand_song(SONGS[sid])
        assert 60 < ex["duration"] < 72
        for d in ("easy", "normal", "hard"):
            chart = build_chart(SONGS[sid], d)
            assert chart == build_chart(SONGS[sid], d)
            assert [n["id"] for n in chart] == list(range(len(chart)))
            assert all(n["lane"] in (0, 1, 2) and 0 <= n["time"] < ex["duration"] for n in chart)
            assert all(a["time"] <= b["time"] for a, b in zip(chart, chart[1:]))
            assert chart_judge_count(chart) >= len(chart)


def test_phases_and_timing():
    game = make(song="moon")
    assert game.phase == "intro" and game.start_at == pytest.approx(T0 + 5.0 + game.ex["barSec"] + 0.3)
    run(game, until=-game.lead + 0.1)
    assert game.phase == "play"
    run(game, until=game.last_time + 0.5 + 0.35 - 0.1)
    assert game.phase == "play"
    run(game, until=game.last_time + 0.5 + 0.35 + 0.1)
    assert game.phase == "outro" and len(game.final_results) == 2
    run(game, until=game.last_time + 0.95 + 170 / 60 + 0.1)
    assert game.phase == "final" and not game.finished
    run(game)
    assert game.finished and game.phase == "done"


def test_perfect_play_is_one_million_and_no_input_is_zero():
    game = make(song="groove")
    out = run(game, {"p1": lambda n: 0.0})
    a, b = game.results
    assert (a["playerId"], a["score"], a["rank"], a["isWinner"]) == ("p1", 1000000, 1, True)
    assert a["stats"]["grade"] == "S" and a["stats"]["fullCombo"] and a["stats"]["allPerfect"]
    assert a["stats"]["maxCombo"] == a["stats"]["perfect"] == game.P["p1"].total
    # 입력이 없는 사람(연결이 끊긴 사람)은 전부 MISS, 게임은 끝까지 간다
    assert (b["score"], b["rank"], b["isWinner"], b["stats"]["grade"]) == (0, 2, False, "D")
    assert b["stats"]["miss"] == game.P["p2"].total
    assert set(a) == {"playerId", "name", "score", "rank", "isWinner", "stats"}
    fin = events(out, "finish")
    assert {e["playerId"] for e in fin} == {"p1", "p2"}


def test_judge_windows():
    game = make(song="groove", difficulty="easy")
    run(game, until=-0.5)
    taps = [n for n in game.chart if n["endTime"] is None][:5]
    p = game.P["p1"]
    for n, off, want in zip(taps, (0.04, -0.08, 0.13, 0.2, -0.2), ("perfect", "great", "good", None, None)):
        run(game, until=n["time"] - 0.3)
        before = dict(p.counts)
        key(game, "p1", n["lane"], True, n["time"] + off, lag=0.01)
        key(game, "p1", n["lane"], False, n["time"] + off + 0.02, lag=0.01)
        got = [k for k in before if p.counts[k] != before[k]]
        if want:
            assert got == [want]
        else:
            # 범위 밖(너무 이르면 헛침, 너무 늦으면 이미 지나가 MISS)
            assert got in ([], ["miss"])
    run(game, until=taps[-1]["time"] + 1.0)
    assert p.counts["perfect"] == 1 and p.counts["great"] == 1 and p.counts["good"] == 1
    assert p.counts["miss"] >= 2 and p.combo == 0 and p.max_combo == 3


def test_hold_note_tail():
    game = make(song="groove", difficulty="normal")
    holds = [n for n in game.chart if n["endTime"] is not None and n["endTime"] - n["time"] > 0.4][:3]
    p = game.P["p1"]
    note = lambda h: p.notes[h["id"]]       # noqa: E731
    # ① 일찍 떼면 꼬리 MISS
    h = holds[0]
    run(game, until=h["time"] - 0.2)
    key(game, "p1", h["lane"], True, h["time"])
    key(game, "p1", h["lane"], False, h["time"] + 0.1)
    assert (note(h)["head"], note(h)["tail"]) == ("perfect", "miss") and p.combo == 0
    # ② 끝나기 0.12초 전부터는 떼도 성공
    h = holds[1]
    run(game, until=h["time"] - 0.2)
    key(game, "p1", h["lane"], True, h["time"])
    run(game, until=h["endTime"] - 0.1)
    key(game, "p1", h["lane"], False, h["endTime"] - 0.1)
    assert (note(h)["head"], note(h)["tail"]) == ("perfect", "perfect")
    # ③ 계속 누르고 있으면 끝에서 자동으로 성공
    h = holds[2]
    run(game, until=h["time"] - 0.2)
    key(game, "p1", h["lane"], True, h["time"])
    assert game.state_for("p1", at(game, h["time"]))["me"]["hold"][h["lane"]] == h["id"]
    run(game, until=h["endTime"] + 0.5)
    assert note(h)["tail"] == "perfect" and p.hold_note[h["lane"]] is None


def test_lag_compensation_up_to_035s():
    game = make(song="groove", difficulty="easy")
    a, b = [n for n in game.chart if n["endTime"] is None][:2]
    # 0.3초 늦게 도착해도 누른 시각 그대로 판정 (서버는 그동안 MISS 처리를 미루고 있다)
    run(game, until=a["time"] + 0.3)
    assert game.P["p1"].judged == 0
    game.on_input("p1", {"k": "key", "lane": a["lane"], "down": True, "t": a["time"]}, at(game, a["time"] + 0.3))
    assert game.P["p1"].counts["perfect"] == 1
    # 0.35초보다 더 옛날 시각이라고 우기면 (지금 − 0.35초)로 당겨 판정한다 → 범위 밖
    run(game, until=b["time"] + 0.6)
    game.on_input("p2", {"k": "key", "lane": b["lane"], "down": True, "t": b["time"]}, at(game, b["time"] + 0.6))
    assert game.P["p2"].counts["perfect"] == 0
    # 미래 시각도 안 된다
    c = next(n for n in game.chart if n["time"] > b["time"] + 2)
    game.on_input("p2", {"k": "key", "lane": c["lane"], "down": True, "t": c["time"]}, at(game, b["time"] + 0.7))
    assert game.P["p2"].counts["perfect"] == 0


def test_bad_input_is_ignored():
    game = make(song="groove")
    n = game.chart[0]
    game.on_input("p1", {"k": "key", "lane": n["lane"], "down": True, "t": 0.0}, T0)      # 아직 소개 화면
    run(game, until=n["time"])
    now = at(game, n["time"])
    for bad in (None, "x", {}, {"k": "key"}, {"k": "key", "lane": 3, "down": True, "t": 0.0},
                {"k": "key", "lane": True, "down": True, "t": 0.0}, {"k": "key", "lane": 0, "down": 1, "t": 0.0},
                {"k": "key", "lane": n["lane"], "down": True, "t": float("nan")},
                {"k": "key", "lane": n["lane"], "down": True, "t": "0"}, {"k": "cut", "lane": 0}):
        game.on_input("p1", bad, now)
    game.on_input("zz", {"k": "key", "lane": n["lane"], "down": True, "t": n["time"]}, now)
    assert game.P["p1"].judged == 0 and game.P["p2"].judged == 0


def test_ranking_tie_breaks_follow_original():
    game = make(n=3, song="groove")
    P = game.P
    for pid in ("p1", "p2", "p3"):
        P[pid].counts.update(perfect=100, great=0, good=0, miss=0)
        P[pid].judged, P[pid].max_combo = 100, 50
    assert [r["rank"] for r in game.build_results()] == [1, 1, 1]
    assert all(r["isWinner"] for r in game.build_results())
    # 점수가 같아도 최대 콤보 → PERFECT 수로 가른다: p1 은 (90P·10G·콤보 70), p2 는 (91P·4G·콤보 55) → 둘 다 같은 점수
    P["p1"].counts.update(perfect=90, great=10, good=0, miss=0)
    P["p1"].max_combo = 70
    P["p2"].counts.update(perfect=91, great=4, good=0, miss=5)
    P["p2"].max_combo = 55
    P["p3"].counts.update(perfect=10, great=0, good=0, miss=90)
    if P["p1"].score == P["p2"].score:
        rows = game.build_results()
        assert [(r["playerId"], r["rank"]) for r in rows[:2]] == [("p1", 1), ("p2", 2)]
    rows = game.build_results()
    assert rows[-1]["playerId"] == "p3" and rows[-1]["rank"] == 3 and not rows[-1]["isWinner"]


@pytest.mark.parametrize("n", [2, 3, 5])
def test_full_game_with_2_3_5_players(n):
    game = make(n=n, seed=n)
    rnd = random.Random(n)
    skills = {f"p{i + 1}": 0.02 + 0.03 * i for i in range(n)}        # 뒤 번호일수록 박자가 더 흔들린다

    def plan(pid):
        return lambda note: None if rnd.random() < skills[pid] else rnd.uniform(-1, 1) * skills[pid] * 1.5
    out = run(game, {pid: plan(pid) for pid in skills})
    rows = game.results
    assert game.finished and len(rows) == n
    assert [r["rank"] for r in rows] == sorted(r["rank"] for r in rows) and rows[0]["rank"] == 1
    assert all(rows[i]["score"] >= rows[i + 1]["score"] for i in range(n - 1))
    for r in rows:
        s = r["stats"]
        assert 0 < r["score"] <= 1000000 and s["grade"] in "SABCD"
        assert s["perfect"] + s["great"] + s["good"] + s["miss"] == game.P[r["playerId"]].total
        assert s["song"] == game.song_id and s["difficulty"] == "normal"
    states = [d for _, k, d in out if k == "state"]
    assert states[-1]["phase"] == "done" and states[-1]["results"] == rows
    assert set(states[0]["players"]) == {f"p{i + 1}" for i in range(n)}
    json.dumps(out)                                   # 모든 메시지는 JSON 으로 보낼 수 있어야 한다
    # 해설: Gemini 없이도 기본 대사가 나오고, 3초보다 자주 말하지 않는다
    says = events(out, "say")
    assert says and all(s["source"] == "canned" and s["who"] == "꽥대장" and s["text"] for s in says)
    assert says[0]["kind"] == "start" and says[-1]["kind"] in ("finish", "finish_s")
    assert not events(out, "verdict") and states[-1]["verdict"] is None


def test_commentary_kinds_and_gap():
    assert set(SAY_KINDS) == set(SAY_CANNED) and all(len(v) >= 2 for v in SAY_CANNED.values())
    game = make(song="groove")
    # p1 은 완벽하게 치다가 중간에 한 번 놓친다 → 50콤보 · 100콤보 · 풀콤보 페이스 · 콤보 끊김
    miss_id = next(n["id"] for n in game.chart if n["time"] > 45)
    plans = {"p1": lambda n: None if n["id"] == miss_id else 0.0, "p2": lambda n: 0.05 if n["id"] % 2 else None}
    out = run(game, plans)
    kinds = [s["kind"] for s in events(out, "say")]
    assert {"start", "jackpot", "combo50", "combo100", "pace", "break", "final"} <= set(kinds)
    assert kinds[-1] == "finish_s"                    # p1 은 한 번 놓쳐도 S
    assert any(e["playerId"] == "p1" and e["n"] == 50 for e in events(out, "combo"))
    assert any(e["playerId"] == "p1" for e in events(out, "break"))
    # 말한 시각 간격(상태의 say 가 바뀐 시각으로 잰다)
    last, changes = None, []
    for _, k, d in out:
        if k == "state" and d["say"] and d["say"] != last:
            last = d["say"]
            changes.append(d["now"])
    assert all(b - a >= 3.0 - 0.2 for a, b in zip(changes, changes[1:-1]))


def test_lead_change_event():
    game = make(song="groove")
    later = game.chart[40]
    out = run(game, {"p1": lambda n: 0.0 if n["id"] < 20 else None, "p2": lambda n: 0.0 if n["id"] >= 10 else None},
              until=later["time"] + 5)
    lead = events(out, "lead")
    assert lead and lead[-1]["playerId"] == "p2" and game.snapshot(0)["leader"] == "p2"
    assert any(s["kind"] == "lead" and "선수2" in s["text"] for s in events(out, "say"))


def test_fake_gemini_lines_and_verdict():
    lines = {k: [f"AI {k} {{name}}"] for k in SAY_KINDS}
    fake = FakeGemini(lines, {"headline": "뜨거운 무대였다", "mvp": "선수1 최고!", "cheer": "선수2 다음엔 꼭"})
    game = make(services={"gemini": fake}, song="moon")
    for _ in range(200):
        if game.book.ready:
            break
        time.sleep(0.01)
    out = run(game, {"p1": lambda n: 0.0}, until=game.last_time + 1.0)
    says = events(out, "say")
    assert says and all(s["source"] == "gemini" for s in says)
    assert says[0]["text"] == "AI start"
    assert game.phase == "outro"
    for _ in range(200):
        if game._verdict_job is None or game._verdict_job.done():
            break
        time.sleep(0.01)
    out = run(game)
    verdict = events(out, "verdict")
    assert verdict == [{"type": "verdict", "headline": "뜨거운 무대였다", "mvp": "선수1 최고!", "cheer": "선수2 다음엔 꼭"}]
    assert game.state_for("p2", 0)["verdict"]["headline"] == "뜨거운 무대였다"   # 재접속한 사람도 본다
    assert len(fake.calls) == 2


def test_reconnect_state():
    game = make(song="groove")
    run(game, {"p1": lambda n: 0.0}, until=20.0)
    snap = game.state_for("p1", at(game, 20.0))
    me = snap["me"]
    assert snap["phase"] == "play" and snap["startAt"] == game.start_at
    assert me["judged"] == game.P["p1"].judged > 0 and me["combo"] == me["maxCombo"] > 0
    assert me["ptr"] == game.P["p1"].ptr and len(me["hold"]) == 3
    assert snap["players"]["p1"]["score"] == game.P["p1"].score
    assert "me" not in game.snapshot(0)
    json.dumps(snap)


# ----------------------------------------------------------------------
# 브라우저 쪽(JS)과 같은지
def node(args, stdin=None):
    proc = subprocess.run(["node", str(SIM), *args], input=stdin, capture_output=True, text=True,
                          encoding="utf-8", timeout=120)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


@needs_node
def test_config_matches_browser():
    js = node(["--config"])
    for k, v in js.items():
        assert DEFAULT_CONFIG[k] == pytest.approx(v) if not isinstance(v, (dict, list)) else True
        if isinstance(v, dict):
            for kk, vv in v.items():
                assert DEFAULT_CONFIG[k][kk] == (pytest.approx(vv) if isinstance(vv, float) else vv), (k, kk)
        elif isinstance(v, list):
            assert DEFAULT_CONFIG[k] == v


@needs_node
def test_charts_are_identical_to_browser():
    js = node(["--charts"])
    for sid in SONG_ORDER:
        ex = expand_song(SONGS[sid])
        assert (js[sid]["duration"], js[sid]["barSec"], js[sid]["bars"]) == (ex["duration"], ex["barSec"], len(ex["bars"]))
        for d in ("easy", "normal", "hard"):
            chart = build_chart(SONGS[sid], d)
            mine = [[n["id"], n["time"], n["lane"], n["endTime"], n["step"]] for n in chart]
            assert mine == js[sid][d]["notes"], (sid, d)          # 시각까지 한 치도 다르지 않아야 한다
            assert chart_judge_count(chart) == js[sid][d]["total"]


@needs_node
def test_same_inputs_give_same_scores_in_browser_sim():
    rnd = random.Random(7)
    pl = players(3)
    options = {"song": "neon", "difficulty": "hard"}
    game = GrooveGame(pl, options, lambda: 0.0)
    ops = [["start", T0]]
    game.start(T0)
    todo = []
    for pid, sk in (("p1", 0.03), ("p2", 0.08), ("p3", 0.14)):
        for n in game.chart:
            if rnd.random() < sk:
                continue
            t = n["time"] + rnd.uniform(-1, 1) * sk
            end = n["endTime"] if n["endTime"] is not None and rnd.random() > sk else t + 0.04
            todo.append((t, rnd.uniform(0.0, 0.3), pid, n["lane"], True))
            todo.append((end, rnd.uniform(0.0, 0.3), pid, n["lane"], False))
    # 도착 순서: 한 사람의 입력은 보낸 순서대로 도착한다
    arrive = {}
    queue = []
    for t, lag, pid, lane, down in sorted(todo):
        when = max(t + lag, arrive.get(pid, -99))
        arrive[pid] = when
        queue.append((when, pid, {"k": "key", "lane": lane, "down": down, "t": t}))
    queue.sort(key=lambda q: q[0])
    trace = []
    gt = -game.lead - 5.0
    while not game.finished:
        gt += STEP
        while queue and queue[0][0] <= gt:
            when, pid, data = queue.pop(0)
            now = at(game, when)
            ops.append(["input", pid, data, now])
            game.on_input(pid, data, now)
        ops.append(["tick", at(game, gt)])
        game.tick(at(game, gt))
        trace += [[d["phase"], d["players"]] for _, k, d in game.drain() if k == "state"]
    js = node(["--replay"], json.dumps({"players": pl, "options": options, "ops": ops}))
    assert js["finished"] and js["options"] == game.client_options()
    assert js["trace"] == trace
    assert js["results"] == game.results
    assert js["reconnect"] == game.state_for("p1", 0)["me"]
    assert len({r["score"] for r in game.results}) == 3
