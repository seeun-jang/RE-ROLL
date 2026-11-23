// ============================================================
// 속성 정의와 상성 규칙
//   불 → 바람 → 번개 → 물 → 불  (화살표 방향이 이긴다)
//   얼음 = 방어 계열, 치유 = 회복 계열 (상성 순환 밖)
// ============================================================
import { CONFIG } from '../config.js';

export const ELEMENTS = Object.freeze({
  fire: { id: 'fire', name: '불', icon: 'icon_fire' },
  wind: { id: 'wind', name: '바람', icon: 'icon_wind' },
  lightning: { id: 'lightning', name: '번개', icon: 'icon_lightning' },
  water: { id: 'water', name: '물', icon: 'icon_water' },
  ice: { id: 'ice', name: '얼음', icon: 'icon_ice' },
  heal: { id: 'heal', name: '치유', icon: 'icon_heal' },
});

// key가 value를 이긴다
export const BEATS = Object.freeze({
  fire: 'wind',
  wind: 'lightning',
  lightning: 'water',
  water: 'fire',
});

// 순환 순서 (UI 안내용)
export const CYCLE = Object.freeze(['fire', 'wind', 'lightning', 'water']);

export function beats(attacker, defender) {
  return !!attacker && BEATS[attacker] === defender;
}

/** 이 속성을 이기는 속성 (예: fire → water) */
export function counterOf(element) {
  for (const [k, v] of Object.entries(BEATS)) if (v === element) return k;
  return null;
}

/**
 * 공격 속성 vs 방어(상대의 속성 친화) 배율
 * 유리 1.5 / 불리 0.5 / 그 외 1.0
 */
export function elementMultiplier(attack, defend) {
  if (!attack || !defend) return 1;
  if (beats(attack, defend)) return CONFIG.ELEMENT.ADVANTAGE;
  if (beats(defend, attack)) return CONFIG.ELEMENT.DISADVANTAGE;
  return 1;
}
