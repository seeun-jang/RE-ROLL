"""잭팟 볼링 숫자 모음. 레인 · 던지기 값은 원본 js/config.js 그대로이다.

같은 값이 web/src/games/bowling/sim/rules.js 의 DEFAULT_CONFIG 에 있고 테스트가 비교한다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG = {
    "FRAMES": 5,               # 프레임 수 (원본은 3 · 5 · 10 중 선택) — 임시 값: 한 판 2~3분에 맞춰 5
    "JACKPOT_BONUS": 3,        # 금색 '잭팟 핀'을 쓰러뜨리면 +3점
    "JACKPOT_CHANCE": 0.25,    # 새로 세운 핀에 금색 핀이 섞여 있을 확률
    # 레인 (x = 가운데 0 기준 좌우, y = 파울 라인 0 에서 핀 쪽으로 +)
    "LANE": {
        "HALF": 20,            # 레인 반폭 (이보다 바깥 = 거터)
        "HEAD_Y": 54,          # 1번 핀까지 거리
        "PIN_GAP_X": 9,
        "PIN_GAP_Y": 7,
        "PIN_R": 2.2,
        "BALL_R": 3.2,
        "PIT_Y": 80,           # 이보다 멀리 가면 핀 구덩이로 사라짐
        "WALL": 25,            # 핀 데크 옆벽 (핀이 튕겨 나옴)
    },
    # 던지기
    "THROW": {
        "MOVE_SPEED": 0.45,    # 위치 옮기는 속도 (프레임당)
        "START_RANGE": 17,     # 출발 위치 좌우 한계
        "AIM_MAX": 0.2,        # 방향 화살표가 흔들리는 최대 기울기
        "AIM_SPEED": 0.045,    # 방향 화살표 흔들림 속도
        "POWER_PERIOD": 70,    # 힘 게이지가 한 번 오르내리는 프레임
        "SPEED_MIN": 1.0,
        "SPEED_MAX": 2.5,
        "SPIN_BUDGET": 0.5,    # 굴러가는 중 좌우로 휠 수 있는 총량
        "SPIN_ACCEL": 0.02,    # 한 프레임에 휘는 양
    },
    # 연출 길이 (프레임, 60분의 1초) — 서버가 "다음 투구를 언제부터 받을지" 계산하는 데 쓴다
    "FLOW": {
        "FPS": 60,
        "SETTLE_TIME": 50,     # 공이 들어간 뒤 핀이 멈추길 기다리는 최대 시간
        "SHOW_PLAIN": 50,      # 결과 표시: 아무 연출 없음
        "SHOW_JACKPOT": 80,    # 잭팟 핀만
        "SHOW_ANIM": 100,      # 스트라이크 · 스페어 · 스플릿 · 거터
        "SWEEP_TIME": 54,      # 스위퍼 한 번
        "SWEEP_MID": 26,       # 이때 핀을 치우거나 새로 세움
    },
    "RULES": {
        "INTRO_TIME": 3.0,     # 시작 안내 (원본 130프레임 ≈ 2.2초)
        "THROW_LIMIT": 10.0,   # 한 번 던지는 제한 시간(초) — 임시 값
        "GRACE": 1.5,          # 제한 시간 뒤 브라우저의 투구를 이만큼 더 기다렸다가 서버가 대신 던진다
        "AWAY_LIMIT": 1.5,     # 연결이 끊긴 사람은 이만큼만 기다리고 서버가 던진다 — 임시 값
        "EARLY": 0.5,          # 차례 시작보다 이만큼 일찍 온 투구까지 받는다
        "MAX_SPIN_FRAMES": 90, # 스핀 기록 최대 길이
        "FINAL_TIME": 8.0,     # 최종 결과 화면
        "STATE_HZ": 5,
        "SAY_GAP": 3.0,        # 해설 최소 간격(초)
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
