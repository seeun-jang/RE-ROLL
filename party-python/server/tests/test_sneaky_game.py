"""교수님 몰래 댄스!: 춤 점수, 걸림 · 유예 · 복도행, 피버, 순위, AI 수업 계획(가짜 Gemini), 대사 · 총평."""

from __future__ import annotations

import random
import time

import pytest

from party.games.sneaky.config import DEFAULT_CONFIG
from party.games.sneaky.game import SneakyGame
from party.games.sneaky.teacher import Teacher, clean_plan, plan_bounds, plan_request

FAST = {"FLOW": {"INTRO_TIME": 0.5, "END_HOLD": 0.3, "FINAL_TIME": 0.4}}
T0 = 0.5      # 수업이 시작되는 시각
FPS = 60


class FakeGemini:
    """요청의 응답 모양(schema)을 보고 수업 계획 · 총평 · 대사 중 맞는 것을 돌려준다."""

    def __init__(self, plan=None, lines=None, verdict=None, error=None):
        self.plan, self.lines, self.verdict, self.error, self.calls = plan, lines, verdict, error, []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        props = (schema or {}).get("properties", {})
        kind = "plan" if "steps" in props else "verdict" if "headline" in props else "lines"
        self.calls.append({"kind": kind, "prompt": prompt, "schema": schema, "system": system})
        if self.error:
            raise self.error
        return {"plan": self.plan, "verdict": self.verdict, "lines": self.lines}[kind]


def make(n=3, gemini=None, config=None, seed=1, wait_ai=True):
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]
    g = SneakyGame(players, {"config": {**FAST, **(config or {})}}, random.Random(seed).random)
    g.services = {"gemini": gemini} if gemini is not None else {}
    g.start(0.0)
    if gemini is not None and wait_ai:          # 가짜 Gemini 의 답(스레드)이 올 때까지 잠깐 기다린다
        for _ in range(300):
            if g.book.ready and (g._plan_job is None or g._plan_job.done()):
                break
            time.sleep(0.01)
    g.drain()
    return g


def run_to(g, t, step=1 / 30):
    """가짜 시계로 t 까지 돌리고 그동안의 사건을 돌려준다."""
    events = []
    now = getattr(g, "_now", 0.0)
    while now < t - 1e-9:
        now = min(t, now + step)
        g.tick(now)
        events += [d for _to, kind, d in g.drain() if kind == "event"]
    g._now = t
    return events


def hold(g, pid, at, big=False, small=False):
    g.on_input(pid, {"k": "in", "big": big, "small": small}, at)


def run_until_state(g, state, limit=20.0):
    """교수님이 state 가 될 때까지 한 프레임씩 진행한다."""
    now = getattr(g, "_now", 0.0)
    events = []
    while g.teacher.state != state:
        now += 1 / FPS
        assert now < limit, f"{state} 가 오지 않음"
        g.tick(now)
        events += [d for _to, kind, d in g.drain() if kind == "event"]
    g._now = now
    return events


def test_registered_and_options():
    from party.games import GAMES
    assert GAMES["sneaky"] is SneakyGame
    g = make()
    opt = g.client_options()
    assert opt["config"]["CLASS_TIME"] == 3600 and opt["config"]["FEVER"] == [1, 1.5, 2, 3]


def test_dance_scores_small_and_big_and_big_takes_time_to_stop():
    g = make()
    hold(g, "p1", 0.1, small=True)                 # 수업 시작 전에 누르고 있으면 시작과 함께 춤춘다
    hold(g, "p2", 0.1, big=True)
    run_to(g, 0.4)
    assert g.by_id["p1"]["score"] == 0             # 안내 중에는 점수 없음
    run_to(g, T0 + 1.0)
    assert g.by_id["p1"]["score"] == pytest.approx(6, abs=0.2)     # 작은 춤 초당 6점
    assert g.by_id["p2"]["score"] == pytest.approx(15, abs=0.5)    # 큰 춤 초당 15점
    assert g.by_id["p3"]["score"] == 0
    hold(g, "p1", T0 + 1.0)
    hold(g, "p2", T0 + 1.0)
    run_to(g, T0 + 1.0 + 4 / FPS)
    assert g.by_id["p1"]["mode"] == "none"         # 작은 춤은 바로 멈춘다
    assert g.by_id["p2"]["mode"] == "recover"      # 큰 춤은 앉기까지 14프레임
    run_to(g, T0 + 1.0 + 20 / FPS)
    assert g.by_id["p2"]["mode"] == "none"


def test_caught_when_dancing_while_watched_but_not_within_grace():
    g = make(n=3)
    hold(g, "p1", 0.1, small=True)                 # p1 은 계속 춘다 → 걸림
    hold(g, "p2", 0.1, small=True)                 # p2 는 교수님이 돌아선 직후(유예 안)에 멈춘다 → 안 걸림
    run_until_state(g, "look")
    assert g.teacher.watch_t <= g.cfg["GRACE"]     # 아직 유예 중 — 아무도 안 걸렸다
    assert g.by_id["p1"]["strikes"] == 0
    hold(g, "p2", g._now)
    before = g.by_id["p1"]["score"]
    ev = run_to(g, g._now + 0.5)
    caught = [e for e in ev if e["type"] == "caught"]
    assert len(caught) == 1 and caught[0]["ids"] == ["p1"]
    p1 = g.by_id["p1"]
    assert p1["strikes"] == 1 and p1["punish"] > 0 and p1["fever"] == 0
    assert p1["score"] == pytest.approx(max(0, before - 20), abs=1.5)
    assert g.by_id["p2"]["strikes"] == 0
    says = [e for e in ev if e["type"] == "say"]
    assert says and says[0]["kind"] == "caught_one" and "N1" in says[0]["text"] and says[0]["source"] == "canned"
    # 벌서는 동안에는 키를 누르고 있어도 점수가 오르지 않는다
    s0 = p1["score"]
    run_to(g, g._now + 0.5)
    assert p1["score"] == s0 and p1["mode"] == "none"


def test_three_strikes_sends_to_hallway_and_fever_rises_for_survivors():
    # 벌서기를 짧게 해서 계속 걸리게 한다
    g = make(n=2, config={"PUNISH_TIME": 5})
    hold(g, "p1", 0.1, big=True)                   # p1: 무조건 계속 춤
    says, fever_events = [], []
    now = T0
    p2 = g.by_id["p2"]
    while not (g.by_id["p1"]["out"] and p2["maxFever"] >= 1) and now < T0 + 55:
        # p2: 교수님이 칠판에 쓸 때만 작은 춤(낌새가 보이면 멈춤)
        want = g.teacher.state == "write"
        if want != p2["small"]:
            hold(g, "p2", now, small=want)
        now += 1 / FPS
        g.tick(now)
        for _to, kind, d in g.drain():
            if kind == "event" and d["type"] == "say":
                says.append(d)
            if kind == "event" and d["type"] == "fever":
                fever_events.append(d)
    p1 = g.by_id["p1"]
    assert p1["out"] and p1["strikes"] == 3
    assert any(e["kind"] == "hallway" and "N1" in e["text"] for e in says)
    assert p2["strikes"] == 0 and p2["maxFever"] >= 1 and fever_events and fever_events[0]["id"] == "p2"
    score = p1["score"]
    g._now = now
    run_to(g, now + 1.0)
    assert p1["score"] == score and p1["mode"] == "none"      # 복도행 뒤에는 못 춘다


@pytest.mark.parametrize("n", [2, 3, 5])
def test_full_game_results(n):
    g = make(n=n, seed=n)
    rnd = random.Random(7)
    now, events = 0.0, []
    while not g.finished:
        now += 1 / 30
        assert now < 80
        if g.phase == "play":
            for i, s in enumerate(g.students):
                # 사람 흉내: i 번째 학생은 낌새를 보고 (i × 0.05)초쯤 늦게 반응한다. 가끔 큰 춤.
                safe = g.teacher.state == "write" or (g.teacher.state in ("tell", "turn") and g.teacher.t < i * 4)
                big = safe and i % 2 == 0 and rnd.random() < 0.5
                if (safe and not big) != s["small"] or big != s["big"]:
                    hold(g, s["id"], now, big=big, small=safe and not big)
        g.tick(now)
        events += [d for _to, kind, d in g.drain() if kind == "event"]
    res = g.results
    assert len(res) == n and {r["playerId"] for r in res} == {f"p{i + 1}" for i in range(n)}
    for r in res:
        assert set(r) == {"playerId", "name", "score", "rank", "isWinner", "stats"}
        assert isinstance(r["score"], int) and r["score"] >= 0
        assert set(r["stats"]) == {"caught", "out", "maxFever", "danceSec"}
    assert [r["rank"] for r in res] == sorted(r["rank"] for r in res) and res[0]["rank"] == 1 and res[0]["isWinner"]
    assert [r["score"] for r in res] == sorted((r["score"] for r in res), reverse=True)
    assert res[0]["score"] > 0
    kinds = {e["type"] for e in events}
    assert {"teacher", "end"} <= kinds and "verdict" not in kinds     # Gemini 가 없으면 총평은 보내지 않는다
    assert all(e["source"] == "canned" for e in events if e["type"] == "say")
    assert 60 < now < 60 + 0.5 + 0.3 + 0.4 + 1


def test_ranking_tie_breakers():
    g = make(n=3)
    a, b, c = g.students
    a.update(score=50.9, strikes=1, maxFever=3)
    b.update(score=50.2, strikes=0, maxFever=0)
    c.update(score=50.0, strikes=1, maxFever=3)
    res = g.build_results()
    assert [(r["playerId"], r["rank"]) for r in res] == [("p2", 1), ("p1", 2), ("p3", 2)]   # 덜 걸린 순, 같으면 공동
    assert res[0]["isWinner"] and not res[1]["isWinner"]


def test_reconnect_state_and_disconnect():
    g = make()
    hold(g, "p1", 0.1, small=True)
    run_to(g, T0 + 0.5)
    snap = g.state_for("p1", T0 + 0.5)
    assert snap["phase"] == "play" and snap["students"][0]["mode"] == "small" and snap["teacher"]["state"] == "write"
    assert "fake" not in snap["teacher"]           # 페이크인지는 화면에 알려 주지 않는다
    g.on_connection("p1", False, T0 + 0.5)         # 끊긴 사람은 얌전히 앉아 있는 것으로
    run_to(g, T0 + 0.6)
    assert g.by_id["p1"]["mode"] == "none"
    g.on_input("p1", "bad", T0 + 0.6)              # 이상한 입력은 무시
    g.on_input("zz", {"k": "in", "big": True}, T0 + 0.6)


# ----------------------------------------------------------------------
# AI 수업 계획
# ----------------------------------------------------------------------
def teacher_trace(g, seconds=30.0):
    """교수님의 상태 변화 [(프레임, 상태)] 를 모은다."""
    trace = []
    for e in run_to(g, T0 + seconds, step=1 / FPS):
        if e["type"] == "teacher":
            trace.append((e["frame"], e["state"]))
        elif e["type"] == "fake":
            trace.append((e["frame"], "fake"))
    return trace


def test_plan_request_uses_original_ranges():
    b = plan_bounds(DEFAULT_CONFIG)
    assert b == {"write": (55, 220), "tell": (22, 52), "look": (60, 140)}
    system, prompt, schema = plan_request(DEFAULT_CONFIG, 4)
    step = schema["properties"]["steps"]["items"]["properties"]
    assert step["write"]["minimum"] == pytest.approx(0.92) and step["write"]["maximum"] == pytest.approx(3.67)
    assert step["move"]["enum"] == ["tell", "fake", "sudden"]
    assert "10~14" in system and "4명" in prompt


def test_clean_plan_clamps_and_rejects():
    cfg = DEFAULT_CONFIG
    assert clean_plan(None, cfg) is None
    assert clean_plan({"steps": "x"}, cfg) is None
    assert clean_plan({"steps": [{"move": "dance"}, 3]}, cfg) is None          # 쓸 수 있는 단계가 하나도 없음
    steps = clean_plan({"steps": [
        {"write": 99, "move": "tell", "tell": 0, "look": -5},                   # 범위 밖 → 범위 끝으로
        {"write": 2.0, "move": "moonwalk", "tell": 0.5, "look": 1.5},           # 모르는 행동 → 그 단계만 버림
        {"write": "2", "move": "tell", "tell": 0.5, "look": 1.5},               # 숫자가 아님 → 그 단계만 버림
        {"write": 2.0, "move": "fake", "tell": 0.5, "look": 1.5},
    ]}, cfg)
    assert steps == [
        {"move": "tell", "write": 220, "tell": 22, "look": 60}, None, None,
        {"move": "fake", "write": 120, "tell": 30, "look": 90},
    ]
    # 갑자기 돌아보기 · 페이크는 정해진 수까지만, 단계는 14개까지만
    many = clean_plan([{"write": 1.5, "move": "sudden", "tell": 0.5, "look": 1.5}] * 20, cfg)
    assert len(many) == 14 and [s["move"] for s in many].count("sudden") == 3
    many = clean_plan([{"write": 1.5, "move": "fake", "tell": 0.5, "look": 1.5}] * 9, cfg)
    assert [s["move"] for s in many].count("fake") == 5 and many[-1]["move"] == "tell"


PLAN = {"steps": [
    {"write": 1.0, "move": "tell", "tell": 0.5, "look": 1.0},
    {"write": 1.5, "move": "fake", "tell": 0.4, "look": 1.0},
    {"write": 1.0, "move": "sudden", "tell": 0.5, "look": 2.0},
    {"write": 50, "move": "tell", "tell": 5, "look": 50},          # 범위 밖 → 잘려서 쓰인다
]}


def test_valid_plan_is_used_in_order_after_rule_based_first_write():
    fake = FakeGemini(plan=PLAN)
    g = make(gemini=fake)
    assert g.plan_source == "pending" and [c["kind"] for c in fake.calls].count("plan") == 1
    run_to(g, 0.2)
    assert g.plan_source == "gemini"
    tc = g.teacher
    assert tc.step is None and tc.dur == 160                       # 첫 쓰기는 항상 규칙 기반
    assert g.snapshot(0.2)["teacher"]["planned"] is False
    trace = teacher_trace(g, 25.0)
    # 첫 바퀴(규칙 기반)가 끝난 뒤의 쓰기부터 계획 단계가 차례로 쓰인다
    writes = [i for i, (_f, s) in enumerate(trace) if s == "write"]
    seq = trace[writes[0]:]
    dur = lambda i: seq[i + 1][0] - seq[i][0]                      # noqa: E731
    names = [s for _f, s in seq]
    assert names[:5] == ["write", "tell", "turn", "look", "back"]            # 1단계: 낌새 뒤 돌아봄
    assert (dur(0), dur(1), dur(2), dur(3)) == (60, 30, 9, 60)
    assert names[5:9] == ["write", "tell", "write", "fake"]                  # 2단계: 페이크(같은 프레임에 다시 쓰기)
    assert (dur(5), dur(6)) == (90, 24)
    assert names[9:12] == ["turn", "look", "back"]                           # 3단계: 낌새 없이 갑자기
    assert (seq[9][0] - seq[7][0], dur(9), dur(10)) == (60, 26, 120)
    assert names[12:16] == ["write", "tell", "turn", "look"]                 # 4단계: 숫자가 범위로 잘림
    assert (dur(12), dur(13), dur(15) if len(seq) > 16 else 140) == (220, 52, 140)
    assert tc.steps_used == 4
    # 계획을 다 쓰면 다시 규칙 기반
    run_until_state(g, "back", limit=60)
    run_until_state(g, "write", limit=60)
    assert tc.step is None and g.snapshot(g._now)["teacher"]["planned"] is False


def test_planned_flag_is_in_state_while_plan_step_runs():
    g = make(gemini=FakeGemini(plan=PLAN))
    run_until_state(g, "back")
    run_until_state(g, "write")
    snap = g.snapshot(g._now)
    assert snap["teacher"]["planned"] is True and snap["plan"] == "gemini"


def test_no_gemini_or_bad_plan_keeps_original_random_behaviour():
    base = teacher_trace(make(seed=5))
    assert make(seed=5).plan_source == "none"
    # 잘못된 계획 · Gemini 오류 → 교수님은 Gemini 가 없을 때와 똑같이 움직인다
    for fake in (FakeGemini(plan={"steps": [{"move": "x"}]}), FakeGemini(plan="???"),
                 FakeGemini(error=RuntimeError("503"))):
        g = make(seed=5, gemini=fake)
        assert teacher_trace(g) == base and g.plan_source == "none" and g.teacher.steps_used == 0
    # 그리고 그 움직임은 원본 Teacher 를 같은 난수로 혼자 돌린 것과 같다
    rng = random.Random(5).random
    rng()                                        # 게임이 대사용 씨앗으로 한 번 뽑는다
    tc, solo = Teacher(rng, DEFAULT_CONFIG["TEACHER"]), []
    for f in range(1, 30 * FPS + 1):
        tc.update((f - 1) / DEFAULT_CONFIG["CLASS_TIME"])
        solo += [(f, e["type"]) for e in tc.events]
        tc.events.clear()
    assert solo == base
    kinds = {s for _f, s in base}
    assert {"write", "tell", "turn", "look", "back"} <= kinds


def test_late_plan_does_not_block_and_skips_ahead():
    g = make(gemini=None)
    tc = g.teacher
    run_to(g, T0 + 30.0)                          # 계획 없이 절반 진행(게임은 기다리지 않는다)
    assert tc.steps_used == 0
    steps = clean_plan({"steps": [{"write": 1.0, "move": "tell", "tell": 0.5, "look": 1.0}] * 10}, g.cfg)
    tc.set_plan(steps, 1 - g.left / g.cfg["CLASS_TIME"])
    assert tc.plan_i == 5                         # 늦게 온 계획은 수업 진행도만큼 건너뛴다


# ----------------------------------------------------------------------
# 대사 · 총평
# ----------------------------------------------------------------------
def test_gemini_lines_and_verdict():
    lines = {k: [f"AI {k} " + "{name}"] for k in ("start", "caught_one", "caught_many", "fake", "clean",
                                                 "fever", "hallway", "last10")}
    fake = FakeGemini(plan=None, lines=lines, verdict={"headline": "몰래 춤의 달인", "mvp": "N1 대단", "cheer": "힘내"})
    g = make(n=2, gemini=fake, config={"CLASS_TIME": 6 * FPS, "LAST_SECONDS": 2})
    assert g.plan_source in ("pending", "none")
    hold(g, "p1", 0.1, small=True)
    ev = run_to(g, T0 + 6.0 + 0.2)
    says = [e for e in ev if e["type"] == "say"]
    assert says[0]["kind"] == "start" and says[0]["source"] == "gemini" and says[0]["who"] == "마법사"
    assert any(e["kind"] == "last10" for e in says)
    frames = [e for e in ev if e["type"] in ("say",)]
    assert len(frames) >= 2
    assert g.phase == "end" and g.final_results
    for _ in range(200):                          # 총평(스레드)이 올 때까지
        if g._verdict_job is None or g._verdict_job.done():
            break
        time.sleep(0.01)
    ev = run_to(g, T0 + 6.0 + 0.5)
    verdicts = [e for e in ev if e["type"] == "verdict"]
    assert verdicts == [{"type": "verdict", "headline": "몰래 춤의 달인", "mvp": "N1 대단", "cheer": "힘내"}]
    assert g.snapshot(g._now)["verdict"]["headline"] == "몰래 춤의 달인"
    run_to(g, T0 + 8.0)
    assert g.finished and len(g.results) == 2
    assert {c["kind"] for c in fake.calls} == {"plan", "lines", "verdict"}
    assert "마법사" in next(c for c in fake.calls if c["kind"] == "lines")["system"]


def test_say_gap_limits_chatter():
    g = make(n=2, config={"PUNISH_TIME": 5, "GRACE": 0})
    hold(g, "p1", 0.1, big=True)
    ev = run_to(g, T0 + 25)
    plain = [e for e in ev if e["type"] == "say" and e["kind"] in ("fake", "clean", "fever", "last10")]
    assert all(e["text"] for e in ev if e["type"] == "say")
    assert len(plain) <= 25 / 3 + 1
