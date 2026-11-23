"""잭팟 인형뽑기 수치. 기계 안 좌표는 유리 안쪽 기준(가로 0~58, 세로 0~86, 아래가 바닥), 시간은 60분의 1초(프레임) 단위.

원본 js/config.js 값을 그대로 옮겼다. 브라우저 쪽(web/src/games/claw/sim/config.js)에 같은 값이 있다 — 테스트가 비교한다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG = {
    "BASE": {"WIDTH": 320, "HEIGHT": 180, "LOGIC_FPS": 60},
    "COINS": 8,                 # 한 사람 코인(= 도전 횟수)
    "MOVE_TIME": 8 * 60,        # 집게 옮기는 제한 시간(프레임). 지나면 자동으로 내려간다
    # 기계 안(유리 안쪽)
    "BOX": {
        "W": 58, "H": 86,
        "HOLE_W": 15,           # 왼쪽 배출구 폭
        "WALL_TOP": 52,         # 배출구 칸막이 꼭대기 높이
        "RAIL_Y": 6,            # 집게가 매달린 높이
        "HOME_X": 7,            # 집게 대기 자리(배출구 위)
        "MAX_X": 52,
    },
    # 집게 (속도는 프레임당 픽셀)
    "CLAW": {
        "MOVE": 0.55, "DROP": 0.9, "LIFT": 0.8, "CARRY": 0.65,
        "CLOSE_TIME": 16, "OPEN_TIME": 16,
        "REACH": 3,             # 집게 끝에서 인형까지 이만큼 가까우면 집기 시도
    },
    # 집는 힘: 시도마다 다르다(가운데를 잘 집을수록 · 가벼울수록 안 미끄러진다)
    "GRIP_MIN": 0.15,
    "GRIP_MAX": 0.62,
    "GRAVITY": 0.18,
    # 인형 종류: r = 반지름, value = 점수, weight = 무게(무거울수록 잘 미끄러진다)
    "PRIZE_TYPES": ["bear", "cat", "duck", "tiger", "shiba", "dice", "chip", "gold"],
    "PRIZES": {
        "bear": {"r": 7, "value": 10, "weight": 1, "name": "곰"},
        "cat": {"r": 7, "value": 10, "weight": 1, "name": "고양이"},
        "duck": {"r": 7, "value": 10, "weight": 1, "name": "오리"},
        "tiger": {"r": 7, "value": 10, "weight": 1, "name": "호랑이"},
        "shiba": {"r": 7, "value": 10, "weight": 1, "name": "시바"},
        "dice": {"r": 6, "value": 15, "weight": 0.8, "name": "주사위"},
        "chip": {"r": 5, "value": 5, "weight": 0.85, "name": "칩"},
        "gold": {"r": 8.5, "value": 30, "weight": 2.3, "name": "황금곰"},
    },
    # 기계 하나에 들어가는 인형(모든 기계가 같은 배치)
    "LINEUP": ["bear", "cat", "duck", "tiger", "shiba", "bear", "tiger", "shiba", "dice", "dice", "chip", "chip", "gold"],
    "RULES": {
        "INTRO_TIME": 4.0,      # 설명 화면(초)   ← 임시 값(원본은 100프레임)
        "END_DELAY": 2.5,       # '영업 종료!' 연출(원본 150프레임). 이 동안 굴러가던 인형도 마저 센다
        "FINAL_TIME": 8.0,      # 최종 결과 화면(AI 총평을 기다리는 시간)
    },
    "SAY": {"MIN_GAP": 3.0, "PRIORITY_GAP": 1.0},   # 해설 최소 간격(초)
    "NET": {"STATE_HZ": 30},
}


def merge_config(override: dict | None) -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for section, values in (override or {}).items():
        if isinstance(values, dict) and isinstance(cfg.get(section), dict):
            cfg[section].update(values)
        else:
            cfg[section] = values
    return cfg
