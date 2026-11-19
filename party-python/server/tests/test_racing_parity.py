"""레이싱: 서버 판정(Python)과 시험용 진행기(JS RacingSim)가 같은 입력에 같은 결과를 내는지,
그리고 양쪽의 규칙 값이 같은지 비교한다. Node.js 가 없으면 건너뛴다."""

from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from party.games.racing.config import DEFAULT_CONFIG
from party.games.racing.game import RacingGame
from party.games.racing.track import det_cos, det_sin
from test_tug_parity import assert_close

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
REPLAY = WEB_DIR / "tests" / "racing-replay.mjs"
FAST = {"RULES": {"LAPS": 2, "INTRO_TIME": 0.5, "COUNTDOWN": 0.5, "FINISH_GRACE": 8.0, "MAX_TIME": 90.0, "END_DELAY": 0.5,
                  "FINAL_TIME": 0.5, "RANK_SCORES": [100, 70, 50, 30, 10]}}

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")


def node(args, stdin=None):
    proc = subprocess.run(["node", str(REPLAY), *args], input=stdin, capture_output=True, text=True,
                          cwd=str(WEB_DIR), timeout=300)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout)


def test_config_is_the_same_on_both_sides():
    assert_close(node(["--config"]), DEFAULT_CONFIG, "config")


def build_script(n_players: int, seed: int) -> dict:
    """Python 쪽 게임을 돌려 가며 "가운데 선을 따라가는 운전자" 의 입력을 만든다(실력은 제각각, 가끔 벽에 박는다)."""
    r = random.Random(seed)
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n_players)]
    game = RacingGame(players, {"config": FAST}, random.random)
    tr = game.track
    now = 300.0
    game.start(now)
    ops: list = [["start", now]]
    skill = {p["id"]: {"look": r.randint(3, 9), "gas": r.choice([1.0, 1.0, 0.8, 0.5]), "wild": r.random() * 0.25} for p in players}
    dt = 1.0 / 30.0
    i = 0
    while not game.finished and i < 30 * 140:
        i += 1
        t = now + i * dt
        if game.phase == "race":
            for p in players:
                car = game.cars[p["id"]]
                if car["finished"] or r.random() < 0.4:
                    continue
                s = skill[p["id"]]
                k = (car["seg"] + s["look"]) % tr["n"]
                dx, dy = tr["x"][k] - car["x"], tr["y"][k] - car["y"]
                fx, fy = det_cos(car["a"]), det_sin(car["a"])
                ang = math.atan2(fx * dy - fy * dx, fx * dx + fy * dy)
                steer = max(-1.0, min(1.0, ang * 2.5))
                if r.random() < s["wild"]:
                    steer = r.uniform(-1, 1)           # 가끔 엉뚱하게 꺾어 벽에 박는다
                data = {"k": "in", "steer": round(steer, 2), "throttle": s["gas"] if abs(ang) < 1.0 else -0.4,
                        "drift": round(r.random(), 2) if r.random() < 0.2 else 0}
                when = round(t - r.uniform(0, 0.03), 4)
                ops.append(["input", p["id"], data, when])
                game.on_input(p["id"], data, when)
        ops.append(["tick", t])
        game.tick(t)
    assert game.finished
    return {"players": players, "config": FAST, "ops": ops}


def run_python(script: dict) -> dict:
    game = RacingGame(script["players"], {"config": script["config"]}, random.random)
    options = game.client_options()
    trace, events = [], []
    for op in script["ops"]:
        if op[0] == "start":
            game.start(op[1])
        elif op[0] == "tick":
            game.tick(op[1])
        else:
            game.on_input(op[1], op[2], op[3])
        for _to, kind, data in game.drain():
            (events if kind == "event" else trace).append(data)
    return {"options": options, "trace": trace, "events": events, "finished": game.finished, "results": game.results}


@pytest.mark.parametrize("n_players,seed", [(2, 61), (3, 62), (5, 63)])
def test_python_and_js_sim_agree(n_players, seed):
    script = build_script(n_players, seed)
    py = run_python(script)
    js = node([], json.dumps(script))
    assert py["finished"] and js["finished"]
    kinds = {e["type"] for e in py["events"]}
    assert {"lap", "finish", "wall"} <= kinds       # 비교가 의미 있도록
    assert_close(py["options"], js["options"], "options")
    assert_close(py["events"], js["events"], "events")
    assert_close(py["trace"], js["trace"], "trace")
    assert_close(py["results"], js["results"], "results")
