/* Eden menu editor: click a cell whose text doesn't fit and it opens up, wrapping onto as many lines as it needs so
 * the whole name or description can be read and edited. Typing goes straight through to the cell underneath, so
 * saving, publishing and the inventory search work exactly as before. Enter or clicking away closes it; Escape too.
 */
(function () {
  'use strict';
  var ROOT = 'edMain';
  var cur = null;   // { input, box, start }

  function eligible(el) {
    if (!el || el.tagName !== 'INPUT' || el.disabled || el.readOnly) return false;
    if (el.type && !/^(text|search)$/.test(el.type) && el.getAttribute('type')) return false;
    var root = document.getElementById(ROOT);
    if (!root || !root.contains(el) || el.closest('.ed-search')) return false;
    return !!el.closest('.ed-field');
  }
  function overflows(el) { return el.scrollWidth > el.clientWidth + 2; }

  function place() {
    if (!cur) return;
    var input = cur.input, box = cur.box, wrap = input.parentNode;
    var row = input.closest('.ed-item, .ed-ghead, .ed-notes, .ed-tabname, .ed-group, .ed-quick') || wrap.parentNode;
    var ir = input.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), rr = row.getBoundingClientRect();
    var want = Math.max(ir.width, Math.min(620, rr.width - 24));
    var left = ir.left - wr.left;
    var room = rr.right - 12 - ir.left;            // keep it inside the row: slide left if it would run past the edge
    if (want > room) left -= Math.min(want - room, ir.left - (rr.left + 12));
    box.style.left = left + 'px';
    box.style.top = (ir.top - wr.top) + 'px';
    box.style.width = want + 'px';
    box.style.height = 'auto';
    box.style.height = Math.max(ir.height, box.scrollHeight + 2) + 'px';
    var list = wrap.querySelector('.ed-ac-list');    // inventory suggestions: show them below the open box
    if (list) list.style.top = (box.offsetTop + box.offsetHeight) + 'px';
  }

  function open(input) {
    if (cur && cur.input === input) return;
    close(false);
    var box = document.createElement('textarea');
    box.className = 'ed-grow';
    box.rows = 1; box.value = input.value; box.spellcheck = input.spellcheck;
    box.setAttribute('aria-label', (input.closest('.ed-field').querySelector('span') || {}).textContent || 'Edit');
    if (input.placeholder) box.placeholder = input.placeholder;
    var wrap = input.parentNode;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    wrap.appendChild(box);
    wrap.classList.add('ed-growing');
    cur = { input: input, box: box, start: input.value };
    place();
    var s = input.selectionStart, e = input.selectionEnd;
    box.focus({ preventScroll: true });
    try { box.setSelectionRange(s == null ? box.value.length : s, e == null ? box.value.length : e); } catch (x) {}

    box.addEventListener('input', function () {
      var v = box.value.replace(/[\r\n]+/g, ' ');
      if (v !== box.value) { var p = box.selectionStart; box.value = v; box.setSelectionRange(p, p); }
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      place();
    });
    box.addEventListener('keydown', function (ev) {
      var list = wrap.querySelector('.ed-ac-list'), listOpen = list && !list.hidden;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ((ev.key === 'Enter' || ev.key === 'Escape') && listOpen) || (ev.key === 'Enter' && !ev.shiftKey)) {
        // hand the key to the cell underneath (inventory list, quick add) first
        var fwd = new KeyboardEvent('keydown', { key: ev.key, bubbles: true, cancelable: true, shiftKey: ev.shiftKey });
        input.dispatchEvent(fwd);
        if (fwd.defaultPrevented || ev.key.indexOf('Arrow') === 0) { ev.preventDefault(); if (input.value !== box.value) { box.value = input.value; place(); } if (ev.key !== 'Enter') return; }
        if (ev.key === 'Enter') { ev.preventDefault(); if (document.activeElement === box) finish(); return; }
        if (ev.key === 'Escape') { ev.preventDefault(); return; }
      }
      if (ev.key === 'Escape') { ev.preventDefault(); finish(); return; }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        var all = [].slice.call(document.getElementById(ROOT).querySelectorAll('input, textarea, select, button, [tabindex]:not([tabindex="-1"])'))
          .filter(function (x) { return x !== box && !x.disabled && x.offsetParent !== null; });
        var i = all.indexOf(input), next = all[i + (ev.shiftKey ? -1 : 1)];
        close(true);
        if (next) next.focus(); else input.focus();
      }
    });
    box.addEventListener('blur', function () { setTimeout(function () { if (cur && cur.box === box && document.activeElement !== box) close(true); }, 120); });
  }

  function finish() { close(true); }

  function close(commit) {
    if (!cur) return;
    var c = cur; cur = null;
    if (commit && c.input.value !== c.start) c.input.dispatchEvent(new Event('change', { bubbles: true }));
    var wrap = c.input.parentNode, list = wrap && wrap.querySelector('.ed-ac-list');
    if (list) list.style.top = '';
    if (wrap) wrap.classList.remove('ed-growing');
    if (c.box.parentNode) c.box.parentNode.removeChild(c.box);
  }

  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.edGrowSkip) { delete el.dataset.edGrowSkip; return; }
    if (!eligible(el)) return;
    setTimeout(function () { if (document.activeElement === el && overflows(el)) open(el); }, 0);
  });
  // a cell that starts to overflow while typing opens up too
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (cur || !eligible(el) || document.activeElement !== el || !overflows(el)) return;
    open(el);
  }, true);
  window.addEventListener('resize', place);
  document.addEventListener('scroll', function () { if (cur) place(); }, true);
})();
