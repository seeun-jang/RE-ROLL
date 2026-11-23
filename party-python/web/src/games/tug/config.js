// =============================================================
// 설정 — 게임의 모든 숫자 값은 여기서 관리한다.
// mount(canvas, { config }) 로 넘긴 값이 이 기본값을 덮어쓴다 (깊은 병합).
// =============================================================
import { PALETTE, C } from './palette.js';

export const DEFAULT_CONFIG = Object.freeze({
  // ---------- 화면 ----------
  WIDTH: 320,          // 기본 해상도 (가로)
  HEIGHT: 180,         // 기본 해상도 (세로)
  SCALE: 'auto',       // 정수배 확대. 'auto' = 부모/창 크기 안에 들어가는 최대 정수배 (넓은 화면이면 ×4 → 1280×720).
                       // 숫자(예: 4)면 그 배율로 고정. CSS 가 캔버스를 비정수배로 줄이지 않도록 항상 정수배 크기를 지정한다
  FPS: 60,             // 게임 로직 고정 스텝
  MAX_FRAME_STEPS: 5,  // 한 rAF 에서 따라잡을 최대 스텝 수 (탭 복귀 시 폭주 방지)

  // ---------- 진행 ----------
  ROUNDS: 3,           // 라운드 수
  ROUND_TIME: 30,      // 라운드 제한 시간 (초)
  COUNTDOWN: 3,        // 카운트다운 숫자 (3,2,1)
  TEAM_ASSIGN_TIME: 3.2,   // 팀 배정 연출 시간 (초) — Enter/클릭으로 건너뛰기 가능
  ROUND_RESULT_TIME: 4,    // 라운드 결과 화면 자동 진행 시간 (초)
  TITLE_ALL_READY_DELAY: 1.0, // 타이틀에서 5명 모두 준비되면 시작까지 대기 (초)
  AUTO_PAUSE_ON_BLUR: true,   // 창 포커스를 잃으면 플레이 중 자동 일시정지
  SHOW_RESTART: true,          // 최종 결과 화면에 '다시 하기' 버튼 표시

  // ---------- 팀 ----------
  SMALL_TEAM_MULT: 1.5,    // 인원이 적은 팀(2인)의 힘 보정 배율
  TEAM_NAMES: { left: '빨강 팀', right: '파랑 팀' },

  // ---------- 줄 (px 단위, 320×180 기준) ----------
  WIN_DISTANCE: 48,        // 중앙에서 진영 선까지 거리. 표식이 이 선을 넘으면 라운드 승리
  ROPE_SPEED: 10,          // (팀 힘 차이 1 당) 줄 이동 속도 px/s
  ROPE_MAX_SPEED: 30,      // 줄 최대 속도 px/s
  FORCE_DECAY: 2.5,        // 팀 힘의 지수 감쇠율 (1/s) — 연타를 멈추면 힘이 빠진다
  DRAW_EPSILON: 1,         // 시간 종료 시 |pos| 가 이 값 미만이면 무승부
  SLIP_SPEED: 8,           // 줄이 상대 쪽으로 이 속도 이상 끌려가면 '미끄러짐' 애니메이션

  // ---------- 박자 ----------
  BPM_MENU: 100,           // 메뉴 화면 배경음 템포
  BPM: 120,                // 플레이 기본 템포
  FEVER_BPM: 150,          // 피버 타임 템포 (템포 업)
  PERFECT_WINDOW: 0.06,    // ±초 안이면 Perfect
  GOOD_WINDOW: 0.13,       // ±초 안이면 Good (그 밖은 Miss)
  SPAM_MAX_PRESSES_PER_BEAT: 2, // 최근 1박 안에 이보다 많이 누르면 '헛힘'
  INPUT_OFFSET: 0,         // 입력 보정 (초). 양수면 누른 시각을 그만큼 앞으로 당겨 판정
  AUDIO_LATENCY_COMP: 'auto', // 오디오 출력 지연 보정 (초) 또는 'auto'

  // ---------- 힘 ----------
  POWER: { perfect: 1.0, good: 0.6, miss: 0.25, spam: 0.05 },

  // ---------- 피버 ----------
  FEVER_FIRST: 8,          // 라운드 시작 후 첫 피버 시작 시각 (초)
  FEVER_INTERVAL: 10,      // 피버 시작 간격 (초)
  FEVER_DURATION: 4,       // 피버 지속 시간 (초)
  FEVER_WARNING: 1,        // 피버 시작 몇 초 전부터 예고 표시
  FEVER_POWER_MULT: 2,     // 피버 중 박자 판정(Perfect/Good) 힘 배율
  FEVER_SCORE_MULT: 2,     // 피버 중 박자 판정 점수 배율

  // ---------- 점수 ----------
  SCORE: {
    perfect: 100,
    good: 50,
    miss: 0,
    spam: -10,         // 헛힘 감점
    comboStep: 5,      // 콤보 1당 추가 점수
    comboCap: 20,      // 콤보 보너스 상한 (콤보 20 이상은 동일)
    roundWin: 300,     // 라운드 승리 팀원 보너스
    roundDraw: 100,    // 무승부 시 전원 보너스
  },

  // ---------- 연출 ----------
  HITSTOP: 0.05,           // Perfect 히트 스톱 (초) — 시각 연출만 멈춘다 (박자·줄 물리는 계속)
  SHAKE_ROUND_END: { intensity: 4, duration: 0.45 },
  SHAKE_PERFECT: { intensity: 1, duration: 0.08 },
  TRANSITION_TIME: 0.6,    // 화면 전환 전체 시간 (초)
  CAMERA_FOLLOW: 0.35,     // 줄 위치에 카메라가 따라가는 비율 (패럴랙스)
  ANIMS: {                 // 애니메이션 프레임 수 / 속도 (8~12 FPS 느낌)
    idle: { frames: 4, fps: 8, loop: true },
    pull: { frames: 4, fps: 12, loop: false },  // 누를 때마다 처음부터 재생, 끝나면 0프레임(버티기) 유지
    slip: { frames: 3, fps: 10, loop: true },
    win:  { frames: 4, fps: 8, loop: true },
    fall: { frames: 3, fps: 10, loop: false },
  },

  // ---------- 배치 (px) ----------
  LAYOUT: {
    CENTER_X: 160,
    GROUND_Y: 132,        // 캐릭터 발 위치 (스프라이트 하단)
    ROPE_Y: 117,          // 줄 높이 (손 위치 = 스프라이트 17번째 행)
    FRONT_OFFSET: 26,     // 중앙에서 맨 앞 선수까지 거리
    PLAYER_SPACING: 20,   // 선수 간 간격
    TOP_BAR_H: 22,        // 상단 HUD 높이
    BEAT_LANE_Y: 25,      // 박자 레인 y
    PANEL_Y: 142,         // 하단 플레이어 패널 y
    PANEL_W: 64,
    PANEL_H: 38,
  },

  // ---------- 조작 ----------
  PAUSE_KEY: 'Escape',
  MUTE_KEY: 'KeyM',
  START_KEY: 'Enter',

  // ---------- 폰트 (Galmuri, SIL OFL 1.1) ----------
  FONT_CSS_URL: 'https://cdn.jsdelivr.net/npm/galmuri@2.40.2/dist/galmuri.css',
  FONTS: {
    s: { family: 'Galmuri7', size: 8 },
    m: { family: 'Galmuri9', size: 10 },
    l: { family: 'Galmuri11', size: 12 },
    xl: { family: 'Galmuri14', size: 15 },
  },
  FONT_FALLBACK: 'monospace',
  FONT_LOAD_TIMEOUT: 2500, // ms. 폰트 로딩이 늦으면 대체 폰트로 진행

  // ---------- 사운드 ----------
  MASTER_VOLUME: 0.5,
  MUSIC_VOLUME: 0.35,
  SFX_VOLUME: 0.6,
  START_MUTED: false,

  DEBUG: false,
});

/** 기본 플레이어 5명 (키는 KeyboardEvent.code — 한글 입력기 상태와 무관하게 동작) */
export const DEFAULT_PLAYERS = Object.freeze([
  { id: 'p1', name: 'P1', color: PALETTE[C.ORANGE], hair: PALETTE[C.PLUM], key: 'KeyQ', keyLabel: 'Q' },
  { id: 'p2', name: 'P2', color: PALETTE[C.GREEN], hair: PALETTE[C.CHARCOAL], key: 'KeyR', keyLabel: 'R' },
  { id: 'p3', name: 'P3', color: PALETTE[C.YELLOW], hair: PALETTE[C.INK], key: 'KeyU', keyLabel: 'U' },
  { id: 'p4', name: 'P4', color: PALETTE[C.CYAN], hair: PALETTE[C.SLATE], key: 'KeyP', keyLabel: 'P' },
  { id: 'p5', name: 'P5', color: PALETTE[C.WHITE], hair: PALETTE[C.TEAL], key: 'Space', keyLabel: 'SPC' },
]);

export const PLAYER_COUNT = 5;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 깊은 병합 (배열은 통째로 교체) */
function deepMerge(base, over) {
  const out = {};
  for (const k of Object.keys(base)) out[k] = isPlainObject(base[k]) ? deepMerge(base[k], {}) : base[k];
  if (!isPlainObject(over)) return out;
  for (const k of Object.keys(over)) {
    if (over[k] === undefined) continue;
    out[k] = isPlainObject(base[k]) && isPlainObject(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

/** 사용자 설정을 기본 설정에 병합 (원본은 바뀌지 않는다) */
export function mergeConfig(userConfig = {}) {
  return deepMerge(DEFAULT_CONFIG, userConfig);
}

/** 키 코드 → 화면에 보일 짧은 라벨 */
export function labelForCode(code) {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6);
  const map = {
    Space: 'SPC', Enter: 'ENT', ShiftLeft: 'LSH', ShiftRight: 'RSH', ControlLeft: 'LCT', ControlRight: 'RCT',
    AltLeft: 'LAL', AltRight: 'RAL', ArrowLeft: '<', ArrowRight: '>', ArrowUp: '^', ArrowDown: 'V',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Minus: '-', Equal: '=', Backslash: '\\', Backquote: '`', Tab: 'TAB',
  };
  return map[code] || code.slice(0, 3).toUpperCase();
}

/** 자주 쓰는 CSS 색 이름 (DOM 이 없는 환경에서도 해석되도록) */
const NAMED_COLORS = Object.freeze({
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff',
  orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', hotpink: '#ff69b4', brown: '#a52a2a',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', navy: '#000080', teal: '#008080', olive: '#808000',
  maroon: '#800000', gold: '#ffd700', skyblue: '#87ceeb', violet: '#ee82ee', indigo: '#4b0082',
  coral: '#ff7f50', salmon: '#fa8072', tomato: '#ff6347', crimson: '#dc143c', turquoise: '#40e0d0',
  beige: '#f5f5dc', khaki: '#f0e68c', tan: '#d2b48c', chocolate: '#d2691e', orchid: '#da70d6',
  lavender: '#e6e6fa', mint: '#98ff98', darkgreen: '#006400', darkblue: '#00008b', darkred: '#8b0000',
  lightblue: '#add8e6', lightgreen: '#90ee90', royalblue: '#4169e1', steelblue: '#4682b4',
  forestgreen: '#228b22', limegreen: '#32cd32', deepskyblue: '#00bfff', dodgerblue: '#1e90ff',
});

const byteHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** 'rgb(255, 0, 0)' / 'rgba(255 0 0 / 50%)' / 퍼센트 값 → '#rrggbb' (해석 실패면 null) */
function parseRgbFunc(s) {
  const m = /^rgba?\(\s*([^)]*)\)$/i.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  if (parts.length < 3) return null;
  const vals = parts.map((v) => (v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v)));
  if (!vals.every(Number.isFinite)) return null;
  return '#' + vals.map(byteHex).join('');
}

/** '#rgb' '#rgba' '#rrggbb' '#rrggbbaa' ('#' 생략 허용) → '#rrggbb' (해석 실패면 null). 알파는 버린다 */
function parseHexColor(s) {
  const hasHash = s.startsWith('#');
  let h = hasHash ? s.slice(1) : s;
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  if (!hasHash && h.length !== 6) return null; // '#' 없이는 6자리만 (짧은 영단어와 헷갈리지 않게)
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  else if (h.length === 8) h = h.slice(0, 6);
  else if (h.length !== 6) return null;
  return '#' + h.toLowerCase();
}

/**
 * 외부에서 받은 색 값 → '#rrggbb'. 해석할 수 없으면 fallback.
 * - 숫자(0xff0000), hex 문자열, rgb()/rgba(), 흔한 색 이름은 직접 해석
 * - 그 밖의 CSS 색(hsl(), 드문 색 이름 등)은 브라우저면 캔버스 fillStyle 정규화로 해석 (함수 안에서만 DOM 접근)
 */
function normalizeColor(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return '#' + (Math.max(0, Math.min(0xffffff, Math.floor(value)))).toString(16).padStart(6, '0');
  }
  if (typeof value !== 'string') return fallback;
  const s = value.trim().toLowerCase();
  if (!s) return fallback;
  const named = Object.prototype.hasOwnProperty.call(NAMED_COLORS, s) ? NAMED_COLORS[s] : null;
  const direct = named || parseHexColor(s) || parseRgbFunc(s) || null;
  if (direct) return direct;
  // 브라우저: 캔버스에 넣었다 빼서 정규화. 서로 다른 두 기준색으로 확인해야 '무효 값(기준색 유지)'을 구별할 수 있다
  if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillStyle = s;
        const a = String(ctx.fillStyle);
        ctx.fillStyle = '#ffffff';
        ctx.fillStyle = s;
        const b = String(ctx.fillStyle);
        if (a === b) {
          const norm = a.trim().toLowerCase();
          const out = parseHexColor(norm) || parseRgbFunc(norm);
          if (out) return out;
        }
      }
    } catch (e) {
      // 정규화 실패 → 기본색
    }
  }
  return fallback;
}

/**
 * 외부에서 받은 플레이어 정보를 정리한다.
 * - 빠진 필드는 같은 순번의 기본값으로 채운다.
 * - 기본(단독 실행): 5명보다 적으면 기본 플레이어로 채우고, 많으면 앞의 5명만 쓴다.
 * - exact: true (멀티플레이): 받은 인원 그대로(최대 5명) 쓴다. key 가 null 이면 '이 화면에서 조작하지 않는 선수'.
 * - id 가 겹치면 'p{순번}' 으로 바꾼다.
 */
export function resolvePlayers(players, { exact = false } = {}) {
  const list = Array.isArray(players) ? players : [];
  const used = new Set();
  const out = [];
  const count = exact ? Math.max(1, Math.min(PLAYER_COUNT, list.length)) : PLAYER_COUNT;
  for (let i = 0; i < count; i++) {
    const def = DEFAULT_PLAYERS[i];
    const p = isPlainObject(list[i]) ? list[i] : {};
    let id = p.playerId ?? p.id ?? def.id;
    id = String(id);
    if (used.has(id)) id = `p${i + 1}`;
    used.add(id);
    const noKey = exact && p.key === null;
    const key = noKey ? null : (p.key || def.key);
    out.push({
      id,
      name: p.name ? String(p.name) : def.name,
      // 외부 색은 'red', 'rgb(…)', 0xff0000 등 무엇이 와도 '#rrggbb' 로 정리 (스프라이트·그림자 계산은 hex 만 받는다)
      color: normalizeColor(p.color, def.color),
      hair: normalizeColor(p.hair, def.hair),
      key,
      keyLabel: noKey ? null : (p.keyLabel || (p.key ? labelForCode(p.key) : def.keyLabel)),
      isMe: !!p.isMe,
      animal: typeof p.animal === 'string' ? p.animal : null,
    });
  }
  return out;
}
