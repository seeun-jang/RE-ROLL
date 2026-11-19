"""1:1 한 경기 — 원본 js/bout.js 의 규칙 부분을 그대로 옮긴 것.

    intro(선수 소개 150프레임) → fight(45초) → ko(심판 카운트) 또는 decision(판정) → done

한 번 step() = 1/60초. 화면 효과 · 소리는 사건(events)으로 내보내고 브라우저가 그린다.
"""

from __future__ import annotations

from .fighter import Fighter


class Bout:
    def __init__(self, cfg: dict, red: dict, blue: dict, rng):
        """red, blue: {"id", "name"}. red 가 왼쪽(홍코너), blue 가 오른쪽(청코너)."""
        self.cfg = cfg
        self.rng = rng
        self.red = Fighter(cfg, red["id"], red["name"], "red")
        self.blue = Fighter(cfg, blue["id"], blue["name"], "blue")
        self.fighters = [self.red, self.blue]
        self.frame = 0
        self.time = cfg["BOUT"]["TIME"]
        self.state = "intro"
        self.state_t = 0
        self.hitstop = 0
        self.slowmo = 0
        self.count = 0
        self.winner: Fighter | None = None
        self.loser: Fighter | None = None
        self.by_ko = False
        self.done = False
        self.events: list[dict] = []

    @property
    def frozen(self) -> bool:
        return self.state != "fight"

    def emit(self, ev: dict) -> None:
        self.events.append(ev)

    def pop_events(self) -> list[dict]:
        out, self.events = self.events, []
        return out

    def step(self, ctrl_red: dict, ctrl_blue: dict) -> None:
        if self.done:
            return
        B = self.cfg["BOUT"]
        self.frame += 1
        self.state_t += 1
        if self.frame == 1:
            self.emit({"type": "cue", "name": "bell"})
        if self.hitstop > 0:
            self.hitstop -= 1
            return
        # KO 순간 슬로모션: 2프레임에 한 번만 진행
        if self.slowmo > 0:
            self.slowmo -= 1
            if self.slowmo % 2 == 1:
                return

        if self.state == "intro":
            # 링 아나운서: 홍코너 소개 → 청코너 소개 → 라운드 → 땡! → FIGHT!
            if self.state_t in (4, 44):
                self.emit({"type": "cue", "name": "call"})
            if self.state_t == 110:
                self.emit({"type": "cue", "name": "bell"})
            if self.state_t == 128:
                self.emit({"type": "cue", "name": "fight"})
            if self.state_t >= B["INTRO_LEN"]:
                self._set_state("fight")
                self.emit({"type": "start"})
        elif self.state == "fight":
            self.time -= 1
            if 0 < self.time <= 300 and self.time % 60 == 0:
                self.emit({"type": "cue", "name": "countdown"})
            if self.time == B["HURRY"]:
                self.emit({"type": "hurry"})
            if self.time <= 0:
                self._decide()
        elif self.state == "ko":
            # 심판 카운트 1~10 → 땡땡 → K.O.!
            since = self.state_t - B["COUNT_START"]
            c = since // B["COUNT_STEP"] + 1
            if since >= 0 and since % B["COUNT_STEP"] == 0 and c <= 10:
                self.count = c
                self.emit({"type": "count", "n": c})
            end = B["COUNT_START"] + B["COUNT_STEP"] * 10
            if self.state_t == end:
                self.emit({"type": "cue", "name": "koBell"})
            if self.state_t >= end + B["KO_TAIL"]:
                self._finish()
        elif self.state == "decision":
            if self.state_t >= B["DECISION_LEN"]:
                self._finish()

        self.red.update(self, ctrl_red, self.blue)
        self.blue.update(self, ctrl_blue, self.red)
        self._separate()

    def _set_state(self, s: str) -> None:
        self.state = s
        self.state_t = 0

    def _finish(self) -> None:
        if not self.done:
            self.done = True
            self.emit({"type": "end", "winner": self.winner.corner, "byKO": self.by_ko})

    def _separate(self) -> None:
        """몸끼리 겹치지 않게 밀어낸다."""
        need = self.cfg["FIGHTER"]["BODY_W"] * 2
        a, b = self.red, self.blue
        d = b.x - a.x
        if abs(d) < need:
            push = (need - abs(d)) / 2
            s = 1 if d >= 0 else -1
            a.x -= s * push
            b.x += s * push

    def resolve_hit(self, att: Fighter, target: Fighter, kind: str) -> None:
        """펀치가 닿았을 때(히트스톱 포함)."""
        P = self.cfg["PUNCH"][kind]
        res = target.take_hit(att, kind, self)
        ev = {"type": "hit", "side": att.corner, "kind": kind, "dmg": res["dmg"], "blocked": res["blocked"],
              "slip": res["slip"], "counter": res["counter"], "broken": res["broken"],
              "x": round(target.x, 2), "dir": att.facing, "ko": False}
        if res["slip"]:
            self.hitstop = 6
            self.emit(ev)
            return
        if res["blocked"]:
            self.hitstop = 3
        else:
            self.hitstop = P["hitstop"] + (8 if res["counter"] else 0)
        if target.hp <= 0:
            ev["ko"] = True
            self.emit(ev)
            self._knockout(att, target)
        else:
            self.emit(ev)

    def _knockout(self, att: Fighter, target: Fighter) -> None:
        target.set_state("ko")
        target.vx = att.facing * 3
        att.set_state("win")
        self.winner, self.loser, self.by_ko = att, target, True
        self.slowmo = 60
        self.hitstop = 14
        self._set_state("ko")
        self.count = 0
        self.emit({"type": "ko", "winner": att.corner})

    def _decide(self) -> None:
        """시간 종료: 남은 체력 → 맞힌 횟수 → 무작위 순으로 판정."""
        a, b = self.red, self.blue
        if a.hp != b.hp:
            w = a if a.hp > b.hp else b
        elif a.hits != b.hits:
            w = a if a.hits > b.hits else b
        else:
            w = a if self.rng() < 0.5 else b
        self.winner, self.loser, self.by_ko = w, (b if w is a else a), False
        w.set_state("win")
        self._set_state("decision")
        self.emit({"type": "decision", "winner": w.corner})

    def snapshot(self) -> dict:
        return {
            "frame": self.frame, "state": self.state, "stateT": self.state_t, "time": self.time,
            "hitstop": self.hitstop, "slowmo": self.slowmo, "count": self.count,
            "winner": self.winner.corner if self.winner else None, "byKO": self.by_ko, "done": self.done,
            "red": self.red.snapshot(), "blue": self.blue.snapshot(),
        }
