"""레이싱 수치. 거리 = 픽셀(화면 320×180 기준의 월드 좌표), 시간 = 초.

차의 움직임(가속·접지력·조향)은 원본 index.html 의 식을 그대로 쓰고, 화면 크기에 맞춰 속도만 줄였다.
브라우저 쪽(web/src/games/racing/sim/config.js)에 같은 값이 있다 — 테스트가 비교한다.
"""

from __future__ import annotations

import copy

LOGIC_FPS = 60

DEFAULT_CONFIG = {
    "WORLD": {"W": 1040, "H": 640},
    # 트랙: 가운데 선을 지나는 점들(닫힌 고리, 시계 방향). 점 사이를 부드러운 곡선으로 잇는다.
    # 첫 점이 출발·결승선이다.   ← 맵 모양은 임시로 그린 것
    "TRACK": {
        "POINTS": [
            [320, 592], [560, 592], [800, 586], [935, 522], [970, 390], [940, 255], [960, 130], [880, 70],
            [740, 74], [640, 135], [650, 245], [740, 335], [700, 440], [570, 450], [480, 365], [470, 235],
            [400, 112], [270, 66], [130, 100], [72, 210], [110, 315], [225, 345], [305, 390], [318, 445],
            [268, 486], [175, 486], [100, 500], [64, 548], [104, 592], [205, 598],
        ],
        "SAMPLES_PER_POINT": 14,   # 점 사이를 나누는 개수
        "HALF_WIDTH": 30,          # 도로 폭의 절반
        "WALL_MARGIN": 6,          # 차 중심이 도로 가장자리에서 이만큼 안쪽까지만 갈 수 있다(잔디 = 보이지 않는 벽)
        "SEARCH": 10,              # 차 주변에서 가장 가까운 구간을 찾는 범위(구간 수)
    },
    "CAR": {
        "ACCEL": 160.0, "MAX_SPEED": 160.0, "REVERSE_RATIO": 0.4, "DRAG": 0.55,
        "GRIP_NORMAL": 13.0, "GRIP_DRIFT": 2.2,       # 옆으로 미끄러지지 않으려는 힘(클수록 안 미끄러짐)
        "TURN_BASE": 2.5, "TURN_DRIFT": 1.7,          # 조향 속도(rad/s)
        "TURN_SPEED_REF": 40.0,                       # 이 속도 이상이면 조향이 다 먹는다
        "WALL_KEEP": 0.72,                            # 벽에 닿았을 때 남는 속도 비율
        "WALL_EVENT_SPEED": 25.0,                     # 이보다 세게 부딪히면 "쿵"
        "SKID_SPEED": 26.0,                           # 옆 미끄러짐이 이보다 크면 타이어 자국
        "GRID_SPACING": 10.0,                         # 출발선에서 차 사이 간격(도로 폭 방향)
        "GRID_BACK": 1.5,                             # 출발선 뒤로 물러선 거리(구간 수)
    },
    "RULES": {
        "LAPS": 3,
        "INTRO_TIME": 8.0,          # 설명 + 손 기준 잡기
        "COUNTDOWN": 3.0,
        "FINISH_GRACE": 30.0,       # 1등이 들어온 뒤 나머지가 달릴 수 있는 시간
        "MAX_TIME": 180.0,          # 아무도 못 들어와도 이 시간이 지나면 끝   ← 임시 값
        "END_DELAY": 2.5,
        "FINAL_TIME": 8.0,
        "RANK_SCORES": [100, 70, 50, 30, 10],   # 순위별 점수   ← 임시 값
    },
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
