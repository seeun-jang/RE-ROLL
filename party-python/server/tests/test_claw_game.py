"""잭팟 인형뽑기 서버 판정 테스트 (가짜 시계로 start / tick / on_input / drain)."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from party.games.claw.config import DEFAULT_CONFIG, merge_config
from party.games.claw.game import SAY_CANNED, SAY_KINDS, ClawGame
from party.games.claw.machine import Machine, make_pile, make_rng

WEB = Path(__file__).resolve().parents[2] / "web"
T0 = 100.0
DT = 1 / 30


def players(n):
    return [{"id": f"p{i + 1}", "name": f"선수{i + 1}", "index": i} for i in range(n)]


def new_game(n=2, seed=7, config=None, services=None):
    g = ClawGame(players(n), {"config": config} if config else None, random.Random(seed).random)
    if services is not None:
        g.services = services
    return g


class Run:
    """게임을 가짜 시계로 돌리며 나온 메시지를 모은다."""

    def __init__(self, game):
        self.g, self.t = game, T0
        self.states: dict[str, dict] = {}
        self.events: list[tuple] = []
        game.start(self.t)
        self.pull()

    def pull(self):
        for to, kind, data in self.g.drain():
            if kind == "state":
                self.states[to] = data
            else:
                self.events.append((to, data))

    def tick(self, seconds=DT):
        for _ in range(max(1, round(seconds / DT))):
            self.t += DT
            self.g.tick(self.t)
            self.pull()

    def send(self, pid, **data):
        self.g.on_input(pid, {"k": "in", **data}, self.t)
        self.pull()

    def until(self, cond, limit=400.0):
        end = self.t + limit
        while not cond() and self.t < end:
            self.tick()
        assert cond(), "조건에 도달하지 못했다"

    def kinds(self, to=None):
        return [e["type"] for who, e in self.events if to is None or who == to]


def machine(seed=5, cfg=None):
    cfg = merge_config(cfg)
    return Machine(cfg, seed, make_pile(cfg, seed))


def play_try(m, hold=0, wait=20):
    """오른쪽으로 hold 프레임 → 멈춤 → 내리기 → 집게가 돌아올 때까지."""
    m.set_input(1)
    for _ in range(hold):
        m.step()
    m.set_input(0)
    for _ in range(wait):
        m.step()
    m.set_input(0, True)
    m.step()
    for _ in range(2000):
        if m.claw.state == "idle":
            break
        m.step()


# ---------------------------------------------------------------- 기계 규칙
def test_rng_matches_original_generator():
    rng = make_rng(12345)
    values = [rng() for _ in range(3)]
    assert all(0 <= v < 1 for v in values) and len(set(values)) == 3
    again = make_rng(12345)
    assert [again() for _ in range(3)] == values


def test_pile_is_same_for_same_seed_and_stays_inside():
    cfg = merge_config(None)
    a, b = make_pile(cfg, 42), make_pile(cfg, 42)
    assert [(p.type, p.x, p.y) for p in a] == [(p.type, p.x, p.y) for p in b]
    assert sorted(p.type for p in a) == sorted(cfg["LINEUP"])
    B = cfg["BOX"]
    for p in a:      # 처음부터 배출구에 빠진 인형이 없어야 한다
        assert p.x >= B["HOLE_W"] + p.r and p.x <= B["W"] - p.r and p.y <= B["H"] - p.r + 1e-6
    assert [(p.x, p.y) for p in make_pile(cfg, 43)] != [(p.x, p.y) for p in a]


def test_idle_pile_never_rolls_into_the_hole():
    m = machine()
    m.coins = 0
    for _ in range(600):
        m.step()
    assert m.won == [] and len(m.prizes) == 13


def test_coin_move_limits_and_auto_drop():
    m = machine()
    m.step()
    assert m.coins == 7 and m.claw.state == "move" and m.events[0] == {"type": "coin", "left": 7}
    m.set_input(1)
    for _ in range(200):
        m.step()
    assert m.claw.x == m.cfg["BOX"]["MAX_X"]          # 오른쪽 끝에서 멈춘다
    m.set_input(-1)
    for _ in range(200):
        m.step()
    assert m.claw.x == m.cfg["BOX"]["HOME_X"]
    m.set_input(0)
    for _ in range(80):                                # 1 + 200 + 200 + 80 = 481 프레임 → 8초가 지나 저절로 내려간다
        m.step()
    assert m.claw.state != "move" and {"type": "drop"} in m.events


def test_drop_too_early_is_ignored_like_original():
    m = machine()
    m.step()
    m.set_input(0, True)        # 코인을 넣고 8프레임 안의 내리기는 무시
    m.step()
    assert m.claw.state == "move"
    for _ in range(10):
        m.step()
    m.set_input(0, True)
    m.step()
    assert m.claw.state == "drop"


def test_full_try_returns_to_idle_and_counts():
    m = machine(seed=9)
    m.coins = 1
    play_try(m, hold=40)
    assert m.done and m.tries == 1
    kinds = [e["type"] for e in m.events]
    assert kinds[:2] == ["coin", "drop"] and (("grab" in kinds) != ("miss" in kinds))
    assert m.score == sum(p.value for p in m.won)
    assert len(m.prizes) + len(m.won) == 13


def test_same_inputs_give_same_result_on_two_machines():
    a, b = machine(seed=3), machine(seed=3)
    for hold in (30, 55, 12, 70):
        play_try(a, hold)
        play_try(b, hold)
    assert [(p.id, p.x, p.y) for p in a.prizes] == [(p.id, p.x, p.y) for p in b.prizes]
    assert [p.id for p in a.won] == [p.id for p in b.won]


def test_some_strategy_wins_prizes_and_scores_add_up():
    # 여러 seed · 여러 자리에서 뽑아 보면 인형이 실제로 나온다(판정이 살아 있는지)
    total = 0
    for seed in range(1, 7):
        m = machine(seed=seed)
        for hold in (20, 35, 50, 65, 28, 44, 58, 72):
            play_try(m, hold)
        assert m.done and m.tries == 8
        assert m.score == sum(m.cfg["PRIZES"][t]["value"] for t in m.stats()["won"])
        total += len(m.won)
    assert total > 0


def test_view_shape():
    m = machine()
    m.step()
    v = m.view()
    assert set(v) == {"frame", "coins", "score", "dir", "claw", "prizes", "won"}
    assert v["claw"]["state"] == "move" and v["claw"]["grab"] == -1
    assert len(v["prizes"]) == 13 and all(len(row) == 4 for row in v["prizes"])


# ---------------------------------------------------------------- 게임 진행
def test_start_sends_personal_state_and_options():
    g = new_game(3)
    r = Run(g)
    assert set(r.states) == {"p1", "p2", "p3"}
    s = r.states["p1"]
    assert s["phase"] == "intro" and s["startAt"] == T0 + 4.0 and s["results"] is None and s["verdict"] is None
    assert s["me"]["coins"] == 8 and len(s["me"]["prizes"]) == 13
    # 모두 같은 더미
    assert r.states["p2"]["me"]["prizes"] == s["me"]["prizes"]
    opt = g.client_options()
    assert opt["coins"] == 8 and opt["moveTime"] == 480 and opt["types"][-1] == "gold" and opt["prizes"]["gold"]["value"] == 30
    json.dumps(opt)
    json.dumps(s)


def test_input_moves_only_my_claw_and_server_judges():
    r = Run(new_game(2))
    r.send("p1", dir=1)                 # 설명 화면 동안의 입력은 버린다
    r.tick(4.2)
    assert r.states["p1"]["phase"] == "play"
    assert r.states["p1"]["me"]["claw"]["x"] == 7
    r.send("p1", dir=1)
    r.tick(1.0)
    x1 = r.states["p1"]["me"]["claw"]["x"]
    assert 7 + 0.55 * 55 <= x1 <= 7 + 0.55 * 65
    assert r.states["p2"]["me"]["claw"]["x"] == 7
    assert r.states["p1"]["me"]["dir"] == 1
    r.send("p1", dir=0, drop=True)
    r.tick(0.2)
    assert r.states["p1"]["me"]["claw"]["state"] in ("drop", "close")
    assert "drop" in r.kinds("p1") and "drop" not in r.kinds("p2")
    # 이상한 입력은 무시
    r.send("p2", dir=5)
    r.send("p2", dir=True)
    r.g.on_input("p2", {"k": "zzz"}, r.t)
    r.g.on_input("nobody", {"k": "in", "dir": 1}, r.t)
    r.tick(0.5)
    assert r.states["p2"]["me"]["claw"]["x"] == 7


@pytest.mark.parametrize("n", [2, 3, 5])
def test_full_game_without_inputs_finishes_with_common_results(n):
    # 아무도 누르지 않아도(= 모두 연결이 끊겨도) 8초마다 집게가 저절로 내려가 끝까지 진행된다
    g = new_game(n, seed=n)
    r = Run(g)
    r.g.on_connection("p1", False, r.t)
    phases = set()
    while not g.finished and r.t < T0 + 300:
        r.tick()
        phases.add(g.phase)
    assert g.finished and phases >= {"intro", "play", "end", "final", "done"}
    assert T0 + 60 < r.t < T0 + 200
    res = g.results
    assert [x["playerId"] for x in res] and len(res) == n
    for i, row in enumerate(res):
        assert set(row) == {"playerId", "name", "score", "rank", "isWinner", "stats"}
        assert row["stats"]["tries"] == 8 and row["stats"]["prizes"] == len(row["stats"]["won"])
        assert row["isWinner"] == (row["rank"] == 1)
        if i:
            assert res[i - 1]["score"] >= row["score"] and res[i - 1]["rank"] <= row["rank"]
    # 같은 더미 · 같은 조작(없음) → 모두 같은 결과 → 공동 1위
    assert {row["score"] for row in res} == {res[0]["score"]} and all(row["rank"] == 1 for row in res)
    assert r.states["p1"]["results"] == res
    assert "verdict" not in r.kinds()                 # Gemini 가 꺼져 있으면 총평을 보내지 않는다
    says = [e for _, e in r.events if e["type"] == "say"]
    assert says and all(e["source"] == "canned" and e["who"] == "꽥대장" and e["text"] for e in says)
    assert says[0]["kind"] == "start" and says[-1]["kind"] == "end"
    json.dumps(res)


def test_played_game_with_inputs_and_say_gap():
    g = new_game(3, seed=21)
    r = Run(g)
    r.tick(4.1)
    rnd = random.Random(1)
    plans = {pid: 0.0 for pid in g.ids}
    while g.phase == "play" and r.t < T0 + 300:
        for pid in g.ids:
            m = g.machines[pid]
            if m.claw.state == "move" and r.t >= plans[pid]:
                if m.dir == 0 and m.claw.t < 5:
                    r.send(pid, dir=1)
                    plans[pid] = r.t + rnd.uniform(0.3, 1.3)
                else:
                    r.send(pid, dir=0, drop=True)
                    plans[pid] = r.t + 0.5
        r.tick()
    r.until(lambda: g.finished)
    scores = {row["playerId"]: row["score"] for row in g.results}
    for pid, m in g.machines.items():
        assert scores[pid] == m.score and m.tries == 8
        won_events = [e for who, e in r.events if who == pid and e["type"] == "won"]
        assert sum(e["value"] for e in won_events) == m.score      # 사건으로 알린 점수 = 최종 점수
    # 해설은 너무 자주 나오지 않는다(우선 대사도 1초 간격)
    assert len([e for _, e in r.events if e["type"] == "say"]) <= (r.t - T0) / 1.0 + 1
    assert all(to is None for to, e in r.events if e["type"] == "say")
    assert all(to is not None for to, e in r.events if e["type"] != "say")


def test_ranking_uses_score_then_count_then_gold():
    g = new_game(4)
    P = g.cfg["PRIZES"]

    def give(pid, *types):
        m = g.machines[pid]
        for t in types:
            p = next(x for x in m.prizes if x.type == t)
            m.prizes.remove(p)
            m.won.append(p)

    give("p1", "bear", "cat", "tiger")            # 30점 · 3개
    give("p2", "gold")                            # 30점 · 1개 · 황금곰 1
    give("p3", "dice", "dice")                    # 30점 · 2개
    give("p4", "dice", "chip", "bear")            # 30점 · 3개 (p1 과 완전히 같다)
    assert P["gold"]["value"] == 30
    res = g.build_results()
    assert [(x["playerId"], x["rank"]) for x in res] == [("p1", 1), ("p4", 1), ("p3", 3), ("p2", 4)]
    assert [x["isWinner"] for x in res] == [True, True, False, False]
    assert res[3]["stats"]["gold"] == 1


def test_finished_player_gets_watch_view_and_reconnect_state():
    g = new_game(2, config={"COINS": 1})
    r = Run(g)
    r.tick(4.1)
    r.tick(0.5)
    r.send("p1", drop=True)             # p1 은 바로 내리고, p2 는 8초를 다 쓴다
    r.until(lambda: g.machines["p1"].done)
    r.tick(0.1)
    s = r.states["p1"]
    assert s["phase"] == "play" and s["watch"]["id"] == "p2" and "prizes" in s["watch"]["view"]
    assert "watch" not in r.states["p2"]
    assert s["players"]["p1"]["done"] is True and s["players"]["p2"]["done"] is False
    again = g.state_for("p1", r.t)
    assert again["me"]["coins"] == 0 and again["watch"]["id"] == "p2"
    assert g.state_for("nobody", r.t)["phase"] == "play"
    r.until(lambda: g.finished)
    assert g.state_for("p2", r.t)["results"] == g.results


# ---------------------------------------------------------------- AI
class FakeGemini:
    """tests/test_caster.py 와 같은 방식의 가짜 Gemini."""

    def __init__(self):
        self.calls = []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append({"prompt": prompt, "schema": schema, "system": system})
        props = (schema or {}).get("properties", {})
        if "headline" in props:
            return {"headline": "뜨거운 한 판이었다 꽥", "mvp": "집게의 달인", "cheer": "다음엔 황금곰이다"}
        return {kind: [f"AI {kind} {{name}}", f"AI {kind} 둘 {{name}}"] for kind in props}


def test_say_kinds_have_canned_lines():
    assert 6 <= len(SAY_KINDS) <= 10 and set(SAY_KINDS) == set(SAY_CANNED)
    assert all(len(lines) >= 2 for lines in SAY_CANNED.values())


def test_with_fake_gemini_say_is_ai_and_verdict_is_sent():
    fake = FakeGemini()
    g = new_game(2, config={"COINS": 1}, services={"gemini": fake})
    r = Run(g)
    for _ in range(200):                # 대사 묶음이 도착할 때까지(스레드)
        if g.book.ready:
            break
        time.sleep(0.01)
    assert g.book.ready
    r.tick(4.1)
    says = [e for _, e in r.events if e["type"] == "say"]
    assert says and says[0]["source"] == "gemini" and says[0]["text"].startswith("AI start")
    r.until(lambda: g.phase == "final")
    for _ in range(200):
        r.tick()
        if g.verdict is not None or g.finished:
            break
        time.sleep(0.01)
    assert g.verdict == {"headline": "뜨거운 한 판이었다 꽥", "mvp": "집게의 달인", "cheer": "다음엔 황금곰이다"}
    assert [e for _, e in r.events if e["type"] == "verdict"] == [{"type": "verdict", **g.verdict}]
    assert r.states["p1"]["verdict"] == g.verdict and g.state_for("p2", r.t)["verdict"] == g.verdict
    assert len(fake.calls) == 2         # 대사 묶음 1번 + 총평 1번 (게임 진행 중에는 부르지 않는다)
    assert "{name}" not in " ".join(e["text"] for _, e in r.events if e["type"] == "say")
    r.until(lambda: g.finished)


# ---------------------------------------------------------------- 브라우저 쪽 시험용 진행기와 비교
def _node(args, stdin=None):
    node = shutil.which("node")
    if node is None:
        pytest.skip("node 가 없다")
    out = subprocess.run([node, "tests/claw-sim.mjs", *args], cwd=WEB, input=stdin, capture_output=True,
                         text=True, encoding="utf-8", timeout=120)
    assert out.returncode == 0, out.stderr
    return out.stdout


def test_config_matches_browser_sim():
    assert json.loads(_node(["--config"])) == DEFAULT_CONFIG


def test_machine_matches_browser_sim_exactly():
    script = {"seed": 987654321, "moves": [[30, 20], [55, 5], [12, 40], [70, 10], [44, 15], [20, 20], [62, 8], [36, 30]]}
    js = json.loads(_node(["--trace"], json.dumps(script)))
    cfg = merge_config(None)
    pile = make_pile(cfg, script["seed"])
    assert [[p.id, p.type, p.x, p.y] for p in pile] == js["pile"]
    m = Machine(cfg, script["seed"], pile)
    events = []

    def pull():
        for e in m.events:
            events.append(f"{e['type']}:{e['id']}" if e["type"] in ("won", "grab", "slip") else e["type"])
        m.events = []

    for hold, wait in script["moves"]:
        play_try(m, hold, wait)
        pull()
    for _ in range(120):
        m.step()
    pull()
    assert events == js["events"]
    assert [p.id for p in m.won] == js["won"] and m.score == js["score"] and m.frame == js["frame"]
    assert [[p.id, p.x, p.y] for p in m.prizes] == js["prizes"]
