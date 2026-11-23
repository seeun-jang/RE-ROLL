"""검도 수치. 거리 = 픽셀(320×180 화면 기준), 시간 = 틱(1/60초).

선수·판정 값은 원본 js/config.js 와 같다(브라우저는 원본 config.js 를 그대로 쓴다 — 테스트가 비교한다).
MATCH·FLOW 는 파티용으로 정한 값이다.
"""

from __future__ import annotations

import copy

LOGIC_FPS = 60

DEFAULT_CONFIG = {
    "WORLD_W": 400,
    "COURT_LEFT": 56,
    "COURT_RIGHT": 344,
    "COURT_CENTER": 200,
    "START_GAP": 34,
    "OUT_MARGIN": 3,
    "ANIM_TICKS": 6,
    "MOVE": {"ACCEL": 0.16, "MAX": 1.15, "FRICTION": 0.78, "BLOCK_MUL": 0.45, "KIAI_MUL": 0.85},
    "BODY_MIN_DIST": 16,
    "CLINCH_DIST": 23,
    "CLINCH_WAKARE_TICKS": 150,
    "STRIKES": {
        "men": {"name": "머리", "startup": 18, "recover": 18, "lunge": 12, "whiffExtra": 22,
                "contact": {"min": 22, "idealLo": 26, "idealHi": 32, "max": 37}},
        "kote": {"name": "손목", "startup": 13, "recover": 14, "lunge": 6, "whiffExtra": 18,
                 "contact": {"min": 24, "idealLo": 30, "idealHi": 36, "max": 40}},
        "do": {"name": "허리", "startup": 20, "recover": 20, "lunge": 8, "whiffExtra": 24,
               "contact": {"min": 20, "idealLo": 24, "idealHi": 30, "max": 34}},
    },
    "BLOCKED_EXTRA": 10,
    "DEFLECT_EXTRA": 12,
    "INPUT_BUFFER": 5,
    "KIAI": {"MAX": 100, "CHARGE": 1.1, "DECAY": 0.22, "REQUIRED": 45, "COST": 40, "TIMING_WINDOW": 20},
    "MOMENTUM": {
        "MAX": 100, "REGEN": 0.06, "SEME_GAIN": 0.05, "RETREAT_DRAIN": 0.12, "BLOCK_DRAIN": 0.03,
        "WHIFF": 14, "DEFLECTED": 10, "BLOCKED": 8, "PARRIED": 22, "GOT_HIT": 8,
        "BLOCK_GAIN": 4, "PARRY_GAIN": 14, "LOW": 30, "STUN_TICKS": 80, "STUN_RECOVER": 45,
    },
    "PARRY": {
        "WINDOW": 9, "STAGGER": 34, "COUNTER_TICKS": 40, "COUNTER_SPEED": 0.6, "COUNTER_LUNGE": 0.3,
        "MISS_COOLDOWN": 24, "MISS_MOMENTUM": 3,
    },
    "OPENINGS": {
        "idle": {"men": 0.30, "kote": 0.25, "do": 0.05},
        "forward": {"men": 0.45, "kote": 0.40, "do": 0.10},
        "backward": {"men": 0.20, "kote": 0.30, "do": 0.05},
        "windup_men": {"men": 0.50, "kote": 1.00, "do": 0.95},
        "windup_kote": {"men": 0.70, "kote": 0.40, "do": 0.50},
        "windup_do": {"men": 0.90, "kote": 0.60, "do": 0.30},
        "recover": {"men": 0.60, "kote": 0.60, "do": 0.70},
        "recover_bad": {"men": 0.85, "kote": 0.80, "do": 0.85},
        "block": {"men": 0.00, "kote": 0.10, "do": 0.95},
        "stagger": {"men": 1.00, "kote": 1.00, "do": 1.00},
        "stun": {"men": 1.00, "kote": 1.00, "do": 1.00},
        "frozen": {"men": 0.00, "kote": 0.00, "do": 0.00},
    },
    "DEFLECT_THRESHOLD": 0.15,
    "JUDGE": {
        "W_DIST": 0.25, "W_OPEN": 0.55, "W_KIAI": 0.20, "KIAI_BASE": 0.5, "COUNTER_BONUS": 0.10,
        "LOW_MOMENTUM_PENALTY": 0.06, "BACKWARD_PENALTY": 0.10, "DIST_EDGE_SCORE": 0.4, "WAVE_MIN": 0.35,
    },
    "ZANSHIN": {"TICKS": 30, "RETREAT_MAX": 10},
    "AIUCHI_TICKS": 8,
    "REFEREES": [
        {"name": "부심", "threshold": 0.64},
        {"name": "주심", "threshold": 0.62},
        {"name": "부심", "threshold": 0.68},
    ],
    "REF_NOISE": 0.04,
    "FX": {"HITSTOP_CONTACT": 3, "HITSTOP_CLASH": 4, "HITSTOP_IPPON": 16},
    # ── 아래는 파티용 값 (원본: 3분, 동점이면 연장전) ──
    "MATCH": {
        "TIME_SEC": 60,          # 한 경기 시간
        "POINTS_TO_WIN": 2,      # 먼저 두 판
        "HANSOKU_LIMIT": 2,      # 장외 반칙 2회 = 상대 한 판
        "HANTEI_NOISE": 0.3,     # 시간 종료 동점 때 심판 판정의 개인차
    },
    "FLOW": {
        "PRACTICE_TIME": 30.0,   # 시작 전 각자 AI 와 연습(순위에 들어가지 않음)
        "INTRO_TIME": 4.0,       # 라운드 대진 안내
        "END_HOLD": 1.0,         # 모든 경기가 끝난 뒤 잠깐 멈춤
        "RESULT_TIME": 4.0,      # 라운드 결과
        "FINAL_TIME": 8.0,       # 최종 결과
        "ROUNDS_FOR_TWO": 1,     # 2명일 때 경기 수
        "WIN_SCORE": 100,        # 순위 점수: 1승
        "IPPON_SCORE": 10,       # 순위 점수: 딴 한 판
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
