"""주문을 외쳐라 — 둘씩 짝지어 동시에 결투하는 대회 진행 + 공통 규격(MiniGame) 연결부.

진행 방식 (손바닥 밀치기와 같다)
- 3명 이상: 모든 사람이 서로 한 번씩 만난다. 한 라운드에 짝이 된 사람들이 동시에 결투한다.
  인원이 홀수면 라운드마다 한 명이 쉬고(관전), 모두 똑같이 한 번씩 쉰다.
- 2명: 같은 상대와 ROUNDS_FOR_TWO 판.
- 순위: 이긴 횟수가 많은 순, 같으면 점수(결투가 끝났을 때 남은 체력의 합)가 높은 순.

장면(phase): intro(대진 안내) → countdown(3·2·1) → fight → result(라운드 결과) → … → final → done

브라우저 → 서버 (game.input 의 data)
    {"k": "cast", "id": "fireball"}                              숫자키(보조 입력)
    {"k": "voice", "pcm": base64(16비트 PCM), "rate": 16000}     외친 주문(말 한 토막)
음성은 서버의 음성 인식(services["stt"])이 글자로 바꾸고, SpellMatcher 가 어느 주문인지 가린다.
"""

from __future__ import annotations

import base64
import binascii
import math

from ...minigame import MiniGame
from ...services.stt import rms_of
from ..palm.game import make_schedule
from .config import LOGIC_FPS, SPELL_BY_ID, merge_config
from .duel import Duel
from .match import SpellMatcher


class SpellGame(MiniGame):
    id = "spell"
    title = "주문을 외쳐라"
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
        self.matcher = SpellMatcher(rules=self.config["MATCH"])
        self.phase = "idle"
        self.round = 0
        self.duels: list[Duel] = []
        self.countdown_at = 0.0
        self.start_at = 0.0
        self.phase_until = 0.0
        self.sim_frame = 0
        self.all_over_frame: int | None = None
        self.round_results: list[dict] = []
        self.final_results: list[dict] = []
        self._jobs: dict[str, tuple] = {}     # 사람 → (음성 인식 Future, 맡긴 시각, 라운드)
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

    def client_options(self) -> dict:
        return {
            "config": {k: self.config[k] for k in ("LAYOUT", "PLAYER", "COMBO", "BATTLE", "FLOW")},
            "rounds": len(self.schedule),
            "voice": self.voice_on,
        }

    def start(self, now: float) -> None:
        self._begin_round(1, now)
        self._emit(now, force=True)

    def _begin_round(self, round_no: int, now: float) -> None:
        self.round = round_no
        plan = self.schedule[round_no - 1]
        self.duels = []
        for index, (a, b) in enumerate(plan["matches"]):
            self.duels.append(Duel(self.config, a, b, lambda ev, i=index: self.send_event({**ev, "match": i})))
        self._jobs = {}
        self.countdown_at = now + self.config["FLOW"]["INTRO_TIME"]
        self.start_at = self.countdown_at + self.config["BATTLE"]["COUNTDOWN"]
        self.sim_frame = 0
        self.all_over_frame = None
        self.round_results = []
        self.phase = "intro"

    def tick(self, now: float) -> None:
        self._advance(now)
        self._poll_voice(now)
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
            for d in self.duels:
                d.step()
            self.sim_frame += 1
            if self.all_over_frame is None and all(d.over for d in self.duels):
                self.all_over_frame = self.sim_frame
            if self.all_over_frame is not None and self.sim_frame >= self.all_over_frame + hold_frames:
                self._end_round()
                return

    def _end_round(self) -> None:
        self.round_results = []
        for d in self.duels:
            res = d.result or {"winner": "draw", "reason": "timeout", "hp": {"a": 0, "b": 0}}
            scores = {}
            for key, m in (("a", d.a), ("b", d.b)):
                hp = int(res["hp"][key])
                scores[m.id] = {"total": hp, "hp": hp, "stats": d.stats_of(key)}
                st = self.standings[m.id]
                st["matches"] += 1
                st["score"] += hp
                if res["winner"] == "draw":
                    st["draws"] += 1
                elif res["winner"] == key:
                    st["wins"] += 1
                else:
                    st["losses"] += 1
            winner = None if res["winner"] == "draw" else d.mage(res["winner"]).id
            self.round_results.append(
                {"a": d.a.id, "b": d.b.id, "winner": winner, "reason": res["reason"], "scores": scores}
            )
        self._jobs = {}
        self.phase = "result"
        self.phase_until = self.start_at + self.sim_frame / LOGIC_FPS + self.config["FLOW"]["RESULT_TIME"]

    def _build_results(self) -> list[dict]:
        """공통 결과 형식. 이긴 횟수 → 점수(남은 체력 합) 순."""
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
    # 입력
    # ------------------------------------------------------------------
    def _duel_of(self, pid: str):
        for index, d in enumerate(self.duels):
            key = d.key_of(pid)
            if key is not None:
                return index, d, key
        return None

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if not isinstance(data, dict) or player_id not in self.standings:
            return
        self._advance(now)
        if self.phase != "fight":
            return
        found = self._duel_of(player_id)
        if found is None or not found[1].fighting:
            return
        _index, duel, key = found
        kind = data.get("k")
        if kind == "cast":
            spell_id = data.get("id")
            if isinstance(spell_id, str) and spell_id in SPELL_BY_ID:
                duel.cast(key, spell_id, "key")
        elif kind == "voice":
            self._on_voice(player_id, data, now)

    def _on_voice(self, pid: str, data: dict, now: float) -> None:
        V = self.config["VOICE"]
        stt = self.stt
        if stt is None or not stt.available:
            self.send_event({"type": "voiceOff"}, to=pid)
            return
        if pid in self._jobs:            # 앞의 말을 아직 인식하는 중 — 겹친 말은 버린다
            return
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
        self._jobs[pid] = (stt.submit(pcm, rate), now, self.round)

    def _poll_voice(self, now: float) -> None:
        """끝난 음성 인식 결과를 주문으로 바꿔 시전한다."""
        for pid in list(self._jobs):
            fut, at, round_no = self._jobs[pid]
            if not fut.done():
                if now - at >= self.config["VOICE"]["TIMEOUT"]:
                    fut.cancel()
                    del self._jobs[pid]
                continue
            del self._jobs[pid]
            try:
                text = str(fut.result() or "").strip()[:40]
            except Exception as exc:
                print(f"[주문] 음성 인식 오류: {exc!r}", flush=True)
                continue
            found = self._duel_of(pid)
            if round_no != self.round or self.phase != "fight" or found is None:
                continue
            index, duel, key = found
            if not duel.fighting or not text:
                continue
            m = self.matcher.match(text)
            self.send_event({"type": "heard", "match": index, "who": key, "text": text, "spell": m["spell"]})
            if m["spell"]:
                duel.cast(key, m["spell"], "voice")
            else:
                duel.mage(key).stats["fails"] += 1

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        """나간 사람은 그 자리에 서 있는다(조작이 없으니 상대가 유리하다). 따로 처리하지 않는다."""

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
            "voice": self.voice_on,
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
