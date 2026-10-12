/* Eden staff site: moving to its own address (staffHome in js/config.js).
 * On the old address, once the new one answers, this sends people there automatically (same page,
 * same #section) and brings along the few things kept only in this browser: the prep list pars
 * and an unsaved note. On the new address it puts those back. Everyone signs in once more there. */
(function () {
  'use strict';
  var CF = window.EDEN_STAFF_CONFIG || {}, home = String(CF.staffHome || '');
  var KEEP = ['eden-prep-v1', 'eden-note-draft'];
  var q = new URLSearchParams(location.search);
  // arriving from the old address: put this browser's saved things back
  if (q.has('carry')) {
    try {
      var got = JSON.parse(decodeURIComponent(escape(atob(q.get('carry')))));
      KEEP.forEach(function (k) { if (got[k] != null && localStorage.getItem(k) == null) localStorage.setItem(k, got[k]); });
    } catch (e) { /* nothing to restore */ }
    q.delete('carry');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
  if (!home || !/\.workers\.dev$/i.test(location.hostname)) return;
  var to; try { to = new URL(home); } catch (e) { return; }
  if (to.hostname === location.hostname) return;
  // only move once the new address is really this staff site (not a half-finished domain setup)
  fetch(to.origin + '/here', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || j.app !== 'eden-staff') return;
    var carry = {}, any = false;
    KEEP.forEach(function (k) { try { var v = localStorage.getItem(k); if (v != null) { carry[k] = v; any = true; } } catch (e) {} });
    var dest = to.origin + location.pathname + (any ? '?carry=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(carry))))) : '') + location.hash;
    location.replace(dest);
  }).catch(function () { /* new address not ready yet: stay here */ });
})();
