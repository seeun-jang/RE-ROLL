"""교수님 몰래 댄스! (서버 판정) — 한 교실에서 2~5명이 동시에 몰래 춤춘다.

규칙 (원본 js/scenes/play.js 의 updateStudent 를 옮긴 것)
- 수업 60초. 키를 누르고 있는 동안 춤춘다: 작은 춤 초당 6점(바로 멈춤), 큰 춤 초당 15점(멈추는 데 14프레임).
- 교수님(컴퓨터)이 반을 보고 있을 때 춤추고 있으면 걸린다: -20점, 피버 초기화, 2.5초 벌서기. 3번 걸리면 복도행.
- 춤춘 뒤 교수님이 돌아봤을 때 안 걸리고 버티면 피버 ×1 → ×1.5 → ×2 → ×3.
- 순위: 점수 → 덜 걸린 순 → 최고 피버.
- 원본과 다른 점: 교수님이 보기 시작한 뒤 GRACE(0.2초) 안에 멈추면 안 걸린다(통신 지연 유예).

장면(phase): intro(수업 시작 안내) → play → end("수업 끝!") → final(최종 결과 + AI 총평) → done

브라우저 → 서버 (game.input 의 data)
    {"k": "in", "big": bool, "small": bool}     누르고 있는 키가 바뀔 때마다

AI (서버의 Gemini, 없으면 기본 동작)
- 교수님 대사(LineBook) · 최종 총평(ask_verdict)
- AI 수업 계획: start() 에서 한 번 요청하고, 도착해 검증을 통과하면 교수님이 그 계획대로 움직인다(teacher.py).
"""

from __future__ import annotations

import math
import random

from ...minigame import MiniGame
from ...services.caster import LineBook, ask_async, ask_verdict, result_or_none, verdict_or_none
from .config import LOGIC_FPS, merge_config
from .teacher import Teacher, clean_plan, plan_request

#: 교수님 대사 — 말투는 스토리보드의 악당 '마법사'(점잖고 비꼬는 존댓말)
CASTER = "마법사"
SAY_KINDS = {
    "start": "수업을 시작하며 학생들에게 한마디",
    "caught_one": "춤추던 학생 {name} 한 명을 딱 잡았을 때",
    "caught_many": "춤추던 학생 여러 명을 한꺼번에 잡았을 때",
    "fake": "돌아보는 척만 했는데(페이크) 학생들이 얼어붙은 것을 눈치챘을 때",
    "clean": "돌아봤는데 아무도 걸리지 않아 수상해할 때",
    "fever": "학생 {name} 이 안 걸리고 계속 춤춰 피버가 올랐을 때(수상한 낌새)",
    "hallway": "세 번 걸린 학생 {name} 을 복도로 내보낼 때",
    "last10": "수업이 10초 남았을 때",
}
SAY_CANNED = {
    "start": ["자, 수업을 시작하겠습니다.", "오늘도 조용히 들으시지요."],
    "caught_one": ["{name} 학생, 다 보입니다.", "{name} 학생, 춤은 쉬는 시간에.", "거기 {name} 학생!"],
    "caught_many": ["단체로 춤바람이 나셨군요.", "여러분, 전부 일어나시지요.", "한꺼번에 걸리다니 장하군요."],
    "fake": ["흠, 기분 탓이었나 보군요.", "아닙니다, 계속 쓰지요.", "왜들 그리 굳어 계십니까?"],
    "clean": ["다들 얌전하군요. 수상합니다.", "조용하니 더 의심스럽군요.", "착한 학생들이군요, 과연?"],
    "fever": ["{name} 학생, 표정이 수상하군요.", "{name} 학생은 운이 좋으시군요.", "누가 신이 난 것 같은데요."],
    "hallway": ["{name} 학생, 복도로 나가시지요.", "{name} 학생은 복도가 어울리겠군요."],
    "last10": ["10초 남았습니다. 방심 마시지요.", "곧 끝납니다. 끝까지 지켜보지요."],
}


class SneakyGame(MiniGame):
    id = "sneaky"
    title = "교수님 몰래 댄스!"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        # 대사 고르기는 따로 만든 난수를 쓴다(대사 때문에 교수님 움직임이 달라지지 않게). 씨앗은 self.rng 에서 뽑는다.
        self._line_rng = random.Random(int(rng() * 1e9)).random
        self.teacher = Teacher(rng, self.cfg["TEACHER"])
        self.students = [
            {
                "id": p["id"], "big": False, "small": False,   # 누르고 있는 키
                "mode": "none",                                # none | small | big | recover
                "recover": 0, "punish": 0, "strikes": 0, "out": False, "outFrames": 0,
                "fever": 0, "maxFever": 0, "score": 0.0,
                "danced": False,                               # 이번 쓰기 동안 춤췄나 (피버 조건)
                "caughtLook": False, "danceFrames": 0,
            }
            for p in self.players
        ]
        self.by_id = {s["id"]: s for s in self.students}
        self.phase = "idle"
        self.start_at = 0.0
        self.phase_until = 0.0
        self.sim_frame = 0
        self.end_frame: int | None = None
        self.left = int(self.cfg["CLASS_TIME"])
        self.line_idx = 0                 # 칠판에 쓰는 줄 번호
        self.look_caught = 0              # 이번에 돌아봐서 잡은 수
        self.final_results: list[dict] = []
        self.verdict: dict | None = None
        self.plan_source = "none"         # none | pending | gemini
        self.book: LineBook | None = None
        self._plan_job = None
        self._verdict_job = None
        self._last_say_frame = -10**9
        self._last_phase = None
        self._last_state_at = -1.0

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        c = self.cfg
        keys = ("CLASS_TIME", "SMALL_RATE", "BIG_RATE", "BIG_RECOVER", "FEVER", "CAUGHT_PENALTY",
                "PUNISH_TIME", "MAX_STRIKES", "GRACE", "FLOW")
        return {"config": {k: c[k] for k in keys}, "seeFrom": c["TEACHER"]["SEE_FROM"]}

    def start(self, now: float) -> None:
        self.start_at = now + self.cfg["FLOW"]["INTRO_TIME"]
        self.phase = "intro"
        gemini = self.services.get("gemini")
        # AI 대사 묶음(스레드에서 미리 받아 둔다)
        self.book = LineBook(
            gemini, game=self.title, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
            players=list(self.names.values()), max_chars=18,
            extra="마법사가 교수님으로 변장해 수업을 하고 있다. 학생들은 교수님 몰래 춤춘다. 교수님의 말풍선에 들어갈 대사다.",
        )
        self.book.prepare()
        # AI 수업 계획 요청(기다리지 않는다 — 올 때까지는 규칙 기반)
        system, prompt, schema = plan_request(self.cfg, len(self.players))
        self._plan_job = ask_async(gemini, prompt, schema, system=system)
        if self._plan_job is not None:
            self.plan_source = "pending"
        self._emit(now, force=True)

    def tick(self, now: float) -> None:
        self._poll_plan()
        self._advance(now)
        self._poll_verdict(now)
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    # ------------------------------------------------------------------
    # AI
    # ------------------------------------------------------------------
    def _poll_plan(self) -> None:
        """수업 계획이 도착했는지 본다. 검증을 통과하면 교수님에게 넘긴다."""
        job = self._plan_job
        if job is None or not job.done():
            return
        self._plan_job = None
        steps = clean_plan(result_or_none(job), self.cfg)
        if steps is None or self.phase not in ("intro", "play"):
            self.plan_source = "none"          # 잘못된 계획 · 너무 늦은 계획 → 규칙 기반 그대로
            return
        self.teacher.set_plan(steps, 1 - self.left / self.cfg["CLASS_TIME"])
        self.plan_source = "gemini"
        self.send_event({"type": "plan", "steps": len(steps)})

    def _poll_verdict(self, now: float) -> None:
        if self._verdict_job is None or not self._verdict_job.done():
            return
        self.verdict = verdict_or_none(self._verdict_job)
        self._verdict_job = None
        if self.verdict and self.phase in ("end", "final"):
            self.send_event({"type": "verdict", **self.verdict})
            self._emit(now, force=True)

    def _say(self, kind: str, name: str = "여러분", force: bool = False) -> None:
        """교수님 대사 한 줄. 너무 자주 말하지 않게 간격을 둔다(force = 중요한 대사)."""
        if self.book is None:
            return
        if not force and self.sim_frame - self._last_say_frame < self.cfg["SAY_GAP"] * LOGIC_FPS:
            return
        text, source = self.book.line(kind, self._line_rng, name=name)
        if not text:
            return
        self._last_say_frame = self.sim_frame
        self.send_event({"type": "say", "kind": kind, "text": text, "source": source, "who": CASTER})

    # ------------------------------------------------------------------
    # 진행
    # ------------------------------------------------------------------
    def _advance(self, now: float) -> None:
        for _ in range(6):
            if self.phase == "intro":
                if now < self.start_at:
                    return
                self.phase = "play"
                self._say("start", force=True)
            elif self.phase in ("play", "end"):
                self._simulate(now)
                if self.phase in ("play", "end"):
                    return
            elif self.phase == "final":
                if now < self.phase_until:
                    return
                self.phase = "done"
            else:
                return

    def _simulate(self, now: float) -> None:
        """서버 시계에 맞춰 1/60초씩 진행한다."""
        target = math.floor((now - self.start_at) * LOGIC_FPS + 1e-6)
        hold = round(self.cfg["FLOW"]["END_HOLD"] * LOGIC_FPS)
        while self.sim_frame < target:
            self.sim_frame += 1
            if self.phase == "play":
                self._step()
            if self.end_frame is not None and self.sim_frame >= self.end_frame + hold:
                self.phase = "final"
                self.phase_until = self.start_at + self.sim_frame / LOGIC_FPS + self.cfg["FLOW"]["FINAL_TIME"]
                return

    def _step(self) -> None:
        """한 프레임(1/60초)."""
        c = self.cfg
        tc = self.teacher
        k = 1 - self.left / c["CLASS_TIME"]
        was_look = tc.state == "look"
        tc.update(k)
        for e in tc.events:
            if e["type"] == "fake":
                self.send_event({"type": "fake", "frame": self.sim_frame})
                self._say("fake")
                continue
            if e["type"] == "write":              # 새 줄 쓰기 시작
                self.line_idx += 1
                for s in self.students:
                    s["danced"] = False
            elif e["type"] == "turn":
                self.look_caught = 0
            self.send_event({"type": "teacher", "state": e["type"], "frame": self.sim_frame,
                             "sudden": tc.sudden and e["type"] == "turn"})
        tc.events.clear()

        # 다 보고 다시 칠판으로 → 안 걸린 사람은 피버 상승
        if was_look and tc.state == "back":
            top = None
            for s in self.students:
                if (not s["out"] and not s["caughtLook"] and s["danced"] and s["punish"] == 0
                        and s["fever"] < len(c["FEVER"]) - 1):
                    s["fever"] += 1
                    s["maxFever"] = max(s["maxFever"], s["fever"])
                    self.send_event({"type": "fever", "id": s["id"], "level": s["fever"], "mult": c["FEVER"][s["fever"]]})
                    if s["fever"] >= 2 and (top is None or s["fever"] > top["fever"]):
                        top = s
                s["caughtLook"] = False
            if top is not None:
                self._say("fever", name=self.names[top["id"]])
            elif self.look_caught == 0:
                self._say("clean")

        caught = [s for s in self.students if self._update_student(s)]
        if caught:
            self.look_caught += len(caught)
            out = [s["id"] for s in caught if s["out"]]
            self.send_event({"type": "caught", "ids": [s["id"] for s in caught], "out": out,
                             "penalty": c["CAUGHT_PENALTY"]})
            if out:
                self._say("hallway", name=self.names[out[0]], force=True)
            elif len(caught) == 1:
                self._say("caught_one", name=self.names[caught[0]["id"]], force=True)
            else:
                self._say("caught_many", force=True)

        # 수업 시간
        self.left -= 1
        if self.left == c["LAST_SECONDS"] * LOGIC_FPS:
            self._say("last10", force=True)
        if self.left <= 0:
            self._end()

    def _update_student(self, s: dict) -> bool:
        """학생 한 명의 한 프레임. 이번 프레임에 걸렸으면 True."""
        c = self.cfg
        if s["out"]:
            s["outFrames"] += 1
            return False
        if s["punish"] > 0:
            s["punish"] -= 1
            s["mode"] = "none"
            return False
        if s["big"]:
            s["mode"] = "big"
            s["recover"] = c["BIG_RECOVER"]
        elif s["recover"] > 0:
            s["recover"] -= 1
            s["mode"] = "recover"
        else:
            s["mode"] = "small" if s["small"] else "none"
        # 점수 (춤추는 동안만, 피버 배수)
        mult = c["FEVER"][s["fever"]]
        if s["mode"] == "small":
            s["score"] += c["SMALL_RATE"] / LOGIC_FPS * mult
        elif s["mode"] == "big":
            s["score"] += c["BIG_RATE"] / LOGIC_FPS * mult
        if s["mode"] in ("small", "big"):
            s["danced"] = True
            s["danceFrames"] += 1
        # 딱 걸림! (교수님이 보기 시작하고 유예가 지났는데도 춤추고 있으면)
        tc = self.teacher
        if tc.watching and tc.watch_t > c["GRACE"] and s["mode"] != "none":
            s["strikes"] += 1
            s["score"] = max(0.0, s["score"] - c["CAUGHT_PENALTY"])
            s["fever"] = 0
            s["mode"] = "none"
            s["recover"] = 0
            s["caughtLook"] = True
            s["punish"] = c["PUNISH_TIME"]
            if s["strikes"] >= c["MAX_STRIKES"]:
                s["out"] = True
                s["outFrames"] = 0
            return True
        return False

    def _end(self) -> None:
        if self.phase != "play":
            return
        self.phase = "end"
        self.end_frame = self.sim_frame
        for s in self.students:
            s["big"] = s["small"] = False
        self.final_results = self.build_results()
        self.send_event({"type": "end"})
        # AI 총평 요청(결과 화면이 떠 있는 동안 도착하면 보낸다)
        self._verdict_job = ask_verdict(
            self.services.get("gemini"), game=self.title, results=self.final_results, caster=CASTER,
            note="caught = 교수님에게 걸린 횟수, out = 복도로 쫓겨남, maxFever = 최고 피버 배수",
        )

    # ------------------------------------------------------------------
    # 입력
    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if not isinstance(data, dict) or player_id not in self.by_id:
            return
        self._advance(now)
        if data.get("k") != "in" or self.phase not in ("intro", "play"):
            return
        s = self.by_id[player_id]
        # 수업 시작 전에 미리 누르고 있으면 시작과 함께 춤춘다
        s["big"] = data.get("big") is True
        s["small"] = data.get("small") is True

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        if not connected and player_id in self.by_id:     # 나간 사람은 얌전히 앉아 있는 것으로
            self.by_id[player_id]["big"] = self.by_id[player_id]["small"] = False

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now)

    # ------------------------------------------------------------------
    # 결과 / 상태
    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        """공통 결과 형식. 순위: 점수 → 덜 걸린 순 → 최고 피버 (셋 다 같으면 공동 순위)."""
        fever = self.cfg["FEVER"]
        rows = []
        for order, s in enumerate(self.students):
            rows.append({
                "playerId": s["id"], "name": self.names[s["id"]], "score": math.floor(s["score"]),
                "rank": 0, "isWinner": False,
                "stats": {"caught": s["strikes"], "out": s["out"], "maxFever": fever[s["maxFever"]],
                          "danceSec": round(s["danceFrames"] / LOGIC_FPS, 1)},
                "_order": order,
            })
        key = lambda r: (-r["score"], r["stats"]["caught"], -r["stats"]["maxFever"])  # noqa: E731
        rows.sort(key=lambda r: (*key(r), r["_order"]))
        for i, row in enumerate(rows):
            row["rank"] = rows[i - 1]["rank"] if i > 0 and key(rows[i - 1]) == key(row) else i + 1
        for row in rows:
            row["isWinner"] = row["rank"] == 1
            del row["_order"]
        return rows

    def snapshot(self, now: float) -> dict:
        tc = self.teacher
        return {
            "phase": self.phase,
            "now": now,
            "startAt": self.start_at,
            "frame": self.sim_frame,
            "left": self.left,                    # 남은 수업 시간(프레임)
            "teacher": {"state": tc.state, "t": tc.t, "dur": tc.dur, "x": tc.x, "sudden": tc.sudden,
                        "planned": tc.planned},
            "students": [
                {"id": s["id"], "mode": s["mode"], "recover": s["recover"], "punish": s["punish"],
                 "strikes": s["strikes"], "out": s["out"], "outFrames": s["outFrames"],
                 "fever": s["fever"], "maxFever": s["maxFever"], "score": round(s["score"], 2)}
                for s in self.students
            ],
            "line": self.line_idx,
            "plan": self.plan_source,
            "results": self.final_results if self.phase in ("end", "final", "done") else None,
            "verdict": self.verdict,
        }

    def _emit(self, now: float, force: bool = False) -> None:
        changed = self.phase != self._last_phase
        live = self.phase in ("play", "end")
        if force or changed or live or now - self._last_state_at >= 1.0:
            if not force and not changed and now == self._last_state_at:
                return
            self._last_phase = self.phase
            self._last_state_at = now
            self.send_state(self.snapshot(now))
