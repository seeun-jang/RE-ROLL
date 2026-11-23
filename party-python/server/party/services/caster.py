"""AI 해설 도우미 — 게임이 Gemini 를 '기다리지 않고' 쓰게 해 준다.

Gemini 는 답하는 데 1~3초가 걸리고 무료 등급은 분당 요청 수가 적다. 그래서
  ① 게임이 시작될 때 한 번, 이 판에 쓸 대사 묶음을 스레드에서 미리 받아 두고(LineBook)
  ② 게임이 끝날 때 한 번, 결과를 보고 총평을 받는다(ask_async)
게임 진행(tick)은 "다 왔나?" 만 확인하고, 안 왔으면 준비된 기본 대사를 쓴다.

    book = LineBook(self.services.get("gemini"), game="잭팟 볼링", caster="해설자",
                    kinds={"strike": "스트라이크를 쳤을 때", "gutter": "거터에 빠졌을 때"},
                    canned={"strike": ["{name} 스트라이크!"], "gutter": ["{name} 아깝다!"]},
                    players=["성원", "지호"])
    book.prepare()                                  # start() 에서 한 번 — 스레드에서 Gemini 호출
    text, source = book.line("strike", rng, name="성원")   # source = "gemini" | "canned"

    job = ask_async(gemini, prompt, schema)         # → Future 또는 None(Gemini 꺼짐)
    if job is not None and job.done(): data = result_or_none(job)

Gemini 가 꺼져 있거나(키 없음) 실패해도 예외를 밖으로 내지 않는다.
"""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from typing import Callable

#: Gemini 호출 전용 스레드(게임 진행 스레드를 막지 않기 위함). 동시에 2개까지만 — 무료 한도 보호.
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="party-gemini")

#: RE:ROLL 스토리보드 등장인물 — 대사 말투를 맞추는 데 쓴다
CHARACTERS = """등장인물 말투:
- 마법사: 마을에 저주를 건 악당. 점잖고 비꼬는 존댓말.
- 냥박사(고양이): 똑똑하고 새침함. 문장 끝에 가끔 "~냥".
- 호랑대장(호랑이): 씩씩한 군대식 말투. "~한다!", "~이다!"
- 꽥대장(오리): 수다스럽고 흥분을 잘함. "꽥!"
- 쿠와카(곰): 느긋하고 다정함.
- 로카(시바견): 무심하고 짧게 말함.
- 해설자: 스포츠 중계 캐스터. 빠르고 신나는 말투."""

MAX_LINE_CHARS = 22


def ask_async(gemini, prompt: str, schema: dict | None = None, *, system: str | None = None,
              images: list[dict] | None = None, temperature: float = 1.0) -> Future | None:
    """Gemini 에게 스레드에서 묻는다. Gemini 가 꺼져 있으면 None."""
    if gemini is None:
        return None
    return _POOL.submit(gemini.generate_json, prompt, schema, temperature, images, system)


def result_or_none(job: Future | None):
    """끝난 작업의 결과. 아직 안 끝났거나 실패했으면 None (예외를 내지 않는다)."""
    if job is None or not job.done():
        return None
    try:
        return job.result()
    except Exception as exc:
        print(f"[AI 해설] Gemini 실패(기본 대사를 씁니다): {exc!r}", flush=True)
        return None


def clean_line(text, limit: int = MAX_LINE_CHARS) -> str:
    """AI 가 쓴 한 줄을 화면에 넣을 수 있게 다듬는다(줄바꿈 · 따옴표 제거, 길이 자르기)."""
    if not isinstance(text, str):
        return ""
    line = " ".join(text.replace('"', "").replace("'", "").split())
    return line[:limit].strip()


class LineBook:
    """한 판에 쓸 대사 묶음. kinds 의 상황마다 대사 몇 줄을 Gemini 에게 한 번에 받아 둔다."""

    def __init__(self, gemini, *, game: str, kinds: dict[str, str], canned: dict[str, list[str]],
                 caster: str = "해설자", players: list[str] | None = None, per_kind: int = 3,
                 max_chars: int = MAX_LINE_CHARS, extra: str = ""):
        self.gemini = gemini
        self.game = game
        self.kinds = dict(kinds)
        self.canned = {k: list(v) for k, v in canned.items()}
        self.caster = caster
        self.players = list(players or [])
        self.per_kind = per_kind
        self.max_chars = max_chars
        self.extra = extra
        self._job: Future | None = None
        self._lines: dict[str, list[str]] | None = None

    # ----- 프롬프트(10주차: 역할 · 작업 · 맥락 · 형식 · 제약) -----
    def system_prompt(self) -> str:
        return (
            f"너는 보드게임 'RE:ROLL' 의 미니게임 '{self.game}' 대사 작가야.\n"
            f"말하는 사람은 '{self.caster}' 이다.\n\n{CHARACTERS}\n\n"
            "규칙:\n"
            f"- 상황마다 서로 다른 한국어 대사를 정확히 {self.per_kind}줄씩 쓴다.\n"
            f"- 한 줄은 {self.max_chars}자 이내, 한 문장.\n"
            "- 선수 이름이 들어갈 자리에는 {name} 이라고만 쓴다(실제 이름을 쓰지 않는다). 이름이 필요 없으면 안 써도 된다.\n"
            "- 욕설 · 비하 · 따옴표 · 이모지 · 줄바꿈 금지."
        )

    def user_prompt(self) -> str:
        rows = "\n".join(f"- {kind}: {desc}" for kind, desc in self.kinds.items())
        who = f"\n참가자 수: {len(self.players)}명" if self.players else ""
        more = f"\n{self.extra}" if self.extra else ""
        return f"상황 목록:\n{rows}{who}{more}"

    def schema(self) -> dict:
        """응답 모양 — 상황 이름마다 문자열 배열 (10주차: JSON 스키마로 응답 모양 고정)"""
        return {
            "type": "OBJECT",
            "properties": {kind: {"type": "ARRAY", "items": {"type": "STRING"}} for kind in self.kinds},
            "required": list(self.kinds),
        }

    # ----- 쓰는 쪽 -----
    def prepare(self) -> None:
        """대사 묶음 요청을 시작한다(기다리지 않는다). 게임 start() 에서 한 번 부른다."""
        if self._job is None and self._lines is None:
            self._job = ask_async(self.gemini, self.user_prompt(), self.schema(), system=self.system_prompt())

    @property
    def ready(self) -> bool:
        self._collect()
        return self._lines is not None

    def _collect(self) -> None:
        if self._lines is not None or self._job is None or not self._job.done():
            return
        data = result_or_none(self._job)
        self._job = None
        lines: dict[str, list[str]] = {}
        if isinstance(data, dict):
            for kind in self.kinds:
                got = [clean_line(x, self.max_chars + 6) for x in (data.get(kind) or []) if isinstance(x, str)]
                lines[kind] = [x for x in got if x]
        self._lines = lines

    def line(self, kind: str, rng: Callable[[], float], **fmt) -> tuple[str, str]:
        """상황 kind 의 대사 한 줄과 출처('gemini' | 'canned'). {name} 등은 fmt 로 채운다."""
        self._collect()
        pool, source = (self._lines or {}).get(kind) or [], "gemini"
        if not pool:
            pool, source = self.canned.get(kind) or [""], "canned"
        text = pool[int(rng() * len(pool)) % len(pool)]
        for key, value in fmt.items():
            text = text.replace("{" + key + "}", str(value))
        if "{" in text:          # 채우지 못한 자리가 남았으면 기본 대사로
            text, source = (self.canned.get(kind) or [""])[0], "canned"
            for key, value in fmt.items():
                text = text.replace("{" + key + "}", str(value))
        return clean_line(text, self.max_chars + 8), source


VERDICT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "headline": {"type": "STRING", "description": "한 줄 총평 (20자 이내)"},
        "mvp": {"type": "STRING", "description": "1등에게 하는 한마디 (24자 이내)"},
        "cheer": {"type": "STRING", "description": "꼴찌에게 하는 응원 (24자 이내)"},
    },
    "required": ["headline", "mvp", "cheer"],
}


def ask_verdict(gemini, *, game: str, results: list[dict], caster: str = "해설자", note: str = "") -> Future | None:
    """게임이 끝났을 때 결과를 보고 총평을 받는다(스레드). Gemini 가 꺼져 있으면 None.

    results: 공통 결과 형식 [{name, score, rank, stats}]. 답은 VERDICT_SCHEMA 모양.
    """
    if gemini is None:
        return None
    rows = "\n".join(
        f"- {r.get('rank')}등 {r.get('name')} · {r.get('score')}점 · {r.get('stats') or {}}" for r in results[:5]
    )
    system = (
        f"너는 보드게임 'RE:ROLL' 미니게임 '{game}' 의 '{caster}' 이다.\n\n{CHARACTERS}\n\n"
        "방금 끝난 경기 결과를 보고 총평을 쓴다. 결과에 있는 이름 · 점수 · 기록만 말하고 없는 사실을 지어내지 않는다.\n"
        "욕설 · 비하 · 따옴표 · 이모지 · 줄바꿈 금지."
    )
    prompt = f"경기 결과:\n{rows}" + (f"\n참고: {note}" if note else "")
    return ask_async(gemini, prompt, VERDICT_SCHEMA, system=system)


def verdict_or_none(job: Future | None) -> dict | None:
    """끝난 총평 작업의 결과를 다듬어 돌려준다. 없으면 None."""
    data = result_or_none(job)
    if not isinstance(data, dict):
        return None
    out = {k: clean_line(data.get(k), 28) for k in ("headline", "mvp", "cheer")}
    return out if out["headline"] else None
