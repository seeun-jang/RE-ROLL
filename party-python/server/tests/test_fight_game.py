"""매직 파이트 나이트: 대진표, 한 경기 규칙, 입력 처리, 순위, AI 해설."""

from __future__ import annotations

import random
import time
from itertools import combinations

import pytest

from party.games.fight.bout import Bout
from party.games.fight.config import merge_config
from party.games.fight.game import FightGame, make_schedule

# 시간을 줄인 설정(경기 6초)
FAST = {
    "BOUT": {"TIME": 6 * 60, "INTRO_LEN": 20, "COUNT_START": 5, "COUNT_STEP": 2, "KO_TAIL": 10, "DECISION_LEN": 20, "HURRY": 120},
    "FLOW": {"ROUNDS_FOR_TWO": 3, "INTRO_TIME": 0.2, "END_HOLD": 0.1, "RESULT_TIME": 0.2, "FINAL_TIME": 0.5, "SAY_GAP": 3.0},
}
NONE = {"left": False, "right": False, "skill": False, "down": False}


def players(n):
    return [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n)]


def ctrl(**kw):
    return {**NONE, **kw}


def run(game, now, seconds, inputs=None, dt=1 / 30):
    """inputs(i, game) → [(playerId, data)]. 돌려주는 값: (사건 목록, 끝난 시각)"""
    events = []
    t = now
    for i in range(1, int(seconds / dt) + 1):
        t = now + i * dt
        for pid, data in (inputs(i, game) if inputs else []):
            game.on_input(pid, data, t)
        game.tick(t)
        events += [d for _to, kind, d in game.drain() if kind == "event"]
        if game.finished:
            break
    return events, t


def new_bout(seed=1, **over):
    return Bout(merge_config(over), {"id": "p1", "name": "A"}, {"id": "p2", "name": "B"}, random.Random(seed).random)


def skip_intro(b):
    while b.state == "intro":
        b.step(NONE, NONE)
    b.pop_events()


# ---------------------------------------------------------------- 대진표
@pytest.mark.parametrize("n", [3, 4, 5])
def test_schedule_everyone_meets_everyone_once(n):
    ids = [f"p{i + 1}" for i in range(n)]
    plan = make_schedule(ids, random.Random(3).random, 3)
    seen = []
    for rnd in plan:
        busy = [x for m in rnd["matches"] for x in m]
        assert len(busy) == len(set(busy))
        assert sorted(busy + rnd["resting"]) == sorted(ids)
        assert len(rnd["resting"]) == n % 2
        seen += [frozenset(m) for m in rnd["matches"]]
    assert sorted(map(sorted, seen)) == sorted(map(list, combinations(ids, 2)))


def test_schedule_two_players():
    plan = make_schedule(["p1", "p2"], random.Random(1).random, 3)
    assert len(plan) == 3 and all(len(r["matches"]) == 1 and not r["resting"] for r in plan)


# ---------------------------------------------------------------- 한 경기 규칙(원본 값)
def test_jab_hits_for_5_and_power_for_14():
    b = new_bout()
    skip_intro(b)
    b.red.x, b.blue.x = 140.0, 180.0          # 잽 사거리(47) 안
    b.step(ctrl(skill=True), NONE)            # 톡
    for _ in range(30):
        b.step(NONE, NONE)
    assert b.blue.hp == 95 and b.red.hits == 1
    for _ in range(40):                        # 뒤로 밀린 만큼 다시 붙는다
        b.step(ctrl(right=True), NONE)
    for _ in range(25):                        # 꾹(20프레임 이상) → 떼면 강펀치
        b.step(ctrl(skill=True), NONE)
    for _ in range(30):
        b.step(NONE, NONE)
    assert b.blue.hp == 81


def test_guard_reduces_damage_and_slip_gives_counter():
    b = new_bout()
    skip_intro(b)
    b.red.x, b.blue.x = 140.0, 180.0
    for _ in range(30):                        # 오래 들고 있던 가드 = 그냥 막기 (5 × 0.15 → 1)
        b.step(NONE, ctrl(down=True))
    b.step(ctrl(skill=True), ctrl(down=True))
    for _ in range(20):
        b.step(NONE, ctrl(down=True))
    assert b.blue.hp == 99

    b = new_bout()
    skip_intro(b)
    b.red.x, b.blue.x = 140.0, 180.0
    b.step(ctrl(skill=True), NONE)             # 잽 시작
    events = []
    for _ in range(12):                        # 닿기 직전에 가드 = 슥
        b.step(NONE, ctrl(down=True))
        events += b.pop_events()
    hit = [e for e in events if e["type"] == "hit"][0]
    assert hit["slip"] and b.blue.hp == 100 and b.blue.counter_t > 0 and b.red.state == "stun"
    b.step(NONE, ctrl(skill=True))             # 바로 받아치면 피해 2배
    for _ in range(20):
        b.step(NONE, NONE)
    assert b.red.hp == 90


def test_dash_needs_two_quick_taps():
    b = new_bout()
    skip_intro(b)
    b.step(ctrl(right=True), NONE)
    b.step(NONE, NONE)
    b.step(ctrl(right=True), NONE)
    assert any(e["type"] == "dash" and e["side"] == "red" for e in b.pop_events())
    assert b.red.vx > 3


def test_knockout_and_time_decision():
    b = new_bout()
    skip_intro(b)
    b.blue.hp = 3
    b.red.x, b.blue.x = 140.0, 180.0
    b.step(ctrl(skill=True), NONE)
    for _ in range(600):
        b.step(NONE, NONE)
    assert b.done and b.by_ko and b.winner is b.red and b.blue.state == "ko"

    b = new_bout(BOUT=merge_config(FAST)["BOUT"])
    skip_intro(b)
    b.blue.hp = 80
    for _ in range(600):
        b.step(NONE, NONE)
    assert b.done and not b.by_ko and b.winner is b.red


# ---------------------------------------------------------------- 게임 전체
def puncher(pid):
    """pid 만 상대 쪽으로 걸어가며 계속 잽을 친다."""
    def inputs(i, game):
        if game.phase != "fight":
            return []
        m = next((m for m in game.schedule[game.round - 1]["matches"] if pid in m), None)
        if m is None:
            return []
        fwd = 2 if m[0] == pid else 1          # 홍코너면 오른쪽이 앞
        if i % 10 == 0:
            return [(pid, {"k": "in", "held": fwd | 4, "press": ["punch"]})]
        if i % 10 == 2:
            return [(pid, {"k": "in", "held": fwd, "press": []})]
        return []
    return inputs


@pytest.mark.parametrize("n", [2, 3, 5])
def test_full_game_results(n):
    game = FightGame(players(n), {"config": FAST}, random.Random(n).random)
    game.start(50.0)
    assert game.state_for("p1", 50.0)["phase"] == "intro"
    events, _ = run(game, 50.0, 200, puncher("p1"))
    assert game.finished
    res = game.results
    assert len(res) == n and [r["rank"] for r in res] == sorted(r["rank"] for r in res)
    assert [r["score"] for r in res] == sorted((r["score"] for r in res), reverse=True)
    for r in res:
        assert set(r) == {"playerId", "name", "score", "rank", "isWinner", "stats"}
        assert r["stats"]["wins"] + r["stats"]["losses"] == r["stats"]["matches"]
    top = res[0]
    assert top["playerId"] == "p1" and top["isWinner"] and top["stats"]["losses"] == 0
    rounds = 3 if n == 2 else (n if n % 2 else n - 1)
    assert sum(r["stats"]["wins"] for r in res) == rounds * (n // 2)
    # 해설은 Gemini 없이 기본 대사로 나온다
    says = [e for e in events if e["type"] == "say"]
    assert says and all(e["source"] == "canned" and e["who"] == "해설자" and e["text"] for e in says)
    assert {"start"} <= {e["kind"] for e in says}
    assert not [e for e in events if e["type"] == "verdict"]


def test_resting_and_bad_inputs_are_ignored():
    game = FightGame(players(3), {"config": FAST}, random.Random(9).random)
    game.start(10.0)
    rest = game.state_for("p1", 10.0)["resting"][0]

    def inputs(i, g):
        return [
            (rest, {"k": "in", "held": 4, "press": ["punch"]}),
            ("nobody", {"k": "in", "held": 15}),
            (rest, "이상한 값"),
            ("p1", {"k": "???"}),
            ("p1", {"k": "in", "held": "x", "press": [1, None, "fly"]}),
        ]

    events, _ = run(game, 10.0, 2.0, inputs)
    assert not [e for e in events if e["type"] in ("punch", "dash", "hit")]


def test_disconnect_releases_keys_and_game_still_ends():
    game = FightGame(players(2), {"config": FAST}, random.Random(4).random)
    game.start(0.0)
    run(game, 0.0, 1.0)
    game.on_input("p1", {"k": "in", "held": 2}, 1.0)
    assert game.held["p1"] == 2
    game.on_connection("p1", False, 1.1)
    assert game.held["p1"] == 0
    run(game, 1.1, 200)
    assert game.finished and len(game.results) == 2


def test_wins_come_before_ko_and_hp_bonus():
    game = FightGame(players(3), {"config": FAST}, random.Random(2).random)
    game.standings["p1"].update(wins=1, kos=1, hpLeft=100)
    game.standings["p2"].update(wins=2, kos=0, hpLeft=2)
    game.standings["p3"].update(wins=1, kos=0, hpLeft=60)
    assert [r["playerId"] for r in game._build_results()] == ["p2", "p1", "p3"]


def test_time_running_out_is_announced():
    game = FightGame(players(2), {"config": FAST}, random.Random(6).random)
    game.start(0.0)
    events, _ = run(game, 0.0, 9.0)
    kinds = [e["kind"] for e in events if e["type"] == "say"]
    assert "hurry" in kinds and "decision" in kinds


# ---------------------------------------------------------------- AI (가짜 Gemini)
class FakeGemini:
    def __init__(self):
        self.calls = []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append(prompt)
        if schema and "headline" in schema.get("properties", {}):
            return {"headline": "링 위의 밤이 끝났다", "mvp": "주먹이 번개 같았다", "cheer": "다음엔 꼭 이긴다"}
        return {kind: [f"AI {kind} 대사"] for kind in schema["properties"]}


def test_gemini_lines_and_verdict():
    fake = FakeGemini()
    game = FightGame(players(2), {"config": {**FAST, "FLOW": {**FAST["FLOW"], "FINAL_TIME": 3.0}}}, random.Random(7).random)
    game.services = {"gemini": fake}
    game.start(0.0)
    for _ in range(200):
        if game.book.ready:
            break
        time.sleep(0.01)
    events = []
    now = 0.0
    while not game.finished and now < 300:
        ev, now = run(game, now, 1.0, puncher("p1"))
        events += ev
        if game.phase == "final":
            time.sleep(0.02)                  # 총평 스레드가 끝날 틈
    says = [e for e in events if e["type"] == "say"]
    assert says and all(e["source"] == "gemini" for e in says)
    verdicts = [e for e in events if e["type"] == "verdict"]
    assert len(verdicts) == 1 and verdicts[0]["headline"] == "링 위의 밤이 끝났다"
    assert game.verdict == {k: verdicts[0][k] for k in ("headline", "mvp", "cheer")}
    assert len(fake.calls) == 2               # 대사 묶음 1번 + 총평 1번
