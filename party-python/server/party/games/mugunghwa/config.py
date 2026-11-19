"""무궁화 꽃이 피었습니다 — 설정. 숫자는 모두 여기서만 바꾼다. (원본 js/config.js 를 옮기고 사람 술래용 값을 더함)"""

from __future__ import annotations

import copy

LOGIC_FPS = 60

DEFAULT_CONFIG: dict = {
    # 이동 (단위: 미터, 초) — 원본 값
    "MOVE": {
        "MAX_SPEED": 1.1,          # 최고 속도 (m/s)
        "ACCEL": 3.0,              # 가속도
        "DECEL": 6.5,              # 감속도 — 키를 떼도 바로 멈추지 못한다(관성)
        "MOVING_THRESHOLD": 0.05,  # 이 속도를 넘으면 "움직이는 중"으로 판정
    },
    "RULES": {
        "TIME_LIMIT": 45,          # 제한 시간(초). 원본 60
        "METERS": 15,              # 출발선 → 결승선 거리(m). 원본 20 (시간에 맞춰 줄임)
        "GRACE_TIME": 0.4,         # 술래가 돌아보기 시작한 뒤 판정까지 유예(초). 원본 0.2 + 통신 지연 여유
        "COUNTDOWN": 3.0,
    },
    "FLOW": {
        "INTRO_TIME": 5.0,         # 술래 발표·역할 안내
        "END_HOLD": 3.0,           # 판이 끝난 뒤 결과 화면으로 넘어가기까지
        "FINAL_TIME": 8.0,         # 결과 화면
    },
    "TAGGER": {
        "PHRASES": ["무궁화 꽃이 피었습니다", "무궁화 꽃이 피었읍니다", "무궁화꽃이 피었습니다"],
        "MATCH_MIN_SCORE": 0.75,    # 들린 말이 문장과 이만큼 비슷하면 인정(0~1)
        "TURN_TIME": 0.15,         # 돌아보는 동작 시간
        "TURN_BACK_TIME": 0.24,    # 다시 뒤도는 동작 시간
        "MIN_LOOK": 1.0,           # 돌아본 뒤 최소한 이만큼은 지켜본다
        "MAX_LOOK": 4.0,           # 술래가 다시 외치지 않아도 이만큼 지나면 뒤돈다
        "MIN_KEY_CHANT": 1.5,      # (마이크 없이 키로 할 때) 이만큼 누르고 있어야 다 외친 것으로 본다
    },
    "SCORE": {
        # 이긴 쪽은 항상 진 쪽보다 높다.
        "TAGGER_WIN": 1000,        # 술래 승리 시 술래
        "RUNNER_LOSE_MAX": 500,    # 술래 승리 시 도망자: 간 거리 비율 × 이 값
        "RUNNER_FINISH": 1000,     # 도망자 승리 시 도착한 사람
        "RUNNER_WIN_BASE": 600,    # 도망자 승리 시 도착 못 한 도망자 기본 점수
        "RUNNER_WIN_PROGRESS": 300,  # + 간 거리 비율 × 이 값
        "TAGGER_LOSE_PER_CATCH": 100,  # 도망자 승리 시 술래: 잡은 사람 수 × 이 값
    },
    "VOICE": {
        "MAX_SECONDS": 6.0,
        "MIN_SECONDS": 0.3,
        "MIN_RMS": 0.004,
        "TIMEOUT": 6.0,
    },
}


def merge_config(override: dict | None = None, base: dict | None = None) -> dict:
    out = copy.deepcopy(DEFAULT_CONFIG if base is None else base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = merge_config(value, out[key])
        else:
            out[key] = copy.deepcopy(value)
    return out
