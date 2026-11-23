"""잭팟 볼링 (서버 판정) — 각자 자기 레인에서 동시에 5프레임을 치고 점수로 겨룬다.

원본은 레인 하나에서 한 명씩 차례로 쳤다. 여기서는 모두가 자기 화면의 레인에서 동시에 친다.
- 잭팟 핀(금색 핀) 자리와 핀이 튀는 난수의 씨앗은 모두 같다(같은 조건).
- 브라우저는 투구 값(위치 · 방향 · 힘 · 스핀)만 보낸다. 서버가 핀 물리(rules.Rack)와 프레임 점수를 계산한다.
- 핀 물리는 씨앗이 같으면 서버와 브라우저가 똑같은 결과를 내도록 옮겼다. 그래서 브라우저는 던지자마자
  같은 계산으로 핀이 쓰러지는 모습을 그리고, 서버가 보낸 결과("roll" 사건)와 다르면 서버 결과로 맞춘다.
- 한 번 던지는 제한 시간(THROW_LIMIT)이 지나면 브라우저가 그 순간의 게이지 값으로 던진다.
  그래도 투구가 오지 않으면(연결 끊김 등) 서버가 그 순간의 게이지 값을 계산해 대신 던진다.

브라우저 → 서버 (game.input 의 data)
    {"k": "throw", "n": 몇 번째 투구(0부터), "x": 위치, "angle": 방향, "power": 0~1, "spin": [-1|0|1, ...]}
"""

from __future__ import annotations

import math

from ...minigame import MiniGame
from ...services.caster import LineBook, ask_verdict, verdict_or_none
from . import rules
from .config import merge_config

CASTER = "해설자"

#: AI 해설 상황 (LineBook 에 넘기는 설명)
SAY_KINDS = {
    "start": "경기를 시작할 때",
    "strike": "선수가 스트라이크를 쳤을 때",
    "double": "선수가 스트라이크를 두 번 연속 쳤을 때(더블)",
    "turkey": "선수가 스트라이크를 세 번 이상 연속 쳤을 때(터키)",
    "spare": "선수가 남은 핀을 모두 처리했을 때(스페어)",
    "split": "핀이 양쪽으로 갈라져 남았을 때(스플릿)",
    "gutter": "공이 거터(도랑)에 빠졌을 때",
    "jackpot": "선수가 금색 잭팟 핀을 쓰러뜨려 보너스를 받았을 때",
    "lead": "선수가 1등으로 올라섰을 때(역전)",
    "last": "마지막 프레임이 시작될 때",
}

#: Gemini 가 꺼져 있거나 답이 안 왔을 때 쓰는 기본 대사
SAY_CANNED = {
    "start": ["잭팟 볼링, 지금 시작합니다!", "모두 자기 레인 앞에 섰습니다!"],
    "strike": ["{name} 스트라이크!", "{name}, 핀이 전부 쓰러졌습니다!"],
    "double": ["{name} 더블! 두 번 연속입니다!", "{name}, 또 스트라이크!"],
    "turkey": ["{name} 터키! 아무도 못 말립니다!", "{name}, 연속 스트라이크 행진!"],
    "spare": ["{name} 깔끔한 스페어!", "{name}, 남은 핀을 정리했습니다!"],
    "split": ["{name} 스플릿! 어렵게 남았네요!", "{name}, 핀이 갈라져 섰습니다!"],
    "gutter": ["{name} 거터! 아깝습니다!", "{name}, 공이 도랑으로 빠졌어요!"],
    "jackpot": ["{name} 잭팟 핀 명중! 보너스!", "{name}, 금색 핀을 쓰러뜨렸습니다!"],
    "lead": ["{name} 선두로 올라섭니다!", "순위가 바뀝니다! {name} 1등!"],
    "last": ["이제 마지막 프레임입니다!", "마지막 프레임, 끝까지 모릅니다!"],
}

#: 한 투구에 여러 일이 겹치면 앞에 있는 것 하나만 말한다
SAY_ORDER = ("turkey", "double", "strike", "lead", "jackpot", "spare", "split", "gutter")


class BowlingGame(MiniGame):
    id = "bowling"
    title = "잭팟 볼링"
    min_players = 2
    max_players = 5
    tick_hz = 20

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.R, self.F, self.T = self.cfg["RULES"], self.cfg["FLOW"], self.cfg["THROW"]
        self.N = int(self.cfg["FRAMES"])
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        # 모두 같은 조건: 핀 물리 씨앗 하나 + 프레임마다 잭팟 핀 자리(마지막 프레임은 핀을 최대 3번 세운다)
        self.seed = int(rng() * 2147483648)
        self.golds = [[self._random_gold() for _ in range(3 if f == self.N - 1 else 1)] for f in range(self.N)]
        self.P = {
            pid: {
                "rolls": [], "bonus": 0, "strikes": 0, "spares": 0, "streak": 0, "bestStreak": 0,
                "gutters": 0, "splits": 0, "jackpots": 0,
                "n": 0,                     # 지금까지 던진 횟수 (= 다음 투구 번호)
                "up": [1] * 10,             # 지금 서 있는 핀
                "gold": self.golds[0][0],   # 지금 세워진 핀 중 잭팟 핀 번호(-1 = 없음)
                "rack": 0,                  # 이 프레임에서 핀을 몇 번째로 세웠나
                "x": 0.0,                   # 마지막으로 선 위치
                "aimAt": 0.0, "deadline": 0.0, "doneAt": 0.0,
                "done": False, "away": False,
            }
            for pid in self.ids
        }
        self.phase = "idle"
        self.start_at = 0.0
        self.final_results: list[dict] = []
        self.verdict: dict | None = None
        self._verdict_job = None
        self._final_at = 0.0
        self._last_state_at = -1.0
        self._says: list[dict] = []        # 보낼 해설 {at, ttl, kind, name}
        self._last_say_at = -99.0
        self._leader: str | None = None
        self._last_frame_said = False
        self.book: LineBook | None = None

    def _random_gold(self) -> int:
        """금색 핀 번호 (가끔만 나옴, 없으면 -1) — 원본 randomGold 와 같은 순서로 난수를 쓴다."""
        return int(self.rng() * 10) if self.rng() < self.cfg["JACKPOT_CHANCE"] else -1

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        return {
            "frames": self.N, "seed": self.seed, "golds": self.golds,
            "intro": self.R["INTRO_TIME"], "throwLimit": self.R["THROW_LIMIT"],
            "jackpotBonus": self.cfg["JACKPOT_BONUS"],
        }

    def start(self, now: float) -> None:
        self.start_at = now + self.R["INTRO_TIME"]
        self.phase = "intro"
        for st in self.P.values():
            self._open_turn(st, self.start_at)
        # AI 해설: 이 판에 쓸 대사 묶음을 한 번 미리 요청한다(기다리지 않는다)
        self.book = LineBook(
            self.services.get("gemini"), game=self.title, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
            players=[self.names[pid] for pid in self.ids],
        )
        self.book.prepare()
        self._queue_say("start", "", now + 0.5, ttl=5.0)
        self._emit(now, force=True)

    def _open_turn(self, st: dict, at: float) -> None:
        st["aimAt"] = at
        st["deadline"] = at + self.R["THROW_LIMIT"]

    def tick(self, now: float) -> None:
        before = self.phase
        if self.phase == "intro" and now >= self.start_at:
            self.phase = "play"
        if self.phase == "play":
            for pid in self.ids:
                st = self.P[pid]
                if st["done"]:
                    continue
                # 제한 시간이 지나도 투구가 안 오면 서버가 그 순간의 게이지 값으로 던진다
                limit = st["aimAt"] + self.R["AWAY_LIMIT"] if st["away"] else st["deadline"] + self.R["GRACE"]
                if now >= limit:
                    self._auto_throw(pid, now)
            if all(st["done"] and now >= st["doneAt"] for st in self.P.values()):
                self.final_results = self.build_results()
                self.phase = "final"
                self._final_at = now
                # AI 총평: 결과가 정해진 순간 한 번 요청
                self._verdict_job = ask_verdict(
                    self.services.get("gemini"), game=self.title, results=self.final_results, caster=CASTER,
                    note=f"{self.N}프레임 볼링. stats 의 strikes=스트라이크 수, spares=스페어 수, bonus=잭팟 핀 보너스 점수",
                )
        if self.phase == "final":
            if self.verdict is None and self._verdict_job is not None and self._verdict_job.done():
                self.verdict = verdict_or_none(self._verdict_job)
                self._verdict_job = None
                if self.verdict:
                    self.send_event({"type": "verdict", **self.verdict})
            if now >= self._final_at + self.R["FINAL_TIME"]:
                self.phase = "done"
        self._flush_says(now)
        self._emit(now, force=self.phase != before)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        if player_id in self.P:
            self.P[player_id]["away"] = not connected

    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        st = self.P.get(player_id)
        if st is None or not isinstance(data, dict) or data.get("k") != "throw":
            return
        if self.phase != "play" or st["done"]:
            return
        if data.get("n") != st["n"] or now < st["aimAt"] - self.R["EARLY"]:
            return      # 이미 처리한 투구이거나, 앞 투구의 연출이 끝나기 전
        x, angle, power = (_number(data.get(k)) for k in ("x", "angle", "power"))
        spin = data.get("spin")
        if x is None or angle is None or power is None or not isinstance(spin, list):
            return
        # 범위를 벗어난 값은 잘라서 쓴다
        x = max(-self.T["START_RANGE"], min(self.T["START_RANGE"], x))
        angle = max(-self.T["AIM_MAX"], min(self.T["AIM_MAX"], angle))
        power = max(0.0, min(1.0, power))
        spin = [v if v in (-1, 0, 1) and not isinstance(v, bool) else 0 for v in spin[: self.R["MAX_SPIN_FRAMES"]]]
        # 브라우저는 스핀을 다 넣은 뒤에 보낸다 → 공은 이미 len(spin) 프레임만큼 굴러간 상태
        self._throw(player_id, x, angle, power, spin, now, auto=False, rolled=len(spin))

    def _auto_throw(self, pid: str, now: float) -> None:
        st = self.P[pid]
        frames = max(0, int((now - st["aimAt"]) * self.F["FPS"]))
        phase0 = rules.make_rng(rules.throw_seed(self.seed, st["n"], 1))() * math.pi * 2
        angle = round(rules.aim_angle(self.cfg, phase0, frames), 4)
        power = round(rules.power_at(self.cfg, frames), 3)
        self._throw(pid, st["x"], angle, power, [], now, auto=True, rolled=0)

    def _throw(self, pid: str, x: float, angle: float, power: float, spin: list, now: float, auto: bool, rolled: int) -> None:
        """투구 하나를 판정한다: 핀 물리 → 프레임 점수 → 다음 핀 배치 → 결과 사건."""
        st = self.P[pid]
        n = st["n"]
        frame_before = rules.frame_state(st["rolls"], self.N)["frame"]
        fresh = sum(st["up"]) == 10
        res = rules.simulate_throw(self.cfg, st["up"], st["gold"], x, angle, power, spin, rules.throw_seed(self.seed, n))
        up, knocked = res["up"], res["knocked"]
        st["rolls"].append(knocked)
        st["n"] = n + 1
        st["x"] = x

        # 어떤 투구였나 (원본 countPins 와 같은 순서)
        kind = None
        if fresh and knocked == 10:
            kind = "strike"
            st["strikes"] += 1
            st["streak"] += 1
            st["bestStreak"] = max(st["bestStreak"], st["streak"])
        elif not fresh and sum(up) == 0:
            kind = "spare"
            st["spares"] += 1
        elif knocked == 0 and res["gutter"]:
            kind = "gutter"
            st["gutters"] += 1
        elif fresh and rules.is_split(self.cfg, up):
            kind = "split"
            st["splits"] += 1
        if fresh and knocked != 10:
            st["streak"] = 0
        if res["goldHit"]:
            st["bonus"] += self.cfg["JACKPOT_BONUS"]
            st["jackpots"] += 1

        # 다음 핀 배치: 프레임이 끝났으면 새로 세우고, 아니면 쓰러진 핀만 치운다
        fs = rules.frame_state(st["rolls"], self.N)
        nxt = None
        if fs["done"]:
            st["done"] = True
        else:
            if fs["frame"] > frame_before:
                st["rack"] = 0
                nxt = {"reset": True, "up": [1] * 10, "gold": self.golds[fs["frame"]][0]}
            elif sum(up) == 0:      # 마지막 프레임의 보너스 투구
                st["rack"] += 1
                nxt = {"reset": True, "up": [1] * 10, "gold": self.golds[fs["frame"]][min(st["rack"], 2)]}
            else:
                nxt = {"reset": False, "up": list(up), "gold": st["gold"]}
            st["up"], st["gold"] = list(nxt["up"]), nxt["gold"]

        # 브라우저 연출 길이: 남은 굴러가기 + 결과 표시 + 스위퍼
        show = self.F["SHOW_ANIM"] if kind else self.F["SHOW_JACKPOT"] if res["goldHit"] else self.F["SHOW_PLAIN"]
        count_at = now + max(0, res["frames"] - rolled) / self.F["FPS"]
        if st["done"]:
            st["doneAt"] = count_at + show / self.F["FPS"]
        else:
            self._open_turn(st, count_at + (show + self.F["SWEEP_TIME"]) / self.F["FPS"])

        self.send_event({
            "type": "roll", "n": n, "auto": auto, "x": x, "angle": angle, "power": power, "spin": spin,
            "knocked": knocked, "up": up, "gutter": res["gutter"], "kind": kind, "streak": st["streak"],
            "jackpot": res["goldHit"], "rolls": list(st["rolls"]), "bonus": st["bonus"],
            "strikes": st["strikes"], "spares": st["spares"], "done": st["done"], "next": nxt,
            "aimAt": st["aimAt"], "deadline": st["deadline"],
        }, to=pid)

        # 해설: 화면에서 핀이 다 쓰러진 뒤(count_at)에 나오게 예약한다
        said = set()
        if kind == "strike":
            said.add("turkey" if st["streak"] >= 3 else "double" if st["streak"] == 2 else "strike")
        elif kind:
            said.add(kind)
        if res["goldHit"]:
            said.add("jackpot")
        if self._lead_changed(pid):
            said.add("lead")
        for k in SAY_ORDER:
            if k in said:
                self._queue_say(k, self.names[pid], count_at)
                break
        if not self._last_frame_said and not st["done"] and fs["frame"] == self.N - 1:
            self._last_frame_said = True
            self._queue_say("last", "", st["aimAt"], ttl=5.0)

    def total(self, pid: str) -> int:
        st = self.P[pid]
        return rules.running_score(st["rolls"], self.N) + st["bonus"]

    def _lead_changed(self, pid: str) -> bool:
        """방금 던진 pid 가 혼자 1등으로 새로 올라섰나."""
        totals = {p: self.total(p) for p in self.ids}
        top = max(totals.values())
        leaders = [p for p in self.ids if totals[p] == top]
        if top <= 0 or len(leaders) != 1 or leaders[0] == self._leader:
            return False
        changed = self._leader is not None and leaders[0] == pid
        self._leader = leaders[0]
        return changed

    # ----- AI 해설 -----
    def _queue_say(self, kind: str, name: str, at: float, ttl: float = 1.0) -> None:
        self._says.append({"kind": kind, "name": name, "at": at, "ttl": ttl})

    def _flush_says(self, now: float) -> None:
        """때가 된 해설을 보낸다. 너무 자주 말하지 않게 SAY_GAP 을 지키고, 오래 밀린 것은 버린다."""
        keep = []
        for s in self._says:
            if now < s["at"]:
                keep.append(s)
            elif now > s["at"] + s["ttl"] or self.book is None:
                continue                                  # 너무 늦었으면 말하지 않는다
            elif now - self._last_say_at >= self.R["SAY_GAP"]:
                text, source = self.book.line(s["kind"], self.rng, name=s["name"])
                if text:
                    self._last_say_at = now
                    self.send_event({"type": "say", "text": text, "source": source, "who": CASTER, "kind": s["kind"]})
            else:
                keep.append(s)
        self._says = keep

    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        """순위: 합계(볼링 + 잭팟) → 스트라이크 수 → 스페어 수. 셋 다 같으면 공동 순위."""
        rows = []
        for order, pid in enumerate(self.ids):
            st = self.P[pid]
            bowling = rules.running_score(st["rolls"], self.N)
            rows.append({
                "playerId": pid, "name": self.names[pid], "score": bowling + st["bonus"], "rank": 0, "isWinner": False,
                "stats": {
                    "bowling": bowling, "bonus": st["bonus"], "strikes": st["strikes"], "spares": st["spares"],
                    "bestStreak": st["bestStreak"], "gutters": st["gutters"], "splits": st["splits"], "rolls": list(st["rolls"]),
                },
                "_order": order,
            })
        key = lambda r: (r["score"], r["stats"]["strikes"], r["stats"]["spares"])  # noqa: E731
        rows.sort(key=lambda r: (-r["score"], -r["stats"]["strikes"], -r["stats"]["spares"], r["_order"]))
        for i, r in enumerate(rows):
            r["rank"] = rows[i - 1]["rank"] if i > 0 and key(r) == key(rows[i - 1]) else i + 1
            r["isWinner"] = r["rank"] == 1
            del r["_order"]
        return rows

    def snapshot(self, now: float) -> dict:
        return {
            "phase": self.phase, "now": now, "startAt": self.start_at, "frames": self.N,
            "players": {
                pid: {
                    "rolls": list(st["rolls"]), "bonus": st["bonus"], "total": self.total(pid),
                    "strikes": st["strikes"], "spares": st["spares"], "done": st["done"],
                }
                for pid, st in self.P.items()
            },
            "results": self.final_results if self.phase in ("final", "done") else None,
            "verdict": self.verdict,
        }

    def state_for(self, player_id: str, now: float) -> dict | None:
        """참가자마다 자기 레인 상태(me)를 함께 보낸다. 다시 접속한 사람은 이것으로 레인을 다시 만든다."""
        snap = self.snapshot(now)
        st = self.P.get(player_id)
        if st:
            snap["me"] = {
                "n": st["n"], "up": list(st["up"]), "gold": st["gold"], "x": st["x"],
                "aimAt": st["aimAt"], "deadline": st["deadline"], "done": st["done"],
            }
        return snap

    def _emit(self, now: float, force: bool = False) -> None:
        if force or now - self._last_state_at >= 1.0 / self.R["STATE_HZ"] - 1e-9:
            self._last_state_at = now
            for pid in self.ids:
                self.send_state(self.state_for(pid, now), to=pid)


def _number(v) -> float | None:
    """유한한 숫자만 받는다."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)
