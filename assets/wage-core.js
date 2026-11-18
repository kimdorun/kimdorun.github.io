/* ==========================================================================
   생활금융 계산기 허브 — 시급·주휴수당·가산수당 엔진 (wage-core.js)
   ─ 모든 산식은 페이지의 <script>와 분리되어 있어 검증 스크립트에서 직접 호출한다.
   ─ 기준: 2026년 최저임금 고용노동부고시 제2025-47호(2025.8.5.) 및 근로기준법
     · 시급 10,320원 / 일급(8시간) 82,560원 / 월 환산 2,156,880원 (209시간)
     · 수습 감액 10%(1년 이상 계약 + 단순노무직 아님 + 3개월 이내) → 9,288원
     · 주휴수당: 근로기준법 제55조 제1항, 제18조 제3항, 시행령 제30조·별표 1·별표 2
     · 가산수당: 근로기준법 제56조 (상시 5인 이상 사업장)
   ─ 금액 상수는 assets/calc-core.js 의 RATES 와 교차 검증된다(한쪽만 바꾸면 검증 실패).
   ─ 네트워크 호출 0건 · Intl 미사용(QuickJS 단위 테스트 가능)
   ========================================================================== */
(function (root) {
  'use strict';

  var RATES = {
    year: 2026,
    /* 2026년 적용 최저임금 (고용노동부고시 제2025-47호) */
    minimum: {
      hourly: 10320,
      dailyHours: 8,
      daily: 82560,
      officialMonthHours: 209,
      monthly: 2156880,
      welfareExcludeRate: 0.07   /* 복리후생비 최저임금 미산입 한도(월 환산액의 7%) */
    },
    /* 시간 환산 상수 */
    hours: {
      legalWeekly: 40,
      legalDaily: 8,
      fullHoliday: 8,
      monthWeeks: 365 / 7 / 12,   /* 4.3452380952... */
      insuranceMinMonthly: 60      /* 국민연금·건강보험 적용 제외 기준(월 60시간 미만) */
    },
    /* 주휴수당 */
    holiday: {
      minWeeklyHours: 15,
      maxHolidayHours: 8
    },
    /* 수습 감액 */
    probation: {
      months: 3,
      rate: 0.9,
      reducedHourly: 9288
    },
    /* 가산수당 가산율 (1.0배 기본임금에 더해지는 비율) */
    addon: {
      extension: 0.5,
      night: 0.5,
      holidayWithin8: 0.5,
      holidayOver8: 1.0,
      weeklyExtensionLimit: 12
    },
    /* 4대보험 근로자 부담 (calc-core.js 와 동일 값) */
    insurance: {
      pension: 0.0475,
      health: 0.03595,
      ltcOnHealth: 0.1314,
      employment: 0.009
    },
    pensionBase: { min: 410000, max: 6590000 },
    nonTaxable: { meal: 200000 },
    withholding: { business33: 0.033 }
  };

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : (typeof fallback === 'number' ? fallback : 0);
  }

  function floorUnit(value, unit) {
    var u = unit || 1;
    if (!isFinite(value) || value <= 0) return 0;
    return Math.floor(value / u + 1e-9) * u;
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  /* ------------------------------------------------------------------
     소정근로시간 구조 — 1주 소정근로시간 / 주휴시간 / 월 환산시간
     · 1주 소정근로시간은 법정 40시간까지만 소정근로로 본다(초과분은 연장근로).
     · 주휴시간 = (1주 소정근로시간 ÷ 40) × 8, 상한 8시간.
     · 1주 소정근로 40시간 + 주휴 8시간이면 고시의 월 환산 기준시간 209시간을 그대로 쓴다.
       그 밖의 시간제는 (주 소정근로 + 주휴) × 365/7/12 로 환산한다(4.3452주).
     ------------------------------------------------------------------ */
  function hourStructure(opts) {
    var o = opts || {};
    var dailyHours = clamp(num(o.dailyHours, RATES.hours.legalDaily) || RATES.hours.legalDaily,
      1, RATES.hours.legalDaily);
    var weeklyDays = clamp(Math.round(num(o.weeklyDays, 5) || 5), 1, 7);
    var weeklyRaw = dailyHours * weeklyDays;
    var weeklyScheduled = Math.min(RATES.hours.legalWeekly, weeklyRaw);
    var weeklyOvertime = Math.max(0, weeklyRaw - RATES.hours.legalWeekly);

    var holidayHours = weeklyScheduled >= RATES.holiday.minWeeklyHours
      ? Math.min(RATES.holiday.maxHolidayHours,
        weeklyScheduled / RATES.hours.legalWeekly * RATES.hours.fullHoliday)
      : 0;

    var isFullTime = weeklyScheduled >= RATES.hours.legalWeekly && holidayHours >= RATES.hours.fullHoliday;
    var monthHoursExact = (weeklyScheduled + holidayHours) * RATES.hours.monthWeeks;
    var monthHours = isFullTime ? RATES.minimum.officialMonthHours : round1(monthHoursExact);
    /* 금액 계산에는 공시 209시간(주 40시간) 또는 정확한 4.3452주 환산시간을 쓴다 */
    var payHours = isFullTime ? RATES.minimum.officialMonthHours : monthHoursExact;

    return {
      dailyHours: dailyHours,
      weeklyDays: weeklyDays,
      weeklyRaw: weeklyRaw,
      weeklyScheduled: weeklyScheduled,
      weeklyOvertime: weeklyOvertime,
      holidayHours: holidayHours,
      holidayEligible: holidayHours > 0,
      monthHours: monthHours,
      monthHoursExact: monthHoursExact,
      payHours: payHours,
      official209: isFullTime,
      monthWeeks: RATES.hours.monthWeeks
    };
  }

  /* =====================================================================
     1) 시급 → 일급 / 주급 / 주휴수당 / 월급 / 실수령액
     opts: { hourly, dailyHours, weeklyDays, probation, deduction }
       deduction: 'none' | 'business'(3.3%) | 'insurance'(4대보험)
     ===================================================================== */
  function calcWage(opts) {
    var o = opts || {};
    var hourly = Math.max(0, num(o.hourly, RATES.minimum.hourly));
    var probation = !!o.probation;
    var appliedHourly = probation ? Math.round(hourly * RATES.probation.rate) : Math.round(hourly);
    var hours = hourStructure(o);

    var dailyWage = Math.floor(appliedHourly * hours.dailyHours);
    var weeklyWorkPay = Math.floor(appliedHourly * hours.weeklyScheduled);
    var weeklyHolidayPay = Math.floor(appliedHourly * hours.holidayHours);
    var weeklyTotal = weeklyWorkPay + weeklyHolidayPay;

    var monthlyWage = Math.floor(appliedHourly * hours.payHours);
    var monthlyHolidayPay = Math.floor(hours.holidayHours * appliedHourly * hours.monthWeeks);
    var monthlyWorkPay = monthlyWage - monthlyHolidayPay;

    /* ---------- 공제 ---------- */
    var mode = o.deduction === 'business' || o.deduction === 'insurance' ? o.deduction : 'none';
    var deduction = { mode: mode, total: 0, net: monthlyWage, lines: [], notice: '' };

    if (mode === 'business') {
      var withheld = floorUnit(monthlyWage * RATES.withholding.business33, 1);
      deduction.lines.push({ key: 'tax33', label: '사업소득 원천징수 3.3%', amount: withheld });
      deduction.total = withheld;
      deduction.notice = '3.3%는 사업소득(프리랜서) 원천징수 방식입니다. 실제 근로자라면 근로소득세·4대보험이 적용되어야 하므로, 사업소득세 3.3%만 떼는 계약은 근로자성 다툼의 소지가 있습니다.';
    } else if (mode === 'insurance') {
      var skipped = hours.payHours < RATES.hours.insuranceMinMonthly;
      var pensionBase = monthlyWage > 0
        ? clamp(monthlyWage, RATES.pensionBase.min, RATES.pensionBase.max) : 0;
      var pension = skipped ? 0 : floorUnit(pensionBase * RATES.insurance.pension, 1);
      var health = skipped ? 0 : floorUnit(monthlyWage * RATES.insurance.health, 10);
      var ltc = skipped ? 0 : floorUnit(health * RATES.insurance.ltcOnHealth, 10);
      var employment = floorUnit(monthlyWage * RATES.insurance.employment, 10);
      deduction.lines.push({ key: 'pension', label: '국민연금 4.75%', amount: pension });
      deduction.lines.push({ key: 'health', label: '건강보험 3.595%', amount: health });
      deduction.lines.push({ key: 'ltc', label: '장기요양 (건보의 13.14%)', amount: ltc });
      deduction.lines.push({ key: 'employment', label: '고용보험 0.9%', amount: employment });
      deduction.total = pension + health + ltc + employment;
      deduction.skippedPensionHealth = skipped;
      deduction.notice = skipped
        ? '월 소정근로시간이 60시간 미만이라 국민연금·건강보험·장기요양은 빼지 않았습니다(고용보험만 적용). 다만 3개월 이상 계속 근로하면 국민연금·건강보험 대상이 될 수 있습니다.'
        : '4대보험 근로자 부담만 계산했습니다. 소득세·지방소득세는 근로소득 간이세액표에 따라 별도로 떼므로, 실제 실수령액은 이 금액보다 조금 적습니다.';
    }
    deduction.net = Math.max(0, monthlyWage - deduction.total);

    return {
      hourly: hourly,
      appliedHourly: appliedHourly,
      probation: probation,
      dailyHours: hours.dailyHours,
      weeklyDays: hours.weeklyDays,
      weeklyRaw: hours.weeklyRaw,
      weeklyScheduled: hours.weeklyScheduled,
      weeklyOvertime: hours.weeklyOvertime,
      holidayHours: hours.holidayHours,
      holidayEligible: hours.holidayEligible,
      monthHours: hours.monthHours,
      monthHoursExact: hours.monthHoursExact,
      payHours: hours.payHours,
      official209: hours.official209,
      dailyWage: dailyWage,
      weeklyWorkPay: weeklyWorkPay,
      weeklyHolidayPay: weeklyHolidayPay,
      weeklyTotal: weeklyTotal,
      monthlyWage: monthlyWage,
      monthlyWorkPay: monthlyWorkPay,
      monthlyHolidayPay: monthlyHolidayPay,
      annualWage: monthlyWage * 12,
      deduction: deduction,
      net: deduction.net,
      deductionRate: monthlyWage > 0 ? deduction.total / monthlyWage : 0
    };
  }

  /* =====================================================================
     2) 연장·야간·휴일 가산수당
     opts: { baseHourly, sizeFivePlus, overtimeHours, nightHours,
             holidayIn8Hours, holidayOver8Hours }
     · 상시 5인 이상: 연장 0.5 / 야간 0.5 / 휴일 8시간 이내 0.5 / 휴일 8시간 초과 1.0 가산
     · 상시 5인 미만: 제56조 미적용 → 가산 0, 기본임금 1.0배만 지급
     ===================================================================== */
  function calcAddon(opts) {
    var o = opts || {};
    var baseHourly = Math.max(0, num(o.baseHourly, RATES.minimum.hourly));
    var fivePlus = o.sizeFivePlus !== false;
    var ot = Math.max(0, num(o.overtimeHours));
    var night = Math.max(0, num(o.nightHours));
    var holIn = Math.max(0, num(o.holidayIn8Hours));
    var holOver = Math.max(0, num(o.holidayOver8Hours));

    var rates = {
      extension: fivePlus ? RATES.addon.extension : 0,
      night: fivePlus ? RATES.addon.night : 0,
      holidayWithin8: fivePlus ? RATES.addon.holidayWithin8 : 0,
      holidayOver8: fivePlus ? RATES.addon.holidayOver8 : 0
    };

    function item(key, label, hours, premiumRate) {
      var multiplier = 1 + premiumRate;
      return {
        key: key,
        label: label,
        hours: hours,
        multiplier: multiplier,
        base: Math.floor(baseHourly * hours),
        premium: Math.floor(baseHourly * premiumRate * hours),
        amount: Math.floor(baseHourly * multiplier * hours)
      };
    }

    var items = [
      item('extension', '연장근로', ot, rates.extension),
      item('night', '야간근로(22:00~06:00)', night, rates.night),
      item('holidayIn8', '휴일근로 8시간 이내', holIn, rates.holidayWithin8),
      item('holidayOver8', '휴일근로 8시간 초과', holOver, rates.holidayOver8)
    ];

    var totalHours = ot + night + holIn + holOver;
    var totalPay = 0, basePay = 0, premiumPay = 0;
    for (var i = 0; i < items.length; i += 1) {
      totalPay += items[i].amount;
      basePay += items[i].base;
      premiumPay += items[i].premium;
    }

    return {
      baseHourly: baseHourly,
      sizeFivePlus: fivePlus,
      rates: rates,
      items: items,
      totalHours: totalHours,
      totalPay: totalPay,
      basePay: basePay,
      premiumPay: premiumPay,
      monthlyEquivalent: Math.floor(totalPay * RATES.hours.monthWeeks),
      weeklyOvertime: ot,
      overWeeklyLimit: fivePlus && ot > RATES.addon.weeklyExtensionLimit
    };
  }

  /* =====================================================================
     3) 월급 역산 & 최저임금 위반 점검
     opts: { monthlyPay, mealAllowance, dailyHours, weeklyDays }
     · 비교대상 임금 = 월 지급액 − 비과세 식대(월 20만원 한도)
     · 환산 시급 = 비교대상 임금 ÷ 월 환산시간(주휴시간 포함)
     · 최저임금 월 환산액 = 10,320원 × 월 환산시간
     ===================================================================== */
  function calcReverse(opts) {
    var o = opts || {};
    var monthlyPay = Math.max(0, num(o.monthlyPay));
    var hours = hourStructure(o);
    var mealRequested = Math.max(0, num(o.mealAllowance));
    /* 최저임금 산입 제외 한도는 두 가지를 모두 넘지 않는다.
       ① 소득세 비과세 식대 월 20만원
       ② 복리후생비 미산입 한도 = 최저임금 월 환산액의 7% (최저임금법 시행령 제2조) */
    var nonTaxableCap = RATES.nonTaxable.meal;
    var minWageInclusionCap = RATES.minimum.hourly * hours.payHours * RATES.minimum.welfareExcludeRate;
    var mealExcluded = Math.floor(Math.min(mealRequested, nonTaxableCap, minWageInclusionCap));
    var comparablePay = Math.max(0, monthlyPay - mealExcluded);
    var hourly = hours.payHours > 0 ? comparablePay / hours.payHours : 0;
    var hourlyFloor = Math.floor(hourly);
    var minimumPay = Math.floor(RATES.minimum.hourly * hours.payHours);
    var gap = Math.floor(comparablePay - minimumPay);
    var minShortfall = gap < 0 ? -gap : 0;

    return {
      monthlyPay: monthlyPay,
      mealRequested: mealRequested,
      mealExcluded: mealExcluded,
      nonTaxableCap: nonTaxableCap,
      minWageInclusionCap: minWageInclusionCap,
      mealIgnored: Math.max(0, mealRequested - mealExcluded),
      comparablePay: comparablePay,
      monthHours: hours.monthHours,
      monthHoursExact: hours.monthHoursExact,
      payHours: hours.payHours,
      official209: hours.official209,
      weeklyScheduled: hours.weeklyScheduled,
      holidayHours: hours.holidayHours,
      dailyHours: hours.dailyHours,
      weeklyDays: hours.weeklyDays,
      hourly: hourly,
      hourlyFloor: hourlyFloor,
      displayHourly: hours.payHours > 0 ? monthlyPay / hours.payHours : 0,
      minimumHourly: RATES.minimum.hourly,
      minimumPay: minimumPay,
      gap: gap,
      /* 판정은 원 단위 월 금액으로 한다 — 시급을 원 미만 버림한 값과 비교하면 1원 미만 오차로 뒤집힌다 */
      passes: comparablePay + 1e-6 >= minimumPay,
      shortfallMonthly: minShortfall,
      shortfallAnnual: minShortfall * 12,
      hourlyShortfall: hourly < RATES.minimum.hourly ? RATES.minimum.hourly - hourly : 0
    };
  }

  /* 최저임금 충족 판정 (시급 기준) */
  function checkMinimum(opts) {
    var o = opts || {};
    var hourly = Math.max(0, num(o.hourly));
    var probation = !!o.probation;
    var applied = probation ? Math.round(hourly * RATES.probation.rate) : Math.round(hourly);
    var gap = hourly - RATES.minimum.hourly;
    return {
      hourly: hourly,
      appliedHourly: applied,
      probation: probation,
      requiredHourly: RATES.minimum.hourly,
      requiredDaily: RATES.minimum.daily,
      requiredMonthly: RATES.minimum.monthly,
      passes: hourly + 1e-9 >= RATES.minimum.hourly,
      gap: gap,
      gapRate: RATES.minimum.hourly > 0 ? gap / RATES.minimum.hourly : 0,
      legal: probation ? applied + 1e-9 >= RATES.probation.reducedHourly : hourly + 1e-9 >= RATES.minimum.hourly
    };
  }

  var WageCore = {
    RATES: RATES,
    num: num,
    floorUnit: floorUnit,
    hourStructure: hourStructure,
    calcWage: calcWage,
    calcAddon: calcAddon,
    calcReverse: calcReverse,
    checkMinimum: checkMinimum
  };

  root.WageCore = WageCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = WageCore;
})(typeof window !== 'undefined' ? window : this);
