"""음성 퀴즈 설정 — 숫자는 모두 여기서만 바꾼다. (원본 web/js/config.js 의 RULES 를 옮김)"""

from __future__ import annotations

import copy
from pathlib import Path

QUESTIONS_FILE = Path(__file__).resolve().parent / "data" / "questions.json"

DEFAULT_CONFIG: dict = {
    "RULES": {
        "QUESTION_COUNT": 10,        # 한 판 문제 수
        "QUESTION_TIME": 45.0,       # 문제당 제한 시간(초) — 누군가 답하는 동안에는 멈춘다
        "HINT_CHOSUNG_AT": 10.0,     # 10초 지나면 초성 힌트
        "HINT_FIRST_AT": 20.0,       # 20초 지나면 첫 글자 공개
        "ANSWER_TIME": 10.0,         # 버저를 잡은 뒤 답할 시간(초)
        "READY_TIME": 4.0,           # 게임 시작 전 준비 시간(화면·마이크 준비)
        "INTRO_TIME": 2.2,           # 문제 시작 전 "문제 N" 시간
        "REVEAL_TIME": 3.6,          # 정답 공개 시간
        "WRONG_FEEDBACK_TIME": 1.2,  # 오답 연출 뒤 다시 버저가 열리기까지
        "FINAL_TIME": 8.0,           # 최종 결과 화면 시간
        "VOICE_ATTEMPTS": 2,         # 음성으로 말한 답이 틀렸을 때 말할 수 있는 횟수(오인식 대비)
        "RETRY_MIN_TIME": 4.0,       # 다시 말할 때 최소한 보장하는 시간(초)
        "ANSWER_SLACK_CHARS": 2,     # 정답 외에 붙어도 되는 군더더기 글자 수
        "BUZZ_WINDOW": 0.12,         # 거의 동시에 누른 버저를 모으는 시간(초) — 누른 시각이 빠른 사람이 이긴다
        "BUZZ_MAX_LAG": 0.35,        # 누른 시각이 도착 시각보다 이만큼까지 앞서도 인정(통신 지연 보정)
        "BUZZ_MAX_LEAD": 0.05,       # 시계 오차 허용
        "JUDGE_TIMEOUT": 8.0,        # 음성 인식이 이 시간 안에 안 끝나면 다시 말하게 한다
        "MAX_VOICE_SECONDS": 8.0,    # 받는 음성 길이 상한
        "MIN_VOICE_SECONDS": 0.2,    # 이보다 짧으면 못 들은 것으로 처리
        "MIN_VOICE_RMS": 0.004,      # 이보다 작은 소리는 못 들은 것으로 처리
    },
    "SCORE": {
        "CORRECT": 100,   # 정답
        "WRONG": -50,     # 오답·시간 초과(버저를 잡고 못 맞힘)
    },
    "VOICE": {
        # 정답 앞뒤에 붙는 말버릇 — 판정 전에 떼어낸다
        "FILLER_PREFIX": ["정답은", "정답", "답은", "답", "음", "어", "아", "그", "저기", "제생각엔", "제생각에는"],
        "FILLER_SUFFIX": ["입니다", "이에요", "예요", "이요", "요", "이다", "다", "인가요", "일까요"],
    },
    "BANK": {
        "ANSWER_MIN_SYLLABLES": 2,
        "ANSWER_MAX_SYLLABLES": 7,
        "QUESTION_MAX_CHARS": 70,
    },
    "GEMINI": {
        "BATCH": 20,        # 한 번에 만들어 달라고 할 문제 수
        "POOL_TARGET": 30,  # 미리 쌓아 둘 문제 수
    },
}


def merge_config(base: dict, override: dict | None) -> dict:
    out = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge_config(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out
