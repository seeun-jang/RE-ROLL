"""잭팟 인형뽑기 (서버 판정) — 각자 자기 기계에서 "같은 인형 더미"를 코인 8개로 뽑아 점수를 겨룬다.

- 시작할 때 seed 하나를 정해 인형 배치를 만든다(machine.make_pile) → 모든 기계가 같은 배치, n번째 시도의 집는 힘도 같다.
- 참가자마다 기계(Machine)를 하나씩 서버가 60분의 1초 단위로 진행한다(가든 디펜스와 같은 방식).
  브라우저는 "누르고 있는 방향 / 내리기" 만 보내고, 무엇을 집었는지 · 미끄러졌는지 · 점수는 모두 서버가 정한다.
- 모두가 코인을 다 쓰면 끝. 순위는 점수 → 뽑은 개수 → 황금곰 수.

브라우저 → 서버 (game.input 의 data)
    {"k": "in", "dir": -1 | 0 | 1}        누르고 있는 방향이 바뀔 때마다
    {"k": "in", "drop": true}             내리기 키를 누른 순간 (dir 과 함께 보내도 된다)

AI (Gemini, services/caster.py)
    - 해설: 시작할 때 대사 묶음을 한 번 받아 두고(LineBook), 사건이 생기면 "say" 사건으로 한 줄씩 보낸다.
    - 총평: 결과가 정해지는 순간 한 번 요청하고, 결과 화면 동안 도착하면 "verdict" 사건으로 보낸다.
"""

from __future__ import annotations

import math

from ...minigame import MiniGame
from ...services.caster import LineBook, ask_verdict, verdict_or_none
from .config import merge_config
from .machine import Machine, make_pile

GAME_NAME = "잭팟 인형뽑기"
CASTER = "꽥대장"      # 오락실 사장 노릇을 하는 수다쟁이 오리

#: 해설 상황(Gemini 에게 설명하는 문장)
SAY_KINDS = {
    "start": "인형뽑기가 막 시작됐을 때",
    "gold": "{name} 이(가) 가장 비싼 황금곰 인형을 뽑았을 때 (잭팟)",
    "win": "{name} 이(가) 인형을 하나 뽑았을 때",
    "lucky": "{name} 이(가) 놓친 인형이 운 좋게 배출구로 굴러 들어갔을 때",
    "miss": "{name} 의 집게가 아무것도 못 집고 헛손질했을 때",
    "slip": "{name} 이(가) 집은 인형이 올라가다 미끄러져 떨어졌을 때",
    "lastcoin": "{name} 이(가) 마지막 코인을 넣었을 때",
    "lead": "{name} 이(가) 새로 1등이 됐을 때 (역전)",
    "end": "모두 코인을 다 쓰고 {name} 이(가) 우승했을 때",
}
#: Gemini 가 꺼져 있거나 늦을 때 쓰는 기본 대사
SAY_CANNED = {
    "start": ["꽥! 코인 넣고 시작이다!", "오늘의 잭팟은 누구냐 꽥!"],
    "gold": ["꽥! {name} 황금곰 잭팟!", "{name} 황금곰을 낚았다 꽥!"],
    "win": ["{name} 하나 뽑았다 꽥!", "좋아 {name}, 그대로 쭉!"],
    "lucky": ["{name} 굴러서 들어갔다 꽥!", "운도 실력이다 {name}!"],
    "miss": ["{name} 허공을 집었다 꽥!", "{name} 거긴 아무것도 없다!"],
    "slip": ["아이고 {name} 미끄러졌다!", "{name} 다 잡았다 놓쳤다 꽥!"],
    "lastcoin": ["{name} 마지막 코인이다 꽥!", "{name} 이번이 마지막 기회!"],
    "lead": ["꽥! {name} 1등으로 올라선다!", "{name} 역전이다 꽥꽥!"],
    "end": ["영업 끝! 우승은 {name} 꽥!", "{name} 오늘의 잭팟 왕이다!"],
}


class ClawGame(MiniGame):
    id = "claw"
    title = GAME_NAME
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.R, self.N, self.S = self.cfg["RULES"], self.cfg["NET"], self.cfg["SAY"]
        self.fps = self.cfg["BASE"]["LOGIC_FPS"]
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        # 인형 배치 seed — 모든 기계가 같은 더미로 시작한다
        self.seed = int(rng() * 1e9)
        pile = make_pile(self.cfg, self.seed)
        self.machines = {pid: Machine(self.cfg, self.seed, pile) for pid in self.ids}
        self.phase = "idle"         # idle → intro → play → end → final → done
        self.start_at = 0.0
        self.final_results: list[dict] = []
        self.verdict: dict | None = None
        self._verdict_job = None
        self._end_at = 0.0
        self._final_at = 0.0
        self._last_state_at = -1.0
        self._last_say_at = -99.0
        self._leader: str | None = None
        self.book: LineBook | None = None

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        return {
            "seed": self.seed, "coins": self.cfg["COINS"], "moveTime": self.cfg["MOVE_TIME"],
            "intro": self.R["INTRO_TIME"], "endDelay": self.R["END_DELAY"], "final": self.R["FINAL_TIME"],
            "types": self.cfg["PRIZE_TYPES"],
            "prizes": {k: {"r": v["r"], "value": v["value"]} for k, v in self.cfg["PRIZES"].items()},
            "caster": CASTER,
        }

    def start(self, now: float) -> None:
        self.start_at = now + self.R["INTRO_TIME"]
        self.phase = "intro"
        # AI 해설 대사 묶음을 미리 부탁해 둔다(기다리지 않는다)
        self.book = LineBook(
            self.services.get("gemini"), game=GAME_NAME, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
            players=list(self.names.values()), max_chars=18,
            extra="오락실 인형뽑기 기계 앞에서 떠드는 분위기. 코인 8개로 인형을 뽑아 점수를 겨룬다.",
        )
        self.book.prepare()
        self._emit(now, force=True)

    def gt(self, now: float) -> float:
        return now - self.start_at

    # ----- AI 해설 한 줄 -----
    def _say(self, kind: str, now: float, name: str = "", priority: bool = False) -> None:
        gap = self.S["PRIORITY_GAP"] if priority else self.S["MIN_GAP"]
        if self.book is None or now - self._last_say_at < gap:
            return
        text, source = self.book.line(kind, self.rng, name=name)
        if not text:
            return
        self._last_say_at = now
        self.send_event({"type": "say", "kind": kind, "text": text, "source": source, "who": CASTER})

    def _leader_now(self) -> str | None:
        """혼자 1등인 사람(점수가 0 이거나 공동 1등이면 None)."""
        best = max(self.ids, key=lambda pid: self.machines[pid].rank_key())
        key = self.machines[best].rank_key()
        if key[0] <= 0 or sum(1 for pid in self.ids if self.machines[pid].rank_key() == key) > 1:
            return None
        return best

    def _advance(self, now: float) -> None:
        """모든 기계를 지금 시각까지 진행하고, 생긴 일을 본인에게 알린다."""
        if self.phase not in ("play", "end"):
            return
        target = math.floor(self.gt(now) * self.fps + 1e-6)
        for pid in self.ids:
            m = self.machines[pid]
            while m.frame < target:
                m.step()
            if not m.events:
                continue
            events, m.events = m.events, []
            name = self.names[pid]
            for e in events:
                self.send_event(e, to=pid)
                kind = e["type"]
                if kind == "won":
                    if e["prize"] == "gold":
                        self._say("gold", now, name, priority=True)
                    else:
                        self._say("lucky" if e["lucky"] else "win", now, name)
                    leader = self._leader_now()
                    if leader is not None and leader != self._leader:
                        if self._leader is not None or len(self.ids) > 1:
                            self._say("lead", now, self.names[leader], priority=True)
                        self._leader = leader
                elif kind == "miss":
                    self._say("miss", now, name)
                elif kind == "slip":
                    self._say("slip", now, name)
                elif kind == "coin" and e["left"] == 0:
                    self._say("lastcoin", now, name)

    def tick(self, now: float) -> None:
        gt = self.gt(now)
        before = self.phase
        if self.phase == "intro" and gt >= 0:
            self.phase = "play"
            self._say("start", now, priority=True)
        self._advance(now)
        if self.phase == "play" and all(m.done for m in self.machines.values()):
            self.phase = "end"
            self._end_at = now
        if self.phase == "end" and now >= self._end_at + self.R["END_DELAY"]:
            # 결과가 정해지는 순간: 순위를 매기고 AI 총평을 한 번 부탁한다
            self.final_results = self.build_results()
            self.phase = "final"
            self._final_at = now
            winners = [r for r in self.final_results if r["isWinner"]]
            self._say("end", now, winners[0]["name"] if winners else "", priority=True)
            self._verdict_job = ask_verdict(
                self.services.get("gemini"), game=GAME_NAME, results=self.final_results, caster=CASTER,
                note="stats 의 prizes 는 뽑은 인형 수, gold 는 황금곰 수, slips 는 미끄러뜨린 횟수.",
            )
        if self.phase == "final":
            if self.verdict is None and self._verdict_job is not None and self._verdict_job.done():
                self.verdict = verdict_or_none(self._verdict_job)
                self._verdict_job = None
                if self.verdict is not None:
                    self.send_event({"type": "verdict", **self.verdict})
            if now >= self._final_at + self.R["FINAL_TIME"]:
                self.phase = "done"
        self._emit(now, force=self.phase != before)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        m = self.machines.get(player_id)
        if m is None or not isinstance(data, dict) or data.get("k") != "in" or self.phase != "play":
            return
        self._advance(now)      # 입력이 들어온 시각까지 진행한 뒤 반영한다
        m.set_input(data.get("dir"), data.get("drop") is True)

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        # 끊긴 사람은 키에서 손을 뗀 것으로 본다(8초 뒤 집게가 저절로 내려가므로 게임은 끝까지 간다)
        m = self.machines.get(player_id)
        if m is not None and not connected:
            m.dir = 0

    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        """점수 높은 순 → 뽑은 개수 많은 순 → 황금곰 많은 순. 모두 같으면 공동 순위."""
        rows = []
        for order, pid in enumerate(self.ids):
            m = self.machines[pid]
            rows.append({
                "playerId": pid, "name": self.names[pid], "score": m.score, "rank": 0, "isWinner": False,
                "stats": m.stats(), "_key": m.rank_key(), "_order": order,
            })
        rows.sort(key=lambda r: (tuple(-v for v in r["_key"]), r["_order"]))
        for i, r in enumerate(rows):
            r["rank"] = rows[i - 1]["rank"] if i > 0 and r["_key"] == rows[i - 1]["_key"] else i + 1
        for r in rows:
            r["isWinner"] = r["rank"] == 1
            del r["_key"], r["_order"]
        return rows

    def snapshot(self, now: float) -> dict:
        types = self.cfg["PRIZE_TYPES"]
        return {
            "phase": self.phase, "now": now, "startAt": self.start_at,
            "players": {
                pid: {"score": m.score, "coins": m.coins, "done": m.done,
                      "won": [types.index(p.type) for p in m.won]}
                for pid, m in self.machines.items()
            },
            "results": self.final_results if self.phase in ("final", "done") else None,
            "verdict": self.verdict,
        }

    def _personal(self, pid: str) -> dict:
        """본인 기계 상태. 코인을 다 쓴 사람에게는 아직 하는 사람의 기계도 함께 보낸다(관전)."""
        m = self.machines[pid]
        out = {"me": m.view()}
        if m.done and self.phase == "play":
            for other in self.ids:
                if not self.machines[other].done:
                    out["watch"] = {"id": other, "view": self.machines[other].view()}
                    break
        return out

    def state_for(self, player_id: str, now: float) -> dict | None:
        snap = self.snapshot(now)
        if player_id in self.machines:
            snap.update(self._personal(player_id))
        return snap

    def _emit(self, now: float, force: bool = False) -> None:
        if force or now - self._last_state_at >= 1.0 / self.N["STATE_HZ"] - 1e-9:
            self._last_state_at = now
            common = self.snapshot(now)
            for pid in self.ids:
                self.send_state({**common, **self._personal(pid)}, to=pid)
