"""과일자르기: 서버 판정(Python)과 시험용 진행기(JS FruitSim)가 같은 입력에 같은 결과를 내는지,
그리고 양쪽의 규칙 값이 같은지 비교한다. Node.js 가 없으면 건너뛴다."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from party.games.fruit.config import DEFAULT_CONFIG
from party.games.fruit.game import FruitGame
from test_tug_parity import assert_close

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
REPLAY = WEB_DIR / "tests" / "fruit-replay.mjs"
FAST = {"RULES": {"DURATION": 30.0, "INTRO_TIME": 0.5, "COUNTDOWN": 0.5, "END_DELAY": 0.6, "FINAL_TIME": 0.5},
        "SPAWN": {"FIRST_ITEM_AFTER": 2.0, "ITEM_COOLDOWN": 4.0}}

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")


def node(args, stdin=None):
    proc = subprocess.run(["node", str(REPLAY), *args], input=stdin, capture_output=True, text=True,
                          cwd=str(WEB_DIR), timeout=180)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout)


def test_config_is_the_same_on_both_sides():
    assert_close(node(["--config"]), DEFAULT_CONFIG, "config")


def build_script(n_players: int, seed: int) -> dict:
    r = random.Random(seed)
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n_players)]
    now = 300.0
    ops: list = [["start", now]]
    dt = 1.0 / 20.0
    start_at = now + 1.0
    for i in range(1, int(34 / dt)):
        t = now + i * dt
        gt = t - start_at
        for p in players:
            if r.random() < 0.5:
                # 화면을 크게 가로지르는 칼질 몇 개(시각은 조금 과거)
                segs = []
                for _ in range(r.randint(1, 3)):
                    x0, y0 = r.uniform(0, 320), r.uniform(10, 170)
                    x1, y1 = x0 + r.uniform(-90, 90), y0 + r.uniform(-60, 60)
                    t1 = gt - r.uniform(0, 0.2)
                    segs.append([round(t1 - 0.02, 3), round(x0, 1), round(y0, 1), round(t1, 3), round(x1, 1), round(y1, 1)])
                ops.append(["input", p["id"], {"k": "cut", "segs": segs}, t])
        ops.append(["tick", t])
    return {"players": players, "config": FAST, "rng": [r.random() for _ in range(997)], "ops": ops}


def run_python(script: dict) -> dict:
    values = script["rng"]
    idx = {"i": 0}

    def rng() -> float:
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    game = FruitGame(script["players"], {"config": script["config"]}, rng)
    options = game.client_options()
    trace, events = [], []
    for op in script["ops"]:
        if op[0] == "start":
            game.start(op[1])
        elif op[0] == "tick":
            game.tick(op[1])
        else:
            game.on_input(op[1], op[2], op[3])
        for to, kind, data in game.drain():
            if kind == "event":
                events.append([to, data])
            else:
                trace.append(data)
    reconnect = game.state_for(script["players"][0]["id"], script["ops"][-1][1])
    return {"options": options, "trace": trace, "events": events, "finished": game.finished, "results": game.results,
            "reconnect": reconnect}


@pytest.mark.parametrize("n_players,seed", [(2, 31), (3, 32), (5, 33), (5, 77)])
def test_python_and_js_sim_agree(n_players, seed):
    script = build_script(n_players, seed)
    py = run_python(script)
    js = node([], json.dumps(script))
    assert py["finished"] and js["finished"]
    kinds = {(e["type"], e.get("kind")) for _to, e in py["events"]}
    assert {("slice", "fruit"), ("slice", "bomb"), ("slice", "item"), ("combo", None)} <= kinds    # 비교가 의미 있도록
    assert_close(py["options"], js["options"], "options")
    assert_close(py["events"], js["events"], "events")
    assert_close(py["trace"], js["trace"], "trace")
    assert_close(py["results"], js["results"], "results")
    assert_close(py["reconnect"], js["reconnect"], "reconnect")
