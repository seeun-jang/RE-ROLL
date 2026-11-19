"""마법진 그리기 (서버 판정) — 모두가 같은 마법진을 같은 저주로, 각자 자기 화면에서 동시에 따라 그린다.

진행 (3라운드, 마지막 라운드는 점수 2배)
    intro → [ slot(슬롯머신: 마법진 + 저주) → ready(준비) → draw(그리기) → score(채점 연출) → gallery(모두의 그림) ] × 3
          → final(최종 결과 + AI 총평) → done

판정
- 브라우저는 그리는 동안 펜이 지나간 점(종이 좌표 0~119)을 조금씩 모아 보낸다.
- 서버가 그 점들로 종이(Paper)를 다시 그리고, 원본과 같은 채점(score_drawing)을 한다.
- 저주 중 입력을 바꾸는 것(거울 · 흔들 종이)은 브라우저가 "화면 좌표 → 종이 좌표"로 바꿀 때 한 번만 적용한다.
  서버는 이미 바뀐 종이 좌표만 받으므로 다시 뒤집거나 밀지 않는다. (투명 잉크 · 기억 마법은 보이는 것만 바뀐다.)
- 점수는 100% 규칙 계산이다. Gemini 는 그림을 보고 감상평만 쓴다(점수에 영향 없음).

브라우저 → 서버 (game.input 의 data) — draw 단계에서만
    {"k": "ink", "p": [x0, y0, x1, y1, ...], "c": 0 | 1}   펜이 지나간 점들. c = 1 이면 앞에 보낸 선에 이어 그린다
    {"k": "done", "t": 서버 시계 기준 누른 시각}             다 그렸다(일찍 끝내면 시간 보너스)
"""

from __future__ import annotations

from ...minigame import MiniGame, rank_results
from ...services.caster import LineBook, ask_async, ask_verdict, clean_line, result_or_none, verdict_or_none
from .config import merge_config
from .png import paper_png_base64
from .shapes import SHAPES, js_round, plan_rounds
from .sketch import Paper, score_drawing

CASTER = "마법사"

#: 해설 상황 (LineBook 에 넘긴다)
SAY_KINDS = {
    "round_start": "저주 없는 연습 라운드가 시작될 때",
    "curse": "저주가 걸린 라운드가 시작될 때",
    "jackpot": "점수가 2배인 마지막 잭팟 라운드가 시작될 때",
    "first_done": "{name} 이(가) 가장 먼저 그리기를 끝냈을 때",
    "success": "{name} 이(가) 마법진을 정확히 그려 마법이 발동했을 때",
    "poof": "{name} 의 마법진이 엉망이라 펑 하고 터졌을 때",
    "all_poof": "모두가 마법진을 망쳤을 때",
    "lead_change": "{name} 이(가) 합계 1등으로 올라섰을 때",
    "final": "{name} 이(가) 최종 우승했을 때",
}
SAY_CANNED = {
    "round_start": ["가볍게 손부터 풀어 보시지요.", "선만 따라 그리면 됩니다. 쉽지요?"],
    "curse": ["제 저주가 마음에 드십니까?", "이번엔 조금 불편하실 겁니다."],
    "jackpot": ["마지막은 점수 두 배입니다.", "잭팟 라운드, 뒤집어 보시지요."],
    "first_done": ["{name}, 벌써 끝내셨습니까?", "{name}, 손이 빠르시군요."],
    "success": ["{name}, 마법이 발동했군요.", "{name}, 제법이십니다."],
    "poof": ["{name}, 그건 낙서 아닙니까?", "{name}, 펑 소리가 났습니다만."],
    "all_poof": ["전원 실패라니, 흐뭇하군요.", "이 마을은 아직 제 것입니다."],
    "lead_change": ["{name}, 선두로 올라섰군요.", "1등이 {name}로 바뀌었습니다."],
    "final": ["{name}, 저주를 풀 자격이 있군요.", "{name}, 오늘은 인정하지요."],
}

#: AI 감상평 응답 모양 — 참가자 순서대로 한 칸씩 (JSON 스키마로 응답 모양 고정)
REVIEW_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "looks_like": {"type": "STRING", "description": "그림이 무엇처럼 보이는지, 짧은 한국어 명사구 (10자 이내)"},
            "comment": {"type": "STRING", "description": "목표 모양과 얼마나 비슷한지 마법사의 한 줄 평 (22자 이내)"},
        },
        "required": ["looks_like", "comment"],
    },
}
LOOKS_CHARS = 12
COMMENT_CHARS = 26


class SigilGame(MiniGame):
    id = "sigil"
    title = "마법진 그리기"
    min_players = 2
    max_players = 5
    tick_hz = 20

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        self.F, self.S = self.cfg["FLOW"], self.cfg["SCORE"]
        self.size = self.cfg["CANVAS"]
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        # 라운드 계획: 테스트에서는 options["plan"] 으로 고정할 수 있다
        forced = self.options.get("plan")
        if forced:
            self.plan = [{"shape": int(r["shape"]) % len(SHAPES), "twist": r.get("twist", "none"),
                          "mult": r.get("mult", 1)} for r in forced]
        else:
            self.plan = plan_rounds(rng, self.cfg["ROUNDS"])
        self.rounds = len(self.plan)
        self.P = {pid: {"paper": Paper(self.size, self.cfg["BRUSH"]), "done": False, "doneAt": None, "points": 0,
                        "rounds": [None] * self.rounds, "total": 0, "live": 0, "dirty": False} for pid in self.ids}
        self.connected = set(self.ids)
        self.phase = "idle"
        self.since = 0.0
        self.until = 0.0
        self.round = 0                      # 1부터
        self.draw_until = 0.0               # 화면에 보이는 그리기 마감 시각 (그 뒤 INK_GRACE 동안은 늦은 선만 받는다)
        self.gallery: dict | None = None    # 이번 라운드 모두의 그림 {pid: 비트 묶음(base64)}
        self.reviews: dict | None = None    # 이번 라운드 AI 감상평 {pid: {looksLike, comment}}
        self.verdict: dict | None = None
        self.final_results: list[dict] = []
        self.book: LineBook | None = None
        self._review_job = None
        self._verdict_job = None
        self._first_done = False
        self._last_say = -99.0
        self._say_queue: list[tuple[float, str, dict]] = []   # (말할 시각, 상황, 채울 값)
        self._dirty = True
        self._last_state_at = -99.0
        self._last_live_at = -99.0

    # ------------------------------------------------------------------
    @property
    def now_plan(self) -> dict | None:
        return self.plan[self.round - 1] if 1 <= self.round <= self.rounds else None

    @property
    def shape(self) -> dict | None:
        p = self.now_plan
        return SHAPES[p["shape"]] if p else None

    def draw_time(self) -> float:
        return self.cfg["SPEED_TIME"] if self.now_plan["twist"] == "speed" else self.cfg["DRAW_TIME"]

    def client_options(self) -> dict:
        c = self.cfg
        return {
            "rounds": [{"tier": r["tier"], "mult": r["mult"]} for r in c["ROUNDS"]][:self.rounds],
            "canvas": c["CANVAS"], "brush": c["BRUSH"], "score": dict(c["SCORE"]), "twists": c["TWISTS"],
            "drawTime": c["DRAW_TIME"], "speedTime": c["SPEED_TIME"], "memoryTime": c["MEMORY_TIME"],
            "shake": dict(c["SHAKE"]), "flow": dict(c["FLOW"]),
            # 모양 좌표도 서버 것을 보낸다(화면과 서버가 같은 안내선을 쓰게)
            "shapes": [{k: s[k] for k in ("name", "short", "color", "gc", "tier", "pts")} for s in SHAPES],
        }

    # ------------------------------------------------------------------
    def start(self, now: float) -> None:
        gemini = self.services.get("gemini")
        self.book = LineBook(gemini, game=self.title, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
                             players=list(self.names.values()),
                             extra="마법사가 참가자들이 마법진을 따라 그리는 것을 지켜보며 하는 말이다.")
        self.book.prepare()                 # 스레드에서 한 번 요청 — 기다리지 않는다
        self._set("intro", now, self.F["INTRO_TIME"])
        self._emit(now, force=True)

    def tick(self, now: float) -> None:
        self._advance(now)
        self._poll_ai(now)
        self._flush_says(now)
        if self.phase == "draw":
            self._update_live(now)
        self._emit(now)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def on_connection(self, player_id: str, connected: bool, now: float) -> None:
        if player_id not in self.P:
            return
        (self.connected.add if connected else self.connected.discard)(player_id)

    # ------------------------------------------------------------------
    # 진행
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
            if ph in ("idle", "done"):
                return
            if ph == "draw" and self._everyone_done():
                self._finish_draw(now)      # 접속한 사람이 모두 '완료'를 누르면 기다리지 않는다
                continue
            if now < self.until:
                return
            at = self.until
            if ph == "intro":
                self._begin_round(1, at)
            elif ph == "slot":
                self._set("ready", at, F["READY_TIME"])
                p = self.now_plan
                kind = "jackpot" if p["mult"] > 1 else "curse" if p["twist"] != "none" else "round_start"
                self._say(kind, at)
            elif ph == "ready":
                self.draw_until = at + self.draw_time()
                self._set("draw", at, self.draw_time() + F["INK_GRACE"])
            elif ph == "draw":
                self._finish_draw(at)
            elif ph == "score":
                self._set("gallery", at, F["GALLERY_TIME"])
            elif ph == "gallery":
                self._review_job = None     # 늦게 오는 감상평은 버린다
                if self.round < self.rounds:
                    self._begin_round(self.round + 1, at)
                else:
                    self._begin_final(at)
            elif ph == "final":
                self.phase = "done"
                self._dirty = True
            else:
                return

    def _begin_round(self, round_no: int, at: float) -> None:
        self.round = round_no
        self.gallery = None
        self.reviews = None
        self._review_job = None
        self._first_done = False
        for st in self.P.values():
            st["paper"] = Paper(self.size, self.cfg["BRUSH"])
            st.update(done=False, doneAt=None, points=0, live=0, dirty=False)
        self._set("slot", at, self.F["SLOT_TIME"])

    def _everyone_done(self) -> bool:
        active = [pid for pid in self.ids if pid in self.connected]
        return bool(active) and all(self.P[pid]["done"] for pid in active)

    def _leader(self) -> str | None:
        """합계가 혼자 가장 높은 사람(동점이면 None)."""
        totals = sorted(((st["total"], pid) for pid, st in self.P.items()), reverse=True)
        if len(totals) > 1 and totals[0][0] == totals[1][0]:
            return None
        return totals[0][1] if totals and totals[0][0] > 0 else None

    def _finish_draw(self, at: float) -> None:
        """그리기 끝 → 모두 채점(원본 finishTurn)하고 그림을 공개한다."""
        S, plan = self.S, self.now_plan
        per = S["TIME_BONUS"] * (2 if plan["twist"] == "speed" else 1)
        before = self._leader()
        scores = {}
        for pid in self.ids:
            st = self.P[pid]
            st["paper"].end()
            sc = score_drawing(st["paper"], self.shape, S)
            early = st["doneAt"] is not None
            left = max(0.0, self.draw_until - st["doneAt"]) if early else 0.0
            bonus = min(S["BONUS_MAX"], int(left) * per) if early and sc["accuracy"] >= S["OKAY"] else 0
            result = {"accuracy": sc["accuracy"], "cover": round(sc["cover"], 3), "neat": round(sc["neat"], 3),
                      "bonus": bonus, "mult": plan["mult"], "total": (sc["accuracy"] + bonus) * plan["mult"]}
            st["rounds"][self.round - 1] = result
            st["total"] += result["total"]
            st["live"] = sc["accuracy"]
            scores[pid] = result
        self.gallery = {pid: self.P[pid]["paper"].bits() for pid in self.ids}
        self.send_event({"type": "reveal", "round": self.round, "scores": scores, "drawings": self.gallery})
        self._request_review(scores)
        self._set("score", at, self.F["SCORE_TIME"])
        # 해설: 이번 라운드 최고 / 최저를 보고 한마디, 조금 뒤 선두가 바뀌었으면 한마디 더
        best = max(self.ids, key=lambda pid: scores[pid]["total"])
        worst = min(self.ids, key=lambda pid: scores[pid]["accuracy"])
        if all(s["accuracy"] < S["OKAY"] for s in scores.values()):
            self._say("all_poof", at)
        elif scores[best]["accuracy"] >= S["SUCCESS"]:
            self._say("success", at, name=self.names[best])
        elif scores[worst]["accuracy"] < S["OKAY"]:
            self._say("poof", at, name=self.names[worst])
        after = self._leader()
        if after and after != before and self.round > 1:
            self._say("lead_change", at + self.cfg["SAY_GAP"] + 0.1, name=self.names[after])

    def _begin_final(self, at: float) -> None:
        self.final_results = self.build_results()
        self._set("final", at, self.F["FINAL_TIME"])
        self._say_queue = []
        self._last_say = -99.0
        self._say("final", at, name=self.final_results[0]["name"])
        # AI 총평: 결과가 정해진 순간 한 번 요청하고, 최종 화면 동안 도착하면 보여 준다
        self._verdict_job = ask_verdict(self.services.get("gemini"), game=self.title, results=self.final_results,
                                        caster=CASTER, note="점수는 세 라운드 합계(최대 464점), 80점 이상이면 마법 발동.")

    # ------------------------------------------------------------------
    # AI — 해설 대사 / 그림 감상평 / 총평 (모두 스레드에서 받아 오고, 여기서는 도착했는지만 본다)
    # ------------------------------------------------------------------
    def _say(self, kind: str, at: float, **fmt) -> None:
        self._say_queue.append((at, kind, fmt))

    def _flush_says(self, now: float) -> None:
        keep = []
        for at, kind, fmt in self._say_queue:
            if now < at:
                keep.append((at, kind, fmt))
            elif now - self._last_say >= self.cfg["SAY_GAP"] and now - at < 1.0:   # 너무 자주 말하지 않는다
                text, source = self.book.line(kind, self.rng, **fmt)
                if text:
                    self._last_say = now
                    self.send_event({"type": "say", "text": text, "source": source, "who": CASTER, "kind": kind})
        self._say_queue = keep

    def _request_review(self, scores: dict) -> None:
        """그림 감상평 요청 — 라운드마다 딱 한 번, 모든 참가자의 그림을 한 요청에 담는다(무료 한도 보호).

        글 부분(prompt) 하나 + 그림 부분(PNG) 여러 장을 같이 보내는 멀티모달 요청이다.
        """
        gemini = self.services.get("gemini")
        if gemini is None:
            return
        shape = self.shape
        images = [{"mime_type": "image/png", "data": paper_png_base64(self.P[pid]["paper"], self.cfg["REVIEW_IMAGE"])}
                  for pid in self.ids]
        rows = "\n".join(
            f"- 그림 {i + 1}: {self.names[pid]} (규칙 채점 정확도 {scores[pid]['accuracy']}/100)"
            for i, pid in enumerate(self.ids))
        system = (
            "너는 보드게임 'RE:ROLL' 의 미니게임 '마법진 그리기' 를 지켜보는 '마법사' 이다.\n"
            "마법사: 마을에 저주를 건 악당. 점잖고 비꼬는 존댓말.\n"
            "참가자들이 마우스로 따라 그린 그림(흰 종이에 검은 선)을 순서대로 보고, 그림마다\n"
            f"- looks_like: 그 그림이 무엇처럼 보이는지 짧은 한국어 명사구 (10자 이내)\n"
            f"- comment: 목표 모양과 얼마나 비슷한지 마법사의 한 줄 평 (22자 이내, 한 문장)\n"
            "을 쓴다. 답은 그림 순서와 같은 순서의 배열이고, 칸 수는 그림 수와 같다.\n"
            "빈 종이면 looks_like 를 '빈 종이' 라고 쓴다. 점수를 매기지 않는다(점수는 이미 규칙으로 계산됐다).\n"
            "욕설 · 비하 · 따옴표 · 이모지 · 줄바꿈 금지."
        )
        prompt = f"목표 모양: {shape['name']} ({shape['short']})\n그림 {len(images)}장 (순서대로):\n{rows}"
        self._review_job = ask_async(gemini, prompt, REVIEW_SCHEMA, system=system, images=images)

    def _poll_ai(self, now: float) -> None:
        # 감상평: 채점 연출 · 갤러리 동안 도착하면 보여 준다. 안 오면 조용히 넘어간다(진행을 막지 않는다).
        job = self._review_job
        if job is not None and job.done() and self.phase in ("score", "gallery"):
            self._review_job = None
            reviews = self._clean_reviews(result_or_none(job))
            if reviews:
                self.reviews = reviews
                self.send_event({"type": "review", "round": self.round, "reviews": reviews, "source": "gemini"})
                self._dirty = True
        # 총평
        if self.phase == "final" and self.verdict is None and self._verdict_job is not None and self._verdict_job.done():
            v = verdict_or_none(self._verdict_job)
            self._verdict_job = None
            if v:
                self.verdict = v
                self.send_event({"type": "verdict", **v})
                self._dirty = True

    def _clean_reviews(self, data) -> dict:
        """AI 가 준 배열을 다듬는다: 글은 clean_line 을 거치고, 칸 수는 참가자 수까지만."""
        if isinstance(data, dict):
            data = data.get("reviews")
        if not isinstance(data, list):
            return {}
        out = {}
        for pid, item in zip(self.ids, data[:len(self.ids)]):
            if not isinstance(item, dict):
                continue
            looks = clean_line(item.get("looks_like"), LOOKS_CHARS)
            comment = clean_line(item.get("comment"), COMMENT_CHARS)
            if looks or comment:
                out[pid] = {"looksLike": looks, "comment": comment}
        return out

    # ------------------------------------------------------------------
    # 입력
    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        if not isinstance(data, dict) or player_id not in self.P:
            return
        self._advance(now)
        if self.phase != "draw":
            return
        st = self.P[player_id]
        if st["done"]:
            return
        kind = data.get("k")
        if kind == "ink":
            self._ink(st, data)
        elif kind == "done":
            if now < self.since + self.F["DONE_LOCK"]:
                return
            # 누른 시각은 브라우저가 서버 시계 기준으로 보낸다. 0.35초 넘게 다르면 받은 시각으로 판정한다.
            t = data.get("t")
            if not isinstance(t, (int, float)) or isinstance(t, bool) or not (now - self.F["INK_GRACE"] <= t <= now):
                t = now
            st["done"] = True
            st["doneAt"] = max(self.since, min(float(t), self.draw_until))
            st["paper"].end()
            self.send_event({"type": "done", "playerId": player_id})
            self._dirty = True
            if not self._first_done and now < self.draw_until:
                self._first_done = True
                self._say("first_done", now, name=self.names[player_id])
            self._advance(now)

    def _ink(self, st: dict, data: dict) -> None:
        """받은 점들을 종이에 이어 그린다. 종이 밖 좌표나 형식이 틀린 묶음은 통째로 버린다."""
        pts = data.get("p")
        L = self.cfg["LIMITS"]
        if not isinstance(pts, list) or len(pts) < 2 or len(pts) % 2 or len(pts) > L["PACKET_POINTS"] * 2:
            return
        if st["points"] + len(pts) // 2 > L["ROUND_POINTS"]:
            return
        S = self.size
        clean = []
        for v in pts:
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not (-0.5 <= v < S - 0.5):
                return
            clean.append(js_round(v))
        paper = st["paper"]
        if not data.get("c"):
            paper.end()                     # 새 선 시작(펜을 뗐다가 다시 댐)
        for i in range(0, len(clean), 2):
            paper.stroke(clean[i], clean[i + 1])
        st["points"] += len(clean) // 2
        st["dirty"] = True

    def _update_live(self, now: float) -> None:
        """그리는 중 실시간 정확도(점수판의 작은 게이지용). 초당 2번, 바뀐 사람만 다시 계산한다."""
        if now - self._last_live_at < 0.5:
            return
        self._last_live_at = now
        for st in self.P.values():
            if st["dirty"]:
                st["dirty"] = False
                st["live"] = score_drawing(st["paper"], self.shape, self.S)["accuracy"]

    # ------------------------------------------------------------------
    # 결과 · 상태
    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        rows = []
        for p in self.players:
            st = self.P[p["id"]]
            done = [r for r in st["rounds"] if r]
            rows.append({"playerId": p["id"], "name": self.names[p["id"]], "score": st["total"], "stats": {
                "rounds": [r["total"] if r else 0 for r in st["rounds"]],
                "accuracy": [r["accuracy"] if r else 0 for r in st["rounds"]],
                "best": max((r["accuracy"] for r in done), default=0),
                "spells": sum(1 for r in done if r["accuracy"] >= self.S["SUCCESS"]),
            }})
        return rank_results(rows)

    def snapshot(self, now: float, me: str | None = None) -> dict:
        plan = self.now_plan
        hide_live = bool(plan) and plan["twist"] == "ghost" and self.phase == "draw"   # 투명 잉크: 마력도 ???
        snap = {
            "phase": self.phase, "now": now, "since": self.since, "until": self.until,
            "round": self.round, "rounds": self.rounds,
            "shape": plan["shape"] if plan else None, "twist": plan["twist"] if plan else None,
            "mult": plan["mult"] if plan else 1,
            "drawUntil": self.draw_until if self.phase == "draw" else None,
            "players": {pid: {"total": st["total"], "rounds": list(st["rounds"]), "done": st["done"],
                              "live": None if hide_live else st["live"]} for pid, st in self.P.items()},
            "reviews": self.reviews if self.phase in ("score", "gallery") else None,
            "verdict": self.verdict,
            "results": self.final_results if self.phase in ("final", "done") else None,
        }
        if me is not None:
            # 다시 접속한 사람: 지금까지 그린 내 그림과, 공개된 모두의 그림을 함께 준다
            if self.phase == "draw" and me in self.P:
                snap["me"] = {"ink": self.P[me]["paper"].bits()}
            if self.phase in ("score", "gallery") and self.gallery:
                snap["drawings"] = self.gallery
        return snap

    def state_for(self, player_id: str, now: float) -> dict | None:
        return self.snapshot(now, me=player_id)

    def _emit(self, now: float, force: bool = False) -> None:
        gap = 1.0 / self.F["STATE_HZ"] if self.phase == "draw" else 1.0
        if force or self._dirty or now - self._last_state_at >= gap:
            self._dirty = False
            self._last_state_at = now
            self.send_state(self.snapshot(now))
