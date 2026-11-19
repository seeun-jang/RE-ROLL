"""줄다리기 경기 진행 — 팀 배정 → 카운트다운 → 플레이 → 라운드 결과 → … → 최종 결과.

장면(phase)
    assign     팀 배정 연출            (countdownAt 까지)
    countdown  3·2·1                   (startAt 까지)
    play       박자에 맞춰 당기기      (줄이 선을 넘거나 시간이 끝날 때까지)
    ended      FINISH! + 라운드 결과   (END_HOLD + ROUND_RESULT_TIME)
    summary    점수 기록               (누가 '결과 확인'을 누르거나 SUMMARY_TIME)
    final      최종 결과               (FINAL_TIME 뒤 종료)
    done

같은 내용의 브라우저 시험용 구현: web/src/games/tug/sim/TugSim.js (LocalSession 전용)
"""

from __future__ import annotations

import math
from typing import Callable

from .config import STEP, merge_config
from .systems import Rope, ScoreBoard, TeamAssigner, compute_power, team_multipliers
from .timeline import BeatJudge, BeatTimeline, FeverSchedule


class TugMatch:
    def __init__(self, players: list[dict], config: dict | None, rng: Callable[[], float]):
        self.config = merge_config(config)
        self.players = [{"id": p["id"], "name": p["name"]} for p in players]
        self.ids = [p["id"] for p in self.players]
        self.rng = rng

        self.fever = FeverSchedule(self.config)
        self.rope = Rope(self.config)
        self.score = ScoreBoard(self.ids, self.config)
        self.assigner = TeamAssigner(self.ids, rng)
        self.timeline = BeatTimeline(self.config, self.fever)
        self.judge = BeatJudge(self.config, self.timeline)

        self.phase = "idle"
        self.round = 0
        self.teams = {"left": [], "right": [], "mult": {"left": 1.0, "right": 1.0}}
        self.side_of: dict[str, str] = {}
        self.countdown_at = 0.0
        self.start_at = 0.0
        self.ended_at = 0.0
        self.phase_until = 0.0
        self.sim_t = 0.0            # 이번 라운드에서 진행한 시뮬레이션 시간(초)
        self.winner_side: str | None = None
        self.round_result: dict | None = None
        self.results: list[dict] = []
        self.events: list[dict] = []
        self.finished = False

    # ------------------------------------------------------------------
    @property
    def countdown_length(self) -> float:
        """카운트다운 길이(초) = 정수 박. 원본과 같이 숫자 하나당 약 1초."""
        base = self.timeline.base
        beats = max(1, math.floor(max(1, int(self.config["COUNTDOWN"])) * 1.0 / base + 0.5))
        return beats * base

    def start(self, now: float) -> None:
        self._begin_round(1, now)

    def _begin_round(self, round_no: int, now: float) -> None:
        self.round = round_no
        split = self.assigner.next()
        mult = team_multipliers(len(split["left"]), len(split["right"]), self.config)
        self.teams = {"left": split["left"], "right": split["right"], "mult": mult}
        self.side_of = {pid: "left" for pid in split["left"]}
        self.side_of.update({pid: "right" for pid in split["right"]})

        self.rope.reset()
        self.score.start_round(round_no)
        # 박자 격자와 판정 기록은 라운드마다 새로
        self.timeline = BeatTimeline(self.config, self.fever)
        self.judge = BeatJudge(self.config, self.timeline)

        self.countdown_at = now + self.config["ASSIGN_TIME"]
        self.start_at = self.countdown_at + self.countdown_length
        self.sim_t = 0.0
        self.winner_side = None
        self.round_result = None
        self.phase = "assign"

    # ------------------------------------------------------------------
    def advance(self, now: float) -> None:
        """서버 시계 now 까지 진행한다. 여러 번 불러도 안전하다."""
        # 한 번의 호출에서 여러 장면을 넘길 수 있으므로 반복
        for _ in range(8):
            if self.phase == "assign":
                if now < self.countdown_at:
                    return
                self.phase = "countdown"
            elif self.phase == "countdown":
                if now < self.start_at:
                    return
                self.phase = "play"
            elif self.phase == "play":
                self._simulate(now)
                if self.phase == "play":
                    return
            elif self.phase == "ended":
                if now < self.phase_until:
                    return
                if self.round < self.config["ROUNDS"]:
                    self._begin_round(self.round + 1, self.phase_until)
                else:
                    self.phase = "summary"
                    self.phase_until = self.phase_until + self.config["SUMMARY_TIME"]
            elif self.phase == "summary":
                if now < self.phase_until:
                    return
                self._enter_final(self.phase_until)
            elif self.phase == "final":
                if now < self.phase_until:
                    return
                self.phase = "done"
                self.finished = True
            else:
                return

    def _simulate(self, now: float) -> None:
        """고정 스텝으로 줄 물리를 진행하고 승패를 확인한다."""
        target = now - self.start_at
        round_time = float(self.config["ROUND_TIME"])
        while self.sim_t + STEP <= target + 1e-9:
            self.rope.update(STEP)
            self.sim_t += STEP
            winner = self.rope.winner()
            if winner:
                self._end_round(winner)
                return
            if self.sim_t >= round_time - 1e-9:
                self._end_round(self.rope.leader())
                return

    def _end_round(self, winner_side: str | None) -> None:
        self.winner_side = winner_side
        self.ended_at = self.start_at + self.sim_t
        self.round_result = self.score.end_round(self.round, winner_side, self.teams["left"], self.teams["right"])
        self.round_result["isLastRound"] = self.round >= self.config["ROUNDS"]
        self.phase = "ended"
        self.phase_until = self.ended_at + self.config["END_HOLD"] + self.config["ROUND_RESULT_TIME"]

    def _enter_final(self, at: float) -> None:
        self.results = self.score.results(self.players)
        self.phase = "final"
        self.phase_until = at + self.config["FINAL_TIME"]

    # ------------------------------------------------------------------
    def input(self, player_id: str, data: dict, now: float) -> None:
        if player_id not in self.side_of and data.get("k") != "confirm":
            return
        kind = data.get("k")
        if kind == "pull":
            self._pull(player_id, data, now)
        elif kind == "confirm" and self.phase == "summary":
            self._enter_final(now)

    def _pull(self, player_id: str, data: dict, now: float) -> None:
        cfg = self.config
        if self.phase not in ("countdown", "play"):
            return
        server_t = now - self.start_at
        t = data.get("t")
        # 브라우저가 보낸 누른 시각은 서버 시각과 크게 다르지 않을 때만 믿는다
        if not isinstance(t, (int, float)) or isinstance(t, bool) or not (
            server_t - cfg["INPUT_MAX_LAG"] <= t <= server_t + cfg["INPUT_MAX_LEAD"]
        ):
            t = server_t
        # START 직전 Good 창보다 이른 입력은 버린다(카운트다운 중 연타 방지)
        if t < -cfg["GOOD_WINDOW"]:
            return
        if self.phase == "play" and t > cfg["ROUND_TIME"]:
            return

        verdict = self.judge.judge(player_id, float(t))
        grade = verdict["grade"]
        side = self.side_of[player_id]
        fever = self.fever.active_at(max(0.0, float(t)))
        power = compute_power(grade, cfg, self.teams["mult"][side], fever)
        self.rope.add_force(side, power)
        scored = self.score.record(player_id, grade, fever)
        self.score.add_power(player_id, power)
        self.events.append({
            "type": "judge", "playerId": player_id, "grade": grade, "t": float(t),
            "offset": verdict["offset"], "beatIndex": verdict["beatIndex"],
            "points": scored["points"], "combo": scored["combo"], "power": power,
        })

    def pop_events(self) -> list[dict]:
        out, self.events = self.events, []
        return out

    # ------------------------------------------------------------------
    def snapshot(self, now: float) -> dict:
        return {
            "phase": self.phase,
            "round": self.round,
            "rounds": self.config["ROUNDS"],
            "now": now,
            "teams": {
                "left": list(self.teams["left"]), "right": list(self.teams["right"]),
                "mult": dict(self.teams["mult"]),
            },
            "countdownAt": self.countdown_at,
            "startAt": self.start_at,
            "endedAt": self.ended_at if self.phase == "ended" else None,
            "simT": self.sim_t,
            "rope": {
                "pos": self.rope.pos, "vel": self.rope.vel,
                "lf": self.rope.left_force, "rf": self.rope.right_force,
            },
            "winnerSide": self.winner_side if self.phase == "ended" else None,
            "result": self.round_result if self.phase == "ended" else None,
            "scores": self.score.snapshot(),
            "results": self.results if self.phase in ("final", "done") else None,
        }
