// =============================================================
// 레이싱 규칙 값 — 서버(server/party/games/racing/config.py)와 같은 내용. 테스트가 비교한다.
// 값을 바꿀 때는 서버 쪽 config.py 와 이 파일을 함께 바꾼다.
// =============================================================
export const DEFAULT_CONFIG = {
  "WORLD": {
    "W": 1040,
    "H": 640
  },
  "TRACK": {
    "POINTS": [
      [
        320,
        592
      ],
      [
        560,
        592
      ],
      [
        800,
        586
      ],
      [
        935,
        522
      ],
      [
        970,
        390
      ],
      [
        940,
        255
      ],
      [
        960,
        130
      ],
      [
        880,
        70
      ],
      [
        740,
        74
      ],
      [
        640,
        135
      ],
      [
        650,
        245
      ],
      [
        740,
        335
      ],
      [
        700,
        440
      ],
      [
        570,
        450
      ],
      [
        480,
        365
      ],
      [
        470,
        235
      ],
      [
        400,
        112
      ],
      [
        270,
        66
      ],
      [
        130,
        100
      ],
      [
        72,
        210
      ],
      [
        110,
        315
      ],
      [
        225,
        345
      ],
      [
        305,
        390
      ],
      [
        318,
        445
      ],
      [
        268,
        486
      ],
      [
        175,
        486
      ],
      [
        100,
        500
      ],
      [
        64,
        548
      ],
      [
        104,
        592
      ],
      [
        205,
        598
      ]
    ],
    "SAMPLES_PER_POINT": 14,
    "HALF_WIDTH": 30,
    "WALL_MARGIN": 6,
    "SEARCH": 10
  },
  "CAR": {
    "ACCEL": 160.0,
    "MAX_SPEED": 160.0,
    "REVERSE_RATIO": 0.4,
    "DRAG": 0.55,
    "GRIP_NORMAL": 13.0,
    "GRIP_DRIFT": 2.2,
    "TURN_BASE": 2.5,
    "TURN_DRIFT": 1.7,
    "TURN_SPEED_REF": 40.0,
    "WALL_KEEP": 0.72,
    "WALL_EVENT_SPEED": 25.0,
    "SKID_SPEED": 26.0,
    "GRID_SPACING": 10.0,
    "GRID_BACK": 1.5
  },
  "RULES": {
    "LAPS": 3,
    "INTRO_TIME": 8.0,
    "COUNTDOWN": 3.0,
    "FINISH_GRACE": 30.0,
    "MAX_TIME": 180.0,
    "END_DELAY": 2.5,
    "FINAL_TIME": 8.0,
    "RANK_SCORES": [
      100,
      70,
      50,
      30,
      10
    ]
  },
  "NET": {
    "STATE_HZ": 30
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
