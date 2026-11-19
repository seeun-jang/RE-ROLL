"""잭팟 그루브 (서버 판정) — 모두가 각자 화면에서 "같은 곡 · 같은 채보"를 동시에 연주해 점수로 겨룬다.

- 서버가 곡을 고르고(self.rng 로 3곡 중 하나, options["song"] 으로 지정 가능) 난이도는 "보통"(options["difficulty"]).
- 서버가 곡의 0초가 될 서버 시각(startAt)을 알린다. 브라우저는 그 시각에 맞춰 소리를 예약하고 노트를 그린다.
- 브라우저는 키를 누르거나 뗀 순간의 "곡 시간"(= 서버 시계 − startAt)과 레인만 보낸다.
  서버가 원본 판정 범위(±45/90/135ms)와 점수 공식으로 판정한다(performer.py).
- 통신 지연 보정: 보낸 시각이 서버 시각보다 0.35초 넘게 옛날이거나 미래이면 그 범위 안으로 당긴다.
  그래서 "놓친 노트(MISS)" 처리는 서버 시각보다 0.35초 늦게 한다(늦게 도착한 입력을 기다린다).
- 순위: 점수 → 최대 콤보 → PERFECT 수 (원본 그대로). 셋 다 같으면 공동 순위.

브라우저 → 서버 (game.input 의 data)
    {"k": "key", "lane": 0|1|2, "down": true|false, "t": 곡 시간(초)}
"""

from __future__ import annotations

import math

from ...minigame import MiniGame, rank_results
from ...services.caster import LineBook, ask_verdict, verdict_or_none
from .chart import build_chart
from .config import BREAK_SAY, COMBO_SAY, DEFAULT_DIFFICULTY, merge_config
from .performer import Performer
from .songs import SONG_ORDER, SONGS, expand_song

#: 해설 상황(상황 이름 → Gemini 에게 주는 설명)
SAY_KINDS = {
    "start": "곡이 막 시작됐을 때 (리듬 게임, 카지노 디스코 무대)",
    "jackpot": "코러스 '잭팟 타임'이 시작됐을 때",
    "combo50": "{name} 선수가 50콤보를 달성했을 때",
    "combo100": "{name} 선수가 100콤보를 달성했을 때",
    "pace": "곡 절반까지 {name} 선수가 한 번도 놓치지 않았을 때 (풀콤보 페이스)",
    "break": "{name} 선수의 긴 콤보가 끊겼을 때",
    "lead": "{name} 선수가 1등으로 올라섰을 때 (역전)",
    "final": "곡이 10초쯤 남은 막바지",
    "finish_s": "곡이 끝났고 {name} 선수가 S 등급을 받았을 때",
    "finish": "곡이 끝났을 때 (S 등급은 없음)",
}
#: Gemini 가 꺼져 있거나 늦을 때 쓰는 기본 대사
SAY_CANNED = {
    "start": ["꽥! 무대 조명 올려라!", "칩이 떨어진다, 준비 꽥!"],
    "jackpot": ["꽥! 잭팟 타임이다!", "코러스 간다, 다 같이 꽥!"],
    "combo50": ["{name} 50콤보 꽥!", "{name} 손이 안 보인다 꽥!"],
    "combo100": ["{name} 100콤보! 꽥꽥!", "{name} 오늘 무대 주인공 꽥!"],
    "pace": ["{name} 아직 안 놓쳤다 꽥!", "{name} 풀콤보 페이스 꽥!"],
    "break": ["앗, {name} 콤보 끊겼다 꽥!", "{name} 괜찮아, 다시 쌓자 꽥!"],
    "lead": ["{name} 1등으로 역전 꽥!", "선두가 바뀌었다, {name} 꽥!"],
    "final": ["막바지다, 끝까지 꽥!", "마지막 스퍼트 꽥꽥!"],
    "finish_s": ["{name} S 등급! 꽥꽥꽥!", "{name} 완벽한 무대였다 꽥!"],
    "finish": ["다들 수고했다 꽥!", "멋진 무대였다 꽥!"],
}
CASTER = "꽥대장"


class GrooveGame(MiniGame):
    id = "groove"
    title = "잭팟 그루브"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.F, self.N = self.cfg["FLOW"], self.cfg["NET"]
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        # 곡 고르기: 판마다 무작위(self.rng). 난이도는 기본 "보통".
        song_id = self.options.get("song")
        if song_id not in SONGS:
            song_id = SONG_ORDER[int(rng() * len(SONG_ORDER)) % len(SONG_ORDER)]
        diff = self.options.get("difficulty")
        if diff not in self.cfg["DIFFICULTY"]:
            diff = DEFAULT_DIFFICULTY
        self.song_id, self.difficulty = song_id, diff
        self.song = SONGS[song_id]
        self.ex = expand_song(self.song)
        self.chart = build_chart(self.song, diff)
        self.last_time = max((n["endTime"] if n["endTime"] is not None else n["time"]) for n in self.chart)
        self.lead = self.ex["barSec"] + self.F["LEAD_EXTRA"]      # 카운트인(한 마디) 길이
        self.P = {pid: Performer(self.chart, self.cfg) for pid in self.ids}
        self._last_t = {pid: -math.inf for pid in self.ids}       # 사람마다 마지막으로 받은 입력 시각
        self.phase = "idle"
        self.start_at = 0.0          # 곡 0초의 서버 시각
        self.final_results: list[dict] = []
        self.verdict: dict | None = None
        self._verdict_job = None
        self._phase_at = 0.0
        self._last_state_at = -1.0
        # 해설
        self.book: LineBook | None = None
        self.last_say: dict | None = None
        self._last_say_at = -math.inf
        self._said: set[str] = set()         # 한 번만 하는 해설
        self._leader: str | None = None
        self._jackpot_at = [b["index"] * self.ex["barSec"] for b in self.ex["bars"] if b["fever"] and b["firstOfSection"]]

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        d = self.cfg["DIFFICULTY"][self.difficulty]
        return {
            "song": self.song_id, "title": self.song["title"], "difficulty": self.difficulty,
            "approach": d["approach"], "lead": self.lead, "intro": self.F["INTRO_TIME"],
            "duration": self.ex["duration"], "notes": len(self.chart), "total": self.P[self.ids[0]].total,
            "maxLag": self.N["MAX_LAG"], "outro": self.F["OUTRO_TIME"], "final": self.F["FINAL_TIME"],
        }

    def start(self, now: float) -> None:
        self.start_at = now + self.F["INTRO_TIME"] + self.lead
        self.phase = "intro"
        self._phase_at = now
        # AI 해설: 이 판에 쓸 대사 묶음을 미리 부탁해 둔다(기다리지 않는다)
        self.book = LineBook(
            self.services.get("gemini"), game=self.title, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
            players=list(self.names.values()), extra=f"곡 이름: {self.song['title']}",
        )
        self.book.prepare()
        self._emit(now, force=True)

    def gt(self, now: float) -> float:
        """곡 시간: 곡의 0초부터 흐른 초(카운트인 동안은 음수)."""
        return now - self.start_at

    # ------------------------------------------------------------------
    def tick(self, now: float) -> None:
        gt = self.gt(now)
        before = self.phase
        if self.phase == "intro" and gt >= -self.lead:
            self.phase = "play"
            self._say("start", now)
        if self.phase == "play":
            # 놓친 노트는 MAX_LAG 만큼 기다렸다가 처리한다(늦게 도착하는 입력을 위해)
            for pid in self.ids:
                self.P[pid].sweep(gt - self.N["MAX_LAG"])
                self._after_judge(pid, now)
            self._commentary(gt, now)
            if gt > self.last_time + self.F["END_WAIT"] + self.N["MAX_LAG"] and all(p.finished for p in self.P.values()):
                self._end_song(now)
        if self.phase == "outro" and now >= self._phase_at + self.F["OUTRO_TIME"]:
            self.phase = "final"
            self._phase_at = now
        if self.phase in ("outro", "final") and self.verdict is None and self._verdict_job is not None:
            # AI 총평이 도착했는지만 본다(기다리지 않는다)
            if self._verdict_job.done():
                self.verdict = verdict_or_none(self._verdict_job)
                self._verdict_job = None
                if self.verdict:
                    self.send_event({"type": "verdict", **self.verdict})
        if self.phase == "final" and now >= self._phase_at + self.F["FINAL_TIME"]:
            self.phase = "done"
        self._emit(now, force=self.phase != before)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        p = self.P.get(player_id)
        if p is None or not isinstance(data, dict) or data.get("k") != "key" or self.phase != "play":
            return
        lane, down, t = data.get("lane"), data.get("down"), data.get("t")
        if isinstance(lane, bool) or lane not in (0, 1, 2) or not isinstance(down, bool):
            return
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(t):
            return
        gt = self.gt(now)
        # 판정 시각: 브라우저가 알려 준 시각을 쓰되, 너무 오래됐거나 미래면 서버 시각 쪽으로 당긴다
        t = min(gt, max(gt - self.N["MAX_LAG"], float(t)))
        t = max(t, self._last_t[player_id])      # 한 사람의 입력은 시각 순서대로 처리한다
        self._last_t[player_id] = t
        p.sweep(t)                               # 이 시각까지 지나간 노트를 먼저 정리하고
        if down and p.key_down[lane]:            # 떼지 않고 또 눌렀다고 하면 먼저 뗀 것으로 본다(롱노트가 엉키지 않게)
            p.input(int(lane), t, False)
        p.input(int(lane), t, down)              # 판정
        self._after_judge(player_id, now)

    # ------------------------------------------------------------------
    def _after_judge(self, pid: str, now: float) -> None:
        """방금 생긴 판정에서 사건(콤보 · 끊김)을 뽑아 알리고 해설한다."""
        p = self.P[pid]
        if not p.happened:
            return
        happened, p.happened = p.happened, []
        for what, n in happened:
            if what == "combo" and n % 50 == 0:
                self.send_event({"type": "combo", "playerId": pid, "n": n})
                if n in COMBO_SAY:
                    self._say(f"combo{n}", now, pid)
            elif what == "break" and n >= BREAK_SAY:
                self.send_event({"type": "break", "playerId": pid, "combo": n})
                self._say("break", now, pid)

    def _commentary(self, gt: float, now: float) -> None:
        """시간 · 순위에 따른 해설."""
        # 한 번만 하는 해설: 다른 말과 겹쳐 못 했으면(SAY_GAP) 몇 초 동안 다시 시도한다
        for i, t0 in enumerate(self._jackpot_at):
            if t0 <= gt < t0 + 4 and f"jackpot{i}" not in self._said and self._say("jackpot", now):
                self._said.add(f"jackpot{i}")
        dur = self.ex["duration"]
        if dur / 2 <= gt < dur / 2 + 6 and "pace" not in self._said:
            clean = [pid for pid in self.ids if self.P[pid].counts["miss"] == 0 and self.P[pid].judged > 0]
            if not clean or self._say("pace", now, max(clean, key=lambda pid: self.P[pid].score)):
                self._said.add("pace")
        if dur - 10 <= gt < dur - 4 and "final" not in self._said and self._say("final", now):
            self._said.add("final")
        # 1등이 바뀌었나 (동점이면 그대로)
        best = max(self.ids, key=lambda pid: self.P[pid].score)
        if self.P[best].score > 0 and best != self._leader:
            if self._leader is None or self.P[best].score > self.P[self._leader].score:
                changed = self._leader is not None
                self._leader = best
                if changed:
                    self.send_event({"type": "lead", "playerId": best})
                    if gt > 3:
                        self._say("lead", now, best)

    def _say(self, kind: str, now: float, pid: str | None = None, force: bool = False) -> bool:
        """해설 한 줄. 너무 자주 말하지 않게 SAY_GAP 초 간격을 둔다."""
        if self.book is None or (not force and now - self._last_say_at < self.N["SAY_GAP"]):
            return False
        text, source = self.book.line(kind, self.rng, name=self.names.get(pid, "") if pid else "")
        if not text:
            return False
        self._last_say_at = now
        self.last_say = {"type": "say", "text": text, "source": source, "who": CASTER, "kind": kind}
        self.send_event(dict(self.last_say))
        return True

    def _end_song(self, now: float) -> None:
        """모든 노트가 끝났다: 결과를 정하고 총평을 부탁한다."""
        self.final_results = self.build_results()
        self.phase = "outro"
        self._phase_at = now
        for r in self.final_results:
            st = r["stats"]
            self.send_event({"type": "finish", "playerId": r["playerId"], "grade": st["grade"],
                             "fullCombo": st["fullCombo"], "allPerfect": st["allPerfect"]})
        s_rank = [r for r in self.final_results if r["stats"]["grade"] == "S"]
        if s_rank:
            self._say("finish_s", now, s_rank[0]["playerId"], force=True)
        else:
            self._say("finish", now, force=True)
        self._verdict_job = ask_verdict(
            self.services.get("gemini"), game=self.title, results=self.final_results, caster=CASTER,
            note=f"곡 '{self.song['title']}', 점수는 1,000,000점 만점, 등급 S~D",
        )

    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        rows = rank_results([
            {
                "playerId": pid, "name": self.names[pid], "score": self.P[pid].score,
                "stats": {
                    **{k: v for k, v in self.P[pid].summary().items() if k != "score"},
                    "song": self.song_id, "difficulty": self.difficulty,
                },
            }
            for pid in self.ids
        ])
        # 원본 순위 규칙: 점수 → 최대 콤보 → PERFECT 수. 셋 다 같을 때만 공동 순위.
        order = {pid: i for i, pid in enumerate(self.ids)}
        key = lambda r: (r["score"], r["stats"]["maxCombo"], r["stats"]["perfect"])   # noqa: E731
        rows.sort(key=lambda r: (-r["score"], -r["stats"]["maxCombo"], -r["stats"]["perfect"], order[r["playerId"]]))
        for i, r in enumerate(rows):
            r["rank"] = rows[i - 1]["rank"] if i > 0 and key(r) == key(rows[i - 1]) else i + 1
            r["isWinner"] = r["rank"] == 1
        return rows

    def snapshot(self, now: float) -> dict:
        players = {}
        for pid in self.ids:
            p = self.P[pid]
            players[pid] = {
                "score": p.score, "combo": p.combo, "maxCombo": p.max_combo, **p.counts,
                "judged": p.judged, "grade": p.live_grade,
            }
        done = self.phase in ("outro", "final", "done")
        return {
            "phase": self.phase, "now": now, "startAt": self.start_at, "song": self.song_id,
            "difficulty": self.difficulty, "players": players, "leader": self._leader,
            "results": self.final_results if done else None,
            "verdict": self.verdict, "say": self.last_say,
        }

    def state_for(self, player_id: str, now: float) -> dict | None:
        """다시 접속한 사람에게: 내 채보가 어디까지 판정됐는지도 알려 준다."""
        snap = self.snapshot(now)
        p = self.P.get(player_id)
        if p is not None:
            snap["me"] = p.dump()
        return snap

    def _emit(self, now: float, force: bool = False) -> None:
        # 연주 중에는 초당 STATE_HZ 번, 그 밖에는 장면이 바뀔 때와 1초마다
        gap = 1.0 / self.N["STATE_HZ"] if self.phase == "play" else 1.0
        if force or now - self._last_state_at >= gap - 1e-9:
            self._last_state_at = now
            self.send_state(self.snapshot(now))
