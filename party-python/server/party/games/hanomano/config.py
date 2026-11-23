"""하노마노 수치 — 숫자는 모두 여기서만 바꾼다. 시간 = 초.

원본 js/config.js 의 값을 그대로 옮겼다(원본은 60분의 1초 단위 프레임 → 여기서는 초).
브라우저 쪽 시험용 진행기(web/src/games/hanomano/sim/rules.js)에 같은 값이 있다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG: dict = {
    "RULES": {
        "TIME_LIMIT": 150.0,         # 제한 시간 2분 30초 (원본 150*60 프레임)
        "TARGET": 5,                 # 같은 과일이 정확히 이 개수일 때 종
        # 카드 구성: 과일마다 1개×4장, 2개×3장, 3개×3장, 4개×2장, 5개×1장 = 13장 × 4종 = 52장
        "CARD_COUNTS": {1: 4, 2: 3, 3: 3, 4: 2, 5: 1},
        "FRUITS": ["체리", "레몬", "라임", "포도"],
        "TURN_TIME": [3.0, 1.5],     # 내 차례에 안 뒤집으면 자동으로 뒤집는 시간 (처음 3초 → 끝날 즈음 1.5초)
        "WRONG_LOCK": 3.0,           # 틀리게 치면 3초 동안 종을 못 침
        "COLLECT_PAUSE": 70 / 60,    # 맞혔을 때 카드 모으는 연출 시간 (원본 70프레임)
        "WRONG_PAUSE": 50 / 60,      # 틀렸을 때 멈추는 시간 (원본 50프레임)
    },
    "FLOW": {
        "INTRO_TIME": 8.0,           # 하는 법 화면 (원본은 15초 또는 아무 키 — 모두 함께 넘어가야 해서 고정) *(임시 값)*
        "DEAL_TIME": 1.5,            # 카드 나눠주는 연출 (원본 90프레임)
        "END_TIME": 2.5,             # "게임 끝!" (원본 150프레임)
        "FINAL_TIME": 8.0,           # 최종 순위 화면 (AI 총평을 기다리는 시간)
    },
    "NET": {
        "BELL_WINDOW": 0.12,         # 거의 동시에 친 종을 모으는 시간 — 누른 시각이 빠른 사람이 이긴다
        "BELL_MAX_LAG": 0.35,        # 누른 시각이 도착 시각보다 이만큼까지 앞서도 인정(통신 지연 보정)
        "BELL_MAX_LEAD": 0.05,       # 시계 오차 허용
        "AWAY_TURN_TIME": 0.8,       # 연결이 끊긴 사람의 차례는 이 시간 뒤 자동으로 뒤집는다 *(임시 값)*
        "STALL_TIME": 5.0,           # 아무도 뒤집을 카드가 없는데 5개가 보이는 채로 이만큼 지나면 다시 모은다 *(임시 값)*
    },
    "AI": {
        "SAY_GAP": 3.0,              # 해설 대사 사이 최소 간격
        "BIG_POT": 10,               # 한 번에 이만큼 이상 가져가면 "크게 땄다" *(임시 값)*
        "LOW_CARDS": 3,              # 카드가 이만큼 이하로 줄면 "위험하다" *(임시 값)*
        "LAST_MINUTE": 60.0,         # 남은 시간이 이만큼일 때 "마지막 1분"
    },
}


def merge_config(override: dict | None) -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for section, values in (override or {}).items():
        if isinstance(values, dict) and isinstance(cfg.get(section), dict):
            cfg[section].update(values)
        else:
            cfg[section] = values
    return cfg
