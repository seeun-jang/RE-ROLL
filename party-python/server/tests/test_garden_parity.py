"""가든 디펜스: 서버 판정(Python)과 시험용 진행기(JS GardenSim)가 같은 입력에 같은 결과를 내는지,
그리고 양쪽의 규칙 값이 같은지 비교한다. Node.js 가 없으면 건너뛴다."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from party.games.garden.config import DEFAULT_CONFIG
from party.games.garden.game import GardenGame
from test_tug_parity import assert_close

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
REPLAY = WEB_DIR / "tests" / "garden-replay.mjs"
# 짧은 판: 웨이브 두 개(둘째에 보스, 빠르게 걸어와 문 앞까지 온다)
FAST = {
    "RULES": {"DURATION": 40.0, "INTRO_TIME": 0.5, "COUNTDOWN": 0.5, "END_DELAY": 0.6, "FINAL_TIME": 0.5},
    "BOSS_SPAWN_DELAY": 1.0,
    "ENEMIES": {**DEFAULT_CONFIG["ENEMIES"], "boss": {**DEFAULT_CONFIG["ENEMIES"]["boss"], "speed": 14, "hp": 400,
                                                         "summonInterval": 3.0, "laneSwitchInterval": 2.5}},
    "WAVES": [
        {"name": "A", "start": 0.0, "duration": 14.0, "speedMul": 1.6, "hpMul": 1.0, "boss": False,
         "spawns": [["normal", 10], ["runner", 8], ["helmet", 4], ["jumper", 4]]},
        {"name": "B", "start": 14.0, "duration": 22.0, "speedMul": 2.0, "hpMul": 1.3, "boss": True,
         "spawns": [["normal", 14], ["runner", 14], ["helmet", 5], ["jumper", 6]]},
    ],
}

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
    for i in range(1, int(44 / dt)):
        t = now + i * dt
        for p in players:
            if r.random() < 0.12:
                ops.append(["input", p["id"], {"k": "in", "lane": r.randint(0, 4), "fire": r.random() < 0.85},
                            round(t - r.uniform(0, 0.04), 4)])
        ops.append(["tick", t])
    return {"players": players, "config": FAST, "rng": [r.random() for _ in range(997)], "ops": ops}


def run_python(script: dict) -> dict:
    values = script["rng"]
    idx = {"i": 0}

    def rng() -> float:
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    game = GardenGame(script["players"], {"config": script["config"]}, rng)
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
            (events if kind == "event" else trace).append([to, data])
    return {"options": options, "spawns": game.spawns, "trace": trace, "events": events, "finished": game.finished,
            "results": game.results}


@pytest.mark.parametrize("n_players,seed", [(2, 41), (3, 42), (5, 43)])
def test_python_and_js_sim_agree(n_players, seed):
    script = build_script(n_players, seed)
    py = run_python(script)
    js = node([], json.dumps(script))
    assert py["finished"] and js["finished"]
    kinds = {e["type"] for _to, e in py["events"]}
    assert {"kill", "helmet", "breach", "summon"} <= kinds       # 비교가 의미 있도록
    assert any(e["type"] == "breach" and e["boss"] for _to, e in py["events"])
    assert_close(py["options"], js["options"], "options")
    assert_close(py["spawns"], js["spawns"], "spawns")
    assert_close(py["events"], js["events"], "events")
    assert_close(py["trace"], js["trace"], "trace")
    assert_close(py["results"], js["results"], "results")
