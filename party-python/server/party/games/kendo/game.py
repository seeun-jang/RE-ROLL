"""검도 — 둘씩 짝지어 동시에 겨루는 리그전 + 공통 규격(MiniGame) 연결부.

진행 방식
- 시작 전 PRACTICE_TIME(30초) 동안 각자 자기 화면에서 AI 와 연습한다(브라우저 안에서만 돌고 순위에 들어가지 않는다).
- 3명 이상: 모든 사람이 서로 한 번씩 만난다. 한 라운드에 짝이 된 사람들이 동시에 경기한다.
  인원이 홀수면 라운드마다 한 명이 쉬고(관전), 모두 똑같이 한 번씩 쉰다. (3명 3라운드, 4명 3라운드, 5명 5라운드)
- 2명: 한 경기.
- 한 경기: 먼저 두 판(한판 2개)을 따면 승리, 60초. 시간이 끝나면 한 판이라도 앞선 쪽 승리, 동점이면 심판 판정.
- 순위: 1승 100점 + 딴 한 판마다 10점.

장면(phase)
    practice   AI 와 연습              (practiceUntil 까지)
    intro      대진 안내               (startAt 까지)
    fight      경기                    (모든 경기가 끝나고 END_HOLD 가 지날 때까지)
    result     라운드 결과             (RESULT_TIME)
    final      최종 결과               (FINAL_TIME 뒤 종료)

입력: {"k": "in", "held": 비트(1 왼쪽, 2 오른쪽, 4 기합, 8 막기), "press": ["men"|"kote"|"do"|"block"|"kiai", ...]}
      held 는 누르고 있는 키, press 는 방금 새로 누른 키. 바뀔 때마다 보낸다.
"""

from __future__ import annotations

import math

from ...minigame import MiniGame, rank_results
from .config import LOGIC_FPS, merge_config
from .duel import Duel

PRESS_KEYS = ("men", "kote", "do", "block", "kiai")


def make_schedule(ids: list[str], rng, rounds_for_two: int) -> list[dict]:
    """라운드별 대진표 [{"matches": [(홍 id, 백 id), ...], "resting": [id, ...]}]."""
    order = list(ids)
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
                matches.append((x, y) if (r + i) % 2 == 0 else (y, x))     # 라운드마다 홍·백을 번갈아 준다
        out.append({"matches": matches, "resting": resting})
        seats = [seats[0], seats[-1]] + seats[1:-1]
    return out


class KendoGame(MiniGame):
    id = "kendo"
    title = "검도"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.F = self.cfg["FLOW"]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        self.ids = [p["id"] for p in self.players]
        self.schedule = make_schedule(self.ids, rng, int(self.F["ROUNDS_FOR_TWO"]))
        self.standings = {pid: {"wins": 0, "losses": 0, "ippons": 0, "lost": 0, "matches": 0} for pid in self.ids}
        self.phase = "idle"
        self.round = 0
        self.duels: list[Duel] = []
        self.practice_until = 0.0
        self.start_at = 0.0
        self.phase_until = 0.0
        self.sim_frame = 0
        self.all_over_frame: int | None = None
        self.round_results: list[dict] = []
        self.final_results: list[dict] = []
        self.held = {pid: 0 for pid in self.ids}
        self.pressed: dict[str, set] = {pid: set() for pid in self.ids}
        self._last_phase = None
        self._last_state_at = -1.0

    def client_options(self) -> dict:
        return {
            "rounds": len(self.schedule), "practice": self.F["PRACTICE_TIME"],
            "timeSec": self.cfg["MATCH"]["TIME_SEC"], "toWin": self.cfg["MATCH"]["POINTS_TO_WIN"],
        }

    # ------------------------------------------------------------------
    def start(self, now: float) -> None:
        self.phase = "practice"
        self.practice_until = now + self.F["PRACTICE_TIME"]
        self._emit(now, force=True)

    def _begin_round(self, round_no: int, at: float) -> None:
        self.round = round_no
        plan = self.schedule[round_no - 1]
        self.duels = [
            Duel(self.cfg, {"id": a, "name": self.names[a]}, {"id": b, "name": self.names[b]}, self.rng)
            for a, b in plan["matches"]
        ]
        for pid in self.ids:
            self.held[pid] = 0
            self.pressed[pid] = set()
        self.start_at = at + self.F["INTRO_TIME"]
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
        for _ in range(6):
            if self.phase == "practice":
                if now < self.practice_until:
                    return
                self._begin_round(1, self.practice_until)
            elif self.phase == "intro":
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
                    self.phase_until += self.F["FINAL_TIME"]
            elif self.phase == "final":
                if now < self.phase_until:
                    return
                self.phase = "done"
            else:
                return

    def _simulate(self, now: float) -> None:
        target = math.floor((now - self.start_at) * LOGIC_FPS + 1e-6)
        hold_frames = math.floor(self.F["END_HOLD"] * LOGIC_FPS + 0.5)
        while self.sim_frame < target:
            for index, d in enumerate(self.duels):
                d.step(self._input_for(d.red.player_id), self._input_for(d.white.player_id))
                for ev in d.pop_events():
                    self.send_event({**ev, "match": index})
            for pid in self.ids:
                self.pressed[pid] = set()
            self.sim_frame += 1
            if self.all_over_frame is None and all(d.over for d in self.duels):
                self.all_over_frame = self.sim_frame
            if self.all_over_frame is not None and self.sim_frame >= self.all_over_frame + hold_frames:
                self._end_round()
                return

    def _input_for(self, pid: str) -> dict:
        h = self.held[pid]
        return {"left": bool(h & 1), "right": bool(h & 2), "kiai": bool(h & 4), "block": bool(h & 8),
                "pressed": self.pressed[pid]}

    def _end_round(self) -> None:
        self.round_results = []
        for d in self.duels:
            winner_side = d.rules.winner
            for side, f in (("red", d.red), ("white", d.white)):
                st = self.standings[f.player_id]
                st["matches"] += 1
                st["ippons"] += len(d.rules.points[side])
                st["lost"] += len(d.rules.points["white" if side == "red" else "red"])
                if side == winner_side:
                    st["wins"] += 1
                else:
                    st["losses"] += 1
            self.round_results.append({
                "red": d.red.player_id, "white": d.white.player_id,
                "winner": (d.red if winner_side == "red" else d.white).player_id,
                "decidedBy": d.rules.decided_by,
                "points": {"red": list(d.rules.points["red"]), "white": list(d.rules.points["white"])},
            })
        self.phase = "result"
        self.phase_until = self.start_at + self.sim_frame / LOGIC_FPS + self.F["RESULT_TIME"]

    def _score(self, st: dict) -> int:
        return st["wins"] * self.F["WIN_SCORE"] + st["ippons"] * self.F["IPPON_SCORE"]

    def _build_results(self) -> list[dict]:
        return rank_results([
            {"playerId": pid, "name": self.names[pid], "score": self._score(self.standings[pid]),
             "stats": {k: self.standings[pid][k] for k in ("wins", "losses", "ippons", "matches")}}
            for pid in self.ids
        ])

    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if not isinstance(data, dict) or data.get("k") != "in" or player_id not in self.held:
            return
        self._advance(now)
        if self.phase != "fight":
            return
        held = data.get("held")
        if isinstance(held, int) and not isinstance(held, bool):
            self.held[player_id] = held & 15
        press = data.get("press")
        if isinstance(press, list):
            for key in press[:8]:
                if key in PRESS_KEYS:
                    self.pressed[player_id].add(key)

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        # 연결이 끊기면 누르고 있던 키를 모두 뗀 것으로 본다
        if not connected and player_id in self.held:
            self.held[player_id] = 0

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now)

    def snapshot(self, now: float) -> dict:
        plan = self.schedule[self.round - 1] if self.round else {"matches": [], "resting": []}
        return {
            "phase": self.phase, "round": self.round, "rounds": len(self.schedule), "now": now,
            "practiceUntil": self.practice_until, "startAt": self.start_at,
            "matches": [{"red": a, "white": b} for a, b in plan["matches"]],
            "resting": list(plan["resting"]),
            "duels": [d.snapshot() for d in self.duels],
            "standings": {pid: {**st, "score": self._score(st)} for pid, st in self.standings.items()},
            "roundResults": self.round_results if self.phase == "result" else None,
            "results": self.final_results if self.phase in ("final", "done") else None,
        }

    def _emit(self, now: float, force: bool = False) -> None:
        changed = self.phase != self._last_phase
        live = self.phase == "fight"
        if force or changed or live or now - self._last_state_at >= 1.0:
            if not force and not changed and now == self._last_state_at:
                return
            self._last_phase = self.phase
            self._last_state_at = now
            self.send_state(self.snapshot(now))
