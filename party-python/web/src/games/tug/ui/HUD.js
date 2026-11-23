// =============================================================
// HUD — 그리기 전용 함수 모음 (상태 없음). 320×180 버퍼 기준, 모든 좌표 정수.
// 상단 바(라운드·줄 게이지·시간) / 음소거 버튼 / 박자 레인 / 하단 플레이어 패널 /
// 판정 팝업 / 피버 배너 / 가운데 배너 / 머리 위 라벨.
// =============================================================
import { PALETTE, C, TEAM_COLORS, shadeOf } from '../palette.js';
import { DEFAULT_CONFIG } from '../config.js';
import { drawBitmapText, measureBitmapText } from './PixelFont.js';

const INK = PALETTE[C.INK];
const PLUM = PALETTE[C.PLUM];
const RED = PALETTE[C.RED];
const ORANGE = PALETTE[C.ORANGE];
const YELLOW = PALETTE[C.YELLOW];
const NAVY = PALETTE[C.NAVY];
const BLUE = PALETTE[C.BLUE];
const SKY = PALETTE[C.SKY];
const CYAN = PALETTE[C.CYAN];
const WHITE = PALETTE[C.WHITE];
const SILVER = PALETTE[C.SILVER];
const SLATE = PALETTE[C.SLATE];
const CHARCOAL = PALETTE[C.CHARCOAL];

// ---------- 상단 바 ----------
const ROUND_BOX = Object.freeze({ x: 2, y: 1, w: 60, h: 19 });   // 왼쪽 'ROUND 1/3' 박스
const TIMER_BOX = Object.freeze({ x: 264, y: 1, w: 38, h: 19 }); // 오른쪽 남은 시간 박스 (음소거 버튼 305~317 비움)
const GAUGE_FRAME_HALF = 63;    // 게이지 테두리 박스 반폭 (중앙 기준)
const GAUGE_TRACK_HALF = 59;    // 게이지 트랙 반폭 (트랙 폭 = 119px)
const GAUGE_TRACK_Y = 7;        // 트랙 윗변 y
const GAUGE_TRACK_H = 7;        // 트랙 높이 (외곽 포함)
const GAUGE_WIN_PX = 46;        // 중앙 ~ 진영 선(승리선) 까지 게이지 위 px
const GAUGE_OVERSHOOT = 1.2;    // 표식이 승리선 너머로 갈 수 있는 최대 비율
const LOW_TIME = 5;             // 이 초 이하이면 시간 표시가 빨갛게 깜빡임

// ---------- 음소거 버튼 ----------
export const MUTE_BUTTON_RECT = Object.freeze({ x: 305, y: 3, w: 13, h: 13 });

// ---------- 박자 레인 ----------
const LANE_BEATS = 3;           // 앞으로 보여줄 박 수
const NOTE_SPACING = 17;        // 1박 당 노트 이동 거리 (px)
const LANE_H = 13;              // 레인 높이
const TARGET_SIZE = 11;         // 가운데 목표 칸 크기

// ---------- 하단 패널 ----------
const GRADE_SHOW = 0.9;         // 패널의 최근 판정 글자 표시 시간 (초)
const GRADE_BLINK_FROM = 0.55;  // 이 시각 이후 깜빡이며 사라짐

// ---------- 판정 팝업 ----------
const POP_LIFE = 0.6;           // 팝업 수명 (초)
const POP_RISE = 8;             // 떠오르는 높이 (px)
const POP_BLINK_FROM = 0.4;     // 이 시각 이후 깜빡임

// ---------- 피버 배너 ----------
const FEVER_BANNER_Y = 40;      // 박자 레인 아래

/** 판정 등급 → 표시 글자/색 */
const GRADE_STYLE = Object.freeze({
  perfect: Object.freeze({ word: 'PERFECT', color: YELLOW, panel: YELLOW }),
  good: Object.freeze({ word: 'GOOD', color: SKY, panel: CYAN }),
  miss: Object.freeze({ word: 'MISS', color: SILVER, panel: SILVER }),
  spam: Object.freeze({ word: '헛힘', color: RED, panel: ORANGE }),
});

// ---------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------

/** UI 가 가진 config (없으면 기본값 — 대체용) */
function cfgOf(ui) {
  return (ui && ui.config && ui.config.LAYOUT) ? ui.config : DEFAULT_CONFIG;
}

function screenW(ui) {
  return Math.round(cfgOf(ui).WIDTH || 320);
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function rect(g, color, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** 1px 사각 테두리 (fillRect 4번) */
function ring(g, color, x, y, w, h) {
  rect(g, color, x, y, w, 1);
  rect(g, color, x, y + h - 1, w, 1);
  rect(g, color, x, y + 1, 1, h - 2);
  rect(g, color, x + w - 1, y + 1, 1, h - 2);
}

/** 체커보드 디더 (반투명 대신) */
function dither(g, color, x, y, w, h, parity = 0) {
  g.fillStyle = color;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = (yy + parity) & 1; xx < w; xx += 2) g.fillRect(x + xx, y + yy, 1, 1);
  }
}

/** 머리 위 이름표에 쓸 이름의 최대 폭(px). 선수들이 붙어 서므로 길면 자른다. */
const HEAD_NAME_MAX_W = 38;

/** 비트맵 글꼴(영문 대문자·숫자)만으로 쓸 수 있는 글인지 — 'P1' 같은 기본 라벨 */
function isBitmapText(str) {
  return /^[A-Z0-9 ]*$/.test(String(str ?? ''));
}

/** 글자를 maxW 안에 들어가게 자르기 (넘치면 뒤를 자르고 '.' 붙임) */
function fitText(ui, str, size, maxW) {
  const s = String(str ?? '');
  if (maxW <= 0 || s.length === 0) return '';
  if (ui.measure(s, size) <= maxW) return s;
  const chars = Array.from(s);
  while (chars.length > 0) {
    chars.pop();
    const t = chars.join('') + '.';
    if (ui.measure(t, size) <= maxW) return t;
  }
  return '';
}

/** 작은 불꽃 하나 (아래 기준 baseY, 왼쪽 x, 폭 3). phase 로 높이가 흔들린다 */
function drawFlame(g, x, baseY, t, phase) {
  const h = 3 + ((Math.floor(t * 12) + phase) % 3);
  const top = baseY - h;
  rect(g, RED, x + 1, top, 1, 1);
  rect(g, RED, x, top + 1, 3, h - 1);
  rect(g, ORANGE, x + 1, top + 2, 1, h - 2);
  rect(g, YELLOW, x + 1, baseY - 2, 1, 2);
}

/** 팔레트에 없는 경우를 대비한 스피커 아이콘 대체 그림 (7×7) */
function drawSpeakerFallback(g, x, y, muted) {
  rect(g, WHITE, x, y + 2, 2, 3);
  rect(g, WHITE, x + 2, y + 1, 1, 5);
  rect(g, WHITE, x + 3, y, 1, 7);
  if (muted) {
    rect(g, RED, x + 5, y + 2, 1, 1);
    rect(g, RED, x + 6, y + 3, 1, 1);
    rect(g, RED, x + 5, y + 4, 1, 1);
    rect(g, RED, x + 7, y + 2, 1, 1);
    rect(g, RED, x + 7, y + 4, 1, 1);
  } else {
    rect(g, WHITE, x + 5, y + 2, 1, 3);
    rect(g, WHITE, x + 6, y + 1, 1, 1);
    rect(g, WHITE, x + 6, y + 5, 1, 1);
  }
}

// ---------------------------------------------------------
// 상단 바
// ---------------------------------------------------------

/**
 * 상단 바: 왼쪽 라운드 / 가운데 줄 위치 게이지 / 오른쪽 남은 시간.
 * MUTE_BUTTON_RECT 영역은 비워둔다.
 */
export function drawTopBar(g, ui, { round = 1, rounds = 3, timeLeft = 0, ropePos = 0, winDistance = 48, fever = false, feverWarning = false } = {}) {
  const cx = screenW(ui) >> 1;

  // --- 왼쪽: ROUND n/m ---
  const rb = ROUND_BOX;
  ui.box(g, rb.x, rb.y, rb.w, rb.h, 'dark');
  const head = 'ROUND ';
  const nums = `${Math.round(round)}/${Math.round(rounds)}`;
  const tw = measureBitmapText(head + nums);
  const sx = rb.x + ((rb.w - tw) >> 1);
  const ty = rb.y + 6;
  drawBitmapText(g, head, sx, ty, { color: SILVER, shadow: INK });
  drawBitmapText(g, nums, sx + measureBitmapText(head) + 1, ty, { color: YELLOW, shadow: INK });

  // --- 가운데: 줄 위치 게이지 ---
  const frameStyle = fever ? 'red' : (feverWarning ? 'gold' : 'dark');
  ui.box(g, cx - GAUGE_FRAME_HALF, 1, GAUGE_FRAME_HALF * 2 + 1, 19, frameStyle);
  const tx = cx - GAUGE_TRACK_HALF;
  const tw2 = GAUGE_TRACK_HALF * 2 + 1;
  // 트랙 외곽 + 안쪽
  rect(g, INK, tx, GAUGE_TRACK_Y, tw2, GAUGE_TRACK_H);
  const ix = tx + 1, iy = GAUGE_TRACK_Y + 1, iw = tw2 - 2, ih = GAUGE_TRACK_H - 2;
  rect(g, CHARCOAL, ix, iy, iw, ih);
  // 양 끝 진영 구역 (승리선 너머) — 왼쪽 빨강, 오른쪽 파랑
  const leftLine = cx - GAUGE_WIN_PX;
  const rightLine = cx + GAUGE_WIN_PX;
  rect(g, RED, ix, iy, leftLine - ix, ih);
  rect(g, PLUM, ix, iy + ih - 1, leftLine - ix, 1);
  rect(g, BLUE, rightLine + 1, iy, ix + iw - rightLine - 1, ih);
  rect(g, NAVY, rightLine + 1, iy + ih - 1, ix + iw - rightLine - 1, 1);
  // 중간 눈금 (승리선까지 1/2 지점)
  const half = GAUGE_WIN_PX >> 1;
  rect(g, SLATE, cx - half, iy + 1, 1, ih - 2);
  rect(g, SLATE, cx + half, iy + 1, 1, ih - 2);
  // 진행 막대: 중앙 → 표식 (끌려간 쪽 팀 색)
  const wd = winDistance > 0 ? winDistance : 1;
  const ratio = clamp((Number(ropePos) || 0) / wd, -GAUGE_OVERSHOOT, GAUGE_OVERSHOOT);
  const off = Math.round(ratio * GAUGE_WIN_PX);
  const mx = cx + off;
  if (off < 0) rect(g, TEAM_COLORS.left.light, mx, iy + 1, -off, ih - 2);
  else if (off > 0) rect(g, TEAM_COLORS.right.light, cx + 1, iy + 1, off, ih - 2);
  // 승리선 (흰색 세로선, 트랙 위아래로 1px 삐져나옴)
  rect(g, WHITE, leftLine, GAUGE_TRACK_Y - 1, 1, GAUGE_TRACK_H + 2);
  rect(g, WHITE, rightLine, GAUGE_TRACK_Y - 1, 1, GAUGE_TRACK_H + 2);
  // 중앙 눈금
  rect(g, WHITE, cx, GAUGE_TRACK_Y - 2, 1, GAUGE_TRACK_H + 4);
  // 표식 (노란 리본)
  rect(g, INK, mx - 2, 4, 5, 13);
  rect(g, YELLOW, mx - 1, 5, 3, 11);
  rect(g, WHITE, mx - 1, 5, 1, 4);
  rect(g, ORANGE, mx + 1, 12, 1, 4);
  rect(g, RED, mx - 1, 9, 3, 2);

  // --- 오른쪽: 남은 시간 (LOW_TIME 이하 빨강 깜빡임) ---
  const tl = Math.max(0, Number(timeLeft) || 0);
  const secs = Math.max(0, Math.ceil(tl - 1e-6));
  const low = tl > 0 && tl <= LOW_TIME;
  const blink = low && Math.floor(tl * 4) % 2 === 0;
  const tb = TIMER_BOX;
  ui.box(g, tb.x, tb.y, tb.w, tb.h, blink ? 'red' : 'dark');
  const str = String(secs).padStart(2, '0');
  const sw = measureBitmapText(str, 2, 1);
  const color = blink ? WHITE : (low ? ORANGE : WHITE);
  drawBitmapText(g, str, tb.x + ((tb.w - sw) >> 1), tb.y + 2, { color, scale: 2, shadow: blink ? PLUM : INK });
}

// ---------------------------------------------------------
// 음소거 버튼
// ---------------------------------------------------------

/** MUTE_BUTTON_RECT 에 작은 9-slice 버튼 + 스피커 아이콘 */
export function drawMuteButton(g, ui, { muted = false, hover = false, pressed = false, icons = null } = {}) {
  const r = MUTE_BUTTON_RECT;
  const dy = pressed ? 1 : 0;
  const bh = r.h - 1;
  // 안 눌렸을 때 1px 바닥 그림자
  if (!pressed) rect(g, INK, r.x + 1, r.y + r.h - 1, r.w - 2, 1);
  ui.box(g, r.x, r.y + dy, r.w, bh, muted ? 'red' : 'dark');
  if (hover && !pressed) {
    // hover: 안쪽 테두리를 밝게
    rect(g, WHITE, r.x + 1, r.y + dy + 1, r.w - 2, 1);
    rect(g, WHITE, r.x + 1, r.y + dy + bh - 2, r.w - 2, 1);
    rect(g, WHITE, r.x + 1, r.y + dy + 1, 1, bh - 2);
    rect(g, WHITE, r.x + r.w - 2, r.y + dy + 1, 1, bh - 2);
  }
  const icon = icons ? (muted ? icons.off : icons.on) : null;
  if (icon && icon.width) {
    ui.icon(g, icon, r.x + ((r.w - icon.width) >> 1), r.y + dy + ((bh - icon.height) >> 1));
  } else {
    drawSpeakerFallback(g, r.x + 2, r.y + dy + 2, muted);
  }
}

// ---------------------------------------------------------
// 박자 레인
// ---------------------------------------------------------

/** 노트 하나 (x 중앙) */
function drawNote(g, nx, laneY, fever, flick) {
  const top = laneY + 3;
  rect(g, INK, nx - 2, top, 5, 7);
  rect(g, fever ? ORANGE : CYAN, nx - 1, top + 1, 3, 5);
  rect(g, fever ? YELLOW : WHITE, nx - 1, top + 1, 1, 2);
  rect(g, fever ? RED : SKY, nx + 1, top + 4, 1, 2);
  if (fever) {
    // 작은 불꽃 (노트 위 2px, 깜빡이며 흔들림)
    rect(g, YELLOW, nx, top - 1, 1, 1);
    rect(g, flick ? ORANGE : RED, nx + (flick ? -1 : 1), top - 1, 1, 1);
    rect(g, RED, nx + (flick ? 1 : -1), top - 2, 1, 1);
  }
}

/**
 * 박자 레인: 양쪽에서 노트가 가운데 목표 칸으로 모여 박 시각에 정확히 도착한다.
 * 다음 LANE_BEATS 박까지 (현재 간격이 일정하다고 가정) 보여준다.
 */
export function drawBeatLane(g, ui, { time = 0, lastBeatTime = 0, nextBeatTime = 0, interval = 0.5, fever = false, pulse } = {}) {
  const L = cfgOf(ui).LAYOUT;
  const cx = screenW(ui) >> 1;
  const y0 = Math.round(L.BEAT_LANE_Y);
  const halfW = LANE_BEATS * NOTE_SPACING + 5;
  const x0 = cx - halfW;
  const iv = interval > 0 ? interval : 0.5;
  const t = Number(time) || 0;

  // 박 직후 번쩍임 정도 (안 주어지면 지난 박 이후 경과로 계산)
  let p = Number(pulse);
  if (!Number.isFinite(p)) p = clamp(1 - (t - lastBeatTime) / (iv * 0.25), 0, 1);
  p = clamp(p, 0, 1);

  ui.box(g, x0, y0, halfW * 2, LANE_H, fever ? 'darkRed' : 'dark');
  const midY = y0 + (LANE_H >> 1);

  // 박 눈금 (노트가 1박 전·2박 전·3박 전에 있는 자리)
  for (let k = 1; k <= LANE_BEATS; k++) {
    rect(g, SLATE, cx - k * NOTE_SPACING, midY - 1, 1, 3);
    rect(g, SLATE, cx + k * NOTE_SPACING, midY - 1, 1, 3);
  }

  // 목표 칸
  const tx = cx - (TARGET_SIZE >> 1);
  const ty = y0 + 1;
  // 박 직후 번쩍임 (반투명 대신 디더)
  if (p > 0.55) rect(g, fever ? YELLOW : WHITE, tx + 2, ty + 2, TARGET_SIZE - 4, TARGET_SIZE - 4);
  else if (p > 0.15) dither(g, fever ? YELLOW : WHITE, tx + 2, ty + 2, TARGET_SIZE - 4, TARGET_SIZE - 4);

  // 노트: 박 시각 bt 까지 남은 시간에 비례한 거리. bt == time 이면 정확히 가운데
  const flickBase = Math.floor(t * 12);
  for (let k = 0; k <= LANE_BEATS; k++) {
    const bt = nextBeatTime + k * iv;
    const remain = bt - t;
    if (remain < 0 || remain > LANE_BEATS * iv + 1e-6) continue;
    const off = Math.round((remain / iv) * NOTE_SPACING);
    const flick = ((flickBase + k) & 1) === 1;
    drawNote(g, cx - off, y0, fever, flick);
    drawNote(g, cx + off, y0, fever, !flick);
  }

  // 목표 칸 테두리 (노트 위에 그려 '칸 안으로 들어가는' 느낌)
  const ringColor = fever ? ((flickBase & 2) ? RED : ORANGE) : YELLOW;
  ring(g, INK, tx, ty, TARGET_SIZE, TARGET_SIZE);
  ring(g, ringColor, tx + 1, ty + 1, TARGET_SIZE - 2, TARGET_SIZE - 2);
  if (p > 0.6) {
    // 박 순간 바깥으로 1px 퍼지는 링
    ring(g, fever ? ORANGE : WHITE, tx - 1, ty - 1, TARGET_SIZE + 2, TARGET_SIZE + 2);
  }
}

// ---------------------------------------------------------
// 하단 플레이어 패널
// ---------------------------------------------------------

/** 패널 하나 */
function drawPanel(g, ui, x, y, w, h, p) {
  const style = p.side === 'left' ? 'darkRed' : (p.side === 'right' ? 'darkBlue' : 'dark');
  ui.box(g, x, y, w, h, style);

  // 1행: 색 칩(세로 띠) + 라벨 + 이름 / 오른쪽 키캡
  const color = p.color || WHITE;
  rect(g, INK, x + 3, y + 3, 4, 9);
  rect(g, color, x + 4, y + 4, 2, 7);
  rect(g, shadeOf(color), x + 5, y + 8, 1, 3);
  const label = String(p.label ?? '');
  const name = String(p.name ?? '');
  // keyLabel 이 null 이면(멀티플레이의 다른 참가자) 키캡을 그리지 않는다
  let kx = x + w - 3;
  if (p.keyLabel !== null) {
    const keyLabel = String(p.keyLabel ?? '?');
    kx -= ui.keycapSize(keyLabel).w;
    ui.keycap(g, keyLabel, kx, y + 2, { pressed: !!p.pressed });
  }
  // 대기실에서 정한 이름을 크게 쓴다(넘치면 자름). 이름이 없을 때만 P1 같은 기본 라벨.
  if (name && name !== label) {
    const fitted = fitText(ui, name, 's', kx - 2 - (x + 9));
    if (fitted) ui.text(g, fitted, x + 9, y + 4, { size: 's', color: WHITE, shadow: INK });
  } else {
    drawBitmapText(g, label, x + 9, y + 5, { color: WHITE, shadow: INK });
  }

  // 2행: 점수 / 콤보
  const score = Math.round(Number(p.score) || 0);
  drawBitmapText(g, String(score), x + 4, y + 17, { color: WHITE, shadow: INK });
  const combo = Math.floor(Number(p.combo) || 0);
  if (combo >= 2) {
    drawBitmapText(g, `x${combo}`, x + w - 5, y + 17, { color: YELLOW, shadow: INK, align: 'right' });
  }

  // 3행: 최근 판정 (깜빡이며 사라짐)
  const gs = p.grade ? GRADE_STYLE[p.grade] : null;
  const gt = Number(p.gradeT);
  if (gs && Number.isFinite(gt) && gt >= 0 && gt < GRADE_SHOW) {
    const hidden = gt > GRADE_BLINK_FROM && Math.floor(gt * 20) % 2 === 1;
    if (!hidden) {
      ui.text(g, gs.word, x + (w >> 1), y + 26, { size: 's', color: gs.panel, align: 'center', shadow: INK });
    }
  }
}

/**
 * 하단 5칸 플레이어 패널.
 * panels[i] = { label, name, keyLabel, color, side, score, combo, grade, gradeT, pressed }
 */
export function drawPlayerPanels(g, ui, panels) {
  if (!Array.isArray(panels) || panels.length === 0) return;
  const cfg = cfgOf(ui);
  const L = cfg.LAYOUT;
  const W = screenW(ui);
  const pw = Math.round(L.PANEL_W), ph = Math.round(L.PANEL_H), py = Math.round(L.PANEL_Y);
  const startX = Math.max(0, (W - panels.length * pw) >> 1);
  for (let i = 0; i < panels.length; i++) {
    if (panels[i]) drawPanel(g, ui, startX + i * pw, py, pw, ph, panels[i]);
  }
}

// ---------------------------------------------------------
// 판정 팝업 / 배너 / 머리 위 라벨
// ---------------------------------------------------------

/**
 * 머리 위 판정 팝업. (x 중앙, y 아랫변) — t(0..0.6) 동안 위로 떠오르며 끝에 깜빡여 사라진다.
 */
export function drawJudgePop(g, ui, x, y, grade, t) {
  const gs = GRADE_STYLE[grade];
  const tt = Number(t) || 0;
  if (!gs || tt < 0 || tt >= POP_LIFE) return;
  if (tt > POP_BLINK_FROM && Math.floor(tt * 30) % 2 === 1) return;
  // 빠르게 떠올랐다가 천천히 멈추는 이징
  const k = clamp(tt / POP_LIFE, 0, 1);
  const rise = Math.round((1 - (1 - k) * (1 - k)) * POP_RISE);
  // 5명이 동시에 판정을 받아도 서로 겹치지 않도록 작은 글씨로 통일 (Perfect 는 반짝이로 강조)
  const size = 's';
  const lh = ui.lineHeight(size);
  const cx = Math.round(x);
  const top = Math.round(y) - lh - rise;
  ui.text(g, gs.word, cx, top, { size, color: gs.color, align: 'center', outline: INK });
  if (grade === 'perfect') {
    // 반짝이 픽셀 (양옆)
    const w = ui.measure(gs.word, size);
    const f = Math.floor(tt * 20) & 1;
    const sy = top + (lh >> 1) - 1;
    const lx = cx - (w >> 1) - 4, rx = cx + (w >> 1) + 3;
    rect(g, f ? WHITE : CYAN, lx, sy - 1, 1, 3);
    rect(g, f ? WHITE : CYAN, lx - 1, sy, 3, 1);
    rect(g, f ? CYAN : WHITE, rx, sy - 1, 1, 3);
    rect(g, f ? CYAN : WHITE, rx - 1, sy, 3, 1);
  }
}

/** 피버 배너: 진행 중이면 'FEVER x2!' 깜빡임 + 남은 시간 막대, 예고면 'FEVER 준비!' */
export function drawFeverBanner(g, ui, { active = false, warning = false, remaining = 0, t = 0 } = {}) {
  if (!active && !warning) return;
  const cfg = (ui && ui.config) || DEFAULT_CONFIG;
  const cx = screenW(ui) >> 1;
  const y = FEVER_BANNER_Y;
  const tt = Number(t) || 0;
  const size = 'l';
  const lh = ui.lineHeight(size);

  if (active) {
    const mult = cfg.FEVER_POWER_MULT ?? DEFAULT_CONFIG.FEVER_POWER_MULT;
    const str = `FEVER x${mult}!`;
    const tw = ui.measure(str, size);
    const bw = tw + 14, bh = lh + 7;
    const bx = cx - (bw >> 1);
    ui.box(g, bx, y, bw, bh, 'red');
    // 양옆 불꽃
    for (let i = 0; i < 2; i++) {
      drawFlame(g, bx - 4 - i * 4, y + bh - 2, tt, i);
      drawFlame(g, bx + bw + 1 + i * 4, y + bh - 2, tt, i + 1);
    }
    const color = Math.floor(tt * 8) % 2 === 0 ? YELLOW : WHITE;
    ui.text(g, str, cx, y + 3, { size, color, align: 'center', shadow: PLUM });
    // 남은 시간 막대
    const dur = cfg.FEVER_DURATION > 0 ? cfg.FEVER_DURATION : 4;
    const ratio = clamp((Number(remaining) || 0) / dur, 0, 1);
    rect(g, INK, bx + 2, y + bh, bw - 4, 3);
    rect(g, YELLOW, bx + 3, y + bh + 1, Math.round((bw - 6) * ratio), 1);
    return;
  }

  // 예고: 깜빡이는 금색 배너
  if (Math.floor(tt * 5) % 2 === 1) return;
  const str = 'FEVER 준비!';
  const tw = ui.measure(str, size);
  const bw = tw + 14, bh = lh + 7;
  const bx = cx - (bw >> 1);
  ui.box(g, bx, y, bw, bh, 'gold');
  ui.text(g, str, cx, y + 3, { size, color: INK, align: 'center' });
}

/** 가운데 배너: 박스 + 큰 글씨 가운데 정렬 */
export function drawCenterBanner(g, ui, text, { style = 'gold', y = 60, size = 'xl' } = {}) {
  const str = String(text ?? '');
  if (!str) return;
  const W = screenW(ui);
  const cx = W >> 1;
  const tw = ui.measure(str, size);
  const lh = ui.lineHeight(size);
  const bw = Math.min(W - 4, tw + 20);
  const bh = lh + 9;
  const bx = cx - (bw >> 1);
  const by = Math.round(y);
  ui.box(g, bx, by, bw, bh, style);
  const sc = ui.styleColors(style);
  ui.text(g, str, cx, by + 4, { size, color: sc.text, align: 'center', shadow: sc.textShadow });
}

/**
 * 캐릭터 머리 위 라벨: 팀 색 태그 'P1' + 키캡. (x 중앙, y 아랫변)
 */
export function drawHeadLabel(g, ui, x, y, { label = '', keyLabel = '?', color, side = null, pressed = false } = {}) {
  // 이름표에는 대기실에서 정한 이름을 쓴다. 한글 등 비트맵 글꼴에 없는 글자는 작은 한글 글꼴로 그린다.
  const plain = isBitmapText(label);
  const lab = plain ? String(label ?? '') : fitText(ui, String(label), 's', HEAD_NAME_MAX_W);
  const tagW = (plain ? measureBitmapText(lab) : ui.measure(lab, 's')) + 6;
  const tagH = 11;
  // keyLabel 이 null 이면(멀티플레이의 다른 참가자) 이름표만 그린다
  const hasKey = keyLabel !== null;
  const kw = hasKey ? ui.keycapSize(keyLabel).w : 0;
  const total = tagW + (hasKey ? 1 + kw : 0);
  const left = Math.round(x) - (total >> 1);
  const bottom = Math.round(y);
  const tagY = bottom - 12;
  const style = side === 'left' ? 'red' : (side === 'right' ? 'blue' : 'dark');
  ui.box(g, left, tagY, tagW, tagH, style);
  if (plain) drawBitmapText(g, lab, left + 3, tagY + 2, { color: WHITE });
  else ui.text(g, lab, left + 3, tagY + 1, { size: 's', color: WHITE });
  if (hasKey) ui.keycap(g, keyLabel, left + tagW + 1, bottom - 13, { pressed: !!pressed, color });
}
