"""잭팟 탁구왕 — 둘씩 짝지어 동시에 겨루는 리그전 + 공통 규격(MiniGame) 연결부.

진행 방식 (원본의 토너먼트 · CPU 3연전 · 대진 정하기 화면 대신)
- 3명 이상: 모든 사람이 서로 한 번씩 만난다. 한 라운드에 짝이 된 사람들이 동시에 경기한다.
  인원이 홀수면 라운드마다 한 명이 쉬고(관전), 모두 똑같이 한 번씩 쉰다. (3명 3라운드, 4명 3라운드, 5명 5라운드)
- 2명: 한 경기.
- 한 경기(원본 그대로): 3점 선승, 2:2 듀스부터 2점 차, 6점이면 무조건 승리.
- 순위: 이긴 횟수가 많은 순 → 득실차(딴 점수 − 내준 점수)가 큰 순. 둘 다 같으면 공동 순위.

장면(phase)
    intro      대진 안내               (startAt 까지)
    fight      경기                    (모든 경기가 끝나고 END_HOLD 가 지날 때까지)
    result     라운드 결과             (RESULT_TIME)
    final      최종 결과 + AI 총평     (FINAL_TIME 뒤 종료)

입력: {"k": "in", "held": 비트(1 후진, 2 전진, 4 치기), "press": ["hit"]}
      held 는 누르고 있는 키, press 는 방금 새로 누른 키. 바뀔 때마다 보낸다.
      전진 = 탁구대 쪽. 왼쪽 · 오른쪽 어느 자리든 같은 뜻이다(화면은 내 캐릭터를 항상 왼쪽에 그린다).

AI: 해설 대사(LineBook)와 최종 총평(ask_verdict). Gemini 가 꺼져 있으면 기본 대사만 쓴다.
"""

from __future__ import annotations

import math

from ...minigame import MiniGame, rank_results
from ...services.caster import LineBook, ask_verdict, verdict_or_none
from .config import LOGIC_FPS, merge_config
from .rules import Duel

CASTER = "해설자"

#: 해설 상황 → Gemini 에게 알려 줄 설명
SAY_KINDS = {
    "start": "탁구 경기가 막 시작될 때",
    "rally": "랠리가 길게 이어질 때",
    "smash": "{name} 선수가 스매시로 득점했을 때",
    "drop": "{name} 선수가 짧은 드롭샷으로 득점했을 때",
    "miss": "{name} 선수가 네트에 걸리거나 아웃되는 실수를 했을 때",
    "deuce": "2대2 듀스가 됐을 때",
    "matchpoint": "{name} 선수가 한 점만 더 내면 이기는 매치포인트일 때",
    "comeback": "{name} 선수가 지고 있다가 역전했을 때",
    "win": "{name} 선수가 경기를 이겼을 때",
}

#: Gemini 가 없거나 늦을 때 쓰는 기본 대사
SAY_CANNED = {
    "start": ["자, 탁구대 앞에 섰습니다!", "잭팟 탁구왕, 서브 준비!"],
    "rally": ["랠리가 끝날 줄 모릅니다!", "주고받고, 또 주고받고!", "관중석이 들썩입니다!"],
    "smash": ["{name}, 벼락같은 스매시!", "{name}의 스매시가 꽂혔습니다!"],
    "drop": ["{name}, 살짝 떨어뜨렸습니다!", "{name}의 절묘한 드롭샷!"],
    "miss": ["아, {name} 아쉬운 실수!", "{name}, 힘이 너무 들어갔네요!"],
    "deuce": ["듀스! 이제 두 점 차 승부!", "2대2, 승부는 원점입니다!"],
    "matchpoint": ["{name}, 매치포인트!", "{name}, 한 점만 더!"],
    "comeback": ["{name}, 뒤집었습니다!", "{name}의 짜릿한 역전!"],
    "win": ["게임 셋! {name} 승리!", "{name}, 탁구왕에 한 걸음 더!"],
}


def make_schedule(ids: list[str], rng, rounds_for_two: int) -> list[dict]:
    """라운드별 대진표 [{"matches": [(왼쪽 id, 오른쪽 id), ...], "resting": [id, ...]}] — palm · kendo 와 같은 방식."""
    order = list(ids)
    for i in range(len(order) - 1, 0, -1):          # 무작위로 섞는다(피셔-예이츠)
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
                matches.append((x, y) if (r + i) % 2 == 0 else (y, x))     # 라운드마다 좌우 자리를 번갈아 준다
        out.append({"matches": matches, "resting": resting})
        seats = [seats[0], seats[-1]] + seats[1:-1]   # 첫 자리만 고정하고 나머지를 한 칸씩 돌린다
    return out


class PingpongGame(MiniGame):
    id = "pingpong"
    title = "잭팟 탁구왕"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.F = self.cfg["FLOW"]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        self.ids = [p["id"] for p in self.players]
        self.schedule = make_schedule(self.ids, rng, max(1, int(self.F["ROUNDS_FOR_TWO"])))
        self.standings = {pid: {"wins": 0, "losses": 0, "scored": 0, "conceded": 0, "matches": 0, "bestRally": 0}
                          for pid in self.ids}
        self.phase = "idle"
        self.round = 0
        self.duels: list[Duel] = []
        self.start_at = 0.0
        self.phase_until = 0.0
        self.sim_frame = 0              # 이번 라운드에서 진행한 프레임 수
        self.all_over_frame: int | None = None
        self.round_results: list[dict] = []
        self.final_results: list[dict] = []
        # 참가자별 입력: 누르고 있는 키(비트)와 아직 반영하지 않은 '방금 누름'
        self.held = {pid: 0 for pid in self.ids}
        self.pressed = {pid: False for pid in self.ids}
        # AI
        self.book: LineBook | None = None
        self.verdict_job = None
        self.verdict: dict | None = None
        self._say_at: dict = {}         # 경기 번호 → 마지막으로 말한 시각
        self._trail: list[list[int]] = []   # 경기별 [왼쪽이 가장 크게 뒤진 점수 차, 오른쪽이 …] (역전 해설용)
        self._rally_said: list[bool] = []
        self._last_phase = None
        self._last_state_at = -1.0

    def client_options(self) -> dict:
        C = self.cfg
        return {
            "rounds": len(self.schedule), "gamePoints": C["GAME_POINTS"], "deuceCap": C["DEUCE_CAP"],
            "matchIntro": C["MATCH_INTRO"], "caster": CASTER,
        }

    # ------------------------------------------------------------------
    def start(self, now: float) -> None:
        # AI 해설: 이 판에 쓸 대사 묶음을 한 번만 미리 받아 둔다(기다리지 않는다)
        self.book = LineBook(
            self.services.get("gemini"), game=self.title, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
            players=list(self.names.values()),
            extra="1대1 탁구. 3점을 먼저 내면 이긴다. 2대2부터는 듀스.",
        )
        self.book.prepare()
        self._begin_round(1, now)
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
            self.pressed[pid] = False
        self.start_at = at + self.F["INTRO_TIME"]
        self.sim_frame = 0
        self.all_over_frame = None
        self.round_results = []
        self._say_at = {}
        self._trail = [[0, 0] for _ in self.duels]
        self._rally_said = [False for _ in self.duels]
        self.phase = "intro"

    def tick(self, now: float) -> None:
        self._advance(now)
        self._check_verdict()
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def _advance(self, now: float) -> None:
        for _ in range(6):
            if self.phase == "intro":
                if now < self.start_at:
                    return
                self.phase = "fight"
                self._say(None, "start", self.start_at, force=True)
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
                    # AI 총평: 결과가 정해진 순간 한 번만 요청한다
                    self.verdict_job = ask_verdict(
                        self.services.get("gemini"), game=self.title, results=self.final_results, caster=CASTER,
                        note="stats: wins 이긴 경기, scored 딴 점수, conceded 내준 점수, bestRally 가장 긴 랠리",
                    )
            elif self.phase == "final":
                if now < self.phase_until:
                    return
                self.phase = "done"
            else:
                return

    def _simulate(self, now: float) -> None:
        """서버 시계에 맞춰 모든 경기를 1/60초씩 진행한다."""
        target = math.floor((now - self.start_at) * LOGIC_FPS + 1e-6)
        hold_frames = math.floor(self.F["END_HOLD"] * LOGIC_FPS + 0.5)
        while self.sim_frame < target:
            t = self.start_at + self.sim_frame / LOGIC_FPS
            for index, d in enumerate(self.duels):
                a, b = d.left.player_id, d.right.player_id
                if d.step(self._input_for(a), self._input_for(b)):
                    self.pressed[a] = False
                    self.pressed[b] = False
                for ev in d.pop_events():
                    self.send_event({**ev, "match": index})
                    self._commentate(index, d, ev, t)
            self.sim_frame += 1
            if self.all_over_frame is None and all(d.over for d in self.duels):
                self.all_over_frame = self.sim_frame
            if self.all_over_frame is not None and self.sim_frame >= self.all_over_frame + hold_frames:
                self._end_round()
                return

    def _input_for(self, pid: str) -> dict:
        h = self.held[pid]
        return {"back": bool(h & 1), "fwd": bool(h & 2), "hit": bool(h & 4), "hitPressed": self.pressed[pid]}

    # ----- AI 해설 -----
    def _say(self, match: int | None, kind: str, t: float, name: str = "", force: bool = False) -> None:
        """해설 한 줄. match = 경기 번호(None 이면 모두에게). 너무 자주 말하지 않게 간격을 둔다."""
        if self.book is None:
            return
        last = self._say_at.get(match)
        if not force and last is not None and t - last < self.F["SAY_GAP"]:
            return
        text, source = self.book.line(kind, self.rng, name=name)
        if not text:
            return
        self._say_at[match] = t
        self.send_event({"type": "say", "text": text, "source": source, "who": CASTER, "kind": kind, "match": match})

    def _commentate(self, index: int, d: Duel, ev: dict, t: float) -> None:
        """경기 사건을 보고 해설할 상황인지 고른다."""
        kind = ev["type"]
        if kind == "serve":
            self._rally_said[index] = False
        elif kind == "hit" and ev["rally"] >= self.F["LONG_RALLY"] and not self._rally_said[index]:
            self._rally_said[index] = True
            self._say(index, "rally", t)
        elif kind == "end":
            self._say(index, "win", t, d.fighters[ev["winner"]].name, force=True)
        elif kind == "point":
            side = ev["side"]
            scorer, other = d.fighters[side], d.fighters[1 - side]
            trail = self._trail[index]
            before = (scorer.pts - 1) - other.pts              # 이 득점 전 점수 차
            trail[1 - side] = max(trail[1 - side], scorer.pts - other.pts)
            if d.winner is not None:
                return                                          # 곧 'end' 사건에서 승리 대사를 한다
            if trail[side] >= 2 and before <= 0 < scorer.pts - other.pts:
                trail[side] = 0
                self._say(index, "comeback", t, scorer.name)
            elif d.is_deuce:
                self._say(index, "deuce", t)
            elif d.match_point_side is not None:
                self._say(index, "matchpoint", t, d.fighters[d.match_point_side].name)
            elif ev["reason"] == "smash":
                self._say(index, "smash", t, scorer.name)
            elif ev["reason"] in ("net", "out", "serveFault", "ownCourt"):
                self._say(index, "miss", t, other.name)
            elif ev["shot"] == "drop" and ev["hitter"] == side:
                self._say(index, "drop", t, scorer.name)

    def _check_verdict(self) -> None:
        """최종 결과 화면이 떠 있는 동안 총평이 왔는지 확인한다(안 오면 보내지 않는다)."""
        if self.verdict is not None or self.verdict_job is None or not self.verdict_job.done():
            return
        got = verdict_or_none(self.verdict_job)
        self.verdict_job = None
        if got:
            self.verdict = got
            self.send_event({"type": "verdict", **got})

    # ----- 결과 -----
    def _end_round(self) -> None:
        self.round_results = []
        for d in self.duels:
            # 시간 안에 끝나지 않은 경기는 없지만(자동 서브로 반드시 끝난다) 혹시 모르니 앞선 쪽을 승자로 본다
            winner = d.winner or (d.left if d.left.pts >= d.right.pts else d.right)
            for f in d.fighters:
                o = d.right if f is d.left else d.left
                st = self.standings[f.player_id]
                st["matches"] += 1
                st["scored"] += f.pts
                st["conceded"] += o.pts
                st["bestRally"] = max(st["bestRally"], d.best_rally)
                if f is winner:
                    st["wins"] += 1
                else:
                    st["losses"] += 1
            self.round_results.append({
                "a": d.left.player_id, "b": d.right.player_id, "winner": winner.player_id,
                "pts": [d.left.pts, d.right.pts], "bestRally": d.best_rally,
            })
        self.phase = "result"
        self.phase_until = self.start_at + self.sim_frame / LOGIC_FPS + self.F["RESULT_TIME"]

    def _score(self, st: dict) -> int:
        """순위 점수. 승리 점수가 커서 이긴 횟수가 먼저, 그다음 득실차 순이 된다."""
        S = self.cfg["SCORE"]
        return max(0, st["matches"] * S["BASE"] + st["wins"] * S["WIN"] + (st["scored"] - st["conceded"]) * S["DIFF"])

    def _build_results(self) -> list[dict]:
        return rank_results([
            {"playerId": pid, "name": self.names[pid], "score": self._score(self.standings[pid]),
             "stats": {k: self.standings[pid][k] for k in ("wins", "losses", "scored", "conceded", "matches", "bestRally")}}
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
            self.held[player_id] = held & 7
        press = data.get("press")
        if isinstance(press, list) and "hit" in press[:4]:
            self.pressed[player_id] = True

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        # 연결이 끊기면 누르고 있던 키를 모두 뗀 것으로 본다(서브는 4초 뒤 자동으로 들어간다)
        if not connected and player_id in self.held:
            self.held[player_id] = 0
            self.pressed[player_id] = False

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now)

    def snapshot(self, now: float) -> dict:
        plan = self.schedule[self.round - 1] if self.round else {"matches": [], "resting": []}
        return {
            "phase": self.phase, "round": self.round, "rounds": len(self.schedule), "now": now,
            "startAt": self.start_at, "simFrame": self.sim_frame,
            "matches": [{"a": a, "b": b} for a, b in plan["matches"]],
            "resting": list(plan["resting"]),
            "duels": [d.snapshot() for d in self.duels],
            "standings": {pid: {**st, "score": self._score(st)} for pid, st in self.standings.items()},
            "roundResults": self.round_results if self.phase == "result" else None,
            "results": self.final_results if self.phase in ("final", "done") else None,
            "verdict": self.verdict,
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
