"""무궁화 꽃이 피었습니다 (서버 판정) — 참가자 한 명이 술래가 되어 말로 외친다.

규칙
- 서버가 무작위로 한 명을 술래로 뽑는다. 나머지는 도망자.
- 도망자는 키를 누르고 있는 동안 전진한다(관성 때문에 바로 멈추지 못한다).
- 술래가 마이크에 "무궁화 꽃이 피었습니다"를 외치면 서버의 음성 인식이 문장을 확인하고, 술래가 돌아본다.
  돌아본 뒤 유예 시간이 지나도 움직이고 있는 도망자는 탈락한다.
- 술래가 다시 외치기 시작하면(또는 MAX_LOOK 이 지나면) 뒤돈다.
- 한 명이라도 결승선에 닿으면 도망자 쪽 승리(그 자리에서 끝). 아무도 못 닿으면(전원 탈락·시간 종료) 술래 승리.
- 점수: 이긴 쪽이 항상 진 쪽보다 높고, 도망자끼리는 도착 여부·간 거리로 차등(탈락자는 탈락 지점까지).

장면(phase): intro(술래 발표) → countdown → play → end(결과 배너) → final(점수) → done

브라우저 → 서버 (game.input 의 data)
    도망자  {"k": "move", "on": bool}                                 전진 키를 누름/뗌
    술래    {"k": "mic", "on": bool, "lv": 0~1}                       말하는 중인지(화면 표시·뒤돌기용)
            {"k": "voice", "pcm": base64(16비트 PCM), "rate": 16000}  외친 말 한 토막
            {"k": "chant", "on": bool}                                마이크 대신 키로 외치기(누르고 있다 떼면 돌아봄)
"""

from __future__ import annotations

import base64
import binascii
import math

from ...minigame import MiniGame
from ...services.stt import rms_of
from ..spell.match import SpellMatcher
from .config import LOGIC_FPS, merge_config

DT = 1.0 / LOGIC_FPS


class MugunghwaGame(MiniGame):
    id = "mugunghwa"
    title = "무궁화 꽃이 피었습니다"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        forced = self.options.get("tagger")
        n = len(self.ids)
        self.tagger_id = forced if forced in self.ids else self.ids[min(n - 1, math.floor(rng() * n))]
        self.runners = [
            {"id": pid, "dist": 0.0, "speed": 0.0, "held": False, "alive": True, "finished": False, "elimDist": 0.0}
            for pid in self.ids if pid != self.tagger_id
        ]
        self.runner_by_id = {r["id"]: r for r in self.runners}
        T = self.cfg["TAGGER"]
        self.matcher = SpellMatcher(
            spells=[{"id": "phrase", "keywords": list(T["PHRASES"])}],
            rules={"MIN_SCORE": T["MATCH_MIN_SCORE"], "SHORT_KEYWORD_LEN": 2, "WINDOW_SLACK": 3},
        )
        self.phase = "idle"
        self.countdown_at = 0.0
        self.start_at = 0.0
        self.phase_until = 0.0
        self.sim_frame = 0
        self.end_frame: int | None = None
        self.time_left = float(self.cfg["RULES"]["TIME_LIMIT"])
        # 술래 상태
        self.t_phase = "back"           # back(뒤돌아 외치는 중) | turning | watching | turnBack
        self.t_time = 0.0               # 이 동작을 한 시간
        self.t_clock = 0.0              # 돌아보기 시작한 뒤 흐른 시간(유예 판정용)
        self.mic_on = False
        self.key_on = False
        self.key_time = 0.0
        self.level = 0.0
        self.looks = 0
        self.caught_total = 0
        self.caught_this_look = 0
        self.result: dict | None = None
        self.final_results: list[dict] = []
        self._job = None                # (음성 인식 Future, 맡긴 시각)
        self._last_phase = None
        self._last_state_at = -1.0

    # ------------------------------------------------------------------
    @property
    def stt(self):
        return self.services.get("stt")

    @property
    def voice_on(self) -> bool:
        stt = self.stt
        return bool(stt is not None and stt.available)

    @property
    def chanting(self) -> bool:
        return self.mic_on or self.key_on

    @property
    def facing(self) -> bool:
        return self.t_phase in ("turning", "watching")

    def client_options(self) -> dict:
        return {
            "config": {k: self.cfg[k] for k in ("MOVE", "RULES", "FLOW", "SCORE")},
            "taggerId": self.tagger_id,
            "phrase": self.cfg["TAGGER"]["PHRASES"][0],
            "minKeyChant": self.cfg["TAGGER"]["MIN_KEY_CHANT"],
            "voice": self.voice_on,
        }

    def start(self, now: float) -> None:
        self.countdown_at = now + self.cfg["FLOW"]["INTRO_TIME"]
        self.start_at = self.countdown_at + self.cfg["RULES"]["COUNTDOWN"]
        self.phase = "intro"
        self._emit(now, force=True)

    def tick(self, now: float) -> None:
        self._advance(now)
        self._poll_voice(now)
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    # ------------------------------------------------------------------
    # 진행
    # ------------------------------------------------------------------
    def _advance(self, now: float) -> None:
        for _ in range(6):
            if self.phase == "intro":
                if now < self.countdown_at:
                    return
                self.phase = "countdown"
            elif self.phase == "countdown":
                if now < self.start_at:
                    return
                self.phase = "play"
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
        target = math.floor((now - self.start_at) * LOGIC_FPS + 1e-6)
        hold = round(self.cfg["FLOW"]["END_HOLD"] * LOGIC_FPS)
        while self.sim_frame < target:
            self.sim_frame += 1
            if self.phase == "play":
                self._step()
            if self.end_frame is not None and self.sim_frame >= self.end_frame + hold:
                self.final_results = self.build_results()
                self.phase = "final"
                self.phase_until = self.start_at + self.sim_frame / LOGIC_FPS + self.cfg["FLOW"]["FINAL_TIME"]
                return

    def _step(self) -> None:
        """한 프레임(1/60초)."""
        M, R, T = self.cfg["MOVE"], self.cfg["RULES"], self.cfg["TAGGER"]
        self.time_left = max(0.0, self.time_left - DT)

        # --- 술래 ---
        self.t_time += DT
        if self.t_phase == "back":
            if self.key_on:
                self.key_time += DT
        elif self.t_phase == "turning":
            self.t_clock += DT
            if self.t_time >= T["TURN_TIME"]:
                self.t_phase, self.t_time = "watching", 0.0
        elif self.t_phase == "watching":
            self.t_clock += DT
            if (self.t_time >= T["MIN_LOOK"] and self.chanting) or self.t_time >= T["MAX_LOOK"]:
                self.t_phase, self.t_time = "turnBack", 0.0
                self.send_event({"type": "turnBack", "caught": self.caught_this_look})
        elif self.t_phase == "turnBack":
            if self.t_time >= T["TURN_BACK_TIME"]:
                self.t_phase, self.t_time = "back", 0.0
                self.key_time = 0.0   # 뒤돌기 전에 누르고 있던 시간은 치지 않는다

        # --- 도망자: 누르면 가속, 떼면 감속(관성) ---
        finished = []
        for r in self.runners:
            if not r["alive"] or r["finished"]:
                continue
            if r["held"]:
                r["speed"] = min(M["MAX_SPEED"], r["speed"] + M["ACCEL"] * DT)
            else:
                r["speed"] = max(0.0, r["speed"] - M["DECEL"] * DT)
            r["dist"] += r["speed"] * DT
            if r["dist"] >= R["METERS"]:
                r["dist"] = float(R["METERS"])
                r["speed"] = 0.0
                r["finished"] = True
                finished.append(r["id"])

        # --- 움직임 감지: 돌아본 뒤 유예 시간이 지나도 움직이면 탈락 ---
        if self.facing and self.t_clock >= R["GRACE_TIME"]:
            caught = [r for r in self.runners if r["alive"] and not r["finished"] and r["speed"] > M["MOVING_THRESHOLD"]]
            if caught:
                for r in caught:
                    r["alive"] = False
                    r["elimDist"] = r["dist"]
                    r["speed"] = 0.0
                self.caught_this_look += len(caught)
                self.caught_total += len(caught)
                self.send_event({"type": "caught", "ids": [r["id"] for r in caught]})

        # --- 종료 조건 ---
        if finished:
            for pid in finished:
                self.send_event({"type": "finish", "id": pid})
            self._end("runners", "finish", finished)
        elif all(not r["alive"] for r in self.runners):
            self._end("tagger", "allCaught")
        elif self.time_left <= 0:
            self._end("tagger", "timeUp")

    def _turn(self) -> None:
        self.t_phase, self.t_time, self.t_clock = "turning", 0.0, 0.0
        self.caught_this_look = 0
        self.looks += 1
        self.key_time = 0.0
        self.send_event({"type": "turn"})

    def _end(self, winner: str, reason: str, finishers: list[str] | None = None) -> None:
        if self.phase != "play":
            return
        self.phase = "end"
        self.end_frame = self.sim_frame
        self.result = {"winner": winner, "reason": reason, "finishers": finishers or []}
        for r in self.runners:
            r["speed"] = 0.0
            r["held"] = False
        self._job = None
        self.send_event({"type": "end", "result": self.result})

    # ------------------------------------------------------------------
    # 입력
    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if not isinstance(data, dict) or player_id not in self.names:
            return
        self._advance(now)
        kind = data.get("k")
        if player_id != self.tagger_id:
            if kind == "move" and player_id in self.runner_by_id:
                # 카운트다운 중에 미리 누르고 있어도 시작과 함께 출발한다
                self.runner_by_id[player_id]["held"] = bool(data.get("on")) and self.phase in ("countdown", "play")
            return
        if self.phase != "play":
            return
        if kind == "mic":
            on = bool(data.get("on"))
            lv = data.get("lv", 0)
            self.level = min(1.0, max(0.0, float(lv))) if isinstance(lv, (int, float)) and not isinstance(lv, bool) else 0.0
            if on != self.mic_on:
                self.mic_on = on
                self.send_event({"type": "chant", "on": self.chanting})
        elif kind == "chant":
            on = bool(data.get("on"))
            if on == self.key_on:
                return
            self.key_on = on
            if on:
                self.key_time = 0.0
            elif self.t_phase == "back" and self.key_time >= self.cfg["TAGGER"]["MIN_KEY_CHANT"]:
                self._turn()
            self.send_event({"type": "chant", "on": self.chanting})
        elif kind == "voice":
            self._on_voice(data, now)

    def _on_voice(self, data: dict, now: float) -> None:
        V = self.cfg["VOICE"]
        stt = self.stt
        if stt is None or not stt.available:
            self.send_event({"type": "voiceOff"}, to=self.tagger_id)
            return
        if self._job is not None or self.t_phase != "back":
            return                       # 앞의 말을 인식하는 중이거나, 아직 돌아보고 있는 동안 끝난 말은 버린다
        rate = data.get("rate", 16000)
        raw = data.get("pcm")
        if not isinstance(raw, str) or not isinstance(rate, int) or isinstance(rate, bool) or not (8000 <= rate <= 48000):
            return
        if len(raw) > int(V["MAX_SECONDS"] * rate * 2 * 4 / 3) + 16:
            return
        try:
            pcm = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            return
        if len(pcm) / 2 / rate < V["MIN_SECONDS"] or rms_of(pcm) < V["MIN_RMS"]:
            return
        self._job = (stt.submit(pcm, rate), now)

    def _poll_voice(self, now: float) -> None:
        if self._job is None:
            return
        fut, at = self._job
        if not fut.done():
            if now - at >= self.cfg["VOICE"]["TIMEOUT"]:
                fut.cancel()
                self._job = None
            return
        self._job = None
        try:
            text = str(fut.result() or "").strip()[:40]
        except Exception as exc:
            print(f"[무궁화] 음성 인식 오류: {exc!r}", flush=True)
            return
        if self.phase != "play" or not text:
            return
        ok = self.matcher.match(text)["spell"] == "phrase"
        self.send_event({"type": "heard", "text": text, "ok": ok})
        if ok and self.t_phase == "back":
            self._turn()

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        if connected:
            return
        if player_id in self.runner_by_id:
            self.runner_by_id[player_id]["held"] = False     # 나간 도망자는 그 자리에 선다
        elif player_id == self.tagger_id:
            self.mic_on = self.key_on = False

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now)

    # ------------------------------------------------------------------
    # 결과 / 상태
    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        S = self.cfg["SCORE"]
        meters = float(self.cfg["RULES"]["METERS"])
        runners_win = bool(self.result and self.result["winner"] == "runners")
        rows = []
        for order, p in enumerate(self.players):
            pid = p["id"]
            if pid == self.tagger_id:
                score = min(S["RUNNER_WIN_BASE"] - 1, self.caught_total * S["TAGGER_LOSE_PER_CATCH"]) if runners_win else S["TAGGER_WIN"]
                stats = {"role": "tagger", "caught": self.caught_total, "looks": self.looks}
            else:
                r = self.runner_by_id[pid]
                reached = r["dist"] if r["alive"] else r["elimDist"]
                ratio = min(1.0, reached / meters)
                if runners_win:
                    score = S["RUNNER_FINISH"] if r["finished"] else S["RUNNER_WIN_BASE"] + math.floor(ratio * S["RUNNER_WIN_PROGRESS"])
                else:
                    score = min(S["RUNNER_LOSE_MAX"], math.floor(ratio * S["RUNNER_LOSE_MAX"]))
                stats = {"role": "runner", "meters": math.floor(reached * 10) / 10, "finished": r["finished"],
                         "eliminated": not r["alive"]}
            rows.append({"playerId": pid, "name": self.names[pid], "score": score, "rank": 0, "isWinner": False,
                         "stats": stats, "_order": order})
        rows.sort(key=lambda x: (-x["score"], x["_order"]))
        for i, row in enumerate(rows):
            row["rank"] = rows[i - 1]["rank"] if i > 0 and rows[i - 1]["score"] == row["score"] else i + 1
        for row in rows:
            row["isWinner"] = row["rank"] == 1
            del row["_order"]
        return rows

    def snapshot(self, now: float) -> dict:
        return {
            "phase": self.phase,
            "now": now,
            "countdownAt": self.countdown_at,
            "startAt": self.start_at,
            "timeLeft": self.time_left,
            "meters": self.cfg["RULES"]["METERS"],
            "taggerId": self.tagger_id,
            "tagger": {
                "phase": self.t_phase, "t": self.t_time, "clock": self.t_clock, "chanting": self.chanting,
                "level": self.level, "keyTime": self.key_time if self.key_on else 0.0,
                "looks": self.looks, "caught": self.caught_total,
            },
            "runners": [
                {"id": r["id"], "dist": r["dist"], "speed": r["speed"], "alive": r["alive"],
                 "finished": r["finished"], "elimDist": r["elimDist"]}
                for r in self.runners
            ],
            "result": self.result,
            "results": self.final_results if self.phase in ("final", "done") else None,
            "voice": self.voice_on,
        }

    def _emit(self, now: float, force: bool = False) -> None:
        changed = self.phase != self._last_phase
        live = self.phase in ("countdown", "play", "end")
        if force or changed or live or now - self._last_state_at >= 1.0:
            if not force and not changed and now == self._last_state_at:
                return
            self._last_phase = self.phase
            self._last_state_at = now
            self.send_state(self.snapshot(now))
