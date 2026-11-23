"""한글 처리 유틸 — 초성 추출, 힌트 생성, 정답 비교용 정규화.

web/js/util/hangul.js 와 같은 규칙을 쓴다 (서버 없이 정적 호스팅할 때 JS 쪽이 대신 계산).
"""
import re

HANGUL_BASE = 0xAC00
HANGUL_LAST = 0xD7A3
JUNG_COUNT = 21
JONG_COUNT = 28
SYLLABLES_PER_CHO = JUNG_COUNT * JONG_COUNT  # 588

CHOSUNG = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
    "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
]

# 숨긴 글자 자리 표시
HIDDEN_MARK = "○"

# 공백·문장부호 제거용
_STRIP_RE = re.compile(r"[\s\.,!\?~\-_'\"`·…:;()\[\]{}<>/\\|@#$%^&*+=]+")


def is_hangul_syllable(ch: str) -> bool:
    """완성형 한글 음절인지."""
    return len(ch) == 1 and HANGUL_BASE <= ord(ch) <= HANGUL_LAST


def chosung_of(ch: str) -> str:
    """한 글자의 초성. 한글 음절이 아니면 그대로 돌려준다."""
    if not is_hangul_syllable(ch):
        return ch
    return CHOSUNG[(ord(ch) - HANGUL_BASE) // SYLLABLES_PER_CHO]


def chosung_hint(answer: str) -> str:
    """'세종대왕' -> 'ㅅㅈㄷㅇ' (공백은 유지)."""
    return "".join(chosung_of(ch) for ch in answer)


def first_letter_hint(answer: str) -> str:
    """'세종대왕' -> '세○○○' (첫 글자만 공개, 공백은 유지)."""
    out = []
    revealed = False
    for ch in answer:
        if ch.isspace():
            out.append(ch)
        elif not revealed:
            out.append(ch)
            revealed = True
        else:
            out.append(HIDDEN_MARK)
    return "".join(out)


def normalize(text: str) -> str:
    """비교용 정규화: 소문자, 공백/문장부호 제거."""
    return _STRIP_RE.sub("", (text or "").lower())


def syllable_count(text: str) -> int:
    """공백 제외 글자 수."""
    return len(normalize(text))


def is_pure_hangul(text: str) -> bool:
    """공백 없이 완성형 한글만으로 되어 있는지."""
    return bool(text) and all(is_hangul_syllable(ch) for ch in text)
