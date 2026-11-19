"""주문 게임: 서버 판정(Python)과 시험용 진행기(JS SpellSim)가 같은 입력에 같은 결과를 내는지,
그리고 양쪽의 주문 데이터가 같은지 비교한다. Node.js 가 없으면 건너뛴다."""

from __future__ import annotations

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from party.games.spell.config import BEATS, SPELLS
from party.games.spell.game import SpellGame
from test_tug_parity import assert_close

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
REPLAY = WEB_DIR / "tests" / "spell-replay.mjs"
FAST = {"BATTLE": {"TIME_LIMIT": 20}, "FLOW": {"INTRO_TIME": 0.5, "END_HOLD": 1.0, "RESULT_TIME": 0.5, "FINAL_TIME": 0.5}}
IDS = [s["id"] for s in SPELLS]

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js 가 설치되어 있지 않음")


def node(args, stdin=None):
    proc = subprocess.run(["node", str(REPLAY), *args], input=stdin, capture_output=True, text=True,
                          cwd=str(WEB_DIR), timeout=180)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout)


def test_spell_data_is_the_same_on_both_sides():
    js = node(["--spells"])
    assert js["beats"] == BEATS
    js_spells = {s["id"]: s for s in js["spells"]}
    assert list(js_spells) == IDS
    for s in SPELLS:
        for key, value in s.items():
            assert js_spells[s["id"]][key] == value, (s["id"], key)


def build_script(n_players: int, seed: int) -> dict:
    r = random.Random(seed)
    players = [{"id": f"p{i + 1}", "name": f"N{i + 1}", "index": i} for i in range(n_players)]
    now = 300.0
    ops: list = [["start", now]]
    dt = 1.0 / 30.0
    for i in range(1, int(150 / dt)):
        t = now + i * dt
        for p in players:
            if r.random() < 0.09:
                ops.append(["input", p["id"], {"k": "cast", "id": r.choice(IDS + ["fireball", "wind_cutter"])}, t])
        ops.append(["tick", t])
    return {"players": players, "config": FAST, "rng": [r.random() for _ in range(32)], "ops": ops}


def run_python(script: dict) -> dict:
    values = script["rng"]
    idx = {"i": 0}

    def rng() -> float:
        v = values[idx["i"] % len(values)]
        idx["i"] += 1
        return v

    game = SpellGame(script["players"], {"config": script["config"]}, rng)
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
    return {"trace": trace, "events": events, "finished": game.finished, "results": game.results}


@pytest.mark.parametrize("n_players,seed", [(2, 21), (3, 22), (4, 23), (5, 24), (5, 99)])
def test_python_and_js_sim_agree(n_players, seed):
    script = build_script(n_players, seed)
    py = run_python(script)
    js = node([], json.dumps(script))
    assert py["finished"] and js["finished"]
    kinds = {e["type"] for e in py["events"]}
    assert {"cast", "castFail", "clash", "hit", "blocked", "strike", "end"} <= kinds   # 비교가 의미 있도록
    for snap in py["trace"]:
        snap.pop("voice")
    for snap in js["trace"]:
        snap.pop("voice")
    assert_close(py["events"], js["events"], "events")
    assert_close(py["trace"], js["trace"], "trace")
    assert_close(py["results"], js["results"], "results")
