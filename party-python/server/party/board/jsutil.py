"""자바스크립트와 파이썬의 계산 차이를 메워 주는 작은 도구들.

원본(party.js)은 자바스크립트라서 숫자 변환 · 반올림 · 글자 자르기 규칙이 파이썬과 조금 다르다.
결과가 원본과 같도록, 다른 부분만 여기 모아 두었다.
"""

from __future__ import annotations

import math
import re

_NUMBER = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def to_number(x) -> float:
    """자바스크립트의 `+x` (숫자로 바꾸기). 숫자가 아니면 NaN.

    - true/false → 1/0, null(None) → 0, "" → 0, " 12 " → 12, "abc" → NaN
    """
    if isinstance(x, bool):
        return 1.0 if x else 0.0
    if isinstance(x, (int, float)):
        return float(x)
    if x is None:
        return 0.0
    if isinstance(x, str):
        s = x.strip()
        if s == "":
            return 0.0
        return float(s) if _NUMBER.match(s) else math.nan
    return math.nan


def js_round(x: float) -> float:
    """자바스크립트의 Math.round. 0.5 는 항상 위로 올린다 (2.5 → 3, -2.5 → -2).

    파이썬 round() 는 0.5 를 짝수 쪽으로 보내서(2.5 → 2) 결과가 다르다. NaN · 무한대는 그대로 돌려준다.
    """
    if math.isnan(x) or math.isinf(x):
        return x
    return math.floor(x + 0.5)


def clean_score(x) -> int:
    """미니게임 점수: Math.max(0, Math.round(+score) || 0). 숫자가 아니면 0, 음수도 0.

    원본과 다른 점: 무한대는 0 으로 바꾼다 (JSON 으로 보낼 수 없어서 화면이 깨지지 않게).
    """
    n = js_round(to_number(x))
    if math.isnan(n) or math.isinf(n):
        return 0
    return max(0, int(n))


def clean_timing(x) -> int:
    """타이밍 주사위 값: Math.max(1, Math.min(10, Math.round(+v) || 1)). 1~10 정수."""
    n = js_round(to_number(x))
    if math.isnan(n) or n == 0:
        n = 1
    return int(max(1, min(10, n)))


def js_slice(text: str, n: int) -> str:
    """자바스크립트의 text.slice(0, n).

    자바스크립트는 글자를 UTF-16 단위로 세기 때문에 이모지 하나가 2칸이다. 같은 방식으로 센다.
    (이모지가 반으로 잘리면 그 반쪽은 버린다 — 원본은 깨진 반쪽이 남는다)
    """
    raw = text.encode("utf-16-le", "surrogatepass")[: n * 2]
    return raw.decode("utf-16-le", "ignore")


def js_text(x) -> str:
    """자바스크립트의 String(x || ''). 글자 · 숫자만 받고 나머지(null, 목록 등)는 빈 글자로 본다."""
    if isinstance(x, bool):
        return "true" if x else ""
    if isinstance(x, str):
        return x
    if isinstance(x, (int, float)):
        if x == 0 or (isinstance(x, float) and math.isnan(x)):
            return ""
        return str(int(x)) if float(x).is_integer() else str(x)
    return ""


def clean_name(x) -> str:
    """이름 다듬기: 앞뒤 공백을 빼고 8글자까지."""
    return js_slice(js_text(x).strip(), 8)


def same_value(a, b) -> bool:
    """자바스크립트의 a === b (JSON 으로 받은 값끼리).

    파이썬은 True == 1 이 참이지만 자바스크립트는 true === 1 이 거짓이다. 종류까지 같아야 같다고 본다.
    (정수 1 과 실수 1.0 은 자바스크립트에서 같은 숫자이므로 같다)
    """
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    return False


def tidy_number(x):
    """소수점 아래가 없는 실수는 정수로 (12000.0 → 12000). 자바스크립트가 JSON 에 쓰는 모양과 같게."""
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x
