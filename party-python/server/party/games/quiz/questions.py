"""문제 공급 — 기본 문제 은행(questions.json) + Gemini 가 만든 문제.

- 문제 은행: 원본 게임의 170문제. 분야가 한쪽으로 몰리지 않게 골라 낸다.
- Gemini: 서버가 켜져 있는 동안 뒤에서(스레드) 미리 문제를 만들어 쌓아 둔다(QuestionPool).
  게임을 시작할 때 쌓인 문제가 충분하면 그것을 쓰고, 모자라면 문제 은행으로 채운다.
  만든 문제는 은행과 같은 규칙으로 검증해서 통과한 것만 쓴다.
"""

from __future__ import annotations

import json
import threading
from typing import Callable

from . import config as C
from .hangul import chosung_hint, first_letter_hint, is_pure_hangul, normalize, syllable_count

_bank_cache: dict | None = None


def load_bank() -> dict:
    """{'categories': [...], 'questions': [...]}"""
    global _bank_cache
    if _bank_cache is None:
        with C.QUESTIONS_FILE.open("r", encoding="utf-8") as f:
            _bank_cache = json.load(f)
    return _bank_cache


def with_hints(q: dict) -> dict:
    return {
        "id": q.get("id", ""),
        "category": q.get("category", ""),
        "question": q["question"],
        "answer": q["answer"],
        "aliases": list(q.get("aliases", [])),
        "source": q.get("source", "bank"),
        "hints": {"chosung": chosung_hint(q["answer"]), "firstLetter": first_letter_hint(q["answer"])},
    }


def problems_of(q, category_ids: set[str], rules: dict | None = None) -> list[str]:
    """문제 하나의 규칙 위반 목록(비어 있으면 통과). 은행·Gemini 문제에 똑같이 쓴다."""
    rules = rules or C.DEFAULT_CONFIG["BANK"]
    if not isinstance(q, dict):
        return ["문제는 객체여야 함"]
    out = []
    for key in ("category", "question", "answer"):
        if not isinstance(q.get(key), str) or not q[key].strip():
            out.append(f"'{key}' 항목이 없거나 문자열이 아님")
    aliases = q.get("aliases", [])
    if not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases):
        out.append("'aliases' 는 문자열 리스트여야 함")
    if out:
        return out
    if q["category"] not in category_ids:
        out.append(f"알 수 없는 분야 {q['category']}")
    answer = q["answer"]
    if not is_pure_hangul(answer):
        out.append(f"정답은 공백 없는 한글만 ({answer})")
    n = syllable_count(answer)
    if not (rules["ANSWER_MIN_SYLLABLES"] <= n <= rules["ANSWER_MAX_SYLLABLES"]):
        out.append(f"정답 글자 수 {n}")
    if len(q["question"]) > rules["QUESTION_MAX_CHARS"]:
        out.append("문제가 너무 김")
    for a in aliases:
        if len(normalize(a)) < rules["ANSWER_MIN_SYLLABLES"]:
            out.append(f"별칭 '{a}' 가 너무 짧음")
    nq = normalize(q["question"])
    for a in [answer, *aliases]:
        na = normalize(a)
        if na and na in nq:
            out.append(f"문제에 정답/별칭 '{a}'가 들어 있음")
    return out


def pick_from_bank(count: int, rng: Callable[[], float], exclude_answers: set[str] | None = None) -> list[dict]:
    """분야를 돌아가며 중복 없이 count 개를 고른다."""
    bank = load_bank()
    exclude = exclude_answers or set()
    by_cat: dict[str, list[dict]] = {}
    for q in bank["questions"]:
        if normalize(q["answer"]) in exclude:
            continue
        by_cat.setdefault(q["category"], []).append(q)

    def shuffle(items: list) -> None:
        for i in range(len(items) - 1, 0, -1):
            j = min(i, int(rng() * (i + 1)))
            items[i], items[j] = items[j], items[i]

    for qs in by_cat.values():
        shuffle(qs)
    cats = list(by_cat)
    shuffle(cats)
    picked: list[dict] = []
    while len(picked) < count and any(by_cat.values()):
        for c in cats:
            if by_cat[c] and len(picked) < count:
                picked.append(by_cat[c].pop())
    shuffle(picked)
    return [with_hints(q) for q in picked]


# ----------------------------------------------------------------------
# Gemini 로 만든 문제 모아 두기
# ----------------------------------------------------------------------
QUESTION_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "category": {"type": "STRING"},
            "question": {"type": "STRING"},
            "answer": {"type": "STRING"},
            "aliases": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["category", "question", "answer", "aliases"],
    },
}


def build_prompt(count: int, categories: list[dict], avoid: list[str]) -> str:
    cats = ", ".join(f"{c['id']}({c['name']})" for c in categories)
    avoid_text = ", ".join(avoid[:80]) if avoid else "없음"
    return (
        f"한국어 상식 퀴즈 문제를 {count}개 만들어 주세요. 여러 사람이 버저를 누르고 정답을 말로 외치는 파티 게임에 씁니다.\n"
        "규칙:\n"
        f"- category 는 다음 중 하나의 id: {cats}. 분야를 골고루 섞습니다.\n"
        "- question 은 60자 이내의 한 문장이고 물음표로 끝납니다. 정답이 하나로 분명해야 합니다.\n"
        "- answer 는 공백·숫자·영어·기호 없이 한글 2~7글자인 낱말 하나입니다(예: 세종대왕, 광합성).\n"
        "- question 안에 answer 나 aliases 의 낱말이 그대로 들어가면 안 됩니다.\n"
        "- aliases 는 정답으로 인정할 다른 표기(한글 2글자 이상)의 목록입니다. 없으면 빈 배열입니다.\n"
        "- 대학생이 알 만한 쉬운~보통 난이도로 하고, 사실 관계가 확실한 것만 냅니다.\n"
        f"- 다음 정답은 이미 썼으니 피합니다: {avoid_text}\n"
        "JSON 배열만 출력합니다."
    )


class QuestionPool:
    """Gemini 가 만든 문제를 미리 쌓아 두는 곳. 스레드에서 채우고, 게임이 꺼내 쓴다."""

    def __init__(self, gemini, cfg: dict | None = None):
        self.gemini = gemini
        self.cfg = cfg or C.DEFAULT_CONFIG
        self._lock = threading.Lock()
        self._items: list[dict] = []
        self._used: list[str] = []      # 이미 낸 정답(정규화) — 같은 문제가 또 나오지 않게
        self._busy = False
        self.last_error = ""
        self.generated = 0

    def size(self) -> int:
        with self._lock:
            return len(self._items)

    def mark_used(self, questions: list[dict]) -> None:
        with self._lock:
            for q in questions:
                self._used.append(normalize(q["answer"]))
            self._used = self._used[-300:]

    def used_answers(self) -> set[str]:
        with self._lock:
            return set(self._used)

    def take(self, count: int) -> list[dict]:
        """쌓인 문제에서 최대 count 개를 꺼낸다(모자라면 있는 만큼)."""
        with self._lock:
            out, self._items = self._items[:count], self._items[count:]
        return [with_hints(q) for q in out]

    def accept(self, raw) -> int:
        """Gemini 응답을 검증해 통과한 문제만 쌓는다. 쌓은 개수를 돌려준다."""
        if not isinstance(raw, list):
            return 0
        cat_ids = {c["id"] for c in load_bank()["categories"]}
        added = 0
        with self._lock:
            known = set(self._used) | {normalize(q["answer"]) for q in self._items}
            for i, q in enumerate(raw):
                if problems_of(q, cat_ids, self.cfg["BANK"]):
                    continue
                key = normalize(q["answer"])
                if key in known:
                    continue
                known.add(key)
                self.generated += 1
                self._items.append(
                    {
                        "id": f"gemini-{self.generated:04d}", "category": q["category"],
                        "question": q["question"].strip(), "answer": q["answer"].strip(),
                        "aliases": [a.strip() for a in q.get("aliases", []) if normalize(a) != key],
                        "source": "gemini",
                    }
                )
                added += 1
        return added

    def refill_async(self) -> bool:
        """모자라면 뒤에서 채우기 시작한다. 시작했으면 True."""
        if self.gemini is None:
            return False
        with self._lock:
            if self._busy or len(self._items) >= self.cfg["GEMINI"]["POOL_TARGET"]:
                return False
            self._busy = True
        threading.Thread(target=self._refill, name="quiz-gemini", daemon=True).start()
        return True

    def _refill(self) -> None:
        try:
            with self._lock:
                avoid = self._used[-60:] + [normalize(q["answer"]) for q in self._items]
            prompt = build_prompt(self.cfg["GEMINI"]["BATCH"], load_bank()["categories"], avoid)
            raw = self.gemini.generate_json(prompt, QUESTION_SCHEMA)
            added = self.accept(raw)
            total = len(raw) if isinstance(raw, list) else 0
            self.last_error = ""
            print(f"[음성 퀴즈] Gemini 문제 {added}개 준비(받은 {total}개 중 검증 통과) — 쌓인 문제 {self.size()}개", flush=True)
        except Exception as exc:
            self.last_error = repr(exc)
            print(f"[음성 퀴즈] Gemini 문제 만들기 실패(기본 문제 은행을 씁니다): {exc!r}", flush=True)
        finally:
            with self._lock:
                self._busy = False


def pick_questions(count: int, rng: Callable[[], float], pool: QuestionPool | None) -> tuple[list[dict], str]:
    """한 판에 낼 문제와 출처('gemini' | 'bank' | 'mixed')."""
    picked: list[dict] = []
    if pool is not None:
        picked = pool.take(count)
    n_gemini = len(picked)
    if n_gemini < count:
        exclude = {normalize(q["answer"]) for q in picked}
        if pool is not None:
            exclude |= pool.used_answers()
        more = pick_from_bank(count - n_gemini, rng, exclude)
        if len(more) < count - n_gemini:  # 은행을 다 썼으면 제외 없이 다시 고른다
            more = pick_from_bank(count - n_gemini, rng, {normalize(q["answer"]) for q in picked})
        picked += more
    if pool is not None:
        pool.mark_used(picked)
        pool.refill_async()
    source = "gemini" if n_gemini == len(picked) and picked else "bank" if n_gemini == 0 else "mixed"
    return picked, source
