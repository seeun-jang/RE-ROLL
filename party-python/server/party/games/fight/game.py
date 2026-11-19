"""매직 파이트 나이트 — 1:1 복싱 리그전 진행 + 공통 규격(MiniGame) 연결부.

진행 방식(손바닥 밀치기 · 검도와 같다)
- 3명 이상: 모든 사람이 서로 한 번씩 만난다. 한 라운드에 짝이 된 사람들이 동시에 경기하고,
  인원이 홀수면 한 명이 쉬며 관전한다(3명 3라운드, 4명 3라운드, 5명 5라운드).
- 2명: 같은 상대와 ROUNDS_FOR_TWO 판(코너를 번갈아).
- 순위: 이긴 횟수가 많은 순 → 같으면 KO 승 보너스 + 이긴 경기에서 남은 체력 합이 높은 순.
  (점수 = 승수×1000 + KO승×50 + 남은 체력 이라서 점수 내림차순이 곧 이 순서다)

장면(phase)
    intro    대진 안내               (startAt 까지)
    fight    경기(선수 소개 → 45초 → KO 카운트/판정). 모든 경기가 끝나고 END_HOLD 가 지날 때까지
    result   라운드 결과             (RESULT_TIME)
    final    최종 결과 + AI 총평     (FINAL_TIME 뒤 종료)

입력: {"k": "in", "held": 비트(1 왼쪽, 2 오른쪽, 4 펀치, 8 가드), "press": [방금 새로 누른 키 이름...]}
"""

from __future__ import annotations

import math

from ...minigame import MiniGame, rank_results
from ...services.caster import LineBook, ask_verdict, verdict_or_none
from .bout import Bout
from .config import LOGIC_FPS, merge_config

PRESS_BITS = {"left": 1, "right": 2, "punch": 4, "guard": 8}
CASTER = "해설자"

#: AI 해설 — 상황 종류와 설명(Gemini 에게 보내는 말)
SAY_KINDS = {
    "start": "복싱 경기 시작 종이 울렸을 때",
    "big_hit": "{name} 선수가 강펀치(어퍼컷)를 제대로 맞혔을 때",
    "slip": "{name} 선수가 펀치를 슥 피해서 카운터 기회를 잡았을 때",
    "counter": "{name} 선수가 카운터 펀치를 꽂았을 때",
    "guard_break": "{name} 선수의 강펀치가 상대 가드를 깨뜨렸을 때",
    "comeback": "체력이 뒤지던 {name} 선수가 역전했을 때",
    "hurry": "남은 시간이 10초뿐일 때",
    "ko": "{name} 선수가 상대를 KO 시켰을 때",
    "decision": "시간이 끝나 {name} 선수가 판정으로 이겼을 때",
}
#: Gemini 가 꺼져 있거나 답이 늦을 때 쓰는 기본 대사
SAY_CANNED = {
    "start": ["땡! 경기 시작합니다!", "자, 주먹을 올리세요!", "오늘 밤의 승자는 누구?"],
    "big_hit": ["{name}의 강펀치 작렬!", "묵직하다! {name}!", "{name}, 제대로 꽂았다!"],
    "slip": ["{name} 슥! 카운터 찬스!", "{name}, 종이 한 장 차이로 피했다!"],
    "counter": ["{name}의 카운터! 피해 2배!", "빡! {name}의 받아치기!"],
    "guard_break": ["{name}, 가드를 부쉈다!", "가드가 열렸다! {name} 기회!"],
    "comeback": ["{name} 역전입니다!", "흐름이 {name} 쪽으로!"],
    "hurry": ["남은 시간 10초!", "시간이 없다! 몰아쳐라!"],
    "ko": ["{name}의 KO 승리!", "쓰러졌다! {name} 승!"],
    "decision": ["판정! {name} 승리!", "끝까지 버틴 {name} 승!"],
}
#: 간격 제한 없이 항상 말하는 상황
SAY_ALWAYS = ("start", "ko", "decision")
#: 역전으로 보려면 이만큼(체력) 뒤져 있었어야 한다
COMEBACK_GAP = 15


def make_schedule(ids: list[str], rng, rounds_for_two: int) -> list[dict]:
    """라운드별 대진표 [{"matches": [(홍코너 id, 청코너 id), ...], "resting": [id, ...]}]."""
    order = list(ids)
    for i in range(len(order) - 1, 0, -1):        # 무작위로 섞는다(피셔-예이츠)
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
                matches.append((x, y) if (r + i) % 2 == 0 else (y, x))   # 코너를 번갈아 준다
        out.append({"matches": matches, "resting": resting})
        seats = [seats[0], seats[-1]] + seats[1:-1]   # 첫 자리만 고정하고 나머지를 한 칸씩 돌린다
    return out


class FightGame(MiniGame):
    id = "fight"
    title = "매직 파이트 나이트"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.config = merge_config(self.options.get("config"))
        self.F = self.config["FLOW"]
        self.names = {p["id"]: p["name"] for p in self.players}
        self.ids = [p["id"] for p in self.players]
        self.schedule = make_schedule(self.ids, rng, int(self.F["ROUNDS_FOR_TWO"]))
        self.standings = {
            pid: {"wins": 0, "losses": 0, "kos": 0, "hpLeft": 0, "damage": 0, "hits": 0, "matches": 0}
            for pid in self.ids
        }
        self.phase = "idle"
        self.round = 0
        self.bouts: list[Bout] = []
        self.start_at = 0.0
        self.phase_until = 0.0
        self.sim_frame = 0
        self.all_over_frame: int | None = None
        self.round_results: list[dict] = []
        self.final_results: list[dict] = []
        # 참가자별 입력: 누르고 있는 키(비트) + 아직 반영하지 않은 '방금 누른 키'(비트)
        self.held = {pid: 0 for pid in self.ids}
        self.pressed = {pid: 0 for pid in self.ids}
        # AI
        self.book: LineBook | None = None
        self._last_say: dict[int, int] = {}     # 경기 번호 → 마지막으로 말한 프레임
        self._trailing: dict[int, str | None] = {}   # 경기 번호 → 크게 뒤지고 있던 쪽('red'|'blue')
        self.verdict_job = None
        self.verdict: dict | None = None
        self._last_phase = None
        self._last_state_at = -1.0

    def client_options(self) -> dict:
        return {"config": self.config, "rounds": len(self.schedule)}

    # ------------------------------------------------------------------
    def start(self, now: float) -> None:
        # AI 해설 대사 묶음을 미리 요청해 둔다(기다리지 않는다)
        self.book = LineBook(
            self.services.get("gemini"), game=self.title, caster=CASTER,
            kinds={k: v.replace("{name} 선수", "한 선수") for k, v in SAY_KINDS.items()},
            canned=SAY_CANNED, players=list(self.names.values()),
            extra="카지노 지하 특설 링에서 동물들이 겨루는 복싱 중계다.",
        )
        self.book.prepare()
        self._begin_round(1, now)
        self._emit(now, force=True)

    def _begin_round(self, round_no: int, now: float) -> None:
        self.round = round_no
        plan = self.schedule[round_no - 1]
        self.bouts = [
            Bout(self.config, {"id": a, "name": self.names[a]}, {"id": b, "name": self.names[b]}, self.rng)
            for a, b in plan["matches"]
        ]
        for pid in self.ids:
            self.held[pid] = 0
            self.pressed[pid] = 0
        self.start_at = now + self.F["INTRO_TIME"]
        self.sim_frame = 0
        self.all_over_frame = None
        self.round_results = []
        self._last_say = {}
        self._trailing = {}
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
                    # AI 총평을 한 번 요청한다(답은 tick 에서 확인)
                    self.verdict_job = ask_verdict(
                        self.services.get("gemini"), game=self.title, results=self.final_results, caster=CASTER,
                        note="stats: wins 승, losses 패, kos KO 승, hpLeft 이긴 경기에서 남은 체력 합, damage 준 피해",
                    )
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
            for index, b in enumerate(self.bouts):
                b.step(self._ctrl(b.red.player_id), self._ctrl(b.blue.player_id))
                for ev in b.pop_events():
                    self.send_event({**ev, "match": index})
                    self._comment(index, b, ev)
            for pid in self.ids:
                self.pressed[pid] = 0
            self.sim_frame += 1
            if self.all_over_frame is None and all(b.done for b in self.bouts):
                self.all_over_frame = self.sim_frame
            if self.all_over_frame is not None and self.sim_frame >= self.all_over_frame + hold_frames:
                self._end_round()
                return

    def _ctrl(self, pid: str) -> dict:
        # 한 프레임보다 짧게 톡 친 키도 놓치지 않도록 '방금 누른 키'를 한 프레임 동안 누른 것으로 본다
        bits = self.held[pid] | self.pressed[pid]
        return {"left": bool(bits & 1), "right": bool(bits & 2), "skill": bool(bits & 4), "down": bool(bits & 8)}

    # ----- AI 해설 -----
    def _comment(self, index: int, b: Bout, ev: dict) -> None:
        """경기에서 일어난 일을 보고 해설 한 줄을 보낸다."""
        kind, name = None, ""
        t = ev["type"]
        if t == "start":
            kind = "start"
        elif t == "hurry":
            kind = "hurry"
        elif t == "ko":
            kind, name = "ko", b.winner.name
        elif t == "decision":
            kind, name = "decision", b.winner.name
        elif t == "hit" and not ev["ko"]:
            att = b.red if ev["side"] == "red" else b.blue
            name = att.name
            if ev["slip"]:
                kind, name = "slip", (b.blue if att is b.red else b.red).name
            elif self._is_comeback(index, b):
                kind = "comeback"
            elif ev["counter"]:
                kind = "counter"
            elif ev["broken"]:
                kind = "guard_break"
            elif ev["kind"] == "power" and not ev["blocked"]:
                kind = "big_hit"
        if kind is None or self.book is None:
            return
        gap = math.floor(self.F["SAY_GAP"] * LOGIC_FPS)
        last = self._last_say.get(index)
        if kind not in SAY_ALWAYS and last is not None and self.sim_frame - last < gap:
            return
        text, source = self.book.line(kind, self.rng, name=name)
        if not text:
            return
        self._last_say[index] = self.sim_frame
        self.send_event({"type": "say", "text": text, "source": source, "who": CASTER, "kind": kind, "match": index})

    def _is_comeback(self, index: int, b: Bout) -> bool:
        """크게 뒤지던 쪽이 앞서게 됐는지(한 번 알리면 다시 뒤질 때까지 알리지 않는다)."""
        diff = b.red.hp - b.blue.hp
        trailing = self._trailing.get(index)
        if trailing == "red" and diff > 0 or trailing == "blue" and diff < 0:
            self._trailing[index] = None
            return True
        if diff <= -COMEBACK_GAP:
            self._trailing[index] = "red"
        elif diff >= COMEBACK_GAP:
            self._trailing[index] = "blue"
        return False

    def _check_verdict(self) -> None:
        if self.verdict_job is None or not self.verdict_job.done():
            return
        verdict = verdict_or_none(self.verdict_job)
        self.verdict_job = None
        if verdict and self.phase == "final":
            self.verdict = verdict
            self.send_event({"type": "verdict", **verdict})

    # ----- 라운드 끝 · 결과 -----
    def _end_round(self) -> None:
        self.round_results = []
        for b in self.bouts:
            w, l = b.winner, b.loser
            for f in (b.red, b.blue):
                st = self.standings[f.player_id]
                st["matches"] += 1
                st["damage"] += f.damage_dealt
                st["hits"] += f.hits
            sw, sl = self.standings[w.player_id], self.standings[l.player_id]
            sw["wins"] += 1
            sw["hpLeft"] += w.hp
            sw["kos"] += 1 if b.by_ko else 0
            sl["losses"] += 1
            self.round_results.append({
                "red": b.red.player_id, "blue": b.blue.player_id, "winner": w.player_id, "byKO": b.by_ko,
                "hp": {"red": b.red.hp, "blue": b.blue.hp}, "hits": {"red": b.red.hits, "blue": b.blue.hits},
            })
        self.phase = "result"
        self.phase_until = self.start_at + self.sim_frame / LOGIC_FPS + self.F["RESULT_TIME"]

    def _score(self, st: dict) -> int:
        S = self.config["SCORE"]
        return st["wins"] * S["WIN"] + st["kos"] * S["KO_BONUS"] + st["hpLeft"] * S["HP_BONUS"]

    def _build_results(self) -> list[dict]:
        return rank_results([
            {"playerId": pid, "name": self.names[pid], "score": self._score(self.standings[pid]),
             "stats": dict(self.standings[pid])}
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
                if isinstance(key, str) and key in PRESS_BITS:
                    self.pressed[player_id] |= PRESS_BITS[key]

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        # 연결이 끊기면 누르고 있던 키를 모두 뗀 것으로 본다(선수는 그 자리에 서 있는다)
        if not connected and player_id in self.held:
            self.held[player_id] = 0

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now)

    def snapshot(self, now: float) -> dict:
        plan = self.schedule[self.round - 1] if self.round else {"matches": [], "resting": []}
        return {
            "phase": self.phase, "round": self.round, "rounds": len(self.schedule), "now": now,
            "startAt": self.start_at,
            "matches": [{"red": a, "blue": b} for a, b in plan["matches"]],
            "resting": list(plan["resting"]),
            "bouts": [b.snapshot() for b in self.bouts],
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
