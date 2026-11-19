"""잭팟 홈런 더비 (서버 판정) — 모두가 "같은 공"을 각자 화면에서 동시에 친다.

- 시작할 때 시드 하나로 투구 목록(스트라이크 8개 + 사이사이 볼)을 만들어 모두에게 보낸다.
- 서버 시계에 맞춰 공을 하나씩 던진다: 와인드업 → 투구 → (맞았으면) 타구 연출 → 다음 공.
  다음 공은 "모든 사람의 타구 연출이 끝나는 시각"에 던진다(연출 길이는 타구에서 계산된다).
- 브라우저는 스윙한 시각(서버 시계)과 그때의 배트 위치만 보낸다.
  서버가 원본 규칙(baseball.py)으로 맞았는지 · 타구 결과 · 점수를 정한다.
- 홈런 = 비거리(m) 점, 3루타 30 · 2루타 20 · 안타 10, 금색 잭팟 볼은 2배.
- 기회 8번. 볼을 골라내면(안 치면) 기회가 줄지 않고, 볼에 스윙하면 기회를 쓴다(원본 그대로).
- 순위: 점수 합계 → 홈런 수 → 최장 비거리.

브라우저 → 서버 (game.input 의 data)
    {"k": "swing", "t": 누른 시각(서버 시계), "x": 배트 위치(px, 가운데 0)}
"""

from __future__ import annotations

import math

from ...minigame import MiniGame
from ...services.caster import LineBook, ask_verdict, verdict_or_none
from .baseball import HIT_RESULTS, flight_frames, hit_points, js_round, make_hit, make_pitches, plate_scale
from .config import merge_config

CASTER = "해설자"

#: AI 해설이 쓸 상황(설명은 Gemini 에게 보내는 프롬프트에 들어간다)
SAY_KINDS = {
    "hr": "{name} 선수가 홈런을 쳤을 때",
    "monster": "{name} 선수가 아주 멀리 날아가는 초대형 홈런을 쳤을 때",
    "gold": "{name} 선수가 점수 2배인 금색 잭팟 볼을 쳐서 점수를 냈을 때",
    "b2b": "{name} 선수가 두 번 연속으로 홈런을 쳤을 때",
    "hit": "{name} 선수가 안타(1루타 · 2루타 · 3루타)를 쳤을 때",
    "whiff": "{name} 선수가 헛스윙하거나 스트라이크를 그냥 지켜봤을 때",
    "weak": "{name} 선수의 타구가 파울이 되거나 수비에게 잡혀 아웃됐을 때",
    "eye": "{name} 선수가 볼을 잘 골라냈을 때",
    "last": "마지막 공이 들어오기 직전 (이름 없이)",
    "lead": "{name} 선수가 점수 선두로 올라섰을 때",
}
#: Gemini 가 꺼져 있거나 늦을 때 쓰는 기본 대사
SAY_CANNED = {
    "hr": ["{name}, 담장을 넘겼습니다!", "넘어갔다! {name} 홈런!", "{name} 시원하게 넘깁니다!"],
    "monster": ["{name}, 장외로 날려 버립니다!", "어디까지 가나요! {name}!", "{name} 초대형 홈런입니다!"],
    "gold": ["잭팟 볼을 놓치지 않았다!", "{name}, 점수가 두 배입니다!", "금색 공이 터졌습니다!"],
    "b2b": ["{name} 연타석 홈런!", "또 넘겼습니다! {name}!", "{name} 방망이에 불이 붙었다!"],
    "hit": ["{name} 깔끔한 안타!", "수비 사이를 뚫었습니다!", "{name} 잘 맞혔습니다!"],
    "whiff": ["아, 방망이가 늦었습니다.", "{name} 타이밍을 놓쳤어요.", "공이 미트에 꽂힙니다!"],
    "weak": ["아쉽게 빗맞았습니다.", "수비가 기다리고 있었네요.", "{name} 다음 공을 노립니다."],
    "eye": ["{name} 잘 골라냈습니다!", "볼입니다, 좋은 선구안!"],
    "last": ["자, 마지막 공입니다!", "이 공 하나에 달렸습니다!"],
    "lead": ["{name} 선두로 올라섭니다!", "순위가 뒤집혔습니다! {name}!", "{name} 맨 앞으로 나섭니다!"],
}


class HomerunGame(MiniGame):
    id = "homerun"
    title = "잭팟 홈런 더비"
    min_players = 2
    max_players = 5
    tick_hz = 30

    def __init__(self, players, options, rng):
        super().__init__(players, options, rng)
        self.cfg = merge_config(self.options.get("config"))
        c = self.cfg
        self.F = 1.0 / c["FPS"]                                   # 한 프레임(초)
        self.ids = [p["id"] for p in self.players]
        self.names = {p["id"]: p.get("name", p["id"]) for p in self.players}
        seed = self.options.get("seed")
        self.seed = int(seed) if isinstance(seed, (int, float)) else int(rng() * 1e9)
        self.pitches = make_pitches(self.seed, c)
        # 참가자마다 타석 기록(원본 AtBat 의 기록 부분)
        self.P = {
            pid: {"chances": c["CHANCES"], "total": 0, "hr": 0, "hits": 0, "longest": 0, "log": [],
                  "streak": 0,          # 연속 홈런 수
                  "cur": None,          # 이번 공에 한 스윙 {f, x, hit, at, dt, dx, pts}
                  "pending": None}      # 판정이 끝난 이번 공의 결과 {result, pts, dist}
            for pid in self.ids
        }
        self.phase = "idle"             # intro → play → final → done
        self.idx = -1                   # 지금 공 번호
        self.windup_at = 0.0            # 와인드업 시작(서버 시각)
        self.release_at = 0.0           # 공이 손에서 떠나는 시각
        self.mitt_at = 0.0              # 공이 미트에 들어가는 시각
        self.next_at: float | None = None   # 다음 공 와인드업 시각(판정이 끝나야 정해진다)
        self.judged = False
        self.intro_until = 0.0
        self.final_until = 0.0
        self.final_results: list[dict] = []
        self._last_state_at = -1.0
        # AI
        self.book: LineBook | None = None
        self._says: list[dict] = []     # 보낼 대사 예약 {at, to, kind, name}
        self._said_at: dict[str, float] = {}
        self._verdict_job = None
        self.verdict: dict | None = None

    # ------------------------------------------------------------------
    def client_options(self) -> dict:
        c = self.cfg
        return {
            "seed": self.seed,
            "pitches": self.pitches,
            "chances": c["CHANCES"],
            "intro": c["FLOW"]["INTRO_TIME"],
            "final": c["FLOW"]["FINAL_TIME"],
        }

    def start(self, now: float) -> None:
        gemini = self.services.get("gemini")
        self.book = LineBook(gemini, game=self.title, caster=CASTER, kinds=SAY_KINDS, canned=SAY_CANNED,
                             players=list(self.names.values()),
                             extra="야구 중계처럼 짧고 신나게. 비거리 · 점수 같은 숫자는 쓰지 않는다(화면에 따로 나온다).")
        self.book.prepare()
        self.phase = "intro"
        self.intro_until = now + self.cfg["FLOW"]["INTRO_TIME"]
        self._emit(now, force=True)

    # ------------------------------------------------------------------
    def tick(self, now: float) -> None:
        changed = False
        if self.phase == "intro" and now >= self.intro_until:
            self.phase = "play"
            self._begin_pitch(0, self.intro_until)
            changed = True
        if self.phase == "play":
            # 늦게 도착하는 스윙을 기다린 뒤(MAX_LAG) 이번 공의 결과를 확정한다
            if not self.judged and now >= self.mitt_at + self.cfg["NET"]["MAX_LAG"]:
                self._judge(now)
                changed = True
            if self.judged and now >= self.next_at:
                self._close(now)
                changed = True
        self._flush_says(now)
        if self.phase == "final":
            if self.verdict is None and self._verdict_job is not None and self._verdict_job.done():
                self.verdict = verdict_or_none(self._verdict_job)
                self._verdict_job = None
                if self.verdict:
                    self.send_event({"type": "verdict", **self.verdict})
                    changed = True
            if now >= self.final_until:
                self.phase = "done"
                changed = True
        self._emit(now, force=changed)
        if self.phase == "done" and not self.finished:
            self.finish(self.final_results)

    def _begin_pitch(self, idx: int, at: float) -> None:
        c = self.cfg
        pt = self.pitches[idx]
        self.idx = idx
        self.windup_at = at
        self.release_at = at + c["WINDUP"] * self.F
        self.mitt_at = self.release_at + (pt["frames"] + c["MITT_AFTER"]) * self.F
        self.next_at = None
        self.judged = False
        for st in self.P.values():
            st["cur"] = None
            st["pending"] = None
        if idx == len(self.pitches) - 1:
            self._says.append({"at": at, "to": None, "kind": "last", "name": ""})

    # ------------------------------------------------------------------
    def on_input(self, player_id: str, data: dict, now: float) -> None:
        st = self.P.get(player_id)
        if st is None or not isinstance(data, dict) or data.get("k") != "swing":
            return
        if self.phase != "play" or self.judged or st["cur"] is not None or st["chances"] <= 0:
            return
        c = self.cfg
        pt = self.pitches[self.idx]
        # 누른 시각: 브라우저가 알려 준 서버 시계 기준 시각. 너무 오래됐거나 미래면 서버 시각 쪽으로 당긴다.
        t = _num(data.get("t"), now)
        t = min(now, max(now - c["NET"]["MAX_LAG"], t))
        f = js_round((t - self.release_at) / self.F)        # 공이 떠난 뒤 몇 번째 프레임에 스윙했나
        if f < -1:
            return                                          # 와인드업 중의 스윙은 원본처럼 없던 일
        f = max(1, f)
        last = pt["frames"] + c["MITT_AFTER"] - 1
        if f > last:
            return                                          # 공이 이미 미트에 들어갔다
        x = max(-c["BAT_RANGE"], min(c["BAT_RANGE"], _num(data.get("x"), 0.0)))
        cur = {"f": f, "x": x, "hit": None, "at": 0.0, "dt": 0, "dx": 0.0, "pts": 0}
        # 배트가 공 자리에 온 순간(스윙 후 SWING_CONTACT 프레임) 판정
        contact = f + c["SWING_CONTACT"]
        dt = contact - pt["frames"]
        dx = x - pt["tx"] * plate_scale(c)
        if contact <= pt["frames"] + c["MITT_AFTER"] and abs(dt) <= c["HIT_DT"] and abs(dx) <= c["HIT_DX"]:
            hit = make_hit(pt, dt, dx, c)
            cur.update(hit=hit, at=self.release_at + contact * self.F, dt=dt, dx=dx, pts=hit_points(hit, c))
            self.send_event({"type": "contact", "idx": self.idx, "at": cur["at"], "dt": dt, "dx": dx,
                             "pts": cur["pts"], "hit": hit}, to=player_id)
        else:
            self.send_event({"type": "whiff", "idx": self.idx}, to=player_id)
        st["cur"] = cur

    # ------------------------------------------------------------------
    def _judge(self, now: float) -> None:
        """이번 공의 결과를 모두 확정하고, 다음 공을 던질 시각을 정한다."""
        c = self.cfg
        pt = self.pitches[self.idx]
        end = self.mitt_at + c["AFTER"] * self.F
        for pid in self.ids:
            st = self.P[pid]
            if st["chances"] <= 0:
                continue                                    # 기회를 다 쓴 사람은 구경만 한다
            cur = st["cur"]
            name = self.names[pid]
            if cur and cur["hit"]:
                hit = cur["hit"]
                shown, total = flight_frames(hit, c)
                end = max(end, cur["at"] + total * self.F)
                st["pending"] = {"result": hit["result"], "pts": cur["pts"], "dist": js_round(hit["dist"])}
                self._says.append({"at": cur["at"] + shown * self.F, "to": pid, "kind": self._hit_kind(st, hit, cur["pts"]), "name": name})
            else:
                result = "miss" if cur else "ball" if pt["ball"] else "strike"
                st["pending"] = {"result": result, "pts": 0, "dist": 0}
                self._says.append({"at": now, "to": pid, "kind": "eye" if result == "ball" else "whiff", "name": name})
            p = st["pending"]
            self.send_event({"type": "call", "idx": self.idx, "result": p["result"], "pts": p["pts"], "dist": p["dist"],
                             "gold": pt["gold"], "total": st["total"] + p["pts"],
                             "chances": st["chances"] - (0 if p["result"] == "ball" else 1)}, to=pid)
        self.judged = True
        self.next_at = max(now, end + c["FLOW"]["END_PAD"])

    def _hit_kind(self, st: dict, hit: dict, pts: int) -> str:
        """맞은 타구에 어떤 대사를 할지 고른다."""
        if hit["result"] == "hr":
            if hit["dist"] >= self.cfg["AI"]["MONSTER_DIST"]:
                return "monster"
            if hit["gold"]:
                return "gold"
            return "b2b" if st["streak"] >= 1 else "hr"
        if hit["result"] in HIT_RESULTS:
            return "gold" if hit["gold"] and pts > 0 else "hit"
        return "weak"

    def _close(self, now: float) -> None:
        """타구 연출이 모두 끝났다: 기록에 반영하고 다음 공으로(또는 최종 결과로)."""
        pt = self.pitches[self.idx]
        before = self._leader()
        for pid in self.ids:
            st = self.P[pid]
            p = st["pending"]
            if not p:
                continue
            result = p["result"]
            if result != "ball":
                st["chances"] -= 1
                st["streak"] = st["streak"] + 1 if result == "hr" else 0
            st["total"] += p["pts"]
            if result == "hr":
                st["hr"] += 1
                st["longest"] = max(st["longest"], p["dist"])
            if result in HIT_RESULTS:
                st["hits"] += 1
            st["log"].append({"idx": self.idx, "result": result, "pts": p["pts"], "gold": pt["gold"], "dist": p["dist"],
                              "swung": st["cur"] is not None})
        after = self._leader()
        if after is not None and after != before:
            self._says.append({"at": now, "to": None, "kind": "lead", "name": self.names[after]})
        if self.idx + 1 < len(self.pitches):
            self._begin_pitch(self.idx + 1, self.next_at)
            return
        # 마지막 공까지 끝났다 → 최종 결과 화면
        self.final_results = self.build_results()
        self.phase = "final"
        self.final_until = now + self.cfg["FLOW"]["FINAL_TIME"]
        self._verdict_job = ask_verdict(
            self.services.get("gemini"), game=self.title, results=self.final_results, caster=CASTER,
            note="score = 점수 합계(홈런은 비거리 m 만큼), homeRuns = 홈런 수, longest = 최장 비거리(m)")

    def _key(self, pid: str) -> tuple:
        st = self.P[pid]
        return (st["total"], st["hr"], st["longest"])

    def _leader(self) -> str | None:
        """혼자 1등인 사람(점수가 있을 때만). 없으면 None."""
        best = max(self.ids, key=self._key)
        if self.P[best]["total"] <= 0 or sum(1 for pid in self.ids if self._key(pid) == self._key(best)) > 1:
            return None
        return best

    # ------------------------------------------------------------------
    def _flush_says(self, now: float) -> None:
        """예약해 둔 해설 대사 중 때가 된 것을 보낸다(받는 사람마다 최소 간격을 지킨다)."""
        if not self._says or self.book is None:
            return
        gap = self.cfg["AI"]["SAY_GAP"]
        due = [s for s in self._says if s["at"] <= now]
        self._says = [s for s in self._says if s["at"] > now]
        for s in due:
            to = s["to"]
            last_all = self._said_at.get("*", -math.inf)
            last = last_all if to is None else max(last_all, self._said_at.get(to, -math.inf))
            if now - last < gap:
                continue
            text, source = self.book.line(s["kind"], self.rng, name=s["name"])
            if not text:
                continue
            self._said_at["*" if to is None else to] = now
            self.send_event({"type": "say", "text": text, "source": source, "who": CASTER, "kind": s["kind"]}, to=to)

    # ------------------------------------------------------------------
    def build_results(self) -> list[dict]:
        """공통 결과 형식. 순위: 점수 → 홈런 수 → 최장 비거리(셋 다 같으면 공동 순위)."""
        order = sorted(self.ids, key=lambda pid: tuple(-v for v in self._key(pid)))
        rows = []
        for i, pid in enumerate(order):
            st = self.P[pid]
            same = i > 0 and self._key(pid) == self._key(order[i - 1])
            rows.append({
                "playerId": pid, "name": self.names[pid], "score": st["total"],
                "rank": rows[i - 1]["rank"] if same else i + 1, "isWinner": False,
                "stats": {"homeRuns": st["hr"], "hits": st["hits"], "longest": st["longest"],
                          "log": [e["result"] for e in st["log"]]},
            })
        for r in rows:
            r["isWinner"] = r["rank"] == 1
        return rows

    def snapshot(self, now: float) -> dict:
        return {
            "phase": self.phase, "now": now, "idx": self.idx, "count": len(self.pitches),
            "introUntil": self.intro_until, "windupAt": self.windup_at, "releaseAt": self.release_at,
            "mittAt": self.mitt_at, "nextAt": self.next_at, "finalUntil": self.final_until,
            "players": {
                pid: {"total": st["total"], "hr": st["hr"], "hits": st["hits"], "longest": st["longest"],
                      "chances": st["chances"], "last": st["log"][-1]["result"] if st["log"] else None}
                for pid, st in self.P.items()
            },
            "results": self.final_results if self.phase in ("final", "done") else None,
            "verdict": self.verdict,
        }

    def state_for(self, player_id: str, now: float) -> dict | None:
        """다시 접속한 사람에게: 내 기록과 이번 공에 한 스윙까지 알려 준다."""
        snap = self.snapshot(now)
        st = self.P.get(player_id)
        if st:
            cur = st["cur"]
            snap["me"] = {
                "log": st["log"],
                "cur": None if cur is None else {"idx": self.idx, "f": cur["f"], "x": cur["x"], "at": cur["at"],
                                                 "dt": cur["dt"], "dx": cur["dx"], "pts": cur["pts"], "hit": cur["hit"]},
                "pending": st["pending"],
            }
        return snap

    def _emit(self, now: float, force: bool = False) -> None:
        if force or now - self._last_state_at >= 1.0 / self.cfg["NET"]["STATE_HZ"] - 1e-9:
            self._last_state_at = now
            self.send_state(self.snapshot(now))


def _num(v, default: float) -> float:
    """숫자가 아니거나 이상한 값이면 default."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return float(default)
    return float(v)
