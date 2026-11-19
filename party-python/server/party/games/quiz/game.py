"""음성 퀴즈 (서버 판정) — 키로 버저를 잡고, 마이크로 정답을 말한다.

문제 1개의 흐름 (원본 QuizEngine 과 같다. 2팀 → 2~5명으로 넓힘)
    intro(문제 N) → open(버저 대기, 45초 타이머. 10초 뒤 초성, 20초 뒤 첫 글자)
        버저 → answering(10초 안에 답) → judging(음성 인식 중, 시간 멈춤)
            정답 → reveal → 다음 문제
            오답 → wrong(잠깐) → open (틀린 사람은 이 문제에서 잠금 + 감점)
        시간이 다 되거나 모두 잠기면 → reveal(정답 공개, 득점 없음)

브라우저 → 서버 (game.input 의 data)
    {"k": "buzz", "t": 누른 시각(서버 시계)}
    {"k": "voice", "pcm": base64(16비트 PCM), "rate": 16000}    버저를 잡은 사람만
    {"k": "typed", "text": "..."}                               버저를 잡은 사람만 (타자 보조)

정답은 reveal 전까지 브라우저로 보내지 않는다(힌트도 열린 것만 보낸다).
"""

from __future__ import annotations

import base64
import binascii

from ...minigame import MiniGame
from ...services.stt import rms_of
from .checker import AnswerChecker
from .config import DEFAULT_CONFIG, merge_config
from .hangul import normalize
from .questions import QuestionPool, load_bank, pick_questions

_pool: QuestionPool | None = None


def get_pool(services: dict | None = None) -> QuestionPool:
    """서버에 하나만 두는 문제 보관소(지난 판에 낸 문제를 기억한다)."""
    global _pool
    if _pool is None:
        _pool = QuestionPool((services or {}).get("gemini"))
    return _pool


class QuizGame(MiniGame):
    id = "quiz"
    title = "음성 퀴즈"
    min_players = 2
    max_players = 5
    tick_hz = 20

    @classmethod
    def prepare(cls, services: dict) -> None:
        # 서버가 켜질 때 Gemini 로 문제를 미리 만들어 두기 시작한다
        get_pool(services).refill_async()

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(DEFAULT_CONFIG, self.options.get("config"))
        self.R = self.cfg["RULES"]
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        self.cat_names = {c["id"]: c["name"] for c in load_bank()["categories"]}
        self.questions: list[dict] = list(self.options.get("questions") or [])  # 테스트에서 직접 넣을 수 있다
        self.source = "test" if self.questions else ""
        self.stats = {
            pid: {"score": 0, "correct": 0, "wrong": 0, "buzzes": 0, "correctTime": 0.0} for pid in self.ids
        }
        self.phase = "idle"
        self.index = -1
        self.until = 0.0            # intro / wrong / reveal / ready / final 이 끝나는 시각
        self.elapsed = 0.0          # 이 문제에서 버저 대기로 흐른 시간(답하는 동안은 멈춤)
        self.open_since = 0.0       # 지금 open 구간이 시작된 시각
        self.hint_level = 0
        self.locked: set[str] = set()
        self.buzzer: str | None = None
        self.answer_deadline = 0.0
        self.answer_left = 0.0      # judging 동안 남겨 둔 답변 시간
        self.voice_tries = 0
        self.last: dict | None = None
        self.checker: AnswerChecker | None = None
        self._offers: list[tuple[float, int, str]] = []   # (누른 시각, 도착 순서, 사람)
        self._offer_deadline: float | None = None
        self._offer_seq = 0
        self._judge = None          # 음성 인식 Future
        self._judge_at = 0.0
        self._dirty = True
        self._last_state_at = -1.0

    # ------------------------------------------------------------------
    # 공통 규격
    # ------------------------------------------------------------------
    @property
    def stt(self):
        return self.services.get("stt")

    @property
    def voice_on(self) -> bool:
        stt = self.stt
        return bool(stt is not None and stt.available)

    def client_options(self) -> dict:
        return {
            "rules": {k: self.R[k] for k in (
                "QUESTION_COUNT", "QUESTION_TIME", "HINT_CHOSUNG_AT", "HINT_FIRST_AT", "ANSWER_TIME", "VOICE_ATTEMPTS",
                "MAX_VOICE_SECONDS",
            )},
            "score": dict(self.cfg["SCORE"]),
            "voice": self.voice_on,
        }

    def start(self, now: float) -> None:
        if not self.questions:
            self.questions, self.source = pick_questions(
                int(self.R["QUESTION_COUNT"]), self.rng, get_pool(self.services)
            )
        self.phase = "ready"
        self.until = now + self.R["READY_TIME"]
        self._emit(now, force=True)

    def tick(self, now: float) -> None:
        self._advance(now)
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.build_results())

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if player_id not in self.stats or not isinstance(data, dict):
            return
        self._advance(now)
        kind = data.get("k")
        if kind == "buzz":
            self._on_buzz(player_id, data.get("t"), now)
        elif kind == "voice":
            self._on_voice(player_id, data, now)
        elif kind == "typed":
            self._on_typed(player_id, data.get("text"), now)
        self._emit(now)

    def state_for(self, player_id: str, now: float) -> dict:
        return self.snapshot(now)

    # ------------------------------------------------------------------
    # 진행
    # ------------------------------------------------------------------
    @property
    def question(self) -> dict | None:
        return self.questions[self.index] if 0 <= self.index < len(self.questions) else None

    def _time_left(self, now: float) -> float:
        e = self.elapsed + (max(0.0, now - self.open_since) if self.phase == "open" else 0.0)
        return max(0.0, self.R["QUESTION_TIME"] - e)

    def _set(self, phase: str) -> None:
        self.phase = phase
        self._dirty = True

    def _advance(self, now: float) -> None:
        for _ in range(12):
            ph = self.phase
            if ph == "ready":
                if now < self.until:
                    return
                self._next_question(self.until)
            elif ph == "intro":
                if now < self.until:
                    return
                self._open(self.until)
            elif ph == "open":
                if not self._advance_open(now):
                    return
            elif ph == "answering":
                if now < self.answer_deadline:
                    return
                self._wrong("timeout", "", self.answer_deadline)
            elif ph == "judging":
                if not self._advance_judging(now):
                    return
            elif ph == "wrong":
                if now < self.until:
                    return
                self._reopen(self.until)
            elif ph == "reveal":
                if now < self.until:
                    return
                self._next_question(self.until)
            elif ph == "final":
                if now < self.until:
                    return
                self._set("done")
            else:
                return

    def _next_question(self, at: float) -> None:
        self.index += 1
        self._offers = []
        self._offer_deadline = None
        if self.index >= len(self.questions):
            self._set("final")
            self.until = at + self.R["FINAL_TIME"]
            self.last = None
            self.send_event({"type": "final", "results": self.build_results()})
            return
        self.locked = set()
        self.buzzer = None
        self.hint_level = 0
        self.elapsed = 0.0
        self.last = None
        self.voice_tries = 0
        self.checker = AnswerChecker(self.question, self.cfg)
        self._set("intro")
        self.until = at + self.R["INTRO_TIME"]
        self.send_event({"type": "intro", "index": self.index})

    def _open(self, at: float) -> None:
        self._set("open")
        self.open_since = at
        self.send_event({"type": "open", "index": self.index})

    def _advance_open(self, now: float) -> bool:
        """open 구간 진행. 단계가 바뀌었으면 True."""
        R = self.R
        end_at = self.open_since + (R["QUESTION_TIME"] - self.elapsed)   # 시간이 다 되는 시각
        # 힌트(시간이 흐른 만큼)
        e = self.elapsed + (min(now, end_at) - self.open_since)
        level = 2 if e >= R["HINT_FIRST_AT"] else 1 if e >= R["HINT_CHOSUNG_AT"] else 0
        if level > self.hint_level:
            self.hint_level = level
            self._dirty = True
            self.send_event({"type": "hint", "level": level})
        # 버저: 모으는 시간이 끝났거나 문제 시간이 끝났으면 판정
        if self._offer_deadline is not None and (now >= self._offer_deadline or now >= end_at):
            at = min(now, self._offer_deadline, end_at)
            winner = self._resolve_offers()
            if winner is not None:
                self._grant(winner[2], max(self.open_since, min(winner[0], at)), at)
                return True
        if now >= end_at:
            self.elapsed = R["QUESTION_TIME"]
            self._reveal("timeup", end_at)
            return True
        return False

    # ----- 버저 -----
    def _on_buzz(self, pid: str, t, now: float) -> None:
        if self.phase not in ("open", "wrong") or pid in self.locked:
            return
        R = self.R
        ts = now
        if isinstance(t, (int, float)) and not isinstance(t, bool):
            ts = min(max(float(t), now - R["BUZZ_MAX_LAG"]), now + R["BUZZ_MAX_LEAD"])
        if any(o[2] == pid for o in self._offers):
            return
        self._offer_seq += 1
        self._offers.append((ts, self._offer_seq, pid))
        if self._offer_deadline is None:
            self._offer_deadline = now + R["BUZZ_WINDOW"]

    def _resolve_offers(self):
        offers = [o for o in self._offers if o[2] not in self.locked]
        self._offers = []
        self._offer_deadline = None
        return min(offers) if offers else None

    def _grant(self, pid: str, pressed_at: float, now: float) -> None:
        # 문제 시간은 버저를 누른 순간에 멈춘다
        self.elapsed = min(self.R["QUESTION_TIME"], self.elapsed + max(0.0, pressed_at - self.open_since))
        self.buzzer = pid
        self.voice_tries = 0
        self.answer_deadline = now + self.R["ANSWER_TIME"]
        self.stats[pid]["buzzes"] += 1
        self.last = {"type": "buzz", "player": pid}
        self._set("answering")
        self.send_event({"type": "buzz", "player": pid})

    # ----- 답변 -----
    def _on_typed(self, pid: str, text, now: float) -> None:
        if self.phase != "answering" or pid != self.buzzer or not isinstance(text, str):
            return
        text = text[:40]
        if not normalize(text):
            return
        if self.checker.is_correct(text):
            self._correct("typed", text, now)
        else:
            self._wrong("typed", text, now)

    def _on_voice(self, pid: str, data: dict, now: float) -> None:
        if self.phase != "answering" or pid != self.buzzer:
            return
        R = self.R
        stt = self.stt
        if stt is None or not stt.available:
            self.send_event({"type": "voiceOff"}, to=pid)
            return
        rate = data.get("rate", 16000)
        raw = data.get("pcm")
        if not isinstance(raw, str) or not isinstance(rate, int) or isinstance(rate, bool) or not (8000 <= rate <= 48000):
            return
        if len(raw) > int(R["MAX_VOICE_SECONDS"] * rate * 2 * 4 / 3) + 16:
            return
        try:
            pcm = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            return
        seconds = len(pcm) / 2 / rate
        if seconds < R["MIN_VOICE_SECONDS"] or rms_of(pcm) < R["MIN_VOICE_RMS"]:
            self.send_event({"type": "unheard", "player": pid})
            return
        # 인식하는 동안 답변 시간은 멈춘다
        self.answer_left = max(0.0, self.answer_deadline - now)
        self._judge = stt.submit(pcm, rate)
        self._judge_at = now
        self._set("judging")

    def _advance_judging(self, now: float) -> bool:
        fut = self._judge
        if fut is not None and fut.done():
            self._judge = None
            try:
                text = str(fut.result() or "")
            except Exception as exc:
                print(f"[음성 퀴즈] 음성 인식 오류: {exc!r}", flush=True)
                self._back_to_answering(now, "sttFail")
                return True
            self._voice_result(text, now)
            return True
        if fut is None or now - self._judge_at >= self.R["JUDGE_TIMEOUT"]:
            if fut is not None:
                fut.cancel()
            self._judge = None
            self._back_to_answering(now, "sttFail")
            return True
        return False

    def _back_to_answering(self, now: float, event: str, extra: dict | None = None) -> None:
        self.answer_deadline = now + max(self.answer_left, self.R["RETRY_MIN_TIME"])
        self._set("answering")
        self.send_event({"type": event, "player": self.buzzer, **(extra or {})})

    def _voice_result(self, text: str, now: float) -> None:
        text = text.strip()[:60]
        pid = self.buzzer
        self.send_event({"type": "heard", "player": pid, "text": text})
        if self.checker.is_correct(text):
            self._correct("voice", text, now)
            return
        if not self.checker.is_meaningful(text):
            self._back_to_answering(now, "unheard")
            return
        self.voice_tries += 1
        left = int(self.R["VOICE_ATTEMPTS"]) - self.voice_tries
        if left <= 0:
            self._wrong("voice", text, now)
        else:
            self._back_to_answering(now, "retry", {"text": text, "left": left})

    def _correct(self, source: str, text: str, now: float) -> None:
        pid = self.buzzer
        st = self.stats[pid]
        st["correct"] += 1
        st["score"] += int(self.cfg["SCORE"]["CORRECT"])
        st["correctTime"] = round(st["correctTime"] + self.elapsed, 3)
        self.last = {"type": "correct", "player": pid, "text": text, "source": source}
        self._offers = []
        self._offer_deadline = None
        self._set("reveal")
        self.until = now + self.R["REVEAL_TIME"]
        self.send_event({
            "type": "correct", "player": pid, "text": text, "source": source,
            "answer": self.question["answer"], "points": int(self.cfg["SCORE"]["CORRECT"]),
        })

    def _wrong(self, cause: str, text: str, now: float) -> None:
        pid = self.buzzer
        st = self.stats[pid]
        st["wrong"] += 1
        st["score"] += int(self.cfg["SCORE"]["WRONG"])
        self.locked.add(pid)
        self.buzzer = None
        self.last = {"type": "wrong", "player": pid, "text": text, "cause": cause}
        self._set("wrong")
        self.until = now + self.R["WRONG_FEEDBACK_TIME"]
        self.send_event({
            "type": "wrong", "player": pid, "text": text, "cause": cause, "points": int(self.cfg["SCORE"]["WRONG"]),
        })

    def _reopen(self, at: float) -> None:
        if all(pid in self.locked for pid in self.ids):
            self._reveal("allWrong", at)       # 모두 틀렸으면 정답 공개
            return
        self._set("open")
        self.open_since = at
        self.send_event({"type": "reopen"})
        # 오답 연출 중에 들어온 버저가 있으면 바로 판정
        if self._offers:
            winner = self._resolve_offers()
            if winner is not None:
                self._grant(winner[2], at, at)

    def _reveal(self, kind: str, at: float) -> None:
        self._offers = []
        self._offer_deadline = None
        self.buzzer = None
        self.last = {"type": kind}
        self._set("reveal")
        self.until = at + self.R["REVEAL_TIME"]
        self.send_event({"type": kind, "answer": self.question["answer"]})

    # ------------------------------------------------------------------
    # 결과 / 상태
    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        """점수 높은 순 → 정답 많은 순 → 정답까지 걸린 시간 합이 짧은 순. 모두 같으면 공동 순위."""
        rows = []
        for order, p in enumerate(self.players):
            st = self.stats[p["id"]]
            rows.append({
                "playerId": p["id"], "name": self.names[p["id"]], "score": st["score"], "rank": 0, "isWinner": False,
                "stats": {"correct": st["correct"], "wrong": st["wrong"], "buzzes": st["buzzes"],
                          "correctTime": round(st["correctTime"], 2)},
                "_order": order,
            })
        rows.sort(key=lambda r: (-r["score"], -r["stats"]["correct"], r["stats"]["correctTime"], r["_order"]))

        def same(a, b) -> bool:
            return (a["score"] == b["score"] and a["stats"]["correct"] == b["stats"]["correct"]
                    and abs(a["stats"]["correctTime"] - b["stats"]["correctTime"]) <= 0.05)

        for i, r in enumerate(rows):
            r["rank"] = rows[i - 1]["rank"] if i > 0 and same(r, rows[i - 1]) else i + 1
        for r in rows:
            r["isWinner"] = r["rank"] == 1
            del r["_order"]
        return rows

    def snapshot(self, now: float) -> dict:
        q = self.question
        ph = self.phase
        show_q = q is not None and ph not in ("intro", "ready", "idle")
        revealed = ph == "reveal"
        hints = {}
        if q is not None and (self.hint_level >= 1 or revealed) and show_q:
            hints["chosung"] = q["hints"]["chosung"]
        if q is not None and (self.hint_level >= 2 or revealed) and show_q:
            hints["firstLetter"] = q["hints"]["firstLetter"]
        if ph == "answering":
            answer_left = max(0.0, self.answer_deadline - now)
        elif ph == "judging":
            answer_left = self.answer_left
        else:
            answer_left = 0.0
        return {
            "phase": ph,
            "now": now,
            "index": self.index,
            "total": len(self.questions),
            "category": self.cat_names.get(q["category"], "") if q is not None else "",
            "question": q["question"] if show_q else None,
            "answerLength": len(q["answer"]) if q is not None and show_q else 0,
            "answer": q["answer"] if revealed else None,
            "hintLevel": self.hint_level,
            "hints": hints,
            "timeLeft": self._time_left(now),
            "timeRunning": ph == "open",
            "answerLeft": answer_left,
            "answerRunning": ph == "answering",
            "until": self.until if ph in ("ready", "intro", "wrong", "reveal", "final") else None,
            "buzzer": self.buzzer,
            "tries": self.voice_tries,
            "locked": [pid for pid in self.ids if pid in self.locked],
            "scores": {pid: {k: self.stats[pid][k] for k in ("score", "correct", "wrong")} for pid in self.ids},
            "last": self.last,
            "voice": self.voice_on,
            "source": self.source,
            "results": self.build_results() if ph in ("final", "done") else None,
        }

    def _emit(self, now: float, force: bool = False) -> None:
        if force or self._dirty or now - self._last_state_at >= 0.5:
            self._dirty = False
            self._last_state_at = now
            self.send_state(self.snapshot(now))
