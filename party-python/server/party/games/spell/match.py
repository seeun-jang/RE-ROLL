"""주문 텍스트 판정 — 음성 인식 결과(문장)가 어느 주문인지 가린다.

원본 ai_server/spell_match.py (= src/input/SpellMatcher.js) 와 같은 알고리즘:
한글 자모 분해 + 레벤슈타인 거리 + 부분 구간 탐색. "파이어 벌!" 처럼 조금 다르게 들려도 인정한다.
"""

from __future__ import annotations

import re
import unicodedata

from .config import DEFAULT_CONFIG, SPELLS

CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
        "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]


def normalize(text: str) -> str:
    return re.sub(r"[^0-9a-zㄱ-ㆎ가-힣]", "", unicodedata.normalize("NFC", (text or "").lower()))


def to_jamo(text: str) -> list[str]:
    out: list[str] = []
    for ch in text:
        code = ord(ch) - 0xAC00
        if 0 <= code < 11172:
            out.append(CHO[code // 588])
            out.append(JUNG[(code % 588) // 28])
            if JONG[code % 28]:
                out.append(JONG[code % 28])
        else:
            out.append(ch)
    return out


def levenshtein(a: list[str], b: list[str]) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return prev[-1]


def similarity(a: list[str], b: list[str]) -> float:
    n = max(len(a), len(b))
    return 1 - levenshtein(a, b) / n if n else 1.0


class SpellMatcher:
    def __init__(self, spells: list[dict] | None = None, rules: dict | None = None):
        rules = rules or DEFAULT_CONFIG["MATCH"]
        self.min_score = rules["MIN_SCORE"]
        self.short_len = rules["SHORT_KEYWORD_LEN"]
        self.slack = rules["WINDOW_SLACK"]
        self.entries = []
        for spell in spells or SPELLS:
            for kw in spell["keywords"]:
                kn = normalize(kw)
                if kn:
                    self.entries.append((spell["id"], kw, kn, to_jamo(kn)))

    def _score(self, tj: list[str], kj: list[str], norm: str, knorm: str) -> float:
        kl = len(kj)
        # 짧은 키워드("힐")는 오인식이 많으므로 음절 단위로 정확히 포함될 때만 인정
        if len(knorm) <= self.short_len:
            if norm == knorm:
                return 1.0
            return 0.9 if knorm in norm and len(norm) <= len(knorm) + 3 else 0.0
        best = similarity(tj, kj)
        if len(tj) > kl - self.slack:
            for length in range(max(1, kl - self.slack), kl + self.slack + 1):
                for s in range(0, len(tj) - length + 1):
                    best = max(best, similarity(tj[s:s + length], kj))
                    if best == 1.0:
                        return 1.0
        return best

    def match(self, text: str) -> dict:
        """{"spell": 주문 id | None, "score": 0~1, "keyword": ...}"""
        norm = normalize(text)
        result = {"spell": None, "score": 0.0, "keyword": None}
        if not norm:
            return result
        norm = norm[:40]   # 너무 긴 문장은 앞부분만 본다(계산량 제한)
        tj = to_jamo(norm)
        best = 0.0
        for spell_id, kw, kn, kj in self.entries:
            sc = self._score(tj, kj, norm, kn)
            # 동점이면 더 긴 키워드 우선
            if sc > best or (sc == best and result["keyword"] and len(kw) > len(result["keyword"])):
                best = sc
                result.update(score=round(sc, 3), keyword=kw, spell=spell_id)
        if best < self.min_score:
            result["spell"] = None
        return result
