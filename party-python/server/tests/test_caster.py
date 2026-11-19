"""AI 해설 도우미(services/caster.py) — Gemini 없이도, 가짜 Gemini 로도 동작하는지."""

import time

from party.services.caster import LineBook, ask_verdict, clean_line, verdict_or_none

KINDS = {"strike": "스트라이크", "gutter": "거터"}
CANNED = {"strike": ["{name} 스트라이크!"], "gutter": ["아깝다!"]}


class FakeGemini:
    def __init__(self, data=None, error=None):
        self.data, self.error, self.calls = data, error, []

    def generate_json(self, prompt, schema=None, temperature=1.0, images=None, system=None):
        self.calls.append({"prompt": prompt, "schema": schema, "images": images, "system": system})
        if self.error:
            raise self.error
        return self.data


def wait(book):
    for _ in range(200):
        if book.ready:
            return
        time.sleep(0.01)


def test_without_gemini_uses_canned_lines():
    book = LineBook(None, game="볼링", kinds=KINDS, canned=CANNED)
    book.prepare()
    assert book.line("strike", lambda: 0.0, name="성원") == ("성원 스트라이크!", "canned")


def test_gemini_lines_are_used_and_names_filled():
    fake = FakeGemini({"strike": ["{name} 완벽한 투구!", "핀이 전부 쓰러졌다!"], "gutter": []})
    book = LineBook(fake, game="볼링", kinds=KINDS, canned=CANNED, players=["성원", "지호"])
    book.prepare()
    wait(book)
    assert book.line("strike", lambda: 0.0, name="성원") == ("성원 완벽한 투구!", "gemini")
    assert book.line("gutter", lambda: 0.0) == ("아깝다!", "canned")       # 빈 묶음이면 기본 대사
    assert len(fake.calls) == 1 and "{name}" in fake.calls[0]["system"]


def test_gemini_failure_falls_back():
    book = LineBook(FakeGemini(error=RuntimeError("503")), game="볼링", kinds=KINDS, canned=CANNED)
    book.prepare()
    wait(book)
    assert book.line("strike", lambda: 0.0, name="A")[1] == "canned"


def test_unfilled_placeholder_falls_back():
    fake = FakeGemini({"strike": ["{winner} 대단하다"], "gutter": ["x"]})
    book = LineBook(fake, game="볼링", kinds=KINDS, canned=CANNED)
    book.prepare()
    wait(book)
    assert book.line("strike", lambda: 0.0, name="A") == ("A 스트라이크!", "canned")


def test_verdict():
    assert ask_verdict(None, game="볼링", results=[]) is None
    fake = FakeGemini({"headline": "명승부\n였다", "mvp": '"성원" 최고', "cheer": "다음엔 이긴다"})
    job = ask_verdict(fake, game="볼링", results=[{"rank": 1, "name": "성원", "score": 120, "stats": {}}])
    for _ in range(200):
        if job.done():
            break
        time.sleep(0.01)
    assert verdict_or_none(job) == {"headline": "명승부 였다", "mvp": "성원 최고", "cheer": "다음엔 이긴다"}


def test_clean_line():
    assert clean_line(None) == ""
    assert clean_line("  가\n나  ", 10) == "가 나"
    assert len(clean_line("가" * 50, 10)) == 10
