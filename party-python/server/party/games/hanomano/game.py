"""하노마노 (서버 판정) — 차례대로 카드를 뒤집다가, 같은 과일이 '딱 5개'면 종!

한 판의 흐름 (원본 js/scenes/play.js 와 같다. 모두가 한 테이블을 같이 본다)
    intro(하는 법) → deal(나눠주기) → play(뒤집기 · 종)
        종이 맞음 → collect(펼친 카드를 전부 가져감, 다음 차례는 맞힌 사람) → play
        종이 틀림 → wrong(다른 사람에게 1장씩, 3초 동안 종 금지) → play
    제한 시간이 끝나거나 한 명이 카드를 다 가지면 → end("게임 끝!") → final(최종 순위 + AI 총평) → done

브라우저 → 서버 (game.input 의 data)
    {"k": "flip"}                      내 차례에 카드 한 장 뒤집기
    {"k": "bell", "t": 누른 시각}       종 치기. t 는 서버 시계 기준(통신 지연 보정)

덱에 남은 카드의 내용은 브라우저로 보내지 않는다(장수와 펼쳐진 카드만 보낸다).
"""

from __future__ import annotations

from ...minigame import MiniGame
from ...services.caster import LineBook, ask_verdict, verdict_or_none
from .cards import bell_is_right, bell_reason, deal, make_deck, shuffle_cards
from .config import merge_config

#: 해설을 맡는 인물 — 마법사 성 카지노의 주인
CASTER = "마법사"

#: 해설 상황(Gemini 에게 설명할 문장)
SAY_KINDS = {
    "start": "게임이 막 시작됐을 때",
    "correct": "{name} 이(가) 종을 맞혀 펼친 카드를 가져갔을 때",
    "bigpot": "{name} 이(가) 한 번에 카드를 아주 많이 가져갔을 때",
    "wrong": "{name} 이(가) 5개가 아닌데 종을 쳐서 벌칙을 받았을 때",
    "near": "{name} 이(가) 과일이 4개일 때 종을 쳐서 아깝게 틀렸을 때",
    "low": "{name} 의 카드가 거의 다 떨어졌을 때",
    "lastMinute": "남은 시간이 1분일 때",
    "reshuffle": "뒤집을 카드가 떨어져 펼친 카드를 다시 모을 때",
    "timeup": "제한 시간이 끝났을 때",
    "sweep": "{name} 이(가) 카드를 전부 차지해 게임이 끝났을 때",
}

#: Gemini 가 꺼져 있거나 늦을 때 쓰는 기본 대사
SAY_CANNED = {
    "start": ["자, 눈을 크게 뜨시지요.", "딱 5개입니다. 4개도 6개도 아닙니다."],
    "correct": ["{name} 님, 눈이 밝으시군요.", "{name} 님이 가져가십니다.", "훌륭합니다, {name} 님."],
    "bigpot": ["{name} 님, 한몫 챙기셨군요!", "판이 {name} 님께 기울었습니다."],
    "wrong": ["{name} 님, 세어 보고 치시지요.", "성급하셨습니다, {name} 님.", "{name} 님의 손이 얼얼하겠군요."],
    "near": ["아깝군요, {name} 님. 4개였습니다.", "{name} 님, 하나가 모자랐습니다."],
    "low": ["{name} 님, 카드가 바닥입니다.", "{name} 님이 위태롭군요."],
    "lastMinute": ["이제 1분 남았습니다.", "마지막 1분, 서두르시지요."],
    "reshuffle": ["카드를 다시 모으겠습니다.", "판을 새로 고르지요."],
    "timeup": ["시간이 다 됐습니다.", "거기까지입니다, 여러분."],
    "sweep": ["{name} 님이 판을 쓸어 갔습니다!", "{name} 님, 전부 가져가셨군요."],
}


class HanomanoGame(MiniGame):
    id = "hanomano"
    title = "하노마노"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.R = self.cfg["RULES"]
        self.F = self.cfg["FLOW"]
        self.N = self.cfg["NET"]
        self.A = self.cfg["AI"]
        # 카드 나눠주기: 모두 같은 장수(2명 26 · 3명 17 · 4명 13 · 5명 10), 남는 카드는 뺀다
        hands, self.spare = deal(make_deck(self.R, self.rng), len(self.players))
        self.seats = [
            {
                "id": p["id"], "name": p.get("name", p["id"]),
                "deck": hands[i],        # 아직 안 뒤집은 카드(맨 앞이 다음에 뒤집힐 카드)
                "pile": [],              # 내 앞에 펼친 카드(맨 뒤가 맨 위)
                "lock": 0.0,             # 이 시각까지 종을 못 친다
                "correct": 0, "wrong": 0, "got": 0,
                "connected": True, "low_said": False,
            }
            for i, p in enumerate(self.players)
        ]
        self.by_id = {s["id"]: s for s in self.seats}
        # 첫 차례는 무작위, 그 뒤로는 자리 순서대로 돈다
        self.turn = min(len(self.seats) - 1, int(self.rng() * len(self.seats)))
        self.phase = "idle"
        self.since = 0.0            # 지금 단계가 시작된 시각
        self.until = 0.0            # 지금 단계가 끝나는 시각(play 는 쓰지 않는다)
        self.end_at = 0.0           # 제한 시간이 끝나는 시각
        self.play_since = 0.0       # 지금 play 구간이 시작된 시각(멈췄다 다시 시작할 때마다 바뀐다)
        self.turn_since = 0.0       # 지금 차례가 시작된 시각
        self.stall_since: float | None = None
        self.history: list[tuple[float, list]] = []   # (시각, 그때 펼쳐져 있던 카드) — 종을 누른 순간의 카드를 찾는 데 쓴다
        self._offers: list[tuple[float, int, str]] = []   # (누른 시각, 도착 순서, 사람)
        self._offer_deadline: float | None = None
        self._offer_seq = 0
        self.last: dict | None = None        # 마지막 종 판정(다시 접속한 사람용)
        self.end_info: dict | None = None
        self.final_results: list[dict] | None = None
        # AI
        self.book: LineBook | None = None
        self.last_say: dict | None = None
        self._last_say_at = -99.0
        self._minute_said = False
        self._verdict_job = None
        self.verdict: dict | None = None
        self._dirty = True
        self._last_state_at = -1.0

    # ------------------------------------------------------------------
    # 공통 규격
    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        return {
            "rules": {
                "TIME_LIMIT": self.R["TIME_LIMIT"], "TARGET": self.R["TARGET"], "FRUITS": list(self.R["FRUITS"]),
                "TURN_TIME": list(self.R["TURN_TIME"]), "WRONG_LOCK": self.R["WRONG_LOCK"],
            },
            "flow": dict(self.F),
            "order": [s["id"] for s in self.seats],      # 차례가 도는 순서
            "each": len(self.seats[0]["deck"]),           # 처음에 받은 카드 수
            "spare": len(self.spare),                     # 게임에서 뺀 카드 수
            "caster": CASTER,
        }

    def start(self, now: float) -> None:
        # AI 해설: 이 판에 쓸 대사 묶음을 미리 부탁해 둔다(기다리지 않는다)
        self.book = LineBook(
            self.services.get("gemini"), game=self.title, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
            players=[s["name"] for s in self.seats], max_chars=18,
            extra="게임 설명: 차례대로 과일 카드를 뒤집다가 같은 과일이 정확히 5개 보이면 종을 치는 카지노 카드게임.",
        )
        self.book.prepare()
        self._set("intro", now, now + self.F["INTRO_TIME"])
        self._emit(now, force=True)

    def tick(self, now: float) -> None:
        self._advance(now)
        if self.phase == "play":
            self._commentary(now)
        self._check_verdict()
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results or self.build_results())

    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if player_id not in self.by_id or not isinstance(data, dict):
            return
        self._advance(now)
        kind = data.get("k")
        if kind == "flip":
            self._on_flip(player_id, now)
        elif kind == "bell":
            self._on_bell(player_id, data.get("t"), now)
        self._emit(now)

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        seat = self.by_id.get(player_id)
        if seat is not None:
            seat["connected"] = connected
            self._dirty = True

    def state_for(self, player_id: str, now: float) -> dict:
        return self.snapshot(now)

    # ------------------------------------------------------------------
    # 진행
    # ------------------------------------------------------------------
    def _set(self, phase: str, at: float, until: float = 0.0) -> None:
        self.phase = phase
        self.since = at
        self.until = until
        self._dirty = True

    def tops(self) -> list:
        """각자 맨 위에 펼쳐진 카드(없으면 None)."""
        return [s["pile"][-1] if s["pile"] else None for s in self.seats]

    @staticmethod
    def cards_of(seat: dict) -> int:
        return len(seat["deck"]) + len(seat["pile"])

    def turn_time(self, at: float) -> float:
        """자동으로 뒤집히기까지의 시간 — 끝으로 갈수록 짧아진다(3초 → 1.5초)."""
        a, b = self.R["TURN_TIME"]
        k = 1 - max(0.0, self.end_at - at) / self.R["TIME_LIMIT"]
        return a + (b - a) * min(1.0, max(0.0, k))

    def _flip_deadline(self) -> float:
        wait = self.turn_time(self.turn_since)
        if not self.seats[self.turn]["connected"]:
            wait = min(wait, self.N["AWAY_TURN_TIME"])       # 연결이 끊긴 사람 때문에 판이 느려지지 않게
        return self.turn_since + wait

    def _advance(self, now: float) -> None:
        """now 까지 일어날 일을 시각 순서대로 처리한다."""
        for _ in range(400):
            ph = self.phase
            if ph == "intro":
                if now < self.until:
                    return
                self._set("deal", self.until, self.until + self.F["DEAL_TIME"])
            elif ph == "deal":
                if now < self.until:
                    return
                self._begin_play(self.until)
            elif ph == "play":
                if not self._advance_play(now):
                    return
            elif ph in ("collect", "wrong"):
                # 제한 시간은 연출 중에도 흐른다(원본과 같다)
                if now < min(self.until, self.end_at):
                    return
                if self.end_at <= self.until:
                    self._finish("time", self.end_at)
                else:
                    self._resume(self.until)
            elif ph == "end":
                if now < self.until:
                    return
                self._set("final", self.until, self.until + self.F["FINAL_TIME"])
                self.send_event({"type": "final", "results": self.final_results})
            elif ph == "final":
                if now < self.until:
                    return
                self._set("done", self.until)
            else:
                return

    def _begin_play(self, at: float) -> None:
        self.end_at = at + self.R["TIME_LIMIT"]
        self.send_event({"type": "go"})
        self._say("start", at, force=True)
        self._resume(at)

    def _resume(self, at: float) -> None:
        """play 구간을 (다시) 시작한다."""
        self._set("play", at)
        self.play_since = at
        self.turn_since = at
        self.stall_since = None
        self._offers = []
        self._offer_deadline = None
        self.history = [(at, self.tops())]
        self._settle(at)

    def _advance_play(self, now: float) -> bool:
        """play 구간에서 가장 먼저 일어날 일 하나를 처리한다. 처리했으면 True."""
        todo = [(self.end_at, 0, "time")]
        if self._offer_deadline is not None:
            todo.append((self._offer_deadline, 1, "bell"))
        if self.seats[self.turn]["deck"]:
            todo.append((self._flip_deadline(), 2, "flip"))
        if self.stall_since is not None:
            todo.append((self.stall_since + self.N["STALL_TIME"], 3, "stall"))
        at, _, what = min(todo)
        if at > now:
            return False
        if what == "time":
            self._finish("time", at)
        elif what == "bell":
            self._resolve_bell(at)
        elif what == "flip":
            self._flip(self.turn, at, auto=True)
        else:
            self._reshuffle(at)
        return True

    # ----- 뒤집기 -----
    def _on_flip(self, pid: str, now: float) -> None:
        if self.phase != "play" or self.seats[self.turn]["id"] != pid or not self.seats[self.turn]["deck"]:
            return
        self._flip(self.turn, now, auto=False)

    def _flip(self, index: int, at: float, auto: bool) -> None:
        seat = self.seats[index]
        card = seat["deck"].pop(0)
        seat["pile"].append(card)
        self.history.append((at, self.tops()))
        self._next_turn(at)
        self._dirty = True
        self.send_event({
            "type": "flip", "playerId": seat["id"], "card": card, "auto": auto,
            "next": self.seats[self.turn]["id"],
        })
        self._settle(at)

    def _next_turn(self, at: float) -> None:
        """다음 차례 = 자리 순서로 돌면서 뒤집을 카드가 있는 첫 사람."""
        n = len(self.seats)
        for k in range(1, n + 1):
            i = (self.turn + k) % n
            if self.seats[i]["deck"]:
                self.turn = i
                self.turn_since = at
                return

    def _settle(self, at: float) -> None:
        """카드가 움직인 뒤 정리: 싹쓸이 · 차례 넘기기 · 다시 모으기."""
        total = sum(self.cards_of(s) for s in self.seats)
        leader = next((s for s in self.seats if self.cards_of(s) == total), None)
        if leader is not None:
            self._finish("sweep", at, leader)          # 한 사람이 카드를 전부 가지면 끝
            return
        if not self.seats[self.turn]["deck"]:
            self._next_turn(at)
        if any(s["deck"] for s in self.seats):
            self.stall_since = None
            return
        # 아무도 뒤집을 카드가 없다: 5개가 보이면 누가 종을 칠 때까지 잠깐 기다리고, 아니면 다시 모은다
        if bell_is_right(self.tops(), self.R):
            if self.stall_since is None:
                self.stall_since = at
        else:
            self._reshuffle(at)

    def _reshuffle(self, at: float) -> None:
        """펼친 카드를 각자 자기 덱으로 되돌린다."""
        for s in self.seats:
            s["deck"] += shuffle_cards(s["pile"], self.rng)
            s["pile"] = []
        self.stall_since = None
        self.history.append((at, self.tops()))
        self._dirty = True
        self.send_event({"type": "reshuffle"})
        self._say("reshuffle", at)
        self._next_turn(at)

    # ----- 종 -----
    def _on_bell(self, pid: str, t, now: float) -> None:
        seat = self.by_id[pid]
        if self.phase != "play" or seat["lock"] > now:
            return
        N = self.N
        ts = now
        if isinstance(t, (int, float)) and not isinstance(t, bool):
            ts = min(max(float(t), now - N["BELL_MAX_LAG"]), now + N["BELL_MAX_LEAD"])
        if ts < self.play_since - N["BELL_MAX_LEAD"]:
            return                                   # 판정이 멈춰 있는 동안 누른 종은 무시한다(원본과 같다)
        ts = max(ts, self.play_since)
        if any(o[2] == pid for o in self._offers):
            return
        self._offer_seq += 1
        self._offers.append((ts, self._offer_seq, pid))
        if self._offer_deadline is None:
            self._offer_deadline = now + N["BELL_WINDOW"]

    def _tops_at(self, ts: float) -> list:
        """ts 시각에 펼쳐져 있던 카드."""
        found = self.history[0][1]
        for at, tops in self.history:
            if at <= ts:
                found = tops
        return found

    def _resolve_bell(self, at: float) -> None:
        offers = [o for o in self._offers if self.by_id[o[2]]["lock"] <= at]
        self._offers = []
        self._offer_deadline = None
        if not offers:
            return
        ts, _, pid = min(offers)                    # 누른 시각이 가장 빠른 사람
        seat = self.by_id[pid]
        shown = self._tops_at(ts)                   # 그 사람이 종을 누른 순간의 카드로 판정한다
        why = bell_reason(shown, self.R)
        event = {
            "type": "ring", "playerId": pid, "ok": why["ok"], "text": why["text"], "fruit": why["fruit"],
            "tops": shown, "t": ts,
        }
        if why["ok"]:
            # 성공: 펼친 카드를 전부 가져간다(덱 아래에). 다음 차례는 맞힌 사람.
            got = 0
            taken = {}
            for q in self.seats:
                taken[q["id"]] = len(q["pile"])
                got += len(q["pile"])
                seat["deck"] += shuffle_cards(q["pile"], self.rng)
                q["pile"] = []
            seat["correct"] += 1
            seat["got"] += got
            self.turn = self.seats.index(seat)
            event.update(got=got, piles=taken)
            self._set("collect", at, at + self.R["COLLECT_PAUSE"])
            self._say("bigpot" if got >= self.A["BIG_POT"] else "correct", at, name=seat["name"])
        else:
            # 실패: 다른 사람에게 1장씩 주고, 한동안 종을 못 친다
            to = []
            for q in self.seats:
                if q is seat or not seat["deck"]:
                    continue
                q["deck"].append(seat["deck"].pop())
                to.append(q["id"])
            seat["wrong"] += 1
            seat["lock"] = at + self.R["WRONG_LOCK"]
            event.update(gave=len(to), to=to, near=why["near"], lock=seat["lock"])
            self._set("wrong", at, at + self.R["WRONG_PAUSE"])
            self._say("near" if why["near"] else "wrong", at, name=seat["name"])
        self.last = event
        self.send_event(event)

    # ----- 끝 -----
    def _finish(self, reason: str, at: float, leader: dict | None = None) -> None:
        self._offers = []
        self._offer_deadline = None
        self.final_results = self.build_results()
        text = f"{leader['name']} 싹쓸이!" if leader is not None else "시간 종료!"
        self.end_info = {"reason": reason, "playerId": leader["id"] if leader else None, "text": text}
        self._set("end", at, at + self.F["END_TIME"])
        self.send_event({"type": "end", **self.end_info})
        self._say("sweep" if leader is not None else "timeup", at, force=True, name=leader["name"] if leader else "")
        # AI 총평: 결과가 정해진 지금 한 번만 부탁한다
        self._verdict_job = ask_verdict(
            self.services.get("gemini"), game=self.title, results=self.final_results, caster=CASTER,
            note="score 는 가진 카드 수. cards=카드 수, correct=종을 맞힌 횟수, wrong=틀리게 친 횟수.",
        )

    def _check_verdict(self) -> None:
        job = self._verdict_job
        if job is None or not job.done():
            return
        self._verdict_job = None
        verdict = verdict_or_none(job)
        if verdict:
            self.verdict = verdict
            self._dirty = True
            self.send_event({"type": "verdict", **verdict})

    # ----- AI 해설 -----
    def _say(self, kind: str, at: float, force: bool = False, **fmt) -> bool:
        """상황에 맞는 한 줄을 보낸다. 너무 자주 말하지 않게 간격을 둔다."""
        if self.book is None or (not force and at - self._last_say_at < self.A["SAY_GAP"]):
            return False
        text, source = self.book.line(kind, self.rng, **fmt)
        if not text:
            return False
        self._last_say_at = at
        self.last_say = {"type": "say", "text": text, "source": source, "who": CASTER, "kind": kind}
        self.send_event(dict(self.last_say))
        return True

    def _commentary(self, now: float) -> None:
        """종과 상관없이 나오는 해설: 마지막 1분 · 카드가 거의 떨어진 사람."""
        if not self._minute_said and self.end_at - now <= self.A["LAST_MINUTE"]:
            self._minute_said = True
            self._say("lastMinute", now, force=True)
        for s in self.seats:
            low = self.cards_of(s) <= self.A["LOW_CARDS"]
            if not low:
                s["low_said"] = False
            elif not s["low_said"] and self._say("low", now, name=s["name"]):
                s["low_said"] = True

    # ------------------------------------------------------------------
    # 결과 / 상태
    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        """카드가 많은 순 → 종을 많이 맞힌 순 → 덜 틀린 순(원본과 같다). 모두 같으면 공동 순위. 점수 = 카드 수."""
        rows = []
        for order, s in enumerate(self.seats):
            cards = self.cards_of(s)
            rows.append({
                "playerId": s["id"], "name": s["name"], "score": cards, "rank": 0, "isWinner": False,
                "stats": {"cards": cards, "correct": s["correct"], "wrong": s["wrong"], "got": s["got"]},
                "_order": order,
            })
        rows.sort(key=lambda r: (-r["score"], -r["stats"]["correct"], r["stats"]["wrong"], r["_order"]))

        def same(a, b) -> bool:
            return (a["score"] == b["score"] and a["stats"]["correct"] == b["stats"]["correct"]
                    and a["stats"]["wrong"] == b["stats"]["wrong"])

        for i, r in enumerate(rows):
            r["rank"] = rows[i - 1]["rank"] if i > 0 and same(r, rows[i - 1]) else i + 1
        for r in rows:
            r["isWinner"] = r["rank"] == 1
            del r["_order"]
        return rows

    def snapshot(self, now: float) -> dict:
        ph = self.phase
        playing = ph in ("play", "collect", "wrong")
        return {
            "phase": ph,
            "now": now,
            "since": self.since,
            "until": self.until if ph != "play" else None,
            "endAt": self.end_at if playing else None,
            "timeLeft": max(0.0, self.end_at - now) if playing else (self.R["TIME_LIMIT"] if ph in ("intro", "deal") else 0.0),
            "turn": self.seats[self.turn]["id"],
            "turnSince": self.turn_since,
            "turnTime": (self._flip_deadline() - self.turn_since) if ph == "play" else 0.0,
            "players": [
                {
                    "id": s["id"],
                    "deck": len(s["deck"]),              # 덱은 장수만 보낸다
                    "pile": len(s["pile"]),
                    "show": s["pile"][-4:],              # 펼친 카드 중 위쪽 4장(맨 뒤가 맨 위)
                    "lock": s["lock"],
                    "correct": s["correct"],
                    "wrong": s["wrong"],
                    "connected": s["connected"],
                }
                for s in self.seats
            ],
            "last": self.last,
            "end": self.end_info,
            "say": self.last_say,
            "verdict": self.verdict,
            "results": self.final_results if ph in ("end", "final", "done") else None,
        }

    def _emit(self, now: float, force: bool = False) -> None:
        if force or self._dirty or now - self._last_state_at >= 0.5:
            self._dirty = False
            self._last_state_at = now
            self.send_state(self.snapshot(now))
