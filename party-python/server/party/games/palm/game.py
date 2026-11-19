"""손바닥 밀치기 — 여러 명이 둘씩 짝지어 동시에 겨루는 대회 진행 + 공통 규격(MiniGame) 연결부.

진행 방식
- 3명 이상: 모든 사람이 서로 한 번씩 만난다. 한 라운드에 짝이 된 사람들이 동시에 경기한다.
  인원이 홀수면 라운드마다 한 명이 쉬고(관전), 모두 똑같이 한 번씩 쉰다.
  (3명 3라운드, 4명 3라운드, 5명 5라운드)
- 2명: 같은 상대와 ROUNDS_FOR_TWO 라운드.
- 순위: 이긴 횟수가 많은 순, 같으면 점수 합계가 높은 순.

장면(phase)
    intro      대진 안내              (countdownAt 까지)
    countdown  3·2·1                  (startAt 까지)
    fight      경기                   (모든 경기가 끝나고 END_HOLD 가 지날 때까지)
    result     라운드 결과            (RESULT_TIME)
    final      최종 결과              (FINAL_TIME 뒤 종료)

입력: {"k": "in", "lean": -1|0|1, "push": bool, "hold": bool, "feint": true(누른 순간만)}
"""

from __future__ import annotations

import math

from ...minigame import MiniGame
from .config import LOGIC_FPS, merge_config
from .duel import Duel


def make_schedule(ids: list[str], rng, rounds_for_two: int) -> list[dict]:
    """라운드별 대진표 [{"matches": [(왼쪽 id, 오른쪽 id), ...], "resting": [id, ...]}]."""
    order = list(ids)
    # 무작위로 섞는다(피셔-예이츠)
    for i in range(len(order) - 1, 0, -1):
        j = min(i, math.floor(rng() * (i + 1)))
        order[i], order[j] = order[j], order[i]
    if len(order) == 2:
        a, b = order
        return [{"matches": [(a, b) if r % 2 == 0 else (b, a)], "resting": []} for r in range(rounds_for_two)]
    seats: list[str | None] = order + ([None] if len(order) % 2 else [])
    m = len(seats)
    out = []
    for r in range(m - 1):
        matches, resting = [], []
        for i in range(m // 2):
            x, y = seats[i], seats[m - 1 - i]
            if x is None or y is None:
                resting.append(x if y is None else y)
            else:
                # 라운드마다 좌우 자리를 번갈아 준다
                matches.append((x, y) if (r + i) % 2 == 0 else (y, x))
        out.append({"matches": matches, "resting": resting})
        seats = [seats[0], seats[-1]] + seats[1:-1]   # 첫 자리만 고정하고 나머지를 한 칸씩 돌린다
    return out


class PalmGame(MiniGame):
    id = "palm"
    title = "손바닥 밀치기"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.config = merge_config(self.options.get("config"))
        self.names = {p["id"]: p["name"] for p in self.players}
        self.ids = [p["id"] for p in self.players]
        self.schedule = make_schedule(self.ids, rng, int(self.config["FLOW"]["ROUNDS_FOR_TWO"]))
        self.standings = {pid: {"wins": 0, "draws": 0, "losses": 0, "score": 0, "matches": 0} for pid in self.ids}
        self.phase = "idle"
        self.round = 0
        self.duels: list[Duel] = []
        self.countdown_at = 0.0
        self.start_at = 0.0
        self.phase_until = 0.0
        self.sim_frame = 0              # 이번 라운드에서 진행한 프레임 수
        self.all_over_frame: int | None = None
        self.round_results: list[dict] = []
        self.final_results: list[dict] = []
        # 참가자별 입력: 누르고 있는 상태 + 아직 반영하지 않은 '누른 순간'
        self.held = {pid: {"lean": 0, "push": False, "hold": False} for pid in self.ids}
        self.edges = {pid: {"feint": False, "push": False} for pid in self.ids}
        self._last_phase = None
        self._last_state_at = -1.0

    def client_options(self) -> dict:
        return {"config": self.config, "rounds": len(self.schedule)}

    # ------------------------------------------------------------------
    def start(self, now: float) -> None:
        self._begin_round(1, now)
        self._emit(now, force=True)

    def _begin_round(self, round_no: int, now: float) -> None:
        self.round = round_no
        plan = self.schedule[round_no - 1]
        seed = int(self.config["MATCH"]["SEED"]) + round_no * 101
        self.duels = [
            Duel(self.config, {"id": a, "name": self.names[a]}, {"id": b, "name": self.names[b]}, seed)
            for a, b in plan["matches"]
        ]
        for pid in self.ids:
            self.held[pid] = {"lean": 0, "push": False, "hold": False}
            self.edges[pid] = {"feint": False, "push": False}
        self.countdown_at = now + self.config["FLOW"]["INTRO_TIME"]
        self.start_at = self.countdown_at + self.config["MATCH"]["COUNTDOWN"]
        self.sim_frame = 0
        self.all_over_frame = None
        self.round_results = []
        self.phase = "intro"

    def tick(self, now: float) -> None:
        self._advance(now)
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def _advance(self, now: float) -> None:
        F = self.config["FLOW"]
        for _ in range(6):
            if self.phase == "intro":
                if now < self.countdown_at:
                    return
                self.phase = "countdown"
            elif self.phase == "countdown":
                if now < self.start_at:
                    return
                self.phase = "fight"
                for d in self.duels:
                    d.start()
            elif self.phase == "fight":
                self._simulate(now)
                if self.phase == "fight":
                    return
            elif self.phase == "result":
                if now < self.phase_until:
                    return
                if self.round < len(self.schedule):
                    self._begin_round(self.round + 1, self.phase_until)
                else:
                    self.final_results = self._build_results()
                    self.phase = "final"
                    self.phase_until += F["FINAL_TIME"]
            elif self.phase == "final":
                if now < self.phase_until:
                    return
                self.phase = "done"
            else:
                return

    def _simulate(self, now: float) -> None:
        target = math.floor((now - self.start_at) * LOGIC_FPS + 1e-6)
        hold_frames = round(self.config["FLOW"]["END_HOLD"] * LOGIC_FPS)
        while self.sim_frame < target:
            for index, d in enumerate(self.duels):
                d.step(self._input_for(d.a.player_id), self._input_for(d.b.player_id))
                for ev in d.pop_events():
                    self.send_event({**ev, "match": index})
            for pid in self.ids:
                self.edges[pid]["feint"] = False
                self.edges[pid]["push"] = False
            self.sim_frame += 1
            if self.all_over_frame is None and all(d.over for d in self.duels):
                self.all_over_frame = self.sim_frame
            if self.all_over_frame is not None and self.sim_frame >= self.all_over_frame + hold_frames:
                self._end_round()
                return

    def _input_for(self, pid: str) -> dict:
        held, edge = self.held[pid], self.edges[pid]
        return {
            "lean": held["lean"],
            "pushDown": held["push"] or edge["push"],   # 한 프레임보다 짧게 톡 친 것도 놓치지 않는다
            "feintPressed": edge["feint"],
            "holdDown": held["hold"],
        }

    def _end_round(self) -> None:
        self.round_results = []
        for d in self.duels:
            res = d.result or {"winner": "draw", "reason": "time"}
            scores = {}
            for key, f in (("a", d.a), ("b", d.b)):
                sc = d.score_of(key)
                scores[f.player_id] = {"total": sc["total"], "breakdown": sc["breakdown"]}
                st = self.standings[f.player_id]
                st["matches"] += 1
                st["score"] += sc["total"]
                if res["winner"] == "draw":
                    st["draws"] += 1
                elif res["winner"] == key:
                    st["wins"] += 1
                else:
                    st["losses"] += 1
            winner = None if res["winner"] == "draw" else (d.a if res["winner"] == "a" else d.b).player_id
            self.round_results.append({
                "a": d.a.player_id, "b": d.b.player_id, "winner": winner, "reason": res["reason"], "scores": scores,
            })
        self.phase = "result"
        self.phase_until = self.start_at + self.sim_frame / LOGIC_FPS + self.config["FLOW"]["RESULT_TIME"]

    def _build_results(self) -> list[dict]:
        """공통 결과 형식. 이긴 횟수 → 점수 합계 순."""
        rows = []
        for order, p in enumerate(self.players):
            st = self.standings[p["id"]]
            rows.append({
                "playerId": p["id"], "name": p["name"], "score": st["score"], "rank": 0, "isWinner": False,
                "stats": {"wins": st["wins"], "draws": st["draws"], "losses": st["losses"], "matches": st["matches"]},
                "_order": order,
            })
        rows.sort(key=lambda r: (-r["stats"]["wins"], -r["score"], r["_order"]))
        for i, r in enumerate(rows):
            prev = rows[i - 1] if i > 0 else None
            same = prev is not None and prev["stats"]["wins"] == r["stats"]["wins"] and prev["score"] == r["score"]
            r["rank"] = prev["rank"] if same else i + 1
        for r in rows:
            r["isWinner"] = r["rank"] == 1
            del r["_order"]
        return rows

    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if not isinstance(data, dict) or data.get("k") != "in" or player_id not in self.held:
            return
        self._advance(now)
        if self.phase != "fight":
            return
        held = self.held[player_id]
        lean = data.get("lean")
        held["lean"] = lean if lean in (-1, 0, 1) else 0
        push = bool(data.get("push"))
        if push and not held["push"]:
            self.edges[player_id]["push"] = True
        held["push"] = push
        held["hold"] = bool(data.get("hold"))
        if data.get("feint") is True:
            self.edges[player_id]["feint"] = True

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        # 연결이 끊기면 누르고 있던 키를 모두 뗀 것으로 본다(선수는 그 자리에 서 있는다)
        if not connected and player_id in self.held:
            self.held[player_id] = {"lean": 0, "push": False, "hold": False}

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now)

    def snapshot(self, now: float) -> dict:
        plan = self.schedule[self.round - 1] if self.round else {"matches": [], "resting": []}
        return {
            "phase": self.phase,
            "round": self.round,
            "rounds": len(self.schedule),
            "now": now,
            "countdownAt": self.countdown_at,
            "startAt": self.start_at,
            "matches": [{"a": a, "b": b} for a, b in plan["matches"]],
            "resting": list(plan["resting"]),
            "duels": [d.snapshot() for d in self.duels],
            "standings": {pid: dict(st) for pid, st in self.standings.items()},
            "roundResults": self.round_results if self.phase == "result" else None,
            "results": self.final_results if self.phase in ("final", "done") else None,
        }

    def _emit(self, now: float, force: bool = False) -> None:
        changed = self.phase != self._last_phase
        live = self.phase in ("countdown", "fight")
        if force or changed or live or now - self._last_state_at >= 1.0:
            if not force and not changed and now == self._last_state_at:
                return
            self._last_phase = self.phase
            self._last_state_at = now
            self.send_state(self.snapshot(now))
