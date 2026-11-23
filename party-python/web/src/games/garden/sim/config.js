// =============================================================
// 가든 디펜스 규칙 값 — 서버(server/party/games/garden/config.py)와 같은 내용. 테스트가 비교한다.
// 값을 바꿀 때는 서버 쪽 config.py 와 이 파일을 함께 바꾼다.
// =============================================================
export const DEFAULT_CONFIG = {
  "BASE": {
    "WIDTH": 320,
    "HEIGHT": 180,
    "LOGIC_FPS": 60
  },
  "LAYOUT": {
    "LANES": 5,
    "EXIT_X": 36,
    "SPAWN_X": 322,
    "PLAYER_X": 14,
    "MUZZLE_DX": 16
  },
  "RULES": {
    "DURATION": 120.0,
    "INTRO_TIME": 5.0,
    "COUNTDOWN": 3.0,
    "END_DELAY": 2.0,
    "FINAL_TIME": 8.0
  },
  "GUN": {
    "DAMAGE": 2,
    "FIRE_RATE": 5,
    "BULLET_SPEED": 280.0,
    "BULLET_W": 3
  },
  "SCORE": {
    "BREACH_PENALTY": 30,
    "BOSS_BITE_EVERY": 3.0,
    "HELMET_BREAK": 5
  },
  "COMBO": {
    "WINDOW": 2.0,
    "STEP": 4,
    "MUL_PER_STEP": 0.5,
    "MAX_MUL": 4
  },
  "FX": {
    "KNOCKBACK": 2
  },
  "ENEMY_TYPES": [
    "normal",
    "runner",
    "helmet",
    "jumper",
    "boss"
  ],
  "ENEMIES": {
    "normal": {
      "hp": 10,
      "speed": 9,
      "score": 10,
      "hitL": 4,
      "hitR": 13
    },
    "runner": {
      "hp": 5,
      "speed": 22,
      "score": 15,
      "hitL": 1,
      "hitR": 14
    },
    "helmet": {
      "hp": 10,
      "helmetHp": 14,
      "speed": 7,
      "score": 25,
      "hitL": 4,
      "hitR": 13
    },
    "jumper": {
      "hp": 8,
      "speed": 12,
      "score": 20,
      "hitL": 4,
      "hitR": 13
    },
    "boss": {
      "hp": 160,
      "speed": 4,
      "score": 500,
      "hitL": 5,
      "hitR": 26,
      "summonInterval": 6.0,
      "summonCount": 2,
      "laneSwitchInterval": 9.0
    }
  },
  "BOSS_SPAWN_DELAY": 2.0,
  "WAVES": [
    {
      "name": "WAVE 1",
      "start": 0.0,
      "duration": 14.0,
      "speedMul": 1.0,
      "hpMul": 1.0,
      "boss": false,
      "spawns": [
        [
          "normal",
          7
        ]
      ]
    },
    {
      "name": "WAVE 2",
      "start": 14.0,
      "duration": 17.0,
      "speedMul": 1.05,
      "hpMul": 1.1,
      "boss": false,
      "spawns": [
        [
          "normal",
          6
        ],
        [
          "runner",
          4
        ]
      ]
    },
    {
      "name": "WAVE 3",
      "start": 31.0,
      "duration": 19.0,
      "speedMul": 1.1,
      "hpMul": 1.2,
      "boss": false,
      "spawns": [
        [
          "normal",
          5
        ],
        [
          "runner",
          5
        ],
        [
          "helmet",
          2
        ]
      ]
    },
    {
      "name": "WAVE 4",
      "start": 50.0,
      "duration": 21.0,
      "speedMul": 1.15,
      "hpMul": 1.3,
      "boss": false,
      "spawns": [
        [
          "normal",
          5
        ],
        [
          "runner",
          6
        ],
        [
          "helmet",
          2
        ],
        [
          "jumper",
          3
        ]
      ]
    },
    {
      "name": "WAVE 5",
      "start": 71.0,
      "duration": 23.0,
      "speedMul": 1.2,
      "hpMul": 1.4,
      "boss": false,
      "spawns": [
        [
          "normal",
          7
        ],
        [
          "runner",
          8
        ],
        [
          "helmet",
          3
        ],
        [
          "jumper",
          5
        ]
      ]
    },
    {
      "name": "FINAL WAVE",
      "start": 94.0,
      "duration": 22.0,
      "speedMul": 1.5,
      "hpMul": 1.3,
      "boss": true,
      "spawns": [
        [
          "normal",
          10
        ],
        [
          "runner",
          14
        ],
        [
          "helmet",
          4
        ],
        [
          "jumper",
          6
        ]
      ]
    }
  ],
  "NET": {
    "STATE_HZ": 20
  }
};

export function mergeConfig(override) {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const [section, values] of Object.entries(override || {})) {
    if (values && typeof values === 'object' && !Array.isArray(values) && cfg[section] && !Array.isArray(cfg[section])) {
      Object.assign(cfg[section], values);
    } else cfg[section] = values;
  }
  return cfg;
}
