(function (PK) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 판정(Judge) — 유효타격 판정 로직을 한곳에 모은 모듈
  //
  //  1) resolveStrike()  : 타격이 닿는 순간 "무슨 일이 일어났나" (헛침/막힘/받아치기/튕김/접촉)
  //  2) evaluateStrike() : 접촉 후 잔심까지 지켜본 기록으로 "한판감인가" 를 계산하는 순수 함수
  //       - 필수 조건: 간격(너무 가깝지 않음) + 기합 게이지 + 잔심 유지 + 상타 아님
  //       - 판정 점수: 간격 점수·빈틈(부위)·기합 타이밍의 가중합 (+받아치기 보너스, −감점)
  //     결과에는 항목별 ○/× 와 이유가 담겨 디버그·수련 화면에 그대로 표시된다.
  // ─────────────────────────────────────────────────────────────
  const Judge = {
    // 기술별 접촉 거리 범위 (선수 리치 반영)
    band(type, reach) {
      const c = PK.CONFIG.STRIKES[type].contact;
      const r = reach || 0;
      return { min: c.min, idealLo: c.idealLo + r, idealHi: c.idealHi + r, max: c.max + r };
    },

    // 상대 상태 스냅샷 → 부위별 빈틈 (0~1)
    getOpenings(s) {
      const O = PK.CONFIG.OPENINGS;
      switch (s.state) {
        case 'strike':
          if (s.phase === 'windup') return O['windup_' + s.strikeType];
          return s.recoverBad ? O.recover_bad : O.recover;
        case 'block': return O.block;
        case 'stagger': return O.stagger;
        case 'stun': return O.stun;
        case 'present': {
          const r = { men: O.present_off, kote: O.present_off, do: O.present_off };
          r[s.presentTarget] = O.present_on;
          return r;
        }
        case 'frozen': case 'sonkyo': return O.frozen;
        default:
          if (s.moveRel > 0) return O.forward;
          if (s.moveRel < 0) return O.backward;
          return O.idle;
      }
    },

    // 빈틈이 생긴 이유 (화면 표시용)
    openingReason(s) {
      switch (s.state) {
        case 'strike':
          if (s.phase === 'windup') return '상대가 치러 들어오는 순간';
          return s.recoverBad ? '상대가 헛친 뒤 무너짐' : '상대 타격 직후';
        case 'block': return '상대가 막는 중';
        case 'stagger': return '받아치기로 무너뜨림';
        case 'stun': return '상대 기세가 꺾여 경직';
        case 'present': return '상대가 열어 준 부위';
        default:
          if (s.moveRel > 0) return '상대가 다가오는 중';
          if (s.moveRel < 0) return '상대가 물러나는 중';
          return '상대가 겨눔 자세';
      }
    },

    // 간격 이름표
    maai(dist) {
      const L = PK.CONFIG.MAAI_LABELS;
      for (let i = 0; i < L.length; i++) if (dist <= L[i].max) return L[i];
      return L[L.length - 1];
    },

    // 접촉 거리 → 간격 점수 (최적 범위 1, 범위 끝으로 갈수록 낮아짐)
    distScore(dist, band) {
      const E = PK.CONFIG.JUDGE.DIST_EDGE_SCORE;
      if (dist >= band.idealLo && dist <= band.idealHi) return 1;
      if (dist < band.idealLo) return E + (1 - E) * Math.max(0, (dist - band.min) / Math.max(1, band.idealLo - band.min));
      return E + (1 - E) * Math.max(0, (band.max - dist) / Math.max(1, band.max - band.idealHi));
    },

    // ① 타격이 닿는 틱에 호출 — 결과 종류를 결정
    resolveStrike(att, def) {
      const C = PK.CONFIG;
      const type = att.strike.type;
      const band = this.band(type, att.reach);
      const dist = Math.abs(att.x - def.x);
      const ds = def.snapshot();
      if (dist > band.max) return { kind: 'whiff', dist: dist };
      // 막기는 머리·손목만 막는다 (허리는 열림)
      if (def.state === 'block' && type !== 'do') {
        if (def.parryActive) return { kind: 'parried', dist: dist };
        return { kind: 'blocked', dist: dist };
      }
      const opening = this.getOpenings(ds)[type];
      const base = { dist: dist, opening: opening, defState: ds.state, defPhase: ds.phase, reason: this.openingReason(ds) };
      if (dist < band.min) return Object.assign({ kind: 'contact', tooClose: true }, base);
      if (opening < C.DEFLECT_THRESHOLD) return Object.assign({ kind: 'deflected' }, base);
      return Object.assign({ kind: 'contact', tooClose: false }, base);
    },

    // ② 유효타격 판정 (순수 함수: 입력 기록만으로 결과를 계산, 부수효과 없음)
    // rec: { type, dist, band, tooClose, opening, openReason, kiaiOk, kiaiGauge, kiaiTimed,
    //        zanshinBroken, aiuchi, counter, debana, momentum, backward }
    evaluateStrike(rec) {
      const C = PK.CONFIG, J = C.JUDGE;
      const items = [];
      const tags = [];

      // 1. 간격
      const dScore = rec.tooClose ? 0 : this.distScore(rec.dist, rec.band);
      let distNote;
      if (rec.tooClose) distNote = '너무 가까움 (코등이 거리)';
      else if (dScore >= 1) distNote = '적정 간격';
      else distNote = rec.dist > rec.band.idealHi ? '간격이 조금 멂' : '간격이 조금 가까움';
      items.push({ key: 'dist', label: '간격', ok: !rec.tooClose, value: dScore, note: distNote + ' (' + Math.round(rec.dist) + ')' });

      // 2. 기합
      const kiaiValue = !rec.kiaiOk ? 0 : (rec.kiaiTimed ? 1 : J.KIAI_BASE);
      items.push({
        key: 'kiai', label: '기합', ok: rec.kiaiOk, value: kiaiValue,
        note: !rec.kiaiOk ? '기합 부족 (' + rec.kiaiGauge + '/' + C.KIAI.REQUIRED + ')'
          : rec.kiaiTimed ? '기합과 동시에 타격' : '기합 충분 (타이밍 보통)'
      });

      // 3. 부위·빈틈
      const name = C.STRIKES[rec.type].name;
      items.push({ key: 'target', label: name, ok: true, value: rec.opening, note: '빈틈 ' + rec.opening.toFixed(2) + ' · ' + rec.openReason });

      // 4. 잔심
      items.push({ key: 'zanshin', label: '잔심', ok: !rec.zanshinBroken, value: rec.zanshinBroken ? 0 : 1, note: rec.zanshinBroken || '타격 후 자세 유지' });

      // 5. 상타 (동시 타격)
      if (rec.aiuchi) items.push({ key: 'aiuchi', label: '상타', ok: false, value: 0, note: '서로 동시에 침 — 무효' });

      // 판정 점수
      let q = dScore * J.W_DIST + rec.opening * J.W_OPEN + kiaiValue * J.W_KIAI;
      if (rec.counter) { q += J.COUNTER_BONUS; tags.push('받아치기'); }
      if (rec.debana) tags.push('출발기');
      if (rec.kiaiOk && rec.kiaiTimed) tags.push('기검체일치');
      if (rec.momentum < C.MOMENTUM.LOW) {
        q -= J.LOW_MOMENTUM_PENALTY;
        items.push({ key: 'momentum', label: '기세', ok: true, value: rec.momentum / 100, note: '기세 부족 (감점)', penalty: true });
      }
      if (rec.backward) {
        q -= J.BACKWARD_PENALTY;
        items.push({ key: 'posture', label: '자세', ok: true, value: 0, note: '물러나며 침 (감점·미해금 기술)', penalty: true });
      }
      q = Math.max(0, Math.min(1.1, q));

      const failed = items.filter(function (i) { return !i.ok; });
      return {
        type: rec.type,
        valid: failed.length === 0,
        quality: q,
        items: items,
        tags: tags,
        mainReason: failed.length ? failed[0].note : null
      };
    }
  };

  PK.Judge = Judge;
})(window.PK = window.PK || {});
