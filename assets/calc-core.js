/* ==========================================================================
   생활금융 계산기 허브 — 계산 엔진 (calc-core.js)
   모든 산식은 페이지의 <script>와 분리되어 있어 검증 스크립트에서 직접 호출한다.
   기준: 2026년 공식 요율/법령 (아래 RATES 주석 참고)
   ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------
     2026년 기준 상수
     - 국민연금: 총 9.5% (근로자 4.75%) · 2025.4 국민연금법 개정, 2033년까지 매년 0.5%p 인상
       기준소득월액 하한 41만원 / 상한 659만원 (2026.7.1~2027.6.30 적용)
     - 건강보험: 총 7.19% (근로자 3.595%) · 보수월액 기준
     - 장기요양: 건강보험료의 13.14% (= 보수 대비 0.9448%)
     - 고용보험(실업급여): 총 1.8% (근로자 0.9%)
     - 최저임금: 2026년 시급 10,320원
     - 구직급여 1일 상한 68,100원 / 하한 66,048원(1일 8시간)
     ------------------------------------------------------------------ */
  var RATES = {
    year: 2026,
    pension: { employee: 0.0475, employer: 0.0475, minBase: 410000, maxBase: 6590000 },
    health: { total: 0.0719, employee: 0.03595 },
    ltc: { rateOnHealth: 0.1314 },
    employment: { employee: 0.009, employer: 0.009, stabilitySmall: 0.0025 },
    nonTaxable: { meal: 200000 },
    incomeTax: { personalDeduction: 1500000, localRate: 0.1 },
    jobseek: { dailyMax: 68100, minHourlyWage: 10320, minRate: 0.8 },
    ordinaryWage: { monthlyHours: 209 }
  };

  /* 종합소득 기본세율 (소득세법 제55조) — [과세표준 하한, 세율, 누진공제] */
  var TAX_BRACKETS = [
    [0, 0.06, 0],
    [14000000, 0.15, 1260000],
    [50000000, 0.24, 5760000],
    [88000000, 0.35, 15440000],
    [150000000, 0.38, 19940000],
    [300000000, 0.40, 25940000],
    [500000000, 0.42, 35940000],
    [1000000000, 0.45, 65940000]
  ];

  /* 구직급여 소정급여일수 (고용보험법 별표 1) */
  var JOBSEEK_DAYS = {
    under50: [[1, 120], [3, 150], [5, 180], [10, 210], [Infinity, 240]],
    over50: [[1, 120], [3, 180], [5, 210], [10, 240], [Infinity, 270]]
  };

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : (typeof fallback === 'number' ? fallback : 0);
  }

  /* 원 단위 미만 절사 (국민연금·10원 미만 절사(건강보험) 관행 반영) */
  function floorUnit(value, unit) {
    var u = unit || 1;
    if (!isFinite(value) || value <= 0) return 0;
    return Math.floor(value / u + 1e-9) * u;
  }

  /* ---------- 근로소득공제 (소득세법 제47조) ---------- */
  function earnedIncomeDeduction(grossAnnual) {
    var g = Math.max(0, grossAnnual), d;
    if (g <= 5000000) d = g * 0.7;
    else if (g <= 15000000) d = 3500000 + (g - 5000000) * 0.4;
    else if (g <= 45000000) d = 7500000 + (g - 15000000) * 0.15;
    else if (g <= 100000000) d = 12000000 + (g - 45000000) * 0.05;
    else d = 14750000 + (g - 100000000) * 0.02;
    return Math.min(d, 20000000, g);
  }

  /* ---------- 산출세액 (기본세율) ---------- */
  function incomeTax(taxBase) {
    var base = Math.max(0, taxBase);
    var bracket = TAX_BRACKETS[0];
    for (var i = 0; i < TAX_BRACKETS.length; i += 1) {
      if (base > TAX_BRACKETS[i][0]) bracket = TAX_BRACKETS[i];
    }
    return Math.max(0, base * bracket[1] - bracket[2]);
  }

  /* ---------- 근로소득세액공제 한도 (소득세법 제59조) ---------- */
  function workTaxCreditLimit(grossAnnual) {
    var g = grossAnnual;
    if (g <= 33000000) return 740000;
    if (g <= 70000000) return Math.max(660000, 740000 - (g - 33000000) * 0.008);
    if (g <= 120000000) return Math.max(500000, 660000 - (g - 70000000) * 0.5);
    return Math.max(200000, 500000 - (g - 120000000) * 0.5);
  }

  /* =====================================================================
     1. 연봉·월급 실수령액 & 4대보험
     opts: { mode:'annual'|'monthly', amount, nonTaxable, dependents }
     ===================================================================== */
  function calcSalary(opts) {
    var o = opts || {};
    var mode = o.mode === 'monthly' ? 'monthly' : 'annual';
    var amount = Math.max(0, num(o.amount));
    var dependents = Math.max(1, Math.round(num(o.dependents, 1)));
    var nonTaxableRequested = Math.max(0, num(o.nonTaxable));
    var nonTaxable = Math.min(nonTaxableRequested, RATES.nonTaxable.meal);

    var grossMonthly = mode === 'monthly' ? amount : amount / 12;
    var grossAnnual = grossMonthly * 12;
    var taxableMonthly = Math.max(0, grossMonthly - nonTaxable);

    /* 국민연금: 기준소득월액 상·하한 적용 */
    var pensionBase = taxableMonthly > 0
      ? Math.min(Math.max(taxableMonthly, RATES.pension.minBase), RATES.pension.maxBase)
      : 0;
    var pension = floorUnit(pensionBase * RATES.pension.employee, 1);
    var health = floorUnit(taxableMonthly * RATES.health.employee, 10);
    var ltc = floorUnit(health * RATES.ltc.rateOnHealth, 10);
    var employment = floorUnit(taxableMonthly * RATES.employment.employee, 10);
    var insuranceTotal = pension + health + ltc + employment;

    /* 소득세: 연간 기준으로 산출한 뒤 12로 나눠 월 원천징수 추정 */
    var taxSalary = taxableMonthly * 12;
    var earnedDeduction = earnedIncomeDeduction(taxSalary);
    var earnedIncome = Math.max(0, taxSalary - earnedDeduction);
    var personalDeduction = RATES.incomeTax.personalDeduction * dependents;
    var pensionAnnual = pension * 12;
    var taxBase = Math.max(0, earnedIncome - personalDeduction - pensionAnnual);
    var grossTax = incomeTax(taxBase);
    var creditCalc = grossTax <= 1300000 ? grossTax * 0.55 : 715000 + (grossTax - 1300000) * 0.3;
    var taxCredit = Math.min(creditCalc, workTaxCreditLimit(taxSalary));
    var determinedTax = Math.max(0, grossTax - taxCredit);
    var monthlyIncomeTax = floorUnit(determinedTax / 12, 10);
    var localIncomeTax = floorUnit(monthlyIncomeTax * RATES.incomeTax.localRate, 10);

    var totalDeduction = insuranceTotal + monthlyIncomeTax + localIncomeTax;
    var netMonthly = Math.max(0, grossMonthly - totalDeduction);

    /* 사업주 부담 (참고, 산재보험 제외 · 고용안정 150인 미만 0.25%) */
    var employer = {
      pension: pension,
      health: health,
      ltc: ltc,
      employment: floorUnit(taxableMonthly * RATES.employment.employer, 10),
      stability: floorUnit(taxableMonthly * RATES.employment.stabilitySmall, 10)
    };
    employer.total = employer.pension + employer.health + employer.ltc + employer.employment + employer.stability;

    return {
      mode: mode,
      grossMonthly: grossMonthly,
      grossAnnual: grossAnnual,
      nonTaxable: nonTaxable,
      nonTaxableIgnored: Math.max(0, nonTaxableRequested - nonTaxable),
      taxableMonthly: taxableMonthly,
      pensionBase: pensionBase,
      pension: pension,
      health: health,
      ltc: ltc,
      employment: employment,
      insuranceTotal: insuranceTotal,
      insuranceRate: grossMonthly > 0 ? insuranceTotal / grossMonthly : 0,
      earnedDeduction: earnedDeduction,
      earnedIncome: earnedIncome,
      personalDeduction: personalDeduction,
      pensionAnnual: pensionAnnual,
      taxBase: taxBase,
      grossTax: grossTax,
      taxCredit: taxCredit,
      determinedTax: determinedTax,
      incomeTax: monthlyIncomeTax,
      localIncomeTax: localIncomeTax,
      totalDeduction: totalDeduction,
      netMonthly: netMonthly,
      netAnnual: netMonthly * 12,
      deductionRate: grossMonthly > 0 ? totalDeduction / grossMonthly : 0,
      dependents: dependents,
      employer: employer
    };
  }

  /* =====================================================================
     2. 퇴직금
     opts: { monthlyWage, recent3MonthTotal, daysWorked, daysInPeriod }
     1일 평균임금 = 최근 3개월 임금총액 ÷ 3개월 총일수(기본 92일)
     퇴직금 = 1일 평균임금 × 30 × (재직일수 ÷ 365)
     ===================================================================== */
  function calcSeverance(opts) {
    var o = opts || {};
    var monthlyWage = Math.max(0, num(o.monthlyWage));
    var total = num(o.recent3MonthTotal) > 0 ? num(o.recent3MonthTotal) : monthlyWage * 3;
    var daysInPeriod = num(o.daysInPeriod, 92) > 0 ? num(o.daysInPeriod, 92) : 92;
    var daysWorked = Math.max(0, Math.round(num(o.daysWorked)));
    var averageDailyWage = total / daysInPeriod;
    var severance = averageDailyWage * 30 * (daysWorked / 365);
    return {
      recent3MonthTotal: total,
      daysInPeriod: daysInPeriod,
      daysWorked: daysWorked,
      averageDailyWage: averageDailyWage,
      monthlyAverageWage: averageDailyWage * 30,
      severance: Math.floor(severance),
      eligible: daysWorked >= 365,
      tenureYears: daysWorked / 365
    };
  }

  /* =====================================================================
     3. 실업급여(구직급여)
     opts: { avgMonthlyWage, dailyHours, age, insuredYears }
     ===================================================================== */
  function jobseekDays(age, insuredYears) {
    var table = age >= 50 ? JOBSEEK_DAYS.over50 : JOBSEEK_DAYS.under50;
    var years = Math.max(0, insuredYears);
    if (years < 1) return 120;
    for (var i = 0; i < table.length; i += 1) {
      if (years < table[i][0]) return table[i][1];
    }
    return table[table.length - 1][1];
  }

  function calcUnemployment(opts) {
    var o = opts || {};
    var avgMonthlyWage = Math.max(0, num(o.avgMonthlyWage));
    var dailyHours = Math.min(8, Math.max(1, num(o.dailyHours, 8) || 8));
    var age = Math.max(15, num(o.age, 35));
    var insuredYears = Math.max(0, num(o.insuredYears));
    var averageDailyWage = avgMonthlyWage * 12 / 365;
    var sixty = averageDailyWage * 0.6;
    var minDaily = Math.floor(RATES.jobseek.minHourlyWage * dailyHours * RATES.jobseek.minRate);
    var maxDaily = RATES.jobseek.dailyMax;
    var daily = Math.floor(Math.min(Math.max(sixty, minDaily), maxDaily));
    var days = jobseekDays(age, insuredYears);
    var applied = sixty >= maxDaily ? 'max' : (sixty <= minDaily ? 'min' : 'average');
    return {
      averageDailyWage: averageDailyWage,
      sixtyPercent: sixty,
      minDaily: minDaily,
      maxDaily: maxDaily,
      daily: daily,
      days: days,
      total: daily * days,
      applied: applied,
      monthlyEquivalent: daily * 30,
      age: age,
      insuredYears: insuredYears,
      eligible: insuredYears >= 0.5 /* 실제 수급 요건은 피보험단위기간 180일 이상 */
    };
  }

  /* =====================================================================
     4. 미사용 연차수당
     opts: { monthlyWage, unusedDays, tenureYears, dailyHours }
     1일 통상임금 = 월 통상임금 ÷ 209 × 8 (주 40시간)
     ===================================================================== */
  function calcAnnualLeave(opts) {
    var o = opts || {};
    var monthlyWage = Math.max(0, num(o.monthlyWage));
    var unusedDays = Math.max(0, num(o.unusedDays));
    var tenureYears = Math.max(0, num(o.tenureYears));
    var dailyHours = Math.min(8, Math.max(1, num(o.dailyHours, 8) || 8));
    var hourly = monthlyWage / RATES.ordinaryWage.monthlyHours;
    var daily = hourly * dailyHours;
    var entitled;
    if (tenureYears >= 1) {
      entitled = Math.min(25, 15 + Math.floor((tenureYears - 1) / 2));
    } else {
      entitled = Math.min(11, Math.floor(tenureYears * 12));
    }
    return {
      hourlyWage: hourly,
      dailyWage: daily,
      unusedDays: unusedDays,
      entitledDays: entitled,
      pay: Math.floor(unusedDays * daily),
      tenureYears: tenureYears
    };
  }

  /* =====================================================================
     5. 대출이자 (원리금균등 / 원금균등 / 만기일시)
     opts: { principal, annualRate, months, method }
     ===================================================================== */
  function calcLoan(opts) {
    var o = opts || {};
    var principal = Math.max(0, num(o.principal));
    var annualRate = Math.max(0, num(o.annualRate));
    var months = Math.max(1, Math.round(num(o.months, 12)));
    var method = o.method || 'equal-payment';
    var r = annualRate / 100 / 12;
    var balance = principal;
    var schedule = [];
    var totalInterest = 0;
    var totalPayment = 0;
    var firstPayment = 0;
    var lastPayment = 0;
    var i, interest, principalPart, payment;

    if (method === 'equal-payment') {
      var fixed = r === 0 ? principal / months : principal * r / (1 - Math.pow(1 + r, -months));
      for (i = 1; i <= months; i += 1) {
        interest = balance * r;
        principalPart = Math.min(balance, fixed - interest);
        if (i === months) principalPart = balance;
        payment = principalPart + interest;
        balance = Math.max(0, balance - principalPart);
        totalInterest += interest;
        totalPayment += payment;
        if (i === 1) firstPayment = payment;
        if (i === months) lastPayment = payment;
        schedule.push({
          month: i,
          payment: Math.floor(payment),
          principal: Math.floor(principalPart),
          interest: Math.floor(interest),
          balance: Math.floor(balance)
        });
      }
    } else if (method === 'equal-principal') {
      var principalPartFixed = principal / months;
      for (i = 1; i <= months; i += 1) {
        interest = balance * r;
        principalPart = i === months ? balance : principalPartFixed;
        payment = principalPart + interest;
        balance = Math.max(0, balance - principalPart);
        totalInterest += interest;
        totalPayment += payment;
        if (i === 1) firstPayment = payment;
        if (i === months) lastPayment = payment;
        schedule.push({
          month: i,
          payment: Math.floor(payment),
          principal: Math.floor(principalPart),
          interest: Math.floor(interest),
          balance: Math.floor(balance)
        });
      }
    } else { /* bullet: 만기일시상환 */
      for (i = 1; i <= months; i += 1) {
        interest = principal * r;
        principalPart = i === months ? principal : 0;
        payment = interest + principalPart;
        balance = i === months ? 0 : principal;
        totalInterest += interest;
        totalPayment += payment;
        if (i === 1) firstPayment = payment;
        if (i === months) lastPayment = payment;
        schedule.push({
          month: i,
          payment: Math.floor(payment),
          principal: Math.floor(principalPart),
          interest: Math.floor(interest),
          balance: Math.floor(balance)
        });
      }
    }

    return {
      principal: principal,
      annualRate: annualRate,
      months: months,
      method: method,
      monthlyRate: r,
      firstPayment: Math.floor(firstPayment),
      lastPayment: Math.floor(lastPayment),
      averagePayment: Math.floor(totalPayment / months),
      totalInterest: Math.floor(totalInterest),
      totalPayment: Math.floor(totalPayment),
      schedule: schedule
    };
  }

  /* =====================================================================
     6. 전세 vs 월세 비교
     opts: { jeonseDeposit, loanAmount, loanRate, monthlyDeposit, monthlyRent,
             ownReturnRate, months }
     ===================================================================== */
  function compareJeonse(opts) {
    var o = opts || {};
    var jeonseDeposit = Math.max(0, num(o.jeonseDeposit));
    var loanAmount = Math.min(Math.max(0, num(o.loanAmount)), jeonseDeposit);
    var loanRate = Math.max(0, num(o.loanRate));
    var monthlyDeposit = Math.max(0, num(o.monthlyDeposit));
    var monthlyRent = Math.max(0, num(o.monthlyRent));
    var ownReturnRate = Math.max(0, num(o.ownReturnRate, 3));
    var months = Math.max(1, Math.round(num(o.months, 24)));

    var jeonseOwn = Math.max(0, jeonseDeposit - loanAmount);
    var jeonseLoanInterest = loanAmount * (loanRate / 100) / 12;
    var jeonseOwnCost = jeonseOwn * (ownReturnRate / 100) / 12;
    var jeonseMonthly = jeonseLoanInterest + jeonseOwnCost;

    var monthlyDepositCost = monthlyDeposit * (ownReturnRate / 100) / 12;
    var monthlyTotal = monthlyRent + monthlyDepositCost;

    var conversionRate = jeonseDeposit - monthlyDeposit > 0
      ? (monthlyRent * 12 / (jeonseDeposit - monthlyDeposit)) * 100
      : null;

    return {
      months: months,
      jeonseOwn: jeonseOwn,
      jeonseLoanInterest: jeonseLoanInterest,
      jeonseOwnCost: jeonseOwnCost,
      jeonseMonthly: jeonseMonthly,
      jeonseTotal: jeonseMonthly * months,
      monthlyDepositCost: monthlyDepositCost,
      monthlyTotal: monthlyTotal,
      monthlyTotalCost: monthlyTotal * months,
      differenceMonthly: jeonseMonthly - monthlyTotal,
      differenceTotal: (jeonseMonthly - monthlyTotal) * months,
      cheaper: jeonseMonthly < monthlyTotal ? 'jeonse' : (jeonseMonthly > monthlyTotal ? 'monthly' : 'tie'),
      conversionRate: conversionRate,
      breakEvenRent: Math.max(0, jeonseMonthly - monthlyDepositCost)
    };
  }

  /* =====================================================================
     7. 난방비 예측
     opts: { type:'gas'|'electric', usage, unitPrice, baseFee, people, lastUsage }
     ===================================================================== */
  function calcHeating(opts) {
    var o = opts || {};
    var type = o.type === 'electric' ? 'electric' : 'gas';
    var usage = Math.max(0, num(o.usage));
    var unitPrice = Math.max(0, num(o.unitPrice));
    var baseFee = Math.max(0, num(o.baseFee));
    var people = Math.max(1, Math.round(num(o.people, 1)));
    var lastUsage = Math.max(0, num(o.lastUsage));
    var usageCost = usage * unitPrice;
    var total = usageCost + baseFee;
    var lastTotal = lastUsage * unitPrice + baseFee;
    var delta = total - lastTotal;
    var changeRate = lastTotal > 0 ? (delta / lastTotal) * 100 : null;
    return {
      type: type,
      usage: usage,
      unitPrice: unitPrice,
      baseFee: baseFee,
      usageCost: usageCost,
      total: Math.round(total),
      lastTotal: Math.round(lastTotal),
      delta: Math.round(delta),
      changeRate: changeRate,
      perPerson: Math.round(total / people),
      people: people,
      save10: Math.round(usage * 0.1 * unitPrice),
      save20: Math.round(usage * 0.2 * unitPrice),
      unitCostPerSqmHint: null
    };
  }

  /* =====================================================================
     8. 1/N 더치페이 (개별 추가 금액 반영)
     opts: { total, people, extras:[{name, amount}] }
     기본 1/N = (총액 - 개별 추가 합계) ÷ 인원
     ===================================================================== */
  function splitDutch(opts) {
    var o = opts || {};
    var total = Math.max(0, Math.round(num(o.total)));
    var people = Math.max(1, Math.round(num(o.people, 2)));
    var extras = Array.isArray(o.extras) ? o.extras : [];
    var sumExtras = 0;
    var i;
    for (i = 0; i < extras.length; i += 1) {
      sumExtras += num(extras[i] && extras[i].amount);
    }
    var base = (total - sumExtras) / people;
    var rows = [];
    var exactSum = 0;
    for (i = 0; i < people; i += 1) {
      var extra = extras[i] ? num(extras[i].amount) : 0;
      var exact = base + extra;
      exactSum += exact;
      rows.push({
        index: i,
        name: (extras[i] && extras[i].name) || ('참석자 ' + (i + 1)),
        extra: extra,
        exact: exact,
        amount: Math.floor(exact),
        fraction: exact - Math.floor(exact)
      });
    }
    /* 원 단위 오차를 소수부가 큰 사람부터 1원씩 배분해 합계를 총액과 일치시킨다 */
    var remainder = total - rows.reduce(function (s, r) { return s + r.amount; }, 0);
    var order = rows.slice().sort(function (a, b) { return b.fraction - a.fraction; });
    var step = remainder >= 0 ? 1 : -1;
    var count = Math.abs(Math.round(remainder));
    for (i = 0; i < count; i += 1) {
      order[i % order.length].amount += step;
    }
    return {
      total: total,
      people: people,
      sumExtras: sumExtras,
      base: base,
      rows: rows,
      baseRounded: Math.floor(base),
      negative: base < 0,
      sumResult: rows.reduce(function (s, r) { return s + r.amount; }, 0)
    };
  }

  var CalcCore = {
    RATES: RATES,
    TAX_BRACKETS: TAX_BRACKETS,
    num: num,
    floorUnit: floorUnit,
    earnedIncomeDeduction: earnedIncomeDeduction,
    incomeTax: incomeTax,
    workTaxCreditLimit: workTaxCreditLimit,
    jobseekDays: jobseekDays,
    calcSalary: calcSalary,
    calcSeverance: calcSeverance,
    calcUnemployment: calcUnemployment,
    calcAnnualLeave: calcAnnualLeave,
    calcLoan: calcLoan,
    compareJeonse: compareJeonse,
    calcHeating: calcHeating,
    splitDutch: splitDutch
  };

  root.CalcCore = CalcCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = CalcCore;
})(typeof window !== 'undefined' ? window : this);
