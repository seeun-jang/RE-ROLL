"""검도 한 경기(두 사람) — 원본 js/scenes/match_scene.js 의 시합 진행을 옮긴 것(화면·소리·수련은 뺐다).

흐름(flow): intro(준거) → ready(개시선) → play → stop(한판/반칙/갈려/시간) → ready … → end
play 한 틱:
    입력 → 선수 갱신(타격 접촉은 on_strike_active 에서 해석) → 몸 충돌
    → 잔심 확인 중인 타격 처리(→ 판정 → 심판 깃발 → 한판) → 기세 경직 → 장외 · 코등이 싸움 · 시간

원본과 다른 점: 시간이 끝났을 때 동점이면 연장전 없이 바로 심판 판정(판정승)으로 끝낸다.
"""

from __future__ import annotations

from . import judge
from .fighter import Fighter

LABELS = {"men": "머", "kote": "손", "do": "허", "hansoku": "반"}
ATTACKS = ("men", "kote", "do")


def other(side: str) -> str:
    return "white" if side == "red" else "red"


class Rules:
    """시합 규칙(원본 js/game/rules.js). 먼저 POINTS_TO_WIN 판을 따면 승리."""

    def __init__(self, cfg: dict):
        M = cfg["MATCH"]
        self.cfg = cfg
        self.time_left = int(M["TIME_SEC"] * 60 + 0.5)
        self.to_win = M["POINTS_TO_WIN"]
        self.points: dict[str, list[str]] = {"red": [], "white": []}
        self.hansoku = {"red": 0, "white": 0}
        self.winner: str | None = None
        self.decided_by: str | None = None

    def tick(self) -> None:
        if self.time_left > 0:
            self.time_left -= 1

    def award(self, side: str, kind: str) -> str | None:
        self.points[side].append(kind)
        if len(self.points[side]) >= self.to_win:
            self.winner = side
            self.decided_by = "points"
        return self.winner

    def add_hansoku(self, side: str) -> dict:
        self.hansoku[side] += 1
        if self.hansoku[side] >= self.cfg["MATCH"]["HANSOKU_LIMIT"]:
            self.hansoku[side] = 0
            to = other(side)
            return {"converted": True, "to": to, "winner": self.award(to, "hansoku"), "count": 0}
        return {"converted": False, "count": self.hansoku[side], "winner": None}

    def decide_on_time(self) -> str | None:
        r, w = len(self.points["red"]), len(self.points["white"])
        if r != w:
            self.winner = "red" if r > w else "white"
            self.decided_by = "time"
        return self.winner

    @property
    def is_shobu(self) -> bool:
        return len(self.points["red"]) == self.to_win - 1 and len(self.points["white"]) == self.to_win - 1

    @property
    def total_points(self) -> int:
        return len(self.points["red"]) + len(self.points["white"])


class Controller:
    """누르고 있는 키 + 이번 틱에 새로 누른 키 → 의도(intent). 공격 키는 짧게 선입력을 허용한다."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.buf: str | None = None
        self.buf_t = 0

    def clear(self) -> None:
        self.buf = None
        self.buf_t = 0

    def intent(self, f: Fighter, inp: dict) -> dict:
        pressed = inp["pressed"]
        move = (1 if inp["right"] else 0) - (1 if inp["left"] else 0)
        hit = next((a for a in ATTACKS if a in pressed), None)
        if hit:
            self.buf = hit
            self.buf_t = self.cfg["INPUT_BUFFER"]
        attack = None
        if self.buf and (f.can_act or f.state == "block"):
            attack = self.buf
            self.clear()
        elif self.buf_t > 0:
            self.buf_t -= 1
            if self.buf_t == 0:
                self.buf = None
        return {
            "move": move, "attack": attack, "attackPressed": bool(hit),
            # 한 틱보다 짧게 톡 친 것도 놓치지 않는다
            "block": inp["block"] or "block" in pressed, "blockPressed": "block" in pressed,
            "kiai": inp["kiai"] or "kiai" in pressed, "kiaiPressed": "kiai" in pressed,
        }


NO_INPUT = {"left": False, "right": False, "kiai": False, "block": False, "pressed": ()}


class Duel:
    def __init__(self, cfg: dict, red: dict, white: dict, rng):
        self.cfg = cfg
        self.rng = rng
        self.red = Fighter(cfg, red["name"], "red", 1, red.get("id"))
        self.white = Fighter(cfg, white["name"], "white", -1, white.get("id"))
        self.fighters = [self.red, self.white]
        self.ctrl = {"red": Controller(cfg), "white": Controller(cfg)}
        self.rules = Rules(cfg)
        self.pending: list[dict] = []
        self.out_pending: Fighter | None = None
        self.frame = 0
        self.hitstop = 0
        self.clinch_t = 0
        self.hantei_score = {"red": 0.0, "white": 0.0}
        self.stats = {"red": {"ippons": 0, "strikes": 0, "parries": 0}, "white": {"ippons": 0, "strikes": 0, "parries": 0}}
        self.over = False
        self.started = False
        self.events: list[dict] = []
        self.flow = {"name": "wait", "t": 0, "dur": 0, "onEnd": None}
        self.reset_positions()
        for f in self.fighters:
            f.freeze("sonkyo")

    # ── 흐름 ──
    def set_flow(self, name: str, dur: int = 0, on_end=None) -> None:
        self.flow = {"name": name, "t": 0, "dur": dur, "onEnd": on_end}

    def start(self) -> None:
        self.started = True
        self.set_flow("intro", 80, lambda: self.begin_point(True))

    def reset_positions(self) -> None:
        C = self.cfg
        self.red.reset(C["COURT_CENTER"] - C["START_GAP"])
        self.white.reset(C["COURT_CENTER"] + C["START_GAP"])
        self.ctrl["red"].clear()
        self.ctrl["white"].clear()
        self.pending = []
        self.out_pending = None
        self.clinch_t = 0

    def begin_point(self, first: bool) -> None:
        self.reset_positions()
        for f in self.fighters:
            f.freeze("sonkyo" if first else "frozen")
        self.set_flow("ready", 50 if first else 30, self.call_hajime)

    def call_hajime(self) -> None:
        label = "승부!" if self.rules.is_shobu else "두 번째 판!" if self.rules.total_points > 0 else "시작!"
        K = self.cfg["KIAI"]
        for f in self.fighters:      # "시작!" 과 함께 두 선수 모두 기합을 지르며 일어선다
            f.set_state("idle")
            f.kiai = max(f.kiai, K["REQUIRED"] + 15)
        self.events.append({"type": "hajime", "label": label, "shobu": self.rules.is_shobu})
        self.set_flow("play")

    def stop_play(self, dur: int, then) -> None:
        self.pending = []
        self.out_pending = None
        self.set_flow("stop", dur, then)

    def opponent(self, f: Fighter) -> Fighter:
        return self.white if f is self.red else self.red

    # ── 선수가 알리는 사건 ──
    def on_kiai(self, f: Fighter) -> None:
        self.events.append({"type": "kiai", "side": f.side})

    def on_step(self, f: Fighter) -> None:
        self.events.append({"type": "step", "side": f.side})

    def on_strike_active(self, att: Fighter) -> dict:
        """타격이 닿는 틱."""
        # 시합이 멈춘 뒤 마저 내려온 타격, 시계가 0:00 이 된 뒤의 새 타격은 판정 없이 흘려보낸다
        if self.flow["name"] != "play" or self.rules.time_left == 0:
            return {"kind": "whiff"}
        C = self.cfg
        M = C["MOMENTUM"]
        de = self.opponent(att)
        s = att.strike
        res = judge.resolve_strike(C, att, de)
        kind = res["kind"]
        self.stats[att.side]["strikes"] += 1
        if kind == "whiff":
            att.add_momentum(-M["WHIFF"])
        elif kind == "parried":
            att.stagger(C["PARRY"]["STAGGER"])
            att.add_momentum(-M["PARRIED"])
            de.block_hit = True
            de.on_parry()
            self.stats[de.side]["parries"] += 1
            self.hitstop = C["FX"]["HITSTOP_CLASH"]
        elif kind == "blocked":
            att.add_momentum(-M["BLOCKED"])
            de.add_momentum(M["BLOCK_GAIN"])
            de.block_hit = True
            self.hitstop = 2
        elif kind == "deflected":
            att.add_momentum(-M["DEFLECTED"])
            self.hitstop = 2
        else:   # contact
            self.hitstop = C["FX"]["HITSTOP_CONTACT"]
            de.flinch()
            de.add_momentum(-M["GOT_HIT"])
            rec = {
                "att": att, "side": att.side, "type": s["type"], "contactFrame": self.frame, "dist": res["dist"],
                "band": judge.band(C, s["type"], att.reach), "tooClose": res["tooClose"], "opening": res["opening"],
                "kiaiOk": s["kiaiOk"], "kiaiGauge": s["kiaiGauge"],
                "kiaiTimed": (self.frame - att.last_kiai_press) <= C["KIAI"]["TIMING_WINDOW"],
                "counter": s["counter"], "debana": res["defPhase"] == "windup",
                "momentum": s["momentumAtStart"], "backward": s["moveRelAtStart"] < 0,
                "zanshinT": 0, "retreatT": 0, "zanshinBroken": None, "aiuchi": False,
            }
            # 상타: 서로 거의 동시에 "유효할 수 있는" 타격이 맞았으면 둘 다 무효
            if rec["kiaiOk"] and not rec["tooClose"]:
                for p in self.pending:
                    if (p["att"] is not att and p["kiaiOk"] and not p["tooClose"]
                            and self.frame - p["contactFrame"] <= C["AIUCHI_TICKS"]):
                        p["aiuchi"] = True
                        rec["aiuchi"] = True
            self.pending.append(rec)
        self.events.append({"type": "strike", "side": att.side, "kind": kind, "strike": s["type"], "kiaiOk": s["kiaiOk"]})
        return res

    # ── 잔심 확인 → 판정 ──
    def update_pending(self, intents: dict) -> None:
        Z = self.cfg["ZANSHIN"]
        for rec in list(self.pending):
            rec["zanshinT"] += 1
            intent = intents[rec["side"]]
            att = rec["att"]
            if not rec["zanshinBroken"]:
                if intent["attackPressed"] or intent["blockPressed"]:
                    rec["zanshinBroken"] = "잔심 중 다시 공격/막기 입력"
                elif att.move_rel < 0:
                    rec["retreatT"] += 1
                    if rec["retreatT"] > Z["RETREAT_MAX"]:
                        rec["zanshinBroken"] = "잔심 중 물러남"
                if att.state in ("stagger", "stun"):
                    rec["zanshinBroken"] = "자세가 무너짐"
            if rec["zanshinT"] >= Z["TICKS"]:
                self.pending.remove(rec)
                self.judge_record(rec)
                if self.flow["name"] != "play":
                    return

    def vote(self, ev: dict, side: str) -> list[str]:
        """심판 3명의 깃발. 기준값이 조금씩 다르고 매번 약간의 개인차가 있다."""
        C = self.cfg
        votes = []
        for ref in C["REFEREES"]:
            th = ref["threshold"] + (self.rng() * 2 - 1) * C["REF_NOISE"]
            if ev["valid"] and ev["quality"] >= th:
                votes.append(side)
            elif not ev["valid"] or ev["quality"] >= C["JUDGE"]["WAVE_MIN"]:
                votes.append("wave")
            else:
                votes.append("none")
        return votes

    def judge_record(self, rec: dict) -> None:
        ev = judge.evaluate_strike(self.cfg, rec)
        votes = self.vote(ev, rec["side"])
        n = sum(1 for v in votes if v == rec["side"])
        ippon = ev["valid"] and n >= 2
        self.hantei_score[rec["side"]] += ev["quality"] * (1 if ev["valid"] else 0.4)
        reason = None
        if not ippon:
            reason = ev["mainReason"] or ("깃발 1개 — 한판 부족" if n == 1 else "판정 점수 부족 (빈틈이 작다)")
        self.events.append({"type": "judge", "side": rec["side"], "strike": rec["type"], "ippon": ippon, "votes": votes,
                            "quality": ev["quality"], "tags": ev["tags"], "reason": reason})
        if ippon:
            self.award_ippon(rec)

    def award_ippon(self, rec: dict) -> None:
        self.hitstop = self.cfg["FX"]["HITSTOP_IPPON"]
        self.stats[rec["side"]]["ippons"] += 1
        for f in self.fighters:
            if f.state != "strike":
                f.freeze("frozen")
        winner = self.rules.award(rec["side"], rec["type"])
        self.stop_play(130, (lambda: self.end_match(winner)) if winner else (lambda: self.begin_point(False)))

    def do_hansoku(self, f: Fighter) -> None:
        """장외 반칙."""
        r = self.rules.add_hansoku(f.side)
        for x in self.fighters:
            x.freeze("frozen")
        self.events.append({"type": "hansoku", "side": f.side, "converted": r["converted"], "count": r["count"]})
        winner = r["winner"]
        self.stop_play(110, (lambda: self.end_match(winner)) if winner else (lambda: self.begin_point(False)))

    def wakare(self) -> None:
        """코등이 싸움이 길어지면 "갈려!"."""
        C = self.cfg
        for x in self.fighters:
            if x.state == "stun":
                x.momentum = max(x.momentum, C["MOMENTUM"]["STUN_RECOVER"])
            x.freeze("frozen")
        mid = max(C["COURT_LEFT"] + 40, min(C["COURT_RIGHT"] - 40, (self.red.x + self.white.x) / 2))
        self.events.append({"type": "wakare"})

        def resume():
            self.red.x = mid - 28
            self.white.x = mid + 28
            self.clinch_t = 0
            self.ctrl["red"].clear()
            self.ctrl["white"].clear()
            self.call_hajime()

        self.stop_play(50, resume)

    def time_up(self) -> None:
        for x in self.fighters:
            x.freeze("frozen")
        self.events.append({"type": "timeup"})

        def decide():
            w = self.rules.decide_on_time()
            if w:
                self.end_match(w)
            else:
                self.hantei()

        self.stop_play(90, decide)

    def hantei(self) -> None:
        """동점으로 시간 종료 → 심판 판정: 판정받은 타격 내용 + 기세로 각자 깃발."""
        C = self.cfg
        sc_red = self.hantei_score["red"] + self.red.momentum / C["MOMENTUM"]["MAX"] * 0.5
        sc_white = self.hantei_score["white"] + self.white.momentum / C["MOMENTUM"]["MAX"] * 0.5
        votes = []
        for _ in C["REFEREES"]:
            d = sc_red - sc_white + (self.rng() * 2 - 1) * C["MATCH"]["HANTEI_NOISE"]
            votes.append("red" if d >= 0 else "white")
        winner = "red" if sum(1 for v in votes if v == "red") >= 2 else "white"
        self.rules.winner = winner
        self.rules.decided_by = "hantei"
        self.events.append({"type": "hantei", "votes": votes, "winner": winner})
        self.stop_play(100, lambda: self.end_match(winner))

    def end_match(self, winner: str) -> None:
        self.rules.winner = winner
        self.pending = []
        self.events.append({"type": "end", "winner": winner, "decidedBy": self.rules.decided_by})
        self.set_flow("end", 150, self._finish)

    def _finish(self) -> None:
        self.over = True

    # ── 몸 충돌 (서로 통과하지 못하고, 더 세게 미는 쪽이 민다) ──
    def resolve_bodies(self) -> None:
        C = self.cfg
        a, b = self.red, self.white
        d = b.x - a.x
        if d < C["BODY_MIN_DIST"]:
            over = C["BODY_MIN_DIST"] - d
            pa = max(0, a.vx) + (0.6 if a.state == "strike" else 0) + 0.5
            pb = max(0, -b.vx) + (0.6 if b.state == "strike" else 0) + 0.5
            ra = pb / (pa + pb)
            a.x -= over * ra
            b.x += over * (1 - ra)
            if a.vx > 0:
                a.vx *= 0.3
            if b.vx < 0:
                b.vx *= 0.3
        for f in self.fighters:
            f.x = max(10, min(C["WORLD_W"] - 10, f.x))

    def check_out(self) -> None:
        """장외: 판정 대기 중인 타격이 있으면 먼저 판정하고(한판이 우선), 그 뒤에 반칙을 준다."""
        C = self.cfg
        for f in self.fighters:
            if f.x < C["COURT_LEFT"] - C["OUT_MARGIN"] or f.x > C["COURT_RIGHT"] + C["OUT_MARGIN"]:
                if self.pending:
                    if self.out_pending is None:
                        self.out_pending = f
                    continue
                self.do_hansoku(f)
                return
        if not self.pending and self.out_pending is not None:
            f = self.out_pending
            self.out_pending = None
            self.do_hansoku(f)

    def check_clinch(self) -> None:
        C = self.cfg
        d = abs(self.red.x - self.white.x)
        if d < C["CLINCH_DIST"] and self.red.state != "strike" and self.white.state != "strike":
            self.clinch_t += 1
            if self.clinch_t > C["CLINCH_WAKARE_TICKS"] and not self.pending:
                self.wakare()
        elif d > C["CLINCH_DIST"] + 6:
            self.clinch_t = 0

    def check_stun(self) -> None:
        for f in self.fighters:
            if f.momentum <= 0 and f.state not in ("stun", "frozen", "sonkyo"):
                f.stun()
                self.events.append({"type": "stun", "side": f.side})

    # ── 한 틱 ──
    def step(self, red_in: dict | None = None, white_in: dict | None = None) -> None:
        if self.over or not self.started:
            return
        if self.hitstop > 0:
            self.hitstop -= 1
            return
        f = self.flow
        f["t"] += 1
        if f["name"] == "play":
            self.step_play(red_in or NO_INPUT, white_in or NO_INPUT)
        else:
            self.step_idle()
        if self.flow is f and f["dur"] and f["t"] >= f["dur"] and f["onEnd"]:
            cb = f["onEnd"]
            f["onEnd"] = None
            cb()

    def step_idle(self) -> None:
        """시합이 멈춘 동안: 입력 없이 선수만 자연스럽게 정리."""
        none = {"move": 0}
        self.frame += 1
        self.red.update(none, self)
        self.white.update(none, self)
        self.resolve_bodies()

    def step_play(self, red_in: dict, white_in: dict) -> None:
        self.frame += 1
        intents = {"red": self.ctrl["red"].intent(self.red, red_in), "white": self.ctrl["white"].intent(self.white, white_in)}
        self.red.update(intents["red"], self)
        if self.flow["name"] != "play":
            return
        self.white.update(intents["white"], self)
        if self.flow["name"] != "play":
            return
        self.resolve_bodies()
        self.update_pending(intents)
        if self.flow["name"] != "play":
            return
        self.check_stun()
        self.check_out()
        if self.flow["name"] != "play":
            return
        self.check_clinch()
        if self.flow["name"] != "play":
            return
        self.rules.tick()
        if self.rules.time_left == 0 and not self.pending:
            self.time_up()

    def pop_events(self) -> list[dict]:
        out, self.events = self.events, []
        return out

    def snapshot(self) -> dict:
        r = self.rules
        return {
            "frame": self.frame, "flow": [self.flow["name"], self.flow["t"], self.flow["dur"]], "hitstop": self.hitstop,
            "timeLeft": r.time_left, "points": {"red": list(r.points["red"]), "white": list(r.points["white"])},
            "hansoku": dict(r.hansoku), "winner": r.winner, "decidedBy": r.decided_by, "over": self.over,
            "red": self.red.view(), "white": self.white.view(),
            "pending": [[p["side"], p["zanshinT"], bool(p["zanshinBroken"])] for p in self.pending],
        }
