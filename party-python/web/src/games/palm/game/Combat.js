// =============================================================
// Combat.js — 손바닥 상성 판정
//
//   밀기  vs 대기/후딜      → 상대가 뒤로 밀림 (준비·차지 중이면 카운터, 페인트 후딜이면 무방비 추가 피해)
//   밀기  vs 버티기 자세 잡는 중 → "버티기 실패" (피해 증가)
//   밀기  vs 버티기         → 받아냄! 미는 쪽이 튕겨남 (차지 밀기는 일부 뚫음)
//   밀기  vs 페인트(판정 창) → 헛손질! 미는 쪽이 앞으로 크게 쏠림
//   밀기  vs 밀기(동시)      → 짝! 맞부딪혀 둘 다 뒤로 (센 쪽이 덜 밀림)
//   페인트 vs 버티기         → 버티던 쪽이 지지대를 잃고 앞으로 고꾸라짐
//
//   충격량 부호: Fighter 자기 기준(+앞, -뒤)
// =============================================================

// 두 밀기가 이만큼(프레임) 이내로 나가면 동시 밀기(짝!)로 본다
const CLASH_WINDOW = 2;

export function resolveCombat(a, b, env) {
  if (a.fallen || b.fallen || a.won || b.won) return;
  // 1) 동시 밀기 검사
  if (tryClash(a, b, env) || tryClash(b, a, env)) return;
  // 2) 각자의 밀기 판정
  resolvePush(a, b, env);
  if (a.fallen || b.fallen) return;
  resolvePush(b, a, env);
  if (a.fallen || b.fallen) return;
  // 3) 페인트 vs 버티기
  resolveFeintVsHold(a, b, env);
  resolveFeintVsHold(b, a, env);
}

// 밀기가 막 나간 순간인가?
function pushJustActive(f) {
  return f.state === 'push' && !f.pushResolved;
}

// 곧(CLASH_WINDOW 안에) 밀기가 나갈 예정인가? (툭 밀기 준비 끝무렵 / 차지 해제 중)
function pushImminent(f, cfg) {
  const A = cfg.ACTION;
  if (f.state === 'release') return A.CHARGE_RELEASE - f.stateFrame <= CLASH_WINDOW;
  if (f.state === 'windup' && !f.input.pushDown) return A.PUSH_WINDUP - f.stateFrame <= CLASH_WINDOW;
  if (f.state === 'push' && f.pushResolved) return false;
  return false;
}

function tryClash(a, b, env) {
  if (!pushJustActive(a)) return false;
  const bothNow = pushJustActive(b);
  const bSoon = pushImminent(b, env.cfg);
  if (!bothNow && !bSoon) return false;
  const cfg = env.cfg;
  if (bSoon) {
    // 상대의 밀기도 지금 바로 나간 것으로 처리
    const charged = b.state === 'release';
    b.beginPush(env, charged);
  }
  a.pushResolved = true;
  b.pushResolved = true;
  const I = cfg.IMPACT;
  // 센 쪽은 덜, 약한 쪽은 더 밀린다
  const total = a.power + b.power;
  a.takeImpulse(-I.CLASH * (2 * b.power / total) * Math.max(1, b.power * 0.8), env);
  b.takeImpulse(-I.CLASH * (2 * a.power / total) * Math.max(1, a.power * 0.8), env);
  a.stats.clashes++;
  b.stats.clashes++;
  a.setResult('clash');
  b.setResult('clash');
  env.emit({ type: 'clash', a, b, power: Math.max(a.power, b.power) });
  return true;
}

function resolvePush(att, def, env) {
  if (!pushJustActive(att)) return;
  att.pushResolved = true;
  const I = env.cfg.IMPACT;
  const p = att.power;

  // 페인트 판정 창 안 → 헛손질
  if (def.inFeintWindow) {
    def.feintConsumed = true;
    def.recordFeintSuccess();
    def.setResult('feinted');
    att.stats.whiffs++;
    att.setResult('whiffed');
    const whiff = I.WHIFF * p * (1 + I.WHIFF_LEAN_MULT * att.forwardLean);
    att.squash = 10;
    att.takeImpulse(whiff, env);
    env.emit({ type: 'whiff', attacker: att, feinter: def, power: p, charged: att.charged });
    // 성공한 페인트는 빨리 회복해서 반격할 수 있다
    def.setState('recover', 6);
    return;
  }

  // 버티기 성공
  if (def.state === 'hold') {
    def.stats.holdsSucceeded++;
    def.setResult('blocked');
    att.setResult('blocked');
    // 차지 밀기는 버티기를 일부 뚫는다
    const ratio = I.HOLD_ABSORB + (att.charged ? I.HOLD_BREAK_MULT * att.charge : 0);
    def.body.applyImpulse(-I.PUSH * p * ratio);
    def.stamina = Math.max(0, def.stamina - 15);
    def.flash = 3;
    att.takeImpulse(-I.HOLD_REBOUND * Math.sqrt(p), env);
    env.emit({ type: 'blocked', attacker: att, holder: def, power: p, charged: att.charged });
    return;
  }

  // 일반 명중 — 상대 상태에 따라 배율
  let mult = 1;
  let kind = 'normal';
  if (def.state === 'holdStart') {
    mult = I.HOLD_FAIL_MULT;
    kind = 'holdFail';
    def.setResult('broken');
  } else if (def.state === 'windup' || def.state === 'charge' || def.state === 'release') {
    mult = I.COUNTER_MULT;
    kind = 'counter';
  } else if (def.state === 'feintRecover') {
    mult = I.EXPOSED_MULT;
    kind = 'exposed';
  } else if (def.state === 'stagger') {
    mult = I.STAGGER_MULT;
    kind = 'stagger';
  }
  if (kind === 'counter' || kind === 'holdFail') def.interrupt(10);

  att.stats.pushesLanded++;
  att.setResult('hit');
  att.body.applyImpulse(-I.PUSH_RECOIL * p);
  def.flash = 3;
  def.takeImpulse(-I.PUSH * p * mult, env);
  env.emit({ type: 'hit', attacker: att, defender: def, power: p * mult, charged: att.charged, kind });
}

function resolveFeintVsHold(feinter, holder, env) {
  if (!feinter.inFeintWindow) return;
  if (holder.state !== 'hold') return;
  const I = env.cfg.IMPACT;
  feinter.feintConsumed = true;
  feinter.recordFeintSuccess();
  feinter.setResult('feinted');
  holder.setResult('fooled');
  holder.squash = 8;
  holder.setState('idle');
  holder.takeImpulse(I.FEINT_VS_HOLD, env);
  feinter.setState('recover', 6);
  env.emit({ type: 'feintHold', feinter, holder });
}
