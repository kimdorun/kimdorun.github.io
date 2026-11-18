/* ==========================================================================
   생활금융 계산기 허브 — 대출 상환·스트레스 DSR·대환 손익분기 엔진 (loan-core.js)
   ─ 모든 산식은 페이지의 <script>와 분리되어 있어 검증 스크립트에서 직접 호출한다.
   ─ 기준: 금융위원회 「스트레스 DSR 제도」 금융행정지도 변경시행
     (관리번호 제2024-002호, 유효기간 2026.7.1.~2026.12.31., 공고 제2025-954호)
     · 규제 기준 DSR: 은행권 40% / 제2금융권 50%
     · 스트레스 금리: 수도권·규제지역 주담대 3.0%p(기본 적용비율 100%)
                       지방(비수도권·비규제지역) 주담대 1.5%p × 50% = 0.75%p (2026-12-31까지 2단계 유지)
                       신용대출 1.5%p × 100% (총 잔액 1억원 초과 시에만 부과)
     · 최종 적용 스트레스 금리 = 스트레스 금리 × 기본 적용비율 × 대출유형별 적용비율
     · 대출유형별 적용비율(주담대): 변동형·고정 5년 미만 100%,
       혼합형 80/60/40/미적용(지방 60/40/20/미적용), 주기형 40/30/20/미적용(지방 30/20/10/미적용)
     · 신용대출 만기별: 5년 이상 고정 0%, 3~5년 고정 60%, 변동 등 100%
   ─ 네트워크 호출 0건 · Intl 미사용(QuickJS 단위 테스트 가능) · 순수 ES5
   ========================================================================== */
(function (root) {
  'use strict';

  var RATES = {
    year: 2026,
    /* DSR 규제 기준 (%) */
    dsrLimit: {
      bank: 40,
      nonbank: 50
    },
    /* 스트레스 금리 (%p) 와 기본 적용비율 (%) */
    stress: {
      mortgage: {
        metro: { rate: 3.0, baseRatio: 100 },
        local: { rate: 1.5, baseRatio: 50 }
      },
      credit: { rate: 1.5, baseRatio: 100 }
    },
    /* 신용대출 스트레스 부과 기준 잔액 (원) — 총 잔액이 이 금액을 넘을 때만 부과 */
    creditStressThreshold: 100000000,
    /* 주담대 대출유형별 적용비율 (%) — 고정금리 기간/금리변동주기 비중 구간별 */
    typeRatio: {
      metro: { variable: 100, mixed: [80, 60, 40, 0], periodic: [40, 30, 20, 0] },
      local: { variable: 100, mixed: [60, 40, 20, 0], periodic: [30, 20, 10, 0] }
    },
    /* 신용대출 만기 유형별 적용비율 (%) */
    creditTermRatio: { fixed5: 0, fixed3to5: 60, other: 100 },
    /* 비중 구간 경계 (%) */
    shareBounds: [30, 50, 70],
    /* 정책 유예 종료일 */
    localGraceUntil: '2026-12-31',
    /* 월 단위 상환 상수 */
    months: { year: 12 }
  };

  var METHOD_LABEL = {
    equal: '원리금균등',
    principal: '원금균등',
    bullet: '만기일시'
  };

  var TERM_LABEL = {
    fixed5: '만기 5년 이상 고정금리',
    fixed3to5: '만기 3~5년 고정금리',
    other: '변동금리 등 그 외'
  };

  function num(value, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(String(value == null ? '' : value).replace(/,/g, ''));
    return isFinite(n) ? n : (fallback || 0);
  }

  function floorUnit(value, unit) {
    var u = unit || 1;
    return Math.floor(value / u + 1e-9) * u;
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  /* 비중 구간 index: 0 = 30% 미만, 1 = 30~50%, 2 = 50~70%, 3 = 70% 이상 */
  function shareBucket(share) {
    var s = num(share, 0);
    if (s < RATES.shareBounds[0]) return 0;
    if (s < RATES.shareBounds[1]) return 1;
    if (s < RATES.shareBounds[2]) return 2;
    return 3;
  }

  /* -------------------------------------------------------------------------
     대출 종류·지역·금리유형 → 적용 스트레스 가산금리
     반환: { product, region, rateType, stressRate, baseRatio, typeRatio,
             addon, bucket, applied, note }
     ------------------------------------------------------------------------- */
  function stressAddon(options) {
    var o = options || {};
    var product = o.product === 'credit' ? 'credit' : 'mortgage';
    var region = o.region === 'local' ? 'local' : 'metro';
    var rateType = o.rateType === 'mixed' || o.rateType === 'periodic' ? o.rateType : 'variable';
    var share = num(o.fixedShare, 0);
    var creditBalance = num(o.creditBalance, 0);
    var creditTerm = RATES.creditTermRatio.hasOwnProperty(o.creditTerm) ? o.creditTerm : 'other';
    var bucket = shareBucket(share);

    if (product === 'credit') {
      if (creditBalance <= RATES.creditStressThreshold) {
        return {
          product: product, region: 'all', rateType: creditTerm, bucket: 0,
          stressRate: RATES.stress.credit.rate, baseRatio: 0, typeRatio: 0,
          addon: 0, applied: false,
          note: '신용대출 총 잔액이 1억원 이하이면 스트레스 금리를 부과하지 않습니다.'
        };
      }
      var cr = RATES.stress.credit;
      var cType = RATES.creditTermRatio[creditTerm];
      return {
        product: product, region: 'all', rateType: creditTerm, bucket: 0,
        stressRate: cr.rate, baseRatio: cr.baseRatio, typeRatio: cType,
        addon: cr.rate * (cr.baseRatio / 100) * (cType / 100), applied: cType > 0,
        note: cType === 0
          ? '만기 5년 이상 고정금리 신용대출은 스트레스 금리를 적용하지 않습니다.'
          : '신용대출 총 잔액 1억원 초과, ' + TERM_LABEL[creditTerm] + ' 기준입니다.'
      };
    }

    var m = RATES.stress.mortgage[region];
    var ratio;
    if (rateType === 'variable') {
      ratio = RATES.typeRatio[region].variable;
    } else {
      ratio = RATES.typeRatio[region][rateType][bucket];
    }
    var addon = m.rate * (m.baseRatio / 100) * (ratio / 100);
    var note;
    if (ratio === 0) {
      note = '고정금리 비중이 70% 이상이면 스트레스 금리를 적용하지 않습니다.';
    } else if (region === 'local') {
      note = '지방 주담대는 2단계 수준(기본 적용비율 50%)이 ' + RATES.localGraceUntil + '까지 유지됩니다.';
    } else {
      note = '수도권·규제지역 주담대는 3단계 기준(3.0%p × 100%)이 적용됩니다.';
    }
    return {
      product: product, region: region, rateType: rateType, bucket: bucket,
      stressRate: m.rate, baseRatio: m.baseRatio, typeRatio: ratio,
      addon: addon, applied: ratio > 0, note: note
    };
  }

  /* -------------------------------------------------------------------------
     상환 스케줄 — method: equal(원리금균등) | principal(원금균등) | bullet(만기일시)
     ─ 거치기간(개월) 동안은 이자만 납부하고 원금은 유지된다.
     ------------------------------------------------------------------------- */
  function schedule(options) {
    var o = options || {};
    var P = Math.max(0, num(o.principal, 0));
    var annual = Math.max(0, num(o.annualRate, 0));
    var months = Math.max(1, Math.round(num(o.months, 1)));
    var grace = clamp(Math.round(num(o.graceMonths, 0)), 0, months - 1);
    var method = METHOD_LABEL[o.method] ? o.method : 'equal';

    var i = annual / 100 / RATES.months.year;
    var n = months - grace;
    var rows = [];
    var balance = P;
    var totalInterest = 0;
    var totalPayment = 0;

    var equalPay = 0;
    if (method === 'equal') {
      equalPay = i === 0 ? P / n : P * i / (1 - Math.pow(1 + i, -n));
    }

    for (var m = 1; m <= months; m++) {
      var interest = balance * i;
      var principalPart = 0;
      if (m > grace) {
        if (method === 'equal') {
          principalPart = equalPay - interest;
        } else if (method === 'principal') {
          principalPart = P / n;
        }
      }
      /* 마지막 회차는 잔액을 모두 상환해 부동소수 잔여분을 남기지 않는다. */
      if (m === months) principalPart = balance;
      if (principalPart > balance) principalPart = balance;
      if (principalPart < 0) principalPart = 0;
      var payment = principalPart + interest;
      balance = balance - principalPart;
      if (m === months) balance = 0;
      totalInterest += interest;
      totalPayment += payment;
      rows.push({
        month: m,
        payment: payment,
        principal: principalPart,
        interest: interest,
        balance: balance,
        grace: m <= grace
      });
    }

    return {
      method: method,
      label: METHOD_LABEL[method],
      principal: P,
      annualRate: annual,
      months: months,
      graceMonths: grace,
      effectiveMonths: n,
      rows: rows,
      firstPayment: rows.length ? rows[0].payment : 0,
      lastPayment: rows.length ? rows[rows.length - 1].payment : 0,
      peakPayment: Math.max.apply(null, rows.map(function (r) { return r.payment; })),
      monthlyAverage: months > 0 ? totalPayment / months : 0,
      totalPayment: totalPayment,
      totalInterest: totalInterest,
      totalPrincipal: P
    };
  }

  /* 연도별 집계 — 12개월씩 묶는다. */
  function yearly(result) {
    var out = [];
    var rows = result.rows || [];
    for (var idx = 0; idx < rows.length; idx++) {
      var y = Math.floor(idx / 12);
      if (!out[y]) out[y] = { year: y + 1, principal: 0, interest: 0, payment: 0, balance: 0 };
      out[y].principal += rows[idx].principal;
      out[y].interest += rows[idx].interest;
      out[y].payment += rows[idx].payment;
      out[y].balance = rows[idx].balance;
    }
    return out;
  }

  /* 3가지 상환방식 나란히 비교 */
  function compare(options) {
    var o = options || {};
    var base = {
      principal: o.principal,
      annualRate: o.annualRate,
      months: o.months,
      graceMonths: o.graceMonths
    };
    var equal = schedule({ principal: base.principal, annualRate: base.annualRate, months: base.months, graceMonths: base.graceMonths, method: 'equal' });
    var principal = schedule({ principal: base.principal, annualRate: base.annualRate, months: base.months, graceMonths: base.graceMonths, method: 'principal' });
    var bullet = schedule({ principal: base.principal, annualRate: base.annualRate, months: base.months, graceMonths: base.graceMonths, method: 'bullet' });

    var list = [equal, principal, bullet];
    var minInterest = Math.min.apply(null, list.map(function (r) { return r.totalInterest; }));
    var maxInterest = Math.max.apply(null, list.map(function (r) { return r.totalInterest; }));
    var best = equal;
    list.forEach(function (r) { if (r.totalInterest < best.totalInterest) best = r; });

    return {
      equal: equal,
      principal: principal,
      bullet: bullet,
      best: best.method,
      bestLabel: METHOD_LABEL[best.method],
      minInterest: minInterest,
      maxInterest: maxInterest,
      interestGap: maxInterest - minInterest,
      principalGap: equal.totalInterest - principal.totalInterest
    };
  }

  /* -------------------------------------------------------------------------
     DSR — 1년차 연간 원리금(원리금균등·원금균등은 1년차 합계, 만기일시는 연 이자)
     ------------------------------------------------------------------------- */
  function annualDebtService(principal, annualRate, months, method) {
    var res = schedule({ principal: principal, annualRate: annualRate, months: months, graceMonths: 0, method: method });
    var y = yearly(res);
    return y.length ? y[0].payment : 0;
  }

  /* 원금 1원당 1년차 상환액 — 한도 역산에 쓴다. */
  function serviceFactor(annualRate, months, method) {
    return annualDebtService(1, annualRate, months, method);
  }

  /* -------------------------------------------------------------------------
     스트레스 DSR 계산
     options: { income, existingAnnual, principal, annualRate, months, method,
                addon, limitPct }
     ------------------------------------------------------------------------- */
  function dsr(options) {
    var o = options || {};
    var income = Math.max(0, num(o.income, 0));
    var existing = Math.max(0, num(o.existingAnnual, 0));
    var principal = Math.max(0, num(o.principal, 0));
    var rate = Math.max(0, num(o.annualRate, 0));
    var months = Math.max(1, Math.round(num(o.months, 1)));
    var method = METHOD_LABEL[o.method] ? o.method : 'equal';
    var addon = Math.max(0, num(o.addon, 0));
    var limitPct = num(o.limitPct, RATES.dsrLimit.bank);
    var appliedRate = rate + addon;
    var newAnnual = annualDebtService(principal, appliedRate, months, method);
    var total = existing + newAnnual;
    var limitAmount = income * limitPct / 100;
    var factor = serviceFactor(appliedRate, months, method);
    var available = limitAmount - existing;
    var maxPrincipal = factor > 0 ? Math.max(0, available) / factor : 0;

    return {
      income: income,
      existingAnnual: existing,
      principal: principal,
      annualRate: rate,
      appliedRate: appliedRate,
      addon: addon,
      limitPct: limitPct,
      limitAmount: limitAmount,
      newAnnual: newAnnual,
      totalAnnual: total,
      monthlyNew: newAnnual / 12,
      dsrPct: income > 0 ? total / income * 100 : 0,
      baseDsrPct: income > 0 ? existing / income * 100 : 0,
      headroom: limitAmount - total,
      factor: factor,
      maxPrincipal: floorUnit(maxPrincipal, 10000),
      roomToMax: floorUnit(Math.max(0, maxPrincipal - principal), 10000),
      overLimit: total > limitAmount + 1,
      withinLimit: total <= limitAmount + 1
    };
  }

  /* 신청 예정 금액 없이 '최대 추가 가능 한도'만 역산 */
  function maxLoan(options) {
    var o = options || {};
    var income = Math.max(0, num(o.income, 0));
    var existing = Math.max(0, num(o.existingAnnual, 0));
    var rate = Math.max(0, num(o.annualRate, 0)) + Math.max(0, num(o.addon, 0));
    var months = Math.max(1, Math.round(num(o.months, 1)));
    var method = METHOD_LABEL[o.method] ? o.method : 'equal';
    var limitAmount = income * num(o.limitPct, RATES.dsrLimit.bank) / 100;
    var factor = serviceFactor(rate, months, method);
    var available = limitAmount - existing;
    var raw = factor > 0 ? Math.max(0, available) / factor : 0;
    return {
      appliedRate: rate,
      factor: factor,
      available: available,
      limitAmount: limitAmount,
      maxPrincipal: floorUnit(raw, 10000),
      unlimited: factor <= 0 && available > 0
    };
  }

  /* -------------------------------------------------------------------------
     대환(갈아타기) 손익분기점
     ─ 단순 이자차 모델: 월 이자 절감액 = 잔여원금 × (기존금리 − 신규금리) ÷ 12
     ─ 실제 은행은 원금 감소에 따라 절감액이 줄어들므로 보수적으로 본 값이다.
     ------------------------------------------------------------------------- */
  function refinance(options) {
    var o = options || {};
    var balance = Math.max(0, num(o.balance, 0));
    var oldRate = Math.max(0, num(o.oldRate, 0));
    var newRate = Math.max(0, num(o.newRate, 0));
    var months = Math.max(1, Math.round(num(o.months, 1)));
    var feeRate = Math.max(0, num(o.feeRate, 0));

    var monthlySaving = balance * (oldRate - newRate) / 100 / 12;
    var fee = balance * feeRate / 100;
    var breakeven = monthlySaving > 0 ? fee / monthlySaving : null;
    var grossSaving = monthlySaving * months;
    var netSaving = grossSaving - fee;

    return {
      balance: balance,
      oldRate: oldRate,
      newRate: newRate,
      rateGap: oldRate - newRate,
      months: months,
      feeRate: feeRate,
      monthlySaving: monthlySaving,
      annualSaving: monthlySaving * 12,
      fee: fee,
      breakevenMonths: breakeven,
      breakevenRounded: breakeven === null ? null : Math.ceil(breakeven - 1e-9),
      grossSaving: grossSaving,
      netSaving: netSaving,
      worthIt: breakeven !== null && breakeven <= months && netSaving > 0,
      lowerRate: newRate < oldRate
    };
  }

  var LoanCore = {
    RATES: RATES,
    METHOD_LABEL: METHOD_LABEL,
    TERM_LABEL: TERM_LABEL,
    num: num,
    floorUnit: floorUnit,
    shareBucket: shareBucket,
    stressAddon: stressAddon,
    schedule: schedule,
    yearly: yearly,
    compare: compare,
    annualDebtService: annualDebtService,
    serviceFactor: serviceFactor,
    dsr: dsr,
    maxLoan: maxLoan,
    refinance: refinance
  };

  root.LoanCore = LoanCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = LoanCore;
})(typeof window !== 'undefined' ? window : this);
