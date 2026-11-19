"""줄다리기 서버 판정 테스트."""

from __future__ import annotations

import random

import pytest

from party.games.tug.config import merge_config
from party.games.tug.match import TugMatch
from party.games.tug.systems import TeamAssigner, team_multipliers
from party.games.tug.timeline import BeatJudge, BeatTimeline, FeverSchedule


def players(n):
    return [{"id": f"p{i + 1}", "name": f"N{i + 1}"} for i in range(n)]


def test_beat_grid_speeds_up_one_beat_after_fever_starts():
    tl = BeatTimeline(merge_config())
    assert [round(tl.time_of(k), 6) for k in (15, 16, 17, 18, 19)] == [7.5, 8.0, 8.5, 8.9, 9.3]
    # 피버(8~12초)가 끝난 뒤 한 박 더 빠르고, 그다음부터 기본 간격
    assert [round(tl.time_of(k), 6) for k in (26, 27, 28)] == [12.1, 12.5, 13.0]
    assert tl.time_of(-3) == -1.5


def test_fever_schedule():
    f = FeverSchedule(merge_config())
    assert not f.active_at(7.99) and f.active_at(8.0) and f.active_at(11.99) and not f.active_at(12.0)
    assert f.active_at(18.0) and f.state_at(7.5)["warning"]


def test_judge_grades_and_spam():
    cfg = merge_config()
    j = BeatJudge(cfg, BeatTimeline(cfg))
    assert j.judge("a", 0.5 + 0.03)["grade"] == "perfect"
    assert j.judge("a", 0.5 + 0.05)["grade"] == "spam"      # 같은 박에 또 누름
    assert j.judge("b", 1.0 + 0.10)["grade"] == "good"
    assert j.judge("c", 1.25)["grade"] == "miss"


@pytest.mark.parametrize("n,sizes", [(2, (1, 1)), (3, (1, 2)), (4, (2, 2)), (5, (2, 3))])
def test_team_split_sizes(n, sizes):
    a = TeamAssigner([p["id"] for p in players(n)], random.Random(n).random)
    for _ in range(6):
        s = a.next()
        assert tuple(sorted((len(s["left"]), len(s["right"])))) == sizes
        assert sorted(s["left"] + s["right"]) == sorted(p["id"] for p in players(n))


def test_team_multiplier_is_ratio():
    cfg = merge_config()
    assert team_multipliers(2, 3, cfg) == {"left": 1.5, "right": 1.0}
    assert team_multipliers(2, 1, cfg) == {"left": 1.0, "right": 2.0}
    assert team_multipliers(2, 2, cfg) == {"left": 1.0, "right": 1.0}


def run_match(n, presser, cfg=None, seed=1):
    m = TugMatch(players(n), cfg, random.Random(seed).random)
    t = 50.0
    m.start(t)
    nxt = {}
    rnd = 0
    while not m.finished and t < 600:
        t += 1 / 30
        m.advance(t)
        if m.round != rnd:
            rnd, nxt = m.round, {p: 0 for p in m.ids}
        if m.phase == "play":
            rt = t - m.start_at
            for pid in m.ids:
                if pid in presser and rt >= m.timeline.time_of(nxt[pid]):
                    m.input(pid, {"k": "pull", "t": m.timeline.time_of(nxt[pid])}, t)
                    nxt[pid] += 1
        elif m.phase == "summary":
            m.input("p1", {"k": "confirm"}, t)
    return m


def test_full_match_only_pressers_score_and_winner_is_ranked_first():
    m = run_match(3, presser={"p1"})
    assert m.finished and len(m.score.history) == 3
    by = {r["playerId"]: r for r in m.results}
    assert by["p1"]["rank"] == 1 and by["p1"]["isWinner"]
    assert by["p1"]["stats"]["perfect"] > 10
    # 누르지 않은 사람에게는 판정이 하나도 기록되지 않는다(입력이 다른 참가자에게 적용되지 않음)
    for pid in ("p2", "p3"):
        s = by[pid]["stats"]
        assert s["perfect"] == s["good"] == s["miss"] == s["spam"] == 0


def test_nobody_presses_is_a_draw_for_everyone():
    m = run_match(2, presser=set(), cfg={"ROUNDS": 1, "ROUND_TIME": 3})
    assert [r["score"] for r in m.results] == [100, 100]
    assert all(r["isWinner"] and r["rank"] == 1 for r in m.results)


def test_input_time_far_from_server_time_is_replaced_and_early_input_dropped():
    m = TugMatch(players(2), None, random.Random(3).random)
    m.start(0.0)
    m.advance(m.start_at - 1.0)                       # 카운트다운 중
    m.input("p1", {"k": "pull", "t": -1.0}, m.start_at - 1.0)
    assert m.pop_events() == []                       # START 한참 전 입력은 버린다
    now = m.start_at + 2.26
    m.advance(now)
    m.input("p1", {"k": "pull", "t": 999.0}, now)     # 말이 안 되는 시각 → 서버 시각으로 판정
    ev = m.pop_events()[0]
    assert abs(ev["t"] - 2.26) < 1e-6 and ev["grade"] == "miss"
    m.input("p2", {"k": "pull", "t": 2.0}, now)       # 0.26초 전(허용 범위) → 그대로 믿는다
    assert m.pop_events()[0]["grade"] == "perfect"


def test_inputs_after_round_end_are_ignored():
    m = TugMatch(players(2), {"ROUND_TIME": 1}, random.Random(3).random)
    m.start(0.0)
    m.advance(m.start_at + 1.5)
    assert m.phase == "ended"
    before = m.score.snapshot()
    m.input("p1", {"k": "pull", "t": 1.0}, m.start_at + 1.5)
    assert m.score.snapshot() == before and m.pop_events() == []
