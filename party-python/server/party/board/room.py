"""보드게임 방(Room) · 참가자(Player) · 질문(Prompt).

원본 party.js 의 "보내기 / 고르기 / 주사위 가방 / 방" 부분을 옮긴 것이다.
한 판의 진행(턴 · 주사위 · 칸 효과 · 미니게임)은 game.py 에 있다.

자바스크립트 → 파이썬으로 바꾼 방법
- setTimeout          → loop.call_later (Room.set_timer)
- Promise (질문 대답) → asyncio.Future
- await wait(ms)      → await room.wait(ms)  (asyncio.sleep)
- Math.random()       → 방마다 가진 random.Random (room.rng) — 테스트에서 씨앗을 고정할 수 있다
- Date.now()          → room.clock() (1970년부터의 밀리초) — 테스트에서 가짜 시계를 넣을 수 있다
"""

from __future__ import annotations

import asyncio
import copy
import itertools
import math
import os
import random
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

from . import data as R
from .jsutil import clean_timing, same_value, tidy_number, to_number


# ---------------- 시간 설정 ----------------
@dataclass
class Timings:
    """연출 · 대기 시간(밀리초). 값은 원본 party.js 와 같다."""

    # 아래 10개는 PARTY_SPEED 로 나눠지는 값 (원본의 T0)
    STEP_MS: float = 230            # 한 칸 이동
    REVEAL_MS: float = 2600         # 굴린 결과 보여주기
    EFFECT_MS: float = 1900         # 칸 효과 하나 보여주기
    CHOOSE_MS: float = 20000        # 주사위 고르기
    ASK_MS: float = 12000           # 갈림길 · 사람 고르기 등
    TIMING_MS: float = 8000         # 타이밍 주사위
    MG_INTRO_MS: float = 3500       # 미니게임 소개
    MG_MAX_MS: float = 6 * 60 * 1000  # 미니게임 최대 대기 (6분)
    MG_RESULT_MS: float = 6000      # 미니게임 결과 보여주기
    FINAL_MS: float = 7000          # 최종 순위(누적 점수)를 보여준 뒤 보스전으로
    BOSS_INTRO_MS: float = 4500     # 보스전 시작 연출
    BOSS_REVEAL_MS: float = 4000    # 보스전 한 판의 결과 보여주기
    CPU_THINK_MS: tuple = (500, 1300)  # CPU 가 고르는 데 걸리는 시간 (최소, 최대)

    # 아래는 원본 코드에 숫자로 직접 적혀 있던 값 (PARTY_SPEED 의 영향을 받지 않음)
    START_MS: float = 1500          # "게임 시작!" 뒤
    AFTER_MOVE_MS: float = 400      # 이동이 다 끝난 뒤
    SPACE_INTRO_MS: float = 700     # 칸 이름을 띄운 뒤
    SLOT_MS: float = 900            # 슬롯머신 그림을 보여준 뒤
    BIGDICE_MS: float = 600         # 대왕 주사위 숫자를 보여준 뒤
    MG_POLL_MS: float = 500         # 미니게임 결과가 다 왔는지 확인하는 간격
    MG_SHOW_MS: float = 1500        # 미니게임 순위를 띄운 뒤 보상 주기 전
    AUTO_ANSWER_MS: float = 300     # 끊긴 사람의 질문을 자동으로 넘기기까지
    LOBBY_GRACE_MS: float = 6000    # 대기실에서 끊긴 사람을 빼기까지 (새로고침 기다림)
    CLOSE_MS: float = 15000         # 사람이 아무도 없을 때 방을 닫기까지


_SPEED_KEYS = ("STEP_MS", "REVEAL_MS", "EFFECT_MS", "CHOOSE_MS", "ASK_MS", "TIMING_MS",
               "MG_INTRO_MS", "MG_MAX_MS", "MG_RESULT_MS", "FINAL_MS", "BOSS_INTRO_MS", "BOSS_REVEAL_MS")


def make_timings(speed: float | None = None) -> Timings:
    """PARTY_SPEED=4 처럼 주면 연출 시간이 그만큼 짧아진다 (시험용). speed 를 안 주면 환경 변수를 읽는다."""
    if speed is None:
        speed = to_number(os.environ.get("PARTY_SPEED", ""))
    if math.isnan(speed) or speed == 0:   # 원본: Math.max(1, +process.env.PARTY_SPEED || 1)
        speed = 1
    speed = max(1, speed)
    t = Timings()
    for key in _SPEED_KEYS:
        setattr(t, key, tidy_number(getattr(t, key) / speed))
    t.CPU_THINK_MS = tuple(tidy_number(x / speed) for x in t.CPU_THINK_MS)
    return t


def now_ms() -> int:
    """자바스크립트의 Date.now()."""
    return int(time.time() * 1000)


class Gone(Exception):
    """방이 닫혔다 → 진행 중이던 게임을 조용히 멈춘다."""


# ---------------- 참가자 ----------------
class Player:
    def __init__(self, id: int, name: str, seat: int, *, cpu: bool = False, token: str = "", conn=None):
        self.id = id            # 서버가 매긴 번호 (화면은 이 번호로 사람을 구분)
        self.name = name
        self.seat = seat        # 자리 0~4 (캐릭터 · 색)
        self.cpu = cpu
        self.token = token      # 다시 접속했을 때 같은 사람인지 알아보는 값 (CPU 는 없음)
        self.conn = conn        # 연결(보낼 곳). 끊겼으면 None  (원본의 p.ws)
        self.hist: list[int] = [R.START]   # 지나온 칸들. 맨 끝이 지금 있는 칸 (뒤로 갈 때 왔던 길로 감)
        self.bag: list[dict] = []          # 주사위 가방 [{"id", "uses"}]
        self.flags: dict = {}              # {"skip", "mirror", "shield", "rest"}
        self.goal_over: int | None = None  # 결승에 들어올 때 남은 걸음 수 (많이 남을수록 먼저 들어온 셈)
        self.landed = False                # 이번 턴에 주사위로 움직여서 칸 효과를 받을 사람인지
        self.points = 0                    # 미니게임 순위로 받은 점수 (누적 점수 = 이것 + 전진한 칸 × 10)
        self.ready = False                 # 대기실에서 '준비 완료'를 눌렀는지

    @property
    def online(self) -> bool:
        return self.conn is not None

    @property
    def node(self) -> int:
        """지금 있는 칸 번호."""
        return self.hist[-1]

    @property
    def dist(self) -> int:
        """결승까지 남은 칸 수."""
        return R.DIST[self.node]

    def send(self, msg: dict) -> None:
        if self.conn is not None:
            self.conn.send(msg)


# ---------------- 질문 ----------------
class Prompt:
    """서버가 한 사람에게 묻는 질문 하나 (주사위 고르기 · 갈림길 · 사람 고르기 …)."""

    def __init__(self, id, pid, kind, title, options, deadline, meta, fallback):
        self.id = id
        self.pid = pid              # 대답할 사람
        self.kind = kind            # dice | branch | parity | target | timing | reward
        self.title = title
        self.options = options      # [{"value", "label", "icon"?, "desc"?, "seat"?}]
        self.deadline = deadline    # 이 시각(밀리초)이 지나면 fallback 으로 자동 선택
        self.meta = meta
        self.fallback = fallback    # 시간 초과 · CPU · 끊긴 사람일 때 쓸 값
        self.future: asyncio.Future = asyncio.get_running_loop().create_future()
        self.timer = None
        self.cpu_timer = None
        self.finish: Callable = lambda value: None   # Room.ask 가 채운다 (원본의 pr.resolve)

    def public(self) -> dict:
        """화면으로 보내는 모양. meta 가 없으면 키도 없다 (JSON.stringify 가 undefined 를 빼는 것과 같게)."""
        out = {"id": self.id, "pid": self.pid, "kind": self.kind, "title": self.title,
               "options": self.options, "deadline": self.deadline}
        if self.meta is not None:
            out["meta"] = self.meta
        return out


#: room.mg 안에서 화면으로 보내지 않는 키 (나머지는 그대로 보낸다 → 러너가 url 같은 값을 추가할 수 있음)
MG_PRIVATE_KEYS = ("results", "skip")


# ---------------- 방 ----------------
class Room:
    def __init__(
        self,
        code: str,
        *,
        rng: random.Random | None = None,
        clock: Callable[[], float] | None = None,
        timings: Timings | None = None,
        ids=None,
        prompt_ids=None,
        minigames: list[dict] | None = None,
        minigame_runner: Callable[["Room", dict], Awaitable[dict | None]] | None = None,
        on_close: Callable[["Room"], None] | None = None,
        gemini=None,
    ):
        self.code = code
        self.rng = rng or random.Random()
        self.clock = clock or now_ms
        self.T = timings or make_timings()
        self.ids = ids if ids is not None else itertools.count(1)                  # 참가자 번호표 (서버 전체가 같이 씀)
        self.prompt_ids = prompt_ids if prompt_ids is not None else itertools.count(1)  # 질문 번호표
        self.minigames = list(minigames) if minigames is not None else list(R.MINIGAMES)
        self.minigame_runner = minigame_runner
        self.on_close = on_close
        self.gemini = gemini            # 마법사 대사를 쓰는 AI (없으면 기본 대사)

        self.phase = "lobby"            # lobby | play | end
        self.step: str | None = None    # choose | reveal | move | space | minigame | mgResult | final | boss
        self.turn = 0
        self.max_turns = R.DEFAULT_TURNS
        self.host: int | None = None    # 방장의 참가자 번호
        self.players: list[Player] = []
        self.prompts: dict[int, Prompt] = {}
        self.rolls: dict[int, dict] = {}        # 참가자 번호 → 이번 턴에 굴린 결과
        self.log: list[str] = []
        self.mg: dict | None = None             # 진행 중인 미니게임 {"id","name","seed","startAt","results",…}
        self.mg_result: dict | None = None      # 마지막 미니게임 순위표
        self.ranking: list[dict] | None = None  # 최종 순위 (게임이 끝나면)
        self.boss: dict | None = None           # 보스전 상태 (story.py)
        self.ending: str | None = None          # 'good' | 'bad' (보스전 결과)
        self.wizard = None                      # 마법사 대사 묶음 (story.make_wizard)
        self.last_game: str | None = None       # 바로 전 턴의 미니게임 (연속으로 안 나오게)
        self.history: list[list[list[int]]] = []  # 턴마다 모두의 위치 (타임머신 칸)
        self.dead = False                       # 방이 닫혔는지
        self.close_timer = None
        self.task: asyncio.Task | None = None   # 게임을 진행하는 작업

    # ----- 작은 도구 -----
    def humans(self) -> list[Player]:
        return [p for p in self.players if not p.cpu]

    def player(self, pid) -> Player | None:
        return next((p for p in self.players if p.id == pid), None)

    def rand(self, n: float) -> int:
        """0 이상 n 미만 정수 (원본: Math.floor(Math.random() * n))."""
        return math.floor(self.rng.random() * n)

    def pick(self, arr: list):
        return arr[self.rand(len(arr))]

    def shuffle(self, arr: list) -> list:
        """제자리에서 섞기 (원본과 같은 피셔-예이츠 방식)."""
        for i in range(len(arr) - 1, 0, -1):
            j = self.rand(i + 1)
            arr[i], arr[j] = arr[j], arr[i]
        return arr

    def set_timer(self, ms: float, fn: Callable[[], None]):
        """ms 밀리초 뒤에 fn 을 부른다 (setTimeout). 돌려준 값의 .cancel() 이 clearTimeout."""
        return asyncio.get_running_loop().call_later(max(0, ms) / 1000, fn)

    async def wait(self, ms: float) -> None:
        await asyncio.sleep(max(0, ms) / 1000)
        if self.dead:
            raise Gone()

    # ----- 보내기 -----
    def snapshot(self) -> dict:
        """방의 현재 상태 전체. 화면(board/main.js)은 이것만 보고 그린다 → 키 이름을 바꾸면 안 된다."""
        mg = None
        if self.mg:
            mg = {
                "id": self.mg["id"], "name": self.mg["name"], "seed": self.mg["seed"], "startAt": self.mg["startAt"],
                # 결과를 보낸 사람 번호 (자바스크립트 객체의 숫자 키는 작은 수부터 나오므로 정렬)
                "done": sorted(self.mg["results"]),
            }
            for key, value in self.mg.items():   # 러너가 추가한 값(url 등)은 그대로 보낸다
                if key not in mg and key not in MG_PRIVATE_KEYS:
                    mg[key] = value
        return {
            "t": "room",
            "code": self.code,
            "phase": self.phase,
            "step": self.step,
            "turn": self.turn,
            "maxTurns": self.max_turns,
            "host": self.host,
            "players": [
                {
                    "id": p.id, "name": p.name, "cpu": p.cpu, "online": p.cpu or p.online, "seat": p.seat,
                    "node": p.node, "dist": p.dist, "bag": [d["id"] for d in p.bag], "flags": p.flags,
                    "score": p.points + (R.DIST[R.START] - p.dist) * 10,   # 누적 점수 (story.score_of 와 같은 식)
                    "ready": p.cpu or p.ready or p.id == self.host,        # 방장 · CPU 는 늘 준비 완료
                }
                for p in self.players
            ],
            "prompts": [pr.public() for pr in self.prompts.values()],
            "rolls": {str(pid): roll for pid, roll in self.rolls.items()},   # JSON 의 키는 글자
            "mg": mg,
            "mgResult": self.mg_result,
            "log": self.log[-8:],
            "ranking": self.ranking,
            "boss": self.boss,
            "ending": self.ending,
        }

    def broadcast(self) -> None:
        """방의 모든 사람에게 현재 상태를 보낸다."""
        # 보낸 뒤에 상태가 바뀌어도 이미 보낸 내용이 변하지 않도록 지금 모습을 복사해 둔다
        # (원본은 여기서 바로 JSON 글자로 바꿨다)
        snap = copy.deepcopy(self.snapshot())
        for p in self.players:
            p.send(snap)

    def announce(self, text: str, *, icon: str = "", pid: int | None = None, big: bool = False) -> None:
        """화면에 크게 띄우는 알림 (+ 기록)."""
        self.log.append(f"{icon} {text}" if icon else text)
        msg = {"t": "fx", "kind": "announce", "text": text, "icon": icon, "pid": pid, "big": big}
        for p in self.players:
            p.send(msg)

    # ----- 고르기 -----
    def ask(self, p: Player, kind: str, title: str, options: list[dict], *,
            timeout: float | None = None, cpu_pick: Callable | None = None, meta: dict | None = None) -> asyncio.Future:
        """p 에게 질문을 띄우고, 대답(값)이 들어올 Future 를 돌려준다. `value = await room.ask(...)` 로 쓴다.

        options: [{"value", "label", "icon"?, "desc"?}] · kind 'timing' 은 1~10 숫자
        CPU 나 접속이 끊긴 사람은 cpu_pick 으로 자동 선택, 시간이 지나면 fallback(cpu_pick 값 또는 첫 번째)
        """
        if timeout is None:
            timeout = self.T.ASK_MS
        prompt_id = next(self.prompt_ids)
        fallback = cpu_pick() if cpu_pick else (options[0]["value"] if options else None)
        pr = Prompt(prompt_id, p.id, kind, title, options, tidy_number(self.clock() + timeout), meta, fallback)

        def finish(value) -> None:
            if prompt_id not in self.prompts:   # 이미 대답했거나 게임이 끝남
                return
            del self.prompts[prompt_id]
            pr.timer.cancel()
            if pr.cpu_timer:
                pr.cpu_timer.cancel()
            if pr.future.done():
                return
            if self.dead:
                pr.future.set_exception(Gone())
                return
            self.broadcast()
            pr.future.set_result(value)

        pr.finish = finish
        pr.timer = self.set_timer(timeout, lambda: finish(fallback))
        if p.cpu or not p.online:
            think = self.T.CPU_THINK_MS[0] + self.rand(self.T.CPU_THINK_MS[1] - self.T.CPU_THINK_MS[0])
            pr.cpu_timer = self.set_timer(think, lambda: finish(fallback))
        self.prompts[prompt_id] = pr
        self.broadcast()
        return pr.future

    def answer(self, me: Player, msg: dict) -> None:
        """화면이 보낸 대답 {t:'answer', id, value}. 내 질문이 아니거나 보기에 없는 값이면 무시."""
        n = to_number(msg.get("id"))
        pr = self.prompts.get(int(n)) if math.isfinite(n) and n == int(n) else None
        if pr is None or pr.pid != me.id:
            return
        value = msg.get("value")
        if pr.kind == "timing":
            value = clean_timing(value)
        else:
            option = next((o for o in pr.options if same_value(o["value"], value)), None)
            if option is None:
                return
            value = option["value"]   # 1.0 처럼 들어와도 보기의 값(정수 1)을 쓴다
        pr.finish(value)

    def auto_answer(self, p: Player) -> None:
        """접속이 끊기면 그 사람 질문은 자동으로."""
        for pr in list(self.prompts.values()):
            if pr.pid == p.id:
                self.set_timer(self.T.AUTO_ANSWER_MS, lambda pr=pr: pr.finish(pr.fallback))

    # ----- 주사위 가방 -----
    def trim_bag(self, p: Player) -> None:
        """가방이 넘치면 제일 오래된 것부터 버린다."""
        while len(p.bag) > R.BAG_MAX:
            p.bag.pop(0)

    def give_dice(self, p: Player, dice_id: str, why: str = "") -> None:
        d = R.DICE[dice_id]
        p.bag.append({"id": dice_id, "uses": d.get("uses") or 1})
        self.trim_bag(p)
        self.announce(f"{p.name} {why}{d['icon']} {d['name']} 획득!", pid=p.id)

    def take_random_dice(self, p: Player) -> dict | None:
        if not p.bag:
            return None
        return p.bag.pop(self.rand(len(p.bag)))

    # ----- 방장 · 나가기 · 방 닫기 -----
    def pick_host(self) -> None:
        """접속해 있는 사람 중 맨 앞사람이 방장."""
        h = next((p for p in self.players if not p.cpu and p.online), None)
        self.host = h.id if h else None

    def leave(self, p: Player, *, now: bool = False) -> None:
        """나감 · 끊김: 대기실에선 잠깐(새로고침) 기다렸다 빼고, 게임 중엔 자리를 남겨 CPU 처럼 자동 진행."""
        p.conn = None

        def remove() -> None:
            self.players = [x for x in self.players if x is not p]
            self.pick_host()
            self.check_empty()
            if not self.dead:
                self.broadcast()

        def remove_if_still_gone() -> None:
            if p.conn is None and self.phase == "lobby" and p in self.players:
                remove()

        if self.phase == "lobby":
            if now:
                remove()
            else:
                self.set_timer(self.T.LOBBY_GRACE_MS, remove_if_still_gone)
        else:
            self.auto_answer(p)
        self.pick_host()
        self.check_empty()
        if not self.dead:
            self.broadcast()

    def _someone_online(self) -> bool:
        return any(not p.cpu and p.online for p in self.players)

    def cancel_close(self) -> None:
        if self.close_timer:
            self.close_timer.cancel()
            self.close_timer = None

    def check_empty(self) -> None:
        """사람이 아무도 없으면 15초 뒤 방 닫기."""
        if self.dead or self._someone_online():
            return
        self.cancel_close()
        self.close_timer = self.set_timer(self.T.CLOSE_MS, self._close_if_empty)

    def _close_if_empty(self) -> None:
        if self._someone_online():
            return
        self.close()

    def close(self) -> None:
        """방을 닫는다: 타이머를 지우고, 진행 중이던 게임 작업도 멈춘다."""
        self.dead = True
        for pr in self.prompts.values():
            pr.timer.cancel()
            if pr.cpu_timer:
                pr.cpu_timer.cancel()
        # 원본은 대답이 오지 않는 Promise 를 그냥 버려 두지만, 파이썬에서는 작업이 영원히 남으므로 취소한다
        if self.task and not self.task.done():
            self.task.cancel()
        if self.on_close:
            self.on_close(self)
        print(f"[party {self.code}] 방 닫힘")
