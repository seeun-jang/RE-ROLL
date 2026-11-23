"""잭팟 그루브 수치. 원본 js/config.js 값 그대로.

같은 값이 web/src/games/groove/config.js 에 있다 — 테스트가 비교한다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG = {
    # 판정 범위(초, ± 기준)
    "JUDGE": {"perfect": 0.045, "great": 0.09, "good": 0.135, "holdEndGrace": 0.12},
    # 판정별 점수 비율 ×100 (PERFECT 100%) — 정수로 계산해 브라우저와 결과가 똑같게 한다
    "JUDGE_WEIGHT100": {"perfect": 100, "great": 70, "good": 35, "miss": 0},
    # 총점 1,000,000 = 판정 점수 900,000 + 최대 콤보 보너스 100,000
    "SCORE_MAX": 1000000,
    "SCORE_COMBO_PART": 100000,
    # 등급(이 점수 이상)
    "GRADES": [["S", 950000], ["A", 880000], ["B", 750000], ["C", 600000], ["D", 0]],
    "FEVER_COMBO": 30,          # 이 콤보부터 피버(연출만)
    # 난이도: 노트가 떨어지는 시간(초)
    "DIFFICULTY": {
        "easy": {"label": "쉬움", "approach": 1.45},
        "normal": {"label": "보통", "approach": 1.15},
        "hard": {"label": "어려움", "approach": 0.9},
    },
    # ----- 파티 서버용으로 더한 값 -----
    "FLOW": {
        "INTRO_TIME": 5.0,          # 곡 소개 카드 (임시 값)
        "LEAD_EXTRA": 0.3,          # 카운트인 = 한 마디 + 이 값 (원본 그대로)
        "END_WAIT": 0.5,            # 마지막 노트 뒤 이만큼 지나면 피날레 (원본 그대로)
        "OUTRO_TIME": 170 / 60,     # FINISH! 연출 (원본 170프레임)
        "FINAL_TIME": 10.0,         # 최종 순위 화면 (임시 값)
    },
    "NET": {
        "MAX_LAG": 0.35,            # 이만큼 늦게 도착한 입력까지 누른 시각 그대로 판정
        "STATE_HZ": 10,
        "SAY_GAP": 3.0,             # 해설 사이 최소 간격(초)
    },
}

#: 서버가 고르는 난이도 (임시 값 — options["difficulty"] 로 바꿀 수 있다)
DEFAULT_DIFFICULTY = "normal"
#: 이 콤보에 닿으면 해설
COMBO_SAY = (50, 100)
#: 이 콤보 이상이 끊기면 해설
BREAK_SAY = 30


def merge_config(override: dict | None) -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for section, values in (override or {}).items():
        if isinstance(values, dict) and isinstance(cfg.get(section), dict):
            cfg[section].update(values)
        else:
            cfg[section] = values
    return cfg


def grade_of(score: int, cfg: dict = DEFAULT_CONFIG) -> str:
    for grade, low in cfg["GRADES"]:
        if score >= low:
            return grade
    return cfg["GRADES"][-1][0]
