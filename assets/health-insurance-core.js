/* ==========================================================================
   2026 건강보험료·피부양자 자격·퇴직 후 보험료 계산 엔진 (health-insurance-core.js)
   · 모든 산식은 페이지 <script>와 분리되어 있어 검증 스크립트에서 직접 호출한다.
   · 요율 상수는 assets/calc-core.js 의 2026년 값과 100% 동일하게 유지한다.
     (verify_sites.py 가 두 파일의 상수를 교차 비교한다)
   기준: 2026년 국민건강보험공단 요율·부과체계 안내, 국민건강보험법 시행령 별표 4
   ========================================================================== */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------
     2026년 기준 상수
     - 직장가입자 건강보험료율: 7.19% (가입자 3.595% + 사용자 3.595%)
     - 장기요양보험료: 건강보험료 × 13.14% (보수 대비 0.9448%)
     - 지역가입자 재산보험료 부과점수당 금액: 211.5원
     - 지역가입자 월 보험료 하한 20,160원 / 상한 4,591,740원
     - 보수월액 하한 280,667원 / 상한 127,725,731원 (2026년 고시 역산값)
     - 피부양자: 합산소득 연 2,000만원 이하, 재산세 과세표준 5.4억원 이하
                 (5.4억 초과~9억 이하이면 연 소득 1,000만원 이하), 형제자매 1.8억 이하
     ------------------------------------------------------------------ */
  var RATES = {
    year: 2026,
    health: { total: 0.0719, employee: 0.03595 },
    ltc: { rateOnHealth: 0.1314, rateOnIncome: 0.009448 },
    pay: { minBase: 280667, maxBase: 127725731 },
    regional: {
      pointValue: 211.5,
      minIncomePremium: 20160,
      minPremium: 20160,
      maxPremium: 4591740,
      incomeThresholdMonthly: 280000,
      propertyBaseDeduction: 100000000,
      jeonseEvalRate: 0.3,
      rentMultiplier: 40,
      laborPensionEvalRate: 0.5
    },
    dependent: {
      incomeLimit: 20000000,
      incomeLimitHighProperty: 10000000,
      businessIncomeLimitNoReg: 5000000,
      propertyLimit: 540000000,
      propertyLimitHigh: 900000000,
      siblingPropertyLimit: 180000000
    },
    relief: { arbitraryContinuation: 0.5 }
  };

  /* 재산등급별 점수 (국민건강보험법 시행령 별표 4) — [재산금액 상한(만원), 점수] */
  var PROPERTY_BRACKETS = [
    [450, 22], [900, 44], [1350, 66], [1800, 97], [2250, 122], [2700, 146],
    [3150, 171], [3600, 195], [4050, 219], [4500, 244], [5020, 268], [5590, 294],
    [6220, 320], [6930, 344], [7710, 365], [8590, 386], [9570, 412], [10700, 439],
    [11900, 465], [13300, 490], [14800, 516], [16400, 535], [18300, 559], [20400, 586],
    [22700, 611], [25300, 637], [28100, 659], [31300, 681], [34900, 706], [38800, 731],
    [43200, 757], [48100, 785], [53600, 812], [59700, 841], [66500, 881], [74000, 921],
    [82400, 961], [91800, 1001], [103000, 1041], [114000, 1091], [127000, 1141],
    [142000, 1191], [158000, 1241], [176000, 1291], [196000, 1341], [218000, 1391],
    [242000, 1451], [270000, 1511], [300000, 1571], [330000, 1641], [363000, 1711],
    [399300, 1781], [439230, 1851], [483153, 1921], [531468, 1991], [584615, 2061],
    [643077, 2131], [707385, 2201], [778124, 2271], [Infinity, 2341]
  ];

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : (typeof fallback === 'number' ? fallback : 0);
  }

  /* 10원 미만 절사 (건강보험료·장기요양보험료 고지 단위) */
  function floorUnit(value, unit) {
    var u = unit || 1;
    if (!isFinite(value) || value <= 0) return 0;
    return Math.floor(value / u + 1e-9) * u;
  }

  /* =====================================================================
     1. 직장가입자 보수월액보험료 (가입자 50% / 사용자 50%)
     opts: { pay }  pay = 보수월액(원)
     ===================================================================== */
  function calcEmployee(opts) {
    var o = opts || {};
    var pay = Math.max(0, num(o.pay));

    var healthEmployee = floorUnit(pay * RATES.health.employee, 10);
    /* 가입자·사용자가 정확히 50%씩 부담하므로 두 부담분은 같은 금액이 된다 */
    var healthEmployer = healthEmployee;
    var healthTotal = healthEmployee * 2;
    var ltcEmployee = floorUnit(healthEmployee * RATES.ltc.rateOnHealth, 10);
    var ltcEmployer = ltcEmployee;
    var ltcTotal = ltcEmployee + ltcEmployer;

    var employeeTotal = healthEmployee + ltcEmployee;
    var employerTotal = healthEmployer + ltcEmployer;

    return {
      pay: pay,
      healthRateTotal: RATES.health.total,
      healthRateEmployee: RATES.health.employee,
      healthTotal: healthTotal,
      healthEmployee: healthEmployee,
      healthEmployer: healthEmployer,
      ltcTotal: ltcTotal,
      ltcEmployee: ltcEmployee,
      ltcEmployer: ltcEmployer,
      employeeTotal: employeeTotal,
      employerTotal: employerTotal,
      monthTotal: employeeTotal + employerTotal,
      annualEmployee: employeeTotal * 12,
      annualTotal: (employeeTotal + employerTotal) * 12,
      effectiveRate: pay > 0 ? employeeTotal / pay : 0,
      belowMin: pay > 0 && pay < RATES.pay.minBase,
      aboveMax: pay > RATES.pay.maxBase,
      minBase: RATES.pay.minBase,
      maxBase: RATES.pay.maxBase
    };
  }

  /* =====================================================================
     2. 피부양자 자격 자가점검
     opts: { income, businessRegistered, businessIncome, propertyTaxBase,
             relation, livesTogether, marriage, siblingStatus }
       relation: 'spouse' | 'parent' | 'child' | 'sibling'
       marriage: 'single' | 'couple-ok' | 'couple-fail'
       siblingStatus: 'young' | 'senior' | 'disabled' | 'other'
     ===================================================================== */
  function checkDependent(opts) {
    var o = opts || {};
    var income = Math.max(0, num(o.income));
    var businessIncome = Math.max(0, num(o.businessIncome));
    var propertyTaxBase = Math.max(0, num(o.propertyTaxBase));
    var relation = o.relation || 'parent';
    var livesTogether = o.livesTogether !== false;
    var marriage = o.marriage || 'single';
    var siblingStatus = o.siblingStatus || 'other';
    var D = RATES.dependent;

    var checks = [];
    var blockers = [];
    var notes = [];

    function add(key, label, status, detail) {
      checks.push({ key: key, label: label, status: status, detail: detail });
      if (status === 'fail') blockers.push(label + ' — ' + detail);
    }

    /* --- 소득요건 ①: 합산소득 연 2,000만원 이하 --- */
    if (income <= D.incomeLimit) {
      add('income', '합산소득 연 2,000만원 이하', 'pass',
        '연 소득 ' + comma(income / 10000) + '만원 (기준 2,000만원)');
    } else {
      add('income', '합산소득 연 2,000만원 이하', 'fail',
        '연 소득 ' + comma(income / 10000) + '만원으로 기준(2,000만원)을 ' +
        comma((income - D.incomeLimit) / 10000) + '만원 초과했습니다');
    }

    /* --- 소득요건 ②: 사업소득 --- */
    if (o.businessRegistered) {
      if (businessIncome <= 0) {
        add('business', '사업소득 없음 (사업자등록자)', 'pass',
          '사업자등록이 있어도 사업소득이 없으면 소득요건을 충족합니다. 주택임대소득은 등록 여부와 관계없이 있으면 제외됩니다');
      } else {
        add('business', '사업소득 없음 (사업자등록자)', 'fail',
          '사업자등록이 있고 사업소득 ' + comma(businessIncome / 10000) + '만원이 있어 피부양자에서 제외됩니다');
      }
    } else if (businessIncome <= D.businessIncomeLimitNoReg) {
      add('business', '사업소득 연 500만원 이하 (사업자등록 없음)', 'pass',
        '사업소득 ' + comma(businessIncome / 10000) + '만원 (기준 500만원)');
    } else {
      add('business', '사업소득 연 500만원 이하 (사업자등록 없음)', 'fail',
        '사업자등록은 없지만 사업소득이 연 ' + comma(businessIncome / 10000) + '만원으로 500만원을 넘습니다');
    }

    /* --- 재산요건 --- */
    var propLimit = relation === 'sibling' ? D.siblingPropertyLimit : D.propertyLimit;
    if (relation === 'sibling') {
      if (propertyTaxBase <= D.siblingPropertyLimit) {
        add('property', '재산세 과세표준 1.8억원 이하 (형제자매)', 'pass',
          '재산세 과세표준 ' + eokText(propertyTaxBase) + ' (기준 1억 8,000만원)');
      } else {
        add('property', '재산세 과세표준 1.8억원 이하 (형제자매)', 'fail',
          '형제자매는 재산세 과세표준 1억 8,000만원 이하이어야 하는데 ' + eokText(propertyTaxBase) + '입니다');
      }
    } else if (propertyTaxBase <= D.propertyLimit) {
      add('property', '재산세 과세표준 5.4억원 이하', 'pass',
        '재산세 과세표준 ' + eokText(propertyTaxBase) + ' (기준 5억 4,000만원)');
    } else if (propertyTaxBase <= D.propertyLimitHigh) {
      if (income <= D.incomeLimitHighProperty) {
        add('property', '재산 5.4억 초과~9억 이하 + 연 소득 1,000만원 이하', 'pass',
          '재산세 과세표준 ' + eokText(propertyTaxBase) + '·연 소득 ' +
          comma(income / 10000) + '만원. 두 조건을 함께 충족합니다');
      } else {
        add('property', '재산 5.4억 초과~9억 이하 + 연 소득 1,000만원 이하', 'fail',
          '재산세 과세표준이 5억 4,000만원을 넘으면 연 소득이 1,000만원 이하여야 하는데 ' +
          comma(income / 10000) + '만원입니다');
      }
    } else {
      add('property', '재산세 과세표준 9억원 이하', 'fail',
        '재산세 과세표준 ' + eokText(propertyTaxBase) + '으로 9억원을 넘어 소득과 관계없이 피부양자가 될 수 없습니다');
    }
    if (propertyTaxBase > propLimit && relation !== 'sibling') {
      notes.push('5억 4,000만원을 넘는 재산은 연 소득 1,000만원 이하일 때만 인정됩니다. 재산은 재산세 고지서의 ‘과세표준’ 합계로 판단합니다(공시가격 아님).');
    }

    /* --- 부양요건 --- */
    if (relation === 'spouse') {
      add('support', '부양요건: 배우자', 'pass',
        '배우자는 동거·비동거와 관계없이 부양요건을 충족합니다');
    } else if (relation === 'sibling') {
      if (siblingStatus === 'other') {
        add('support', '부양요건: 형제자매', 'fail',
          '형제자매는 미혼이면서 30세 미만·65세 이상·장애인·국가유공자 중 하나에 해당해야 합니다');
      } else {
        add('support', '부양요건: 형제자매', 'pass',
          '미혼이며 ' + (siblingStatus === 'young' ? '30세 미만' : siblingStatus === 'senior' ? '65세 이상' : '장애인') +
          ' 요건에 해당하는 형제자매입니다');
      }
    } else if (livesTogether) {
      add('support', '부양요건: 동거 직계존·비속', 'pass',
        '함께 거주하는 ' + (relation === 'parent' ? '직계존속' : '직계비속') + '은 부양요건을 충족합니다');
    } else {
      add('support', '부양요건: 비동거 직계존·비속', 'warn',
        '따로 사는 직계존속은 다른 부양의무자(형제자매)의 유무·소득에 따라 판단이 달라질 수 있어 공단 확인이 필요합니다');
    }

    /* --- 기혼자 부부 요건 --- */
    if (marriage === 'couple-fail') {
      add('couple', '기혼자는 부부 모두 소득·재산 요건 충족', 'fail',
        '피부양자가 되려는 사람이 기혼이면 부부 모두 소득·재산 요건을 충족해야 합니다');
    } else if (marriage === 'couple-ok') {
      add('couple', '기혼자는 부부 모두 소득·재산 요건 충족', 'pass',
        '배우자도 같은 기준을 충족하는 것으로 입력했습니다');
    } else {
      add('couple', '기혼자는 부부 모두 소득·재산 요건 충족', 'pass', '미혼으로 입력했습니다');
    }

    var failed = checks.filter(function (c) { return c.status === 'fail'; }).length;
    var warned = checks.filter(function (c) { return c.status === 'warn'; }).length;

    return {
      checks: checks,
      blockers: blockers,
      notes: notes,
      failedCount: failed,
      warnCount: warned,
      verdict: failed === 0 ? (warned === 0 ? 'eligible' : 'check') : 'ineligible',
      verdictText: failed === 0
        ? (warned === 0 ? '요건 충족 — 피부양자 신고를 검토할 수 있습니다' : '요건 충족(확인 필요) — 공단 상담 권장')
        : '요건 미충족 — 피부양자 등재가 어렵습니다',
      basis: '국민건강보험법 시행규칙 별표 1의2 (소득·재산), 별표 1 (부양요건)',
      income: income,
      propertyTaxBase: propertyTaxBase
    };
  }

  function comma(n) {
    var s = String(Math.round(n));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function eokText(won) {
    var eok = Math.floor(won / 100000000);
    var man = Math.round((won % 100000000) / 10000);
    if (eok <= 0) return comma(man) + '만원';
    return eok + '억' + (man > 0 ? ' ' + comma(man) + '만원' : '원');
  }

  /* =====================================================================
     3. 지역가입자 재산보험료 부과점수 (시행령 별표 4)
     ===================================================================== */
  function propertyScore(opts) {
    var o = opts || {};
    var owned = Math.max(0, num(o.propertyTaxBase));
    var deposit = Math.max(0, num(o.deposit));
    var monthlyRent = Math.max(0, num(o.monthlyRent));
    var rented = deposit + monthlyRent * RATES.regional.rentMultiplier;
    var evalRented = rented * RATES.regional.jeonseEvalRate;
    var total = owned + evalRented;
    var net = Math.max(0, total - RATES.regional.propertyBaseDeduction);
    var man = net / 10000;
    var score = 0;
    if (net > 0) {
      for (var i = 0; i < PROPERTY_BRACKETS.length; i += 1) {
        if (man <= PROPERTY_BRACKETS[i][0]) { score = PROPERTY_BRACKETS[i][1]; break; }
      }
    }
    return {
      owned: owned,
      rented: rented,
      evalRented: evalRented,
      total: total,
      deduction: RATES.regional.propertyBaseDeduction,
      net: net,
      score: score,
      premium: floorUnit(score * RATES.regional.pointValue, 10)
    };
  }

  /* =====================================================================
     4. 지역가입자 월 보험료 추정
     opts: { incomeFinance, incomeLaborPension, propertyTaxBase, deposit, monthlyRent }
     ===================================================================== */
  function estimateRegional(opts) {
    var o = opts || {};
    var finance = Math.max(0, num(o.incomeFinance));
    var labor = Math.max(0, num(o.incomeLaborPension)) * RATES.regional.laborPensionEvalRate;
    var evalIncome = finance + labor;
    var incomeMonthly = evalIncome / 12;

    var incomePart;
    var appliedLowIncome = incomeMonthly <= RATES.regional.incomeThresholdMonthly;
    if (appliedLowIncome) {
      incomePart = RATES.regional.minIncomePremium;
    } else {
      incomePart = floorUnit(incomeMonthly * RATES.health.total, 10);
    }

    var prop = propertyScore(o);
    var health = incomePart + prop.premium;
    var capped = false;
    if (health > RATES.regional.maxPremium) {
      health = RATES.regional.maxPremium;
      capped = true;
    }
    if (health < RATES.regional.minPremium) health = RATES.regional.minPremium;
    var ltc = floorUnit(health * RATES.ltc.rateOnHealth, 10);

    return {
      evalIncome: evalIncome,
      financeIncome: finance,
      laborPensionEval: labor,
      incomeMonthly: incomeMonthly,
      incomePart: incomePart,
      appliedLowIncome: appliedLowIncome,
      property: prop,
      propertyPart: prop.premium,
      health: health,
      ltc: ltc,
      total: health + ltc,
      cap: RATES.regional.maxPremium,
      capped: capped
    };
  }

  /* =====================================================================
     5. 퇴직 후 임의계속가입 vs 지역가입자 비교
     opts: calcEmployee 옵션 + estimateRegional 옵션 + months
     임의계속 보험료 = 최근 12개월 평균 보수월액 × 7.19% 를 전액 본인이 부담하되
     보험료 경감고시 제9조에 따라 50%를 경감 → 재직 중 본인 부담과 같은 금액
     ===================================================================== */
  function compareAfterJob(opts) {
    var o = opts || {};
    var months = Math.max(1, Math.round(num(o.months, 36)));
    var avgPay = Math.max(0, num(o.avgPay));

    var keep = calcEmployee({ pay: avgPay });
    var keepFullHealth = floorUnit(avgPay * RATES.health.total, 10);
    var keepFullLtc = floorUnit(keepFullHealth * RATES.ltc.rateOnHealth, 10);
    var regional = estimateRegional(o);

    var diffMonthly = regional.total - keep.employeeTotal;
    var cheaper = diffMonthly === 0 ? 'tie' : (diffMonthly > 0 ? 'keep' : 'regional');

    return {
      months: months,
      averagePay: avgPay,
      keep: {
        health: keep.healthEmployee,
        ltc: keep.ltcEmployee,
        total: keep.employeeTotal,
        fullHealth: keepFullHealth,
        fullLtc: keepFullLtc,
        fullTotal: keepFullHealth + keepFullLtc,
        reliefRate: RATES.relief.arbitraryContinuation
      },
      regional: regional,
      diffMonthly: Math.abs(diffMonthly),
      diffSigned: diffMonthly,
      diffTotal: Math.abs(diffMonthly) * months,
      cheaper: cheaper,
      cheaperText: cheaper === 'keep'
        ? '임의계속가입이 월 ' + comma(Math.abs(diffMonthly)) + '원 유리'
        : cheaper === 'regional'
          ? '지역가입자가 월 ' + comma(Math.abs(diffMonthly)) + '원 유리'
          : '두 경로의 월 부담이 같습니다'
    };
  }

  var HealthCore = {
    RATES: RATES,
    PROPERTY_BRACKETS: PROPERTY_BRACKETS,
    num: num,
    floorUnit: floorUnit,
    comma: comma,
    eokText: eokText,
    calcEmployee: calcEmployee,
    checkDependent: checkDependent,
    propertyScore: propertyScore,
    estimateRegional: estimateRegional,
    compareAfterJob: compareAfterJob
  };

  root.HealthCore = HealthCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = HealthCore;
})(typeof window !== 'undefined' ? window : this);
