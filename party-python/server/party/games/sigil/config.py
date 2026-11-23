"""마법진 그리기 — 숫자 모음 (원본 js/config.js 값을 그대로 옮겼다).

원본은 60분의 1초(프레임) 단위였다. 여기서는 초 단위로 적는다(프레임 ÷ 60).
같은 값이 web/src/games/sigil/config.js 에 있고, 서버가 시작할 때 화면으로도 보낸다(client_options).
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG: dict = {
    # 종이
    "CANVAS": 120,            # 종이 크기 120x120 (모양은 60 기준 좌표를 2배로)
    "BRUSH": 2,               # 펜 굵기
    # 라운드: 난이도 묶음에서 마법진을 뽑고, 저주 슬롯머신이 저주 하나를 뽑는다
    "ROUNDS": [
        {"tier": "easy", "twists": ["none"], "mult": 1},                                 # 1. 연습 마법
        {"tier": "mid", "twists": ["mirror", "ghost", "shake", "speed"], "mult": 1},     # 2. 저주 라운드
        {"tier": "hard", "twists": ["memory", "mirror", "ghost", "shake"], "mult": 2},   # 3. 잭팟 라운드(점수 2배)
    ],
    # 저주 종류 (color 는 화면 팔레트 글자)
    "TWISTS": {
        "none": {"name": "정직한 마법", "desc": "흐릿한 선을 따라 그리기", "color": "e"},
        "memory": {"name": "기억 마법", "desc": "3초 뒤 안내선이 사라짐!", "color": "5"},
        "mirror": {"name": "거울 저주", "desc": "펜이 좌우 반대로 움직임!", "color": "h"},
        "ghost": {"name": "투명 잉크", "desc": "내가 그린 선이 안 보임!", "color": "k"},
        "shake": {"name": "흔들 종이", "desc": "종이가 이리저리 흔들림!", "color": "8"},
        "speed": {"name": "번개 마법", "desc": "단 5초! 빨리 보너스 2배", "color": "9"},
    },
    "DRAW_TIME": 10.0,        # 그리기 시간 10초 (원본 10*60 프레임)
    "SPEED_TIME": 5.0,        # 번개 마법: 5초
    "MEMORY_TIME": 3.0,       # 기억 마법: 처음 3초만 안내선을 보여 줌
    "SHAKE": {"X": 7, "Y": 6},  # 흔들 종이 흔들림 크기(픽셀)
    # 채점: 정확도 = 100 × 덮기 × (0.4 + 0.6 × 깔끔)
    #  일찍 끝내면 남은 초 × 2 (최대 +16, 번개 마법은 ×4) — 정확도 50 이상일 때만
    #  라운드 점수 = (정확도 + 보너스) × 배수
    "SCORE": {
        "COVER_RADIUS": 3,
        "NEAT_RADIUS": 3,
        "TIME_BONUS": 2,
        "BONUS_MAX": 16,
        "SUCCESS": 80,        # 이 이상이면 마법 발동!
        "OKAY": 50,           # 이 이상이면 그럭저럭, 아래는 펑!
    },
    # 진행 시간(초)
    "FLOW": {
        "INTRO_TIME": 3.0,          # 시작 안내 (임시 값)
        "SLOT_TIME": 170 / 60,      # 라운드 시작 슬롯머신 (원본 ROUND_INTRO 170프레임)
        "READY_TIME": 1.5,          # "준비…" — 원본의 '클릭하면 시작' 대신 (임시 값)
        "DONE_LOCK": 20 / 60,       # 그리기 시작 직후에는 '완료'를 받지 않는다 (원본 20프레임)
        "INK_GRACE": 0.35,          # 그리기 시간이 끝난 뒤 늦게 도착한 선을 받아 주는 시간 (통신 지연 보정)
        "SCORE_TIME": 100 / 60,     # 채점 연출 (원본 SCORE_SHOW 100프레임)
        "GALLERY_TIME": 8.0,        # 갤러리 — 원본 220프레임(3.7초). 모두의 그림과 AI 감상평을 읽을 시간이 필요해 늘렸다 (임시 값)
        "FINAL_TIME": 9.0,          # 최종 결과 화면
        "STATE_HZ": 5,              # 그리는 동안 상태를 보내는 횟수(초당)
    },
    # 입력 제한(잘못된 · 지나치게 많은 데이터 막기)
    "LIMITS": {
        "PACKET_POINTS": 400,       # 한 번에 받는 점 개수
        "ROUND_POINTS": 8000,       # 한 라운드에 한 사람이 보낼 수 있는 점 개수
    },
    # AI 감상평에 보낼 그림 크기 (회색조 PNG)
    "REVIEW_IMAGE": 96,
    "SAY_GAP": 3.0,                 # 해설 대사 최소 간격(초)
}


def merge_config(override: dict | None) -> dict:
    """기본값 위에 override 를 덮어쓴 새 설정(dict 안의 dict 까지)."""
    cfg = copy.deepcopy(DEFAULT_CONFIG)

    def merge(base: dict, extra: dict) -> None:
        for key, value in extra.items():
            if isinstance(value, dict) and isinstance(base.get(key), dict):
                merge(base[key], value)
            else:
                base[key] = value

    if isinstance(override, dict):
        merge(cfg, override)
    return cfg
