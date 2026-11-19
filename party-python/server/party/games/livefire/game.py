"""실거리 사격 (서버 판정) — 각자 자기 사로에서 "같은 표적 20개"를 실탄 20발로 쏘아 점수를 겨룬다.

- 시작할 때 표적 순서(거리 · 좌우 위치 · 서 있는 시간)를 전부 정한다(range.make_schedule) → 모두에게 같다.
- 조준점 · 호흡 흔들림 · 반동 · 탄알집은 서버가 사로마다 60분의 1초 단위로 진행한다(range.Range).
  브라우저는 "누르고 있는 조준 키"와 "발사"만 보낸다. 조준 좌표를 브라우저가 보내지 않으므로 속일 수 없다.
  (브라우저는 반응이 느려 보이지 않게 자기 조준점을 같은 식으로 먼저 움직여 그린다 — 판정에는 쓰지 않는다.)
- 발사는 서버에 도착한 시각의 조준점으로 판정한다. 속도 보너스는 0.5초 단위라 통신 지연의 영향이 작다.
- 진행: brief(통제관 준비 방송 5초) → fire(표적 20개) → cease(사격 끝 · 등급 발표) → final(최종 순위 8초) → done
- 통제관(호랑대장)의 안전 · 준비 방송은 원본 대본 그대로(규칙 기반), 경기 중 한마디와 총평은 AI(LineBook · ask_verdict).

브라우저 → 서버 (game.input 의 data)
    {"k": "in", "held": 0~15}       누르고 있는 조준 키(1 왼쪽, 2 오른쪽, 4 위, 8 아래)가 바뀔 때마다
    {"k": "fire", "held": 0~15}     발사 키를 누른 순간(held 는 그때의 조준 키, 생략 가능)
"""

from __future__ import annotations

import math

from ...minigame import MiniGame, rank_results
from ...services.caster import LineBook, ask_verdict, verdict_or_none
from .config import merge_config
from .range import Range, grade_of, make_schedule

CASTER = "호랑대장"

#: AI 해설 상황 (LineBook 에 그대로 넘긴다)
SAY_KINDS = {
    "first_hit": "이번 사격에서 첫 명중이 나왔을 때 ({name} 이 맞힘)",
    "long_hit": "{name} 이 가장 먼 250m 표적을 맞혔을 때",
    "fast_hit": "{name} 이 표적이 올라오자마자 재빨리 맞혔을 때",
    "streak": "{name} 이 여러 발 연속으로 명중시키고 있을 때",
    "miss_streak": "{name} 이 세 발 연속으로 빗나갔을 때 (다그치되 격려)",
    "all_miss": "아무도 표적을 맞히지 못하고 표적이 내려갔을 때",
    "halfway": "표적 20개 중 절반이 끝났을 때 (지금 선두는 {name})",
    "perfect": "{name} 이 지금까지 한 발도 놓치지 않았을 때",
    "cease": "사격이 모두 끝났을 때 (가장 잘 쏜 사수는 {name})",
}

#: Gemini 가 꺼져 있거나 늦을 때 쓰는 기본 대사
SAY_CANNED = {
    "first_hit": ["{name}, 첫 명중이다!", "첫 발 명중! {name} 좋다!"],
    "long_hit": ["{name}, 250 명중이다!", "저 먼 표적을! {name} 훌륭하다!"],
    "fast_hit": ["{name}, 빠르다! 그 속도다!", "올라오자마자 명중! {name}!"],
    "streak": ["{name}, 연속 명중이다! 계속!", "{name} 사수, 감 잡았다!"],
    "miss_streak": ["{name}, 호흡을 고르고 쏜다!", "{name}, 서두르지 않는다!"],
    "all_miss": ["전 사로 불발! 정신 차린다!", "표적이 비웃고 있다! 집중!"],
    "halfway": ["절반이다! 선두는 {name}!", "반 남았다! {name} 가 앞선다!"],
    "perfect": ["{name}, 전탄 명중 중이다!", "{name}, 한 발도 안 놓쳤다!"],
    "cease": ["수고했다! 으뜸은 {name} 이다!", "사격 종료! {name} 가 빛났다!"],
}

STREAK_MARKS = (3, 5, 8, 10, 15, 20)       # 이 연속 명중 수에서 한마디
PERFECT_MARKS = (5, 15)                    # 표적 이만큼이 끝났을 때 전탄 명중인 사람이 있으면 한마디


class LivefireGame(MiniGame):
    id = "livefire"
    title = "실거리 사격"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.fps = self.cfg["FPS"]
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        self.schedule = make_schedule(rng, self.cfg)
        sway = {pid: rng() * 10 for pid in self.ids}        # 사람마다 다른 호흡 박자
        self.range = Range(self.cfg, self.ids, self.schedule, sway)
        self.phase = "idle"
        self.start_at = 0.0             # 프레임 0 의 서버 시각
        self.final_results: list[dict] = []
        self.verdict: dict | None = None
        self.tower: dict | None = None  # 통제관이 마지막으로 한 말 {text, source, at}
        self.book: LineBook | None = None
        self._verdict_job = None
        self._final_at = 0.0
        self._last_state_at = -1.0
        self._last_say_at = -99.0
        self._script_at = -99.0
        self._pending: tuple[str, str, float] | None = None    # 미뤄 둔 해설 (kind, name, 기한)
        self._first_hit = False

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        c = self.cfg
        keys = ("TARGETS", "MAG_SIZE", "RELOAD_TIME", "RISE_TIME", "AIM_START_Y", "AIM_TOP_Y", "AIM_BOTTOM_Y",
                "AIM_SPEED_X", "AIM_SPEED_Y", "AIM_RANGE", "SWAY", "STEADY_TIME", "STEADY_SWAY", "RECOIL",
                "KICK_DECAY", "FIRE_COOLDOWN", "HIT_POINTS", "QUICK_MAX", "GRADES", "BRIEF_END", "CEASE_END",
                "GRADE_AT", "FINAL_TIME", "FPS")
        opts = {k: c[k] for k in keys}
        opts["DISTANCES"] = {str(d): {"y": v["y"], "w": v["w"], "h": v["h"]} for d, v in c["DISTANCES"].items()}
        return {"config": opts, "caster": CASTER}

    def start(self, now: float) -> None:
        self.start_at = now
        self.phase = "brief"
        # AI 대사 묶음을 한 번 미리 받아 둔다(기다리지 않는다)
        self.book = LineBook(
            self.services.get("gemini"), game=self.title, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
            players=list(self.names.values()),
            extra="군대 실거리 사격장이다. 통제관 호랑대장이 확성기로 사수들에게 짧게 외친다.",
        )
        self.book.prepare()
        self._emit(now, force=True)

    # ----- 진행 -----
    def _advance(self, now: float) -> None:
        """사격장을 지금 시각까지 진행하고, 그동안 일어난 일을 처리한다."""
        if self.phase not in ("brief", "fire", "cease"):
            return
        target = math.floor((now - self.start_at) * self.fps + 1e-6)
        rg = self.range
        while rg.frame < target and rg.phase != "over":
            rg.step()
        self._handle_events(now)

    def _handle_events(self, now: float) -> None:
        rg = self.range
        events, rg.events = rg.events, []
        for e in events:
            kind = e["type"]
            if kind == "tower":             # 대본 방송(규칙 기반)
                self.tower = {"text": e["text"], "source": "script", "at": now}
                self._script_at = now
                self.send_event({"type": "tower", "text": e["text"], "who": CASTER})
            elif kind == "dry":
                self.send_event({"type": "dry"}, to=e["playerId"])
            elif kind == "shot":
                self.send_event(e)
                self._comment_shot(e, now)
            elif kind == "half":
                self._comment("halfway", self._leader(), now, hold=6.0)
            elif kind == "down":
                done = e["k"] + 1
                perfect = [pid for pid in self.ids if rg.lanes[pid].hits == done]
                if not e["hitters"]:
                    self._comment("all_miss", "", now)
                elif done in PERFECT_MARKS and perfect:
                    self._comment("perfect", self.names[perfect[0]], now, hold=2.0)
            elif kind == "cease":
                # 결과가 정해졌다 → 총평을 한 번 요청하고, 사격 끝 한마디를 미뤄 둔다(대본 방송이 먼저)
                self.final_results = self.build_results()
                self._verdict_job = ask_verdict(
                    self.services.get("gemini"), game=self.title, results=self.final_results, caster=CASTER,
                    note="표적 20개. hits=명중 수, shots=쏜 탄, quick=빨리 맞힌 보너스, grade=사격 등급",
                )
                self._comment("cease", self._leader(), now, hold=8.0)

    def _leader(self) -> str:
        """지금 가장 앞선 사수의 이름."""
        if not self.ids:
            return ""
        best = max(self.ids, key=lambda pid: self._rank_key(pid))
        return self.names[best]

    def _rank_key(self, pid: str) -> tuple:
        lane = self.range.lanes[pid]
        return (lane.score(self.cfg), lane.hits, -lane.shots)

    # ----- AI 해설 -----
    def _comment_shot(self, e: dict, now: float) -> None:
        name = self.names.get(e["playerId"], "")
        if e["hit"]:
            if not self._first_hit:
                self._first_hit = True
                self._comment("first_hit", name, now, hold=3.0)   # 사격 개시 방송 직후일 수 있어 미뤄 둔다
            elif e["streak"] in STREAK_MARKS:
                self._comment("streak", name, now)
            elif e["dist"] == 250:
                self._comment("long_hit", name, now)
            elif e["quick"] >= self.cfg["QUICK_MAX"]:
                self._comment("fast_hit", name, now)
        elif e["missRun"] == 3:
            self._comment("miss_streak", name, now)

    def _can_say(self, now: float) -> bool:
        return (now - self._last_say_at >= self.cfg["SAY_GAP"]
                and now - self._script_at >= self.cfg["SCRIPT_GAP"])

    def _comment(self, kind: str, name: str, now: float, hold: float = 0.0) -> None:
        """해설 한 줄. 너무 자주 말하지 않는다: 지금 못 하면 버리고, hold 가 있으면 그 시간만큼 미뤄 둔다."""
        if self.book is None:
            return
        if not self._can_say(now):
            if hold > 0:
                self._pending = (kind, name, now + hold)
            return
        text, source = self.book.line(kind, self.rng, name=name)
        if not text:
            return
        self._last_say_at = now
        self.tower = {"text": text, "source": source, "at": now}
        self.send_event({"type": "say", "text": text, "source": source, "who": CASTER, "kind": kind})

    def _flush_pending(self, now: float) -> None:
        if self._pending is None:
            return
        kind, name, until = self._pending
        if now > until:
            self._pending = None
        elif self._can_say(now):
            self._pending = None
            self._comment(kind, name, now)

    def _check_verdict(self) -> None:
        job = self._verdict_job
        if job is None or not job.done():
            return
        self._verdict_job = None
        verdict = verdict_or_none(job)
        if verdict:
            self.verdict = verdict
            self.send_event({"type": "verdict", **verdict})

    # ------------------------------------------------------------------
    def tick(self, now: float) -> None:
        before = self.phase
        self._advance(now)
        rg = self.range
        if self.phase in ("brief", "fire", "cease"):
            self.phase = "final" if rg.phase == "over" else rg.phase
            if self.phase == "final":
                self._final_at = now
                if not self.final_results:
                    self.final_results = self.build_results()
        if self.phase == "final" and now >= self._final_at + self.cfg["FINAL_TIME"]:
            self.phase = "done"
        self._flush_pending(now)
        self._check_verdict()
        self._emit(now, force=self.phase != before)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if player_id not in self.range.lanes or not isinstance(data, dict):
            return
        kind = data.get("k")
        if kind not in ("in", "fire"):
            return
        self._advance(now)                  # 입력이 들어온 시각까지 진행한 뒤 반영한다
        held = data.get("held")
        if isinstance(held, int) and not isinstance(held, bool) and 0 <= held <= 15:
            self.range.set_held(player_id, held)
        if kind == "fire":
            self.range.fire(player_id)
            self._handle_events(now)

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        """끊긴 사람은 조준 키를 놓은 것으로 하고, 표적을 일찍 내릴지 볼 때 빼고 센다."""
        if player_id not in self.range.lanes:
            return
        if connected:
            self.range.away.discard(player_id)
        else:
            self.range.away.add(player_id)
            self.range.set_held(player_id, 0)

    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        """공통 결과 형식. 점수가 같으면 같은 순위이고, 줄 순서만 원본대로 명중 많은 순 → 쏜 탄 적은 순."""
        rows = []
        for pid in sorted(self.ids, key=self._rank_key, reverse=True):
            lane = self.range.lanes[pid]
            rows.append({
                "playerId": pid, "name": self.names[pid], "score": lane.score(self.cfg),
                "stats": {
                    "hits": lane.hits, "shots": lane.shots, "quick": lane.quick,
                    "grade": grade_of(lane.hits, self.cfg)["name"],
                    "accuracy": round(100 * lane.hits / lane.shots) if lane.shots else 0,
                    "bestStreak": lane.best_streak,
                },
            })
        return rank_results(rows)

    def snapshot(self, now: float) -> dict:
        rg = self.range
        tg = rg.target if rg.t_phase != "gap" else None      # 다음 표적은 올라올 때까지 알려 주지 않는다
        lanes = {}
        for pid in self.ids:
            lane = rg.lanes[pid]
            ax, ay = lane.aim()
            lanes[pid] = {
                "hits": lane.hits, "shots": lane.shots, "score": lane.score(self.cfg),
                "mag": lane.mag, "spare": lane.spare, "reload": lane.reload_t,
                "hitK": lane.hit_k, "fallT": lane.fall_t, "streak": lane.streak,
                "aim": [round(ax, 1), round(ay, 1)],
                "rec": "".join("1" if r else "0" for r in lane.record),
            }
        return {
            "phase": self.phase, "now": now, "startAt": self.start_at, "frame": rg.frame, "t": rg.t,
            "k": rg.k, "total": rg.total, "tPhase": rg.t_phase, "tT": rg.t_t,
            "target": {"dist": tg["dist"], "x": tg["x"], "time": tg["time"]} if tg else None,
            "lanes": lanes, "tower": self.tower, "verdict": self.verdict,
            "results": self.final_results if self.phase in ("final", "done") else None,
        }

    def me_view(self, pid: str) -> dict:
        """내 사로의 자세한 상태 — 브라우저가 조준점을 미리 그릴 때 기준으로 삼는다."""
        lane = self.range.lanes[pid]
        return {
            "ax": round(lane.ax, 3), "ay": round(lane.ay, 3), "kick": round(lane.kick, 3), "still": lane.still,
            "cooldown": lane.cooldown, "ph": lane.phase, "held": lane.held,
        }

    def state_for(self, player_id: str, now: float) -> dict | None:
        snap = self.snapshot(now)
        if player_id in self.range.lanes:
            snap["me"] = self.me_view(player_id)
        return snap

    def _emit(self, now: float, force: bool = False) -> None:
        if force or now - self._last_state_at >= 1.0 / self.cfg["STATE_HZ"] - 1e-9:
            self._last_state_at = now
            common = self.snapshot(now)
            for pid in self.ids:
                self.send_state({**common, "me": self.me_view(pid)}, to=pid)
