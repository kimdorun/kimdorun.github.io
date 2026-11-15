/* ==========================================================================
   생활금융 계산기 허브 — 공통 UI 스크립트 (Vanilla JS, 의존성 없음)
   · 모바일 내비게이션 토글
   · 금액 입력 콤마 포맷 / 숫자 파싱
   · 세그먼트(탭) 버튼 · 결과 패널 표시 · 결과 복사
   ========================================================================== */
(function () {
  'use strict';

  var WON = new Intl.NumberFormat('ko-KR');

  /* ---------- 숫자 / 금액 ---------- */
  function number(value, fallback) {
    if (typeof value === 'number') return isFinite(value) ? value : (fallback || 0);
    var cleaned = String(value == null ? '' : value).replace(/[^0-9.\-]/g, '');
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : (fallback || 0);
  }

  function won(value, options) {
    var n = Math.round(number(value));
    var text = WON.format(n) + '원';
    if (options && options.sign && n > 0) text = '+' + text;
    return text;
  }

  function percent(value, digits) {
    var d = typeof digits === 'number' ? digits : 1;
    return Number(value).toFixed(d) + '%';
  }

  function comma(value) {
    return WON.format(Math.round(number(value)));
  }

  function inputValue(el) {
    if (!el) return 0;
    return number(el.value.replace(/,/g, ''), 0);
  }

  function setValue(el, value) {
    if (!el) return;
    el.value = comma(value);
  }

  /* ---------- 금액 입력 콤마 자동 포맷 ---------- */
  function bindMoneyInputs(scope) {
    var root = scope || document;
    var fields = root.querySelectorAll('[data-money]');
    Array.prototype.forEach.call(fields, function (el) {
      el.addEventListener('input', function () {
        var caretFromEnd = el.value.length - (el.selectionStart || 0);
        var raw = el.value.replace(/[^0-9]/g, '');
        if (raw === '') { el.value = ''; return; }
        // 선행 0 정리
        raw = raw.replace(/^0+(?=\d)/, '');
        el.value = comma(raw);
        var pos = el.value.length - caretFromEnd;
        try { el.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
      });
      el.addEventListener('blur', function () {
        if (el.value !== '') el.value = comma(el.value);
      });
    });
  }

  /* ---------- 모바일 내비게이션 ---------- */
  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(e.target) || toggle.contains(e.target)) return;
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  }

  /* ---------- 현재 페이지 표시 ---------- */
  function markCurrent() {
    var path = location.pathname.split('/').pop() || 'index.html';
    var links = document.querySelectorAll('#site-nav a');
    Array.prototype.forEach.call(links, function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      if (href && href === path) a.setAttribute('aria-current', 'page');
    });
    var yearEls = document.querySelectorAll('[data-year]');
    Array.prototype.forEach.call(yearEls, function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* ---------- 세그먼트 토글 ----------
     <div class="segmented" role="group" data-segment="mode">
       <button data-value="annual" aria-pressed="true">연봉</button> ...
     </div>
     data-segment 그룹의 선택값은 group.dataset.value 에 저장된다. */
  function initSegments() {
    var groups = document.querySelectorAll('[data-segment]');
    Array.prototype.forEach.call(groups, function (group) {
      var buttons = group.querySelectorAll('button[data-value]');
      function select(btn) {
        Array.prototype.forEach.call(buttons, function (b) {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        group.dataset.value = btn.dataset.value;
        group.dispatchEvent(new CustomEvent('segmentchange', {
          bubbles: true,
          detail: { value: btn.dataset.value }
        }));
      }
      Array.prototype.forEach.call(buttons, function (btn) {
        btn.type = 'button';
        btn.addEventListener('click', function () { select(btn); });
      });
      var initial = group.querySelector('button[aria-pressed="true"]') || buttons[0];
      if (initial) group.dataset.value = initial.dataset.value;
    });
  }

  function segmentValue(selector, fallback) {
    var group = document.querySelector(selector);
    if (!group) return fallback;
    return group.dataset.value || fallback;
  }

  /* ---------- 결과 표시 ---------- */
  function showResult(panel, scroll) {
    if (!panel) return;
    panel.hidden = false;
    var live = panel.querySelector('[data-live]');
    if (live) live.textContent = '계산 결과가 갱신되었습니다.';
    if (scroll && window.innerWidth < 881) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------- 결과 복사 ---------- */
  function initCopyButtons() {
    var buttons = document.querySelectorAll('[data-copy]');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        var target = document.querySelector(btn.dataset.copy);
        if (!target) return;
        var text = target.innerText.replace(/\n{2,}/g, '\n').trim();
        var done = function () {
          var original = btn.textContent;
          btn.textContent = '복사됨';
          setTimeout(function () { btn.textContent = original; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
        } else {
          fallbackCopy(text, done);
        }
      });
    });
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done && done(); } catch (e) { /* noop */ }
    document.body.removeChild(ta);
  }

  /* ---------- 초기화 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    markCurrent();
    initSegments();
    bindMoneyInputs(document);
    initCopyButtons();
  });

  window.UI = {
    number: number,
    inputValue: inputValue,
    won: won,
    comma: comma,
    percent: percent,
    setValue: setValue,
    segmentValue: segmentValue,
    showResult: showResult,
    bindMoneyInputs: bindMoneyInputs
  };
})();
