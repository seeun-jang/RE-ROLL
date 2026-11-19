"""과일자르기 수치. 좌표·속도는 논리 해상도 320×180 픽셀 기준(원본 web/src/config.js 와 같은 값).

브라우저 쪽 시험용 진행기(web/src/games/fruit/sim/rules.js)에 같은 값이 있다 — 테스트가 비교한다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG = {
    "VIEW": {"W": 320, "H": 180},
    "RULES": {
        "DURATION": 60.0,       # 제한 시간(초)
        "INTRO_TIME": 4.0,      # 설명 화면
        "COUNTDOWN": 3.0,       # 3·2·1
        "END_DELAY": 1.6,       # TIME UP 연출
        "FINAL_TIME": 8.0,      # 결과 화면
    },
    "SCORE": {
        "BOMB_PENALTY": 20,             # 폭탄을 베면 깎이는 점수(0점 아래로는 내려가지 않는다)
        "COMBO_MIN": 3,                 # 이 이상 연속으로 베면 콤보
        "COMBO_BONUS_PER_FRUIT": 5,     # 콤보 보너스 = 개수 × 이 값
        "COMBO_WINDOW": 0.32,           # 이 시간 안에 다음 과일을 베야 콤보 유지
        "ITEM_POINTS": 5,
        "MAX": 999999,
    },
    "PHYSICS": {
        "GRAVITY": 150.0,
        "SPAWN_Y": 198.0,
        "APEX_MIN_Y": 20.0, "APEX_MAX_Y": 74.0,
        "SPAWN_X_MIN": 36.0, "SPAWN_X_MAX": 284.0,
        "TARGET_X_MIN": 70.0, "TARGET_X_MAX": 250.0,
        "OFFSCREEN_MARGIN": 28.0,
    },
    "SPAWN": {
        "FIRST_WAVE": 0.6,
        "INTERVAL_START": 1.45, "INTERVAL_END": 0.72,
        "WAVE_MIN_START": 1, "WAVE_MAX_START": 2,
        "WAVE_MIN_END": 2, "WAVE_MAX_END": 5,
        "STAGGER": 0.13,
        "BOMB_CHANCE_START": 0.1, "BOMB_CHANCE_END": 0.3,
        "ITEM_CHANCE": 0.09,
        "ITEM_COOLDOWN": 8.0,
        "FIRST_ITEM_AFTER": 6.0,
        "FRENZY_MULTIPLIER": 3,
        "FRENZY_MAX": 9,
        "FRENZY_BOMB_SCALE": 0.35,
        "FRENZY_STAGGER": 0.6,
        "ITEM_VY_SCALE": 0.97,
    },
    "ITEMS": {
        "DOUBLE_TIME": 8.0, "DOUBLE_MULT": 2,
        "TRIPLE_TIME": 6.0,
        "ACTIVATE_DELAY": 0.14,
    },
    "BLADE": {"MIN_SLICE_SPEED": 60.0},
    "NET": {
        "MAX_LAG": 0.35,        # 이만큼 늦게 도착한 칼질까지 그 시각 기준으로 판정
        "HIT_TOLERANCE": 2.0,   # 브라우저 예측과의 미세한 차이를 흡수하는 여유(픽셀)
        "MAX_SEGS": 64,         # 한 번에 받는 선분 수
        "STATE_HZ": 5,
    },
    "FRUITS": [
        {"id": "apple", "points": 10, "radius": 8, "weight": 3},
        {"id": "orange", "points": 10, "radius": 8, "weight": 3},
        {"id": "lemon", "points": 10, "radius": 8, "weight": 2},
        {"id": "berry", "points": 15, "radius": 8, "weight": 2},
        {"id": "melon", "points": 20, "radius": 10, "weight": 1},
    ],
    "BOMB": {"id": "bomb", "radius": 7},
    "ITEM_DEFS": [
        {"id": "double", "radius": 9},
        {"id": "triple", "radius": 9},
    ],
}


def merge_config(override: dict | None) -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for section, values in (override or {}).items():
        if isinstance(values, dict) and isinstance(cfg.get(section), dict):
            cfg[section].update(values)
        else:
            cfg[section] = values
    return cfg
