/* ==========================================================================
   생활금융 계산기 허브 — 2026년 귀속 연말정산 미리보기 산식 (Vanilla JS)
   · 신용카드 등 소득공제 (최저사용금액 25%, 공제율 15/30/40%, 기본한도+자녀 추가한도+전통시장·대중교통 추가한도)
   · 월세 세액공제 (총급여 5,500만 이하 17% / 8,000만 이하 15%, 연 1,000만원 한도)
   · 연금저축·IRP 세액공제 (총급여 5,500만 이하 16.5% / 초과 13.2%, 연 900만원 한도)
   · 카드 소득공제의 절세 효과는 추정 한계세율로 환산
   ※ 모든 값은 원(KRW) 단위. 참고용 모의 계산이며 법적 효력이 없습니다.
   ========================================================================== */
(function (root) {
  'use strict';

  var CONST = {
    // 최저사용금액 = 총급여 × 25%
    THRESHOLD_RATE: 0.25,
    // 결제수단별 소득공제율
    RATE_CREDIT: 0.15,
    RATE_DEBIT: 0.30,
    RATE_MARKET: 0.40,
    // 기본한도 (2026년 지출분, 부양자녀 없음 기준)
    GROSS_CAP_SPLIT: 70000000,
    CAP_LOW: 3000000,
    CAP_HIGH: 2500000,
    // 부양자녀 추가한도 (2026년 지출분부터 적용)
    CHILD_EXTRA_LOW: [0, 500000, 1000000],
    CHILD_EXTRA_HIGH: [0, 250000, 500000],
    // 전통시장·대중교통(·문화비) 추가공제 한도
    ADD_CAP_LOW: 3000000,
    ADD_CAP_HIGH: 2000000,
    // 월세 세액공제
    RENT_CAP: 10000000,
    RENT_SPLIT1: 55000000,
    RENT_SPLIT2: 80000000,
    RENT_RATE_LOW: 0.17,
    RENT_RATE_MID: 0.15,
    // 연금저축·IRP 세액공제 (지방소득세 포함)
    PENSION_CAP: 9000000,
    PENSION_SPLIT: 55000000,
    PENSION_RATE_LOW: 0.165,
    PENSION_RATE_HIGH: 0.132,
    // 2026년 귀속 종합소득세 기본세율 구간 (과세표준 상한, 세율)
    BRACKETS: [
      [14000000, 0.06],
      [50000000, 0.15],
      [88000000, 0.24],
      [150000000, 0.35],
      [300000000, 0.38],
      [500000000, 0.40],
      [1000000000, 0.42],
      [Infinity, 0.45]
    ],
    PENSION_BASE_CAP: 3130250   // 국민연금 기준소득월액 상한 659만원 × 4.75% × 12개월 근사
  };

  function num(value) {
    var n = typeof value === 'number' ? value : parseFloat(String(value == null ? '' : value).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function clamp0(n) { return n > 0 ? n : 0; }

  function comma(n) {
    return String(Math.round(num(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* 소득세법상 근로소득공제 (2026년 기준) */
  function earnedIncomeDeduction(gross) {
    if (gross <= 5000000) return gross * 0.7;
    if (gross <= 15000000) return 3500000 + (gross - 5000000) * 0.4;
    if (gross <= 45000000) return 7500000 + (gross - 15000000) * 0.15;
    if (gross <= 100000000) return 12000000 + (gross - 45000000) * 0.05;
    return 14750000 + (gross - 100000000) * 0.02;
  }

  function marginalRate(gross, cardDeduction) {
    var pensionDeduct = Math.min(gross * 0.0475, CONST.PENSION_BASE_CAP);
    var base = gross - earnedIncomeDeduction(gross) - 1500000 - pensionDeduct - clamp0(cardDeduction);
    if (base <= 0) return 0.06;
    for (var i = 0; i < CONST.BRACKETS.length; i++) {
      if (base <= CONST.BRACKETS[i][0]) return CONST.BRACKETS[i][1];
    }
    return 0.45;
  }

  /* 기본한도 = 기본 + 부양자녀 추가한도 */
  function basicCap(gross, children) {
    var idx = children >= 2 ? 2 : (children === 1 ? 1 : 0);
    var low = gross <= CONST.GROSS_CAP_SPLIT;
    var cap = (low ? CONST.CAP_LOW : CONST.CAP_HIGH) + (low ? CONST.CHILD_EXTRA_LOW[idx] : CONST.CHILD_EXTRA_HIGH[idx]);
    return {
      base: low ? CONST.CAP_LOW : CONST.CAP_HIGH,
      childExtra: low ? CONST.CHILD_EXTRA_LOW[idx] : CONST.CHILD_EXTRA_HIGH[idx],
      total: cap,
      addCap: low ? CONST.ADD_CAP_LOW : CONST.ADD_CAP_HIGH
    };
  }

  /* 신용카드 등 사용액 소득공제 */
  function cardDeduction(input, gross) {
    var credit = clamp0(num(input.creditCard));
    var debit = clamp0(num(input.debitCash));
    var market = clamp0(num(input.marketTransit));
    var threshold = Math.floor(gross * CONST.THRESHOLD_RATE);

    // 최저사용금액은 공제율이 낮은 결제수단부터 차감한다 (신용 → 체크·현금 → 전통시장·대중교통)
    var remain = threshold;
    var creditOver = clamp0(credit - remain);
    remain = clamp0(remain - credit);
    var debitOver = clamp0(debit - remain);
    remain = clamp0(remain - debit);
    var marketOver = clamp0(market - remain);

    var creditPart = Math.round(creditOver * CONST.RATE_CREDIT);
    var debitPart = Math.round(debitOver * CONST.RATE_DEBIT);
    var marketPart = Math.round(marketOver * CONST.RATE_MARKET);
    var eligibleAmount = creditPart + debitPart + marketPart;

    var caps = basicCap(gross, num(input.children));
    var baseApplied = Math.min(eligibleAmount, caps.total);
    var overflow = clamp0(eligibleAmount - baseApplied);
    var addDeduction = Math.round(Math.min(overflow, marketPart, caps.addCap));
    var total = baseApplied + addDeduction;
    var usage = credit + debit + market;

    return {
      usage: usage,
      threshold: threshold,
      shortfall: clamp0(threshold - usage),
      remainBeforeDeduct: remain,
      creditOver: creditOver,
      debitOver: debitOver,
      marketOver: marketOver,
      creditPart: creditPart,
      debitPart: debitPart,
      marketPart: marketPart,
      eligibleAmount: eligibleAmount,
      basicCap: caps.base,
      childExtra: caps.childExtra,
      capTotal: caps.total,
      addCap: caps.addCap,
      baseApplied: baseApplied,
      overflow: overflow,
      addDeduction: addDeduction,
      total: total,
      roomLeft: clamp0(caps.total - baseApplied)
    };
  }

  /* 12월 체크카드 전환 시 추가 공제 (최저사용금액 · 한도 잔여분 반영) */
  function switchGain(card, switchAmount) {
    var amount = clamp0(num(switchAmount));
    var diff = CONST.RATE_DEBIT - CONST.RATE_CREDIT; // 15%p
    // 아직 최저사용금액을 못 넘었다면, 전환액 중 그 문턱을 채우는 부분은 공제가 늘지 않는다
    var overThreshold = clamp0(amount - card.shortfall);
    var raw = Math.round(overThreshold * diff);
    var extra = Math.min(raw, card.roomLeft);
    return {
      amount: amount,
      overThreshold: overThreshold,
      raw: raw,
      extra: extra,
      wasted: clamp0(amount - overThreshold) + clamp0(overThreshold - Math.round(extra / diff)),
      roomLeft: card.roomLeft,
      shortfall: card.shortfall,
      maxUseful: card.shortfall + (card.roomLeft > 0 ? Math.round(card.roomLeft / diff) : 0)
    };
  }

  function rentCredit(input, gross) {
    var monthly = clamp0(num(input.monthlyRent));
    var annual = monthly * 12;
    var capped = Math.min(annual, CONST.RENT_CAP);
    var owner = input.household !== 'member';
    var rate = gross <= CONST.RENT_SPLIT1 ? CONST.RENT_RATE_LOW
      : (gross <= CONST.RENT_SPLIT2 ? CONST.RENT_RATE_MID : 0);
    var eligible = owner && rate > 0 && capped > 0;
    return {
      monthly: monthly,
      annual: annual,
      capped: capped,
      overCap: clamp0(annual - CONST.RENT_CAP),
      rate: rate,
      isOwner: owner,
      eligible: eligible,
      saving: eligible ? Math.round(capped * rate) : 0,
      reason: !owner ? 'member' : (rate === 0 ? 'income' : (capped === 0 ? 'none' : ''))
    };
  }

  function pensionCredit(input, gross) {
    var paid = clamp0(num(input.pension));
    var capped = Math.min(paid, CONST.PENSION_CAP);
    var rate = gross <= CONST.PENSION_SPLIT ? CONST.PENSION_RATE_LOW : CONST.PENSION_RATE_HIGH;
    return {
      paid: paid,
      capped: capped,
      overCap: clamp0(paid - CONST.PENSION_CAP),
      rate: rate,
      saving: Math.round(capped * rate)
    };
  }

  function calc(input) {
    input = input || {};
    var gross = clamp0(num(input.grossSalary));
    var card = cardDeduction(input, gross);
    var sw = switchGain(card, input.switchAmount);
    var rent = rentCredit(input, gross);
    var pension = pensionCredit(input, gross);

    var rate = marginalRate(gross, card.total);
    var cardSaving = Math.round(card.total * rate);
    var totalSaving = cardSaving + rent.saving + pension.saving;

    var messages = [];
    if (gross <= 0) {
      messages.push({ type: 'bad', text: '총급여를 입력하면 공제 한도와 예상 절세액을 계산합니다.' });
    } else if (card.usage < card.threshold && card.usage > 0) {
      messages.push({
        type: 'warn',
        text: '신용카드 등 사용액이 최저사용금액(총급여의 25%)보다 ' + comma(card.shortfall) +
          '원 적어 카드 소득공제가 0원입니다. 12월까지 ' + comma(card.shortfall) + '원을 더 쓰면 공제가 시작됩니다.'
      });
    } else if (card.usage === 0) {
      messages.push({ type: 'info', text: '카드 사용액을 입력하면 최저사용금액을 넘긴 구간부터 소득공제가 계산됩니다.' });
    } else if (card.total >= card.capTotal + card.addDeduction && card.addDeduction > 0) {
      messages.push({ type: 'good', text: '기본한도와 전통시장·대중교통 추가한도까지 모두 채웠습니다. 남은 기간 카드 사용은 공제가 늘지 않습니다.' });
    } else if (card.total >= card.capTotal) {
      messages.push({ type: 'warn', text: '기본한도 ' + comma(card.capTotal) + '원을 모두 채웠습니다. 결제수단을 바꿔도 추가 공제는 없습니다.' });
    }
    if (sw.extra > 0) {
      messages.push({
        type: 'good',
        text: '12월에 ' + comma(sw.amount) + '원을 체크카드로 결제하면 소득공제가 ' +
          comma(sw.extra) + '원 늘고, 세금은 소득세 기준 약 ' + comma(sw.extra * rate) +
          '원, 지방소득세 10%를 더하면 약 ' + comma(Math.round(sw.extra * rate * 1.1)) + '원 줄어듭니다.'
      });
    } else if (sw.wasted > 0) {
      messages.push({
        type: 'warn',
        text: '바꿔도 공제로 인정되지 않는 금액이 ' + comma(sw.wasted) + '원 있습니다. ' +
          (card.roomLeft === 0 ? '기본한도를 이미 채웠습니다.' : '최저사용금액을 넘기지 못했거나 한도가 남지 않았습니다.')
      });
    }
    if (rent.eligible) {
      messages.push({ type: 'info', text: '월세 세액공제는 무주택 세대주 요건과 전입일·계약서·주민등록등본 확인이 필요합니다.' });
    } else if (rent.reason === 'member') {
      messages.push({ type: 'info', text: '무주택 세대원은 월세 세액공제 대상이 아닙니다. 세대주만 신청할 수 있어 월세 공제액은 0원으로 계산했습니다.' });
    } else if (rent.reason === 'income') {
      messages.push({ type: 'warn', text: '총급여 8,000만원을 넘으면 월세 세액공제가 적용되지 않습니다. 월세 공제액은 0원입니다.' });
    }
    if (rent.overCap > 0) {
      messages.push({ type: 'info', text: '월세 세액공제는 연 1,000만원까지만 인정되어 초과분 ' + comma(rent.overCap) + '원은 공제에서 제외했습니다.' });
    }
    if (pension.overCap > 0) {
      messages.push({ type: 'info', text: '연금저축·IRP 세액공제는 연 900만원까지 인정되어 초과분 ' + comma(pension.overCap) + '원은 제외했습니다.' });
    }
    if (gross > 120000000) {
      messages.push({ type: 'warn', text: '총급여 1억 2천만원 초과 구간은 기본한도 200만원이 적용됩니다. 이 계산기는 300만/250만원 2구간만 반영했습니다.' });
    }

    return {
      gross: gross,
      card: card,
      switchGain: sw,
      rent: rent,
      pension: pension,
      marginalRate: rate,
      cardSaving: cardSaving,
      totalSaving: totalSaving,
      savingRate: gross > 0 ? totalSaving / gross : 0,
      messages: messages
    };
  }

  var api = { calc: calc, CONST: CONST, marginalRate: marginalRate, earnedIncomeDeduction: earnedIncomeDeduction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.YearEndCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
