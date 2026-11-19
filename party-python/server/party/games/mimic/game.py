"""소리 따라하기 (서버 판정) — 제시 소리를 듣고 한 명씩 차례로 따라 한다.

진행
- 라운드 3번: 쉬움 → 보통 → 어려움 난이도에서 소리를 하나씩 무작위로 뽑는다.
- 라운드마다 원본을 모두에게 2번 들려준 뒤, 한 명씩 차례로:
    turn(차례 안내) → cue(원본 한 번 더) → count(3·2·1) → record(원본 길이 + 1.5초 녹음)
    → scoring(채점) → reveal(녹음을 모두에게 다시 들려주고 점수 공개)
  차례 순서는 처음에 무작위로 정하고, 라운드마다 시작하는 사람이 한 칸씩 밀린다(뒤 순서가 늘 유리하지 않게).
- 채점: 녹음과 원본을 음향 모델(Hugging Face Whisper 인코더)의 특징 벡터로 바꿔 유사도를 잰다(scoring.py).
  소리가 감지되지 않으면 0점.
- 순위: 세 라운드 점수의 합이 높은 순.

브라우저 → 서버 (game.input 의 data) — 지금 차례인 사람만
    {"k": "audio", "pcm": base64(16비트 PCM), "rate": 16000}   녹음한 소리
    {"k": "nomic"}                                             마이크를 쓸 수 없음(바로 0점 처리)
"""

from __future__ import annotations

import base64
import binascii
import math

from ...minigame import MiniGame
from .config import merge_config
from .scoring import Scorer, SpectralEmbedder, WhisperEmbedder, grade_of, load_sounds, pcm16_to_array, trim_active

_scorers: dict[str, Scorer] = {}


def get_scorer(services: dict | None) -> Scorer:
    """쓸 수 있는 채점기를 돌려준다: 음성 모델이 준비됐으면 whisper, 아니면 대체(spectral)."""
    stt = (services or {}).get("stt")
    if stt is not None and getattr(stt, "can_embed", False):
        if "whisper" not in _scorers or _scorers["whisper"].embedder.stt is not stt:
            _scorers["whisper"] = Scorer(WhisperEmbedder(stt))
        sc = _scorers["whisper"]
        if sc.poll() or not sc.error:
            return sc
    if "spectral" not in _scorers:
        _scorers["spectral"] = Scorer(SpectralEmbedder())
    _scorers["spectral"].poll()
    return _scorers["spectral"]


class MimicGame(MiniGame):
    id = "mimic"
    title = "소리 따라하기"
    min_players = 2
    max_players = 5
    tick_hz = 20

    @classmethod
    def prepare(cls, services: dict) -> None:
        get_scorer(services)     # 대체 채점기는 바로 준비된다. 음성 모델용은 모델이 준비된 뒤 첫 판에서 만든다.

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.F, self.R = self.cfg["FLOW"], self.cfg["RULES"]
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        # 차례 순서(무작위)
        order = list(self.ids)
        for i in range(len(order) - 1, 0, -1):
            j = min(i, math.floor(rng() * (i + 1)))
            order[i], order[j] = order[j], order[i]
        self.base_order = order
        # 라운드별 소리
        by_diff: dict[str, list[dict]] = {}
        for s in load_sounds():
            by_diff.setdefault(s["difficulty"], []).append(s)
        forced = self.options.get("sounds")
        self.sounds: list[dict] = []
        all_sounds = {s["id"]: s for s in load_sounds()}
        if forced:
            self.sounds = [all_sounds[sid] for sid in forced if sid in all_sounds]
        else:
            for diff in self.R["DIFFICULTIES"]:
                pool = by_diff.get(diff) or load_sounds()
                self.sounds.append(pool[min(len(pool) - 1, math.floor(rng() * len(pool)))])
        self.rounds = len(self.sounds)
        self.scores = {pid: [None] * self.rounds for pid in self.ids}     # 라운드별 {"score", "valid", "grade"}
        self.phase = "idle"
        self.until = 0.0
        self.since = 0.0
        self.round = 0             # 1부터
        self.turn = -1             # 이번 라운드에서 몇 번째 차례인지(0부터)
        self.order: list[str] = []
        self.last: dict | None = None
        self.final_results: list[dict] = []
        self.scorer: Scorer | None = None
        self._audio: bytes | None = None      # 지금 차례인 사람이 보낸 녹음
        self._rate = 16000
        self._job = None                      # 특징 뽑기 Future
        self._pending: dict | None = None     # 채점 결과(채점 화면 최소 시간이 지나면 공개)
        self._dirty = True
        self._last_state_at = -1.0

    # ------------------------------------------------------------------
    @property
    def sound(self) -> dict | None:
        return self.sounds[self.round - 1] if 1 <= self.round <= self.rounds else None

    @property
    def current(self) -> str | None:
        return self.order[self.turn] if 0 <= self.turn < len(self.order) else None

    def _rec_seconds(self) -> float:
        return self.sound["duration"] + self.R["REC_EXTRA"]

    def client_options(self) -> dict:
        return {
            "rounds": self.rounds,
            "order": list(self.base_order),
            "recExtra": self.R["REC_EXTRA"],
            "flow": dict(self.F),
            "grades": self.cfg["SCORE"]["GRADES"],
            "sounds": [{k: s[k] for k in ("id", "name", "difficulty", "icon", "duration", "file")} for s in load_sounds()],
        }

    def start(self, now: float) -> None:
        self.scorer = get_scorer(self.services)
        self._set("intro", now, self.F["INTRO_TIME"])
        self._emit(now, force=True)

    def tick(self, now: float) -> None:
        self._advance(now)
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    # ------------------------------------------------------------------
    def _set(self, phase: str, at: float, duration: float) -> None:
        self.phase = phase
        self.since = at
        self.until = at + duration
        self._dirty = True

    def _advance(self, now: float) -> None:
        F = self.F
        for _ in range(12):
            ph = self.phase
            if ph == "scoring":
                if not self._advance_scoring(now):
                    return
                continue
            if ph in ("idle", "done") or now < self.until:
                return
            at = self.until
            if ph == "intro":
                self._begin_round(1, at)
            elif ph == "listen":
                self._begin_turn(0, at)
            elif ph == "turn":
                self._set("cue", at, self.sound["duration"] + F["CUE_TAIL"])
            elif ph == "cue":
                self._set("count", at, F["COUNT_BEEPS"] * F["BEEP_INTERVAL"])
            elif ph == "count":
                self._audio = None
                self._job = None
                self._pending = None
                self._set("record", at, self._rec_seconds())
            elif ph == "record":
                self._set("scoring", at, F["SCORE_TIMEOUT"])
            elif ph == "reveal":
                if self.turn + 1 < len(self.order):
                    self._begin_turn(self.turn + 1, at)
                else:
                    self._set("roundEnd", at, F["ROUND_END"])
            elif ph == "roundEnd":
                if self.round < self.rounds:
                    self._begin_round(self.round + 1, at)
                else:
                    self.final_results = self.build_results()
                    self._set("final", at, F["FINAL_TIME"])
            elif ph == "final":
                self.phase = "done"
                self._dirty = True
            else:
                return

    def _begin_round(self, round_no: int, at: float) -> None:
        F = self.F
        self.round = round_no
        n = len(self.base_order)
        shift = (round_no - 1) % n
        self.order = self.base_order[shift:] + self.base_order[:shift]
        self.turn = -1
        self.last = None
        dur = self.sound["duration"]
        listen = F["ROUND_LEAD"] + F["LISTEN_REPEATS"] * dur + (F["LISTEN_REPEATS"] - 1) * F["LISTEN_GAP"] + F["LISTEN_TAIL"]
        self._set("listen", at, listen)

    def _begin_turn(self, turn: int, at: float) -> None:
        self.turn = turn
        self.last = None
        self._set("turn", at, self.F["TURN_INTRO"])

    # ------------------------------------------------------------------
    # 채점
    # ------------------------------------------------------------------
    def _advance_scoring(self, now: float) -> bool:
        """채점 단계 진행. 다음 단계로 넘어갔으면 True."""
        F = self.F
        if self._pending is None:
            if self._audio is not None and self._job is None:
                self._start_job()
            if self._job is not None and self._job.done():
                self._pending = self._finish_job()
            elif now >= self.until:
                self._pending = {"score": 0, "valid": False, "reason": "noAudio" if self._audio is None else "timeout"}
        if self._pending is None or now < self.since + F["SCORE_MIN"]:
            return False
        self._reveal(self._pending, now)
        return True

    def _start_job(self) -> None:
        audio = pcm16_to_array(self._audio)
        trimmed, active = trim_active(audio, self._rate, self.cfg["VOICE"])
        if active < self.R["MIN_ACTIVE_SEC"]:
            self._pending = {"score": 0, "valid": False, "reason": "silent"}
            return
        from .scoring import array_to_pcm16, resample

        if self.scorer is None or not self.scorer.ready:
            self.scorer = get_scorer(self.services)
        self._job = self.scorer.embedder.submit(array_to_pcm16(resample(trimmed, self._rate)), 16000)

    def _finish_job(self) -> dict:
        try:
            emb = self._job.result()
            out = self.scorer.score_embedding(self.sound["id"], emb)
            return {"score": out["score"], "valid": True, "similarity": out["similarity"], "scorer": out["scorer"]}
        except Exception as exc:
            print(f"[소리 따라하기] 채점 오류: {exc!r}", flush=True)
            return {"score": 0, "valid": False, "reason": "error"}
        finally:
            self._job = None

    def _reveal(self, result: dict, now: float) -> None:
        pid = self.current
        entry = {"score": int(result["score"]), "valid": bool(result["valid"])}
        entry["grade"] = grade_of(entry["score"], self.cfg["SCORE"]["GRADES"]) if entry["valid"] else "-"
        self.scores[pid][self.round - 1] = entry
        self.last = {"playerId": pid, **entry, "reason": result.get("reason"), "similarity": result.get("similarity")}
        event = {"type": "reveal", "playerId": pid, "round": self.round, **entry, "reason": result.get("reason")}
        play = 0.0
        if self._audio is not None and entry["valid"]:
            # 녹음을 모두에게 들려준다
            event["pcm"] = base64.b64encode(self._audio).decode("ascii")
            event["rate"] = self._rate
            play = len(self._audio) / 2 / self._rate
        self._audio = None
        self.send_event(event)
        self._set("reveal", now, play + self.F["REVEAL_TIME"])

    # ------------------------------------------------------------------
    # 입력
    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if not isinstance(data, dict) or player_id not in self.names:
            return
        self._advance(now)
        if player_id != self.current or self.phase not in ("record", "scoring") or self._pending is not None:
            return
        kind = data.get("k")
        if kind == "nomic":
            if self._audio is None:
                self._pending = {"score": 0, "valid": False, "reason": "noMic"}
                if self.phase == "record":           # 녹음 시간을 기다리지 않고 넘어간다
                    self._set("scoring", now, self.F["SCORE_TIMEOUT"])
            return
        if kind != "audio" or self._audio is not None:
            return
        rate = data.get("rate", 16000)
        raw = data.get("pcm")
        if not isinstance(raw, str) or not isinstance(rate, int) or isinstance(rate, bool) or not (8000 <= rate <= 48000):
            return
        max_sec = self._rec_seconds() + self.cfg["VOICE"]["MAX_EXTRA_SEC"]
        if len(raw) > int(max_sec * rate * 2 * 4 / 3) + 16:
            return
        try:
            pcm = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            return
        self._audio = pcm
        self._rate = rate
        self._advance(now)

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now)

    # ------------------------------------------------------------------
    def totals(self) -> dict[str, int]:
        return {pid: sum(e["score"] for e in rounds if e) for pid, rounds in self.scores.items()}

    def build_results(self) -> list[dict]:
        totals = self.totals()
        rows = []
        for order, p in enumerate(self.players):
            pid = p["id"]
            rounds = [e["score"] if e else 0 for e in self.scores[pid]]
            rows.append({"playerId": pid, "name": self.names[pid], "score": totals[pid], "rank": 0, "isWinner": False,
                         "stats": {"rounds": rounds, "best": max(rounds) if rounds else 0}, "_order": order})
        rows.sort(key=lambda r: (-r["score"], r["_order"]))
        for i, r in enumerate(rows):
            r["rank"] = rows[i - 1]["rank"] if i > 0 and rows[i - 1]["score"] == r["score"] else i + 1
        for r in rows:
            r["isWinner"] = r["rank"] == 1
            del r["_order"]
        return rows

    def snapshot(self, now: float) -> dict:
        s = self.sound
        return {
            "phase": self.phase,
            "now": now,
            "since": self.since,
            "until": self.until,
            "round": self.round,
            "rounds": self.rounds,
            "sound": {k: s[k] for k in ("id", "name", "difficulty", "icon", "duration")} if s else None,
            "order": list(self.order),
            "turn": self.turn,
            "current": self.current,
            "scores": {pid: list(rounds) for pid, rounds in self.scores.items()},
            "totals": self.totals(),
            "last": self.last,
            "scorer": self.scorer.name if self.scorer else "",
            "results": self.final_results if self.phase in ("final", "done") else None,
        }

    def _emit(self, now: float, force: bool = False) -> None:
        if force or self._dirty or now - self._last_state_at >= 1.0:
            self._dirty = False
            self._last_state_at = now
            self.send_state(self.snapshot(now))
