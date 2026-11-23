// =============================================================
// PowerCalculator ★ AI 보너스 연결 지점
// 판정 등급 → 줄에 더할 힘
// =============================================================

/**
 * power = POWER[grade] × 팀 인원 보정 × (피버 && 박자 판정이면 FEVER_POWER_MULT) × (bonus.powerMult ?? 1)
 * @param {{ grade: 'perfect'|'good'|'miss'|'spam', config: object, teamMultiplier?: number,
 *           fever?: boolean, bonus?: { powerMult?: number } | null }} args
 * @returns {number}
 */
export function computePower({ grade, config, teamMultiplier = 1, fever = false, bonus = null }) {
  const base = (config.POWER && config.POWER[grade]) || 0;
  // 피버 배율은 박자에 맞춘 입력(Perfect/Good)에만 적용
  const feverMult = fever && (grade === 'perfect' || grade === 'good') ? config.FEVER_POWER_MULT : 1;
  // TODO(AI): 퀴즈 정답 보너스 등은 bonus.powerMult 로 들어온다 (PowerSource.poll 의 bonus 또는 game.applyBonus)
  const bonusMult = bonus && Number.isFinite(bonus.powerMult) ? bonus.powerMult : 1;
  return base * teamMultiplier * feverMult * bonusMult;
}
