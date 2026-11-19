"""정답 판정 — 음성/타자 공통. (원본 web/js/core/AnswerChecker.js 를 옮김. 팀 이름 처리만 뺐다)"""

from __future__ import annotations

from .hangul import normalize


def _variants(text: str, prefixes: list[str], suffixes: list[str]) -> list[str]:
    """앞뒤 말버릇(정답은~, ~입니다)을 떼어낸 후보들."""
    out = [text]
    cur = text
    for _ in range(4):  # "음 정답은 세종대왕"
        p = next((f for f in prefixes if cur.startswith(f) and len(cur) > len(f)), None)
        if p is None:
            break
        cur = cur[len(p):]
        if cur not in out:
            out.append(cur)
    for base in list(out):
        s = base
        for _ in range(3):
            f = next((x for x in suffixes if s.endswith(x) and len(s) > len(x)), None)
            if f is None:
                break
            s = s[: -len(f)]
            if s not in out:
                out.append(s)
    return out


class AnswerChecker:
    def __init__(self, question: dict, cfg: dict):
        self.accepted = [a for a in (normalize(x) for x in [question["answer"], *question.get("aliases", [])]) if a]
        self.slack = int(cfg["RULES"]["ANSWER_SLACK_CHARS"])
        self.prefixes = list(cfg["VOICE"]["FILLER_PREFIX"])
        self.suffixes = list(cfg["VOICE"]["FILLER_SUFFIX"])

    def is_correct(self, text: str) -> bool:
        """정답/별칭과 같거나, 정답을 포함하되 군더더기가 허용량 이하일 때."""
        cleaned = normalize(text)
        if not cleaned:
            return False
        for v in _variants(cleaned, self.prefixes, self.suffixes):
            for a in self.accepted:
                if v == a:
                    return True
                # 군더더기 허용량은 정답 길이의 절반까지 — 2글자 정답 두 개를 붙여 찍는 것 방지("목성토성")
                slack = min(self.slack, len(a) // 2)
                if a in v and len(v) - len(a) <= slack:
                    return True
        return False

    def is_meaningful(self, text: str) -> bool:
        """판정할 만한 내용이 있는지(말버릇뿐이면 False)."""
        cleaned = normalize(text)
        if not cleaned:
            return False
        return cleaned not in set(self.prefixes) | set(self.suffixes)
