"""실거리 사격 수치. 원본 js/config.js 값을 그대로 옮겼다(좌표는 사로 한 칸 64×96 기준, 시간은 60분의 1초 = 1프레임).

브라우저 쪽 시험용 진행기(web/src/games/livefire/sim/rules.js)에 같은 값이 있다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG = {
    "FPS": 60,                # 서버가 사로를 진행하는 단위(초당 프레임)

    "TARGETS": 20,            # 표적 수 (= 실탄 20발)
    "MAG_SIZE": 10,           # 탄알집 1개 = 10발 (10발 쏘면 탄알집 교체)
    "RELOAD_TIME": 80,        # 탄알집 교체 시간(프레임)

    # 거리별 표적: y = 표적 발 위치(사로 칸 기준), w·h = 크기, time = 서 있는 시간(프레임), slots = 좌우 위치 후보
    "DISTANCES": {
        100: {"y": 68, "w": 13, "h": 20, "time": 170, "slots": [-12, 0, 12]},
        200: {"y": 44, "w": 9, "h": 13, "time": 200, "slots": [-11, 1, 11]},
        250: {"y": 28, "w": 7, "h": 10, "time": 230, "slots": [-9, 0, 9]},
    },
    "COUNTS": {100: 7, 200: 7, 250: 6},   # 거리별 표적 수 (합 20)
    "LATE_TIME_MUL": 0.85,    # 뒤쪽 절반은 서 있는 시간이 짧아진다
    "TARGET_GAP": 36,         # 표적이 내려가고 다음 표적까지
    "RISE_TIME": 10,          # 표적이 올라오는/넘어가는 시간
    "EARLY_DROP": 25,         # 모두 맞혔으면(또는 탄이 없으면) 이만큼만 서 있다가 내려간다

    # 조준 (사로 칸 안 좌표) — 방향키로 움직이고, 놓으면 그 자리에 멈춤
    "AIM_START_Y": 60,
    "AIM_TOP_Y": 12,
    "AIM_BOTTOM_Y": 78,
    "AIM_SPEED_X": 0.6,       # px/프레임
    "AIM_SPEED_Y": 0.7,
    "AIM_RANGE": 27,          # 좌우 한계
    "SWAY": 1.8,              # 호흡에 따른 흔들림 크기
    "STEADY_TIME": 40,        # 조준점을 이만큼 가만히 두면 숨이 골라져서 흔들림이 줄어든다
    "STEADY_SWAY": 0.55,
    "RECOIL": 7,              # 반동
    "KICK_DECAY": 0.82,       # 반동이 프레임마다 줄어드는 비율
    "FIRE_COOLDOWN": 18,      # 연속 격발 최소 간격

    # 점수: 명중 1발 10점 + 빨리 맞힐수록 보너스(표적이 다 올라온 뒤 0.5초마다 1점씩 줄어듦, 최대 5)
    "HIT_POINTS": 10,
    "QUICK_MAX": 5,
    "QUICK_STEP": 30,

    # 사격 등급 (명중 수 기준). color 는 화면 팔레트 글자
    "GRADES": [
        {"min": 18, "name": "특등사수", "color": "9"},
        {"min": 15, "name": "1급", "color": "e"},
        {"min": 12, "name": "2급", "color": "h"},
        {"min": 10, "name": "3급", "color": "k"},
        {"min": 0, "name": "불합격", "color": "5"},
    ],

    # 통제관 방송 대본(원본 BRIEF / CEASE): [프레임, 대사]
    "BRIEF": [[0, "사수 준비!"], [80, "탄알집 결합!"], [160, "조정간 단발!"], [240, "준비된 사수부터 사격 개시!"]],
    "BRIEF_END": 300,
    "HALF_LINE": "탄알집 교체 후 계속 사격!",
    "CEASE": [[0, "사격 끝! 사격 끝!"], [90, "조정간 안전! 탄알집 제거!"]],
    "CEASE_END": 230,
    "GRADE_AT": 140,          # 사격 끝 뒤 이 프레임부터 사로마다 등급 발표

    "FINAL_TIME": 8.0,        # 최종 순위 화면(초)   ← 임시 값 (다른 게임의 결과 화면 길이에 맞춤)
    "STATE_HZ": 30,           # 상태를 보내는 횟수(초당)

    # AI 해설(통제관 호랑대장)
    "SAY_GAP": 3.0,           # 해설 한 줄 뒤 다음 해설까지 최소 간격(초)
    "SCRIPT_GAP": 2.0,        # 대본 방송 뒤 해설을 참는 시간(초)
}

# 누르고 있는 조준 키(비트)
LEFT, RIGHT, UP, DOWN = 1, 2, 4, 8


def merge_config(override: dict | None) -> dict:
    """기본 값에 override(테스트·옵션)를 덮어쓴다."""
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for key, value in (override or {}).items():
        cfg[key] = value
    # JSON 으로 온 설정은 거리 키가 문자열이므로 숫자로 맞춘다
    cfg["DISTANCES"] = {int(k): v for k, v in cfg["DISTANCES"].items()}
    cfg["COUNTS"] = {int(k): v for k, v in cfg["COUNTS"].items()}
    return cfg
