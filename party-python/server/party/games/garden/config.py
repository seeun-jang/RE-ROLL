"""가든 디펜스 수치. 좌표·속도는 논리 해상도 320×180 픽셀 기준(레인·좀비·권총 값은 원본 config.js 와 같다).

브라우저 쪽 시험용 진행기(web/src/games/garden/sim/rules.js)에 같은 값이 있다 — 테스트가 비교한다.
"""

from __future__ import annotations

import copy

DEFAULT_CONFIG = {
    "BASE": {"WIDTH": 320, "HEIGHT": 180, "LOGIC_FPS": 60},
    "LAYOUT": {"LANES": 5, "EXIT_X": 36, "SPAWN_X": 322, "PLAYER_X": 14, "MUZZLE_DX": 16},
    "RULES": {
        "DURATION": 120.0,      # 제한 시간(초)
        "INTRO_TIME": 5.0,      # 설명 화면
        "COUNTDOWN": 3.0,       # 3·2·1
        "END_DELAY": 2.0,       # TIME UP 연출
        "FINAL_TIME": 8.0,      # 결과 화면
    },
    # 사격만 남겼으므로 무기는 권총 하나(탄약 무한)
    "GUN": {"DAMAGE": 2, "FIRE_RATE": 5, "BULLET_SPEED": 280.0, "BULLET_W": 3},
    "SCORE": {
        "BREACH_PENALTY": 30,   # 좀비가 집에 닿으면 깎이는 점수(0점 아래로는 내려가지 않는다)   ← 임시 값
        "BOSS_BITE_EVERY": 3.0, # 보스가 문 앞에 서면 이 간격으로 계속 감점
        "HELMET_BREAK": 5,
    },
    "COMBO": {"WINDOW": 2.0, "STEP": 4, "MUL_PER_STEP": 0.5, "MAX_MUL": 4},
    "FX": {"KNOCKBACK": 2},
    "ENEMY_TYPES": ["normal", "runner", "helmet", "jumper", "boss"],
    "ENEMIES": {
        "normal": {"hp": 10, "speed": 9, "score": 10, "hitL": 4, "hitR": 13},
        "runner": {"hp": 5, "speed": 22, "score": 15, "hitL": 1, "hitR": 14},
        "helmet": {"hp": 10, "helmetHp": 14, "speed": 7, "score": 25, "hitL": 4, "hitR": 13},
        "jumper": {"hp": 8, "speed": 12, "score": 20, "hitL": 4, "hitR": 13},
        # 원본 보스 체력은 340(포탑·저격총 기준). 권총만으로 잡을 수 있게 낮췄다   ← 임시 값
        "boss": {"hp": 160, "speed": 4, "score": 500, "hitL": 5, "hitR": 26,
                 "summonInterval": 6.0, "summonCount": 2, "laneSwitchInterval": 9.0},
    },
    "BOSS_SPAWN_DELAY": 2.0,
    # 120초에 맞춘 웨이브 일정. 원본의 6개 웨이브 구성을 따르되, 포탑이 없으므로 앞쪽은 줄이고
    # 마지막으로 갈수록 권총 한 자루로는 다 막을 수 없게 몰려온다   ← 마릿수·시간은 임시 값
    "WAVES": [
        {"name": "WAVE 1", "start": 0.0, "duration": 14.0, "speedMul": 1.00, "hpMul": 1.0, "boss": False,
         "spawns": [["normal", 7]]},
        {"name": "WAVE 2", "start": 14.0, "duration": 17.0, "speedMul": 1.05, "hpMul": 1.1, "boss": False,
         "spawns": [["normal", 6], ["runner", 4]]},
        {"name": "WAVE 3", "start": 31.0, "duration": 19.0, "speedMul": 1.10, "hpMul": 1.2, "boss": False,
         "spawns": [["normal", 5], ["runner", 5], ["helmet", 2]]},
        {"name": "WAVE 4", "start": 50.0, "duration": 21.0, "speedMul": 1.15, "hpMul": 1.3, "boss": False,
         "spawns": [["normal", 5], ["runner", 6], ["helmet", 2], ["jumper", 3]]},
        {"name": "WAVE 5", "start": 71.0, "duration": 23.0, "speedMul": 1.20, "hpMul": 1.4, "boss": False,
         "spawns": [["normal", 7], ["runner", 8], ["helmet", 3], ["jumper", 5]]},
        {"name": "FINAL WAVE", "start": 94.0, "duration": 22.0, "speedMul": 1.50, "hpMul": 1.3, "boss": True,
         "spawns": [["normal", 10], ["runner", 14], ["helmet", 4], ["jumper", 6]]},
    ],
    "NET": {"STATE_HZ": 20},
}


def merge_config(override: dict | None) -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for section, values in (override or {}).items():
        if isinstance(values, dict) and isinstance(cfg.get(section), dict):
            cfg[section].update(values)
        else:
            cfg[section] = values
    return cfg
