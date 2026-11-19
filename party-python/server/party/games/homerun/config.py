"""잭팟 홈런 더비 수치. 원본 js/config.js 값을 그대로 옮겼다(시간 단위 "프레임" = 1/60초).

브라우저 쪽(web/src/games/homerun/config.js 의 RULES)에 같은 값이 있다 — 테스트가 비교한다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG = {
    "FPS": 60,                # 원본 게임 로직 속도. 프레임 수 ÷ 60 = 초
    "CHANCES": 8,             # 타자 한 명의 기회 (볼을 골라내면 안 줄어듦)
    "GOLD_AT": 5,             # 몇 번째 스트라이크가 잭팟 볼인지 (0부터)
    "GOLD_MULT": 2,

    # 중계 화면 투영 (포수 뒤 카메라): 단위 m
    "CAM_BACK": 3,
    "FOCAL": 300,
    "MOUND": 18.4,
    "ZONE": {"HALF_W": 0.215, "LOW": 0.5, "HIGH": 1.1},   # 스트라이크 존

    # 배트 (노란 막대)
    "BAT_SPEED": 2.4,         # 한 프레임에 움직이는 px
    "BAT_RANGE": 34,          # 가운데에서 좌우로 갈 수 있는 px
    "SWING_TIME": 16,         # 스윙 동작 길이
    "SWING_CONTACT": 6,       # 스윙 시작 후 배트가 공 자리에 오는 프레임
    "HIT_DX": 14,             # 배트와 공이 이 px 안이면 맞음
    "HIT_DT": 11,             # 타이밍이 이 프레임 안이면 맞음
    "MITT_AFTER": 6,          # 공이 홈 플레이트를 지나 미트에 들어가기까지 프레임

    # 투구
    "WINDUP": 70,             # 와인드업 (공 나오기 전)
    "AFTER": 40,              # 공이 지나간 뒤 다음 공까지 쉬는 시간

    # 타구
    "GRAV": 9.8,
    "DRAG": 0.62,
    "EXIT_MIN": 26,           # 빗맞으면 m/s
    "EXIT_MAX": 53,           # 정타 m/s
    "FENCE_LINE": 98,         # 좌우 펜스 m
    "FENCE_CENTER": 122,      # 가운데 펜스 m
    "FIELDER_RUN": 5.6,       # 외야수 달리기 m/s
    "FLIGHT_SPEED": 2.2,      # 타구 화면 빨리감기 배율
    "FLIGHT_HOLD": 18,        # 맞는 순간 중계 화면에 머무는 프레임
    "FLIGHT_MIN": 50,         # 타구 화면 최소 길이
    "RESULT_TIME": 80,        # 타구 결과 글자
    "BASE_DIST": 27.43,       # 루 사이 거리 m
    "RUN_MPS": 7,             # 타자 달리기 m/s
    "THROW_MPS": 30,          # 내야 송구 m/s
    "FIELD_PAUSE": 10,        # 잡고 나서 던지기까지 프레임

    # 점수 (홈런 = 비거리 m)
    "POINTS": {"single": 10, "double": 20, "triple": 30},

    # ----- 파티 서버용으로 새로 정한 값 -----
    "FLOW": {
        "INTRO_TIME": 4.0,    # 설명 화면(초) (임시 값)
        "FINAL_TIME": 9.0,    # 최종 결과 화면(초) (임시 값)
        "END_PAD": 0.1,       # 타구 연출이 끝난 뒤 다음 공까지 여유(초)
    },
    "NET": {
        "MAX_LAG": 0.35,      # 이만큼 늦게 도착한 스윙까지 누른 시각 기준으로 판정
        "STATE_HZ": 2,
    },
    "AI": {
        "SAY_GAP": 3.0,       # 해설 대사 최소 간격(초)
        "MONSTER_DIST": 130,  # 이 비거리(m) 이상 홈런이면 "초대형 홈런" 대사 (임시 값)
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
