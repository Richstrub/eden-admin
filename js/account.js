/* Eden staff site + staff page: passwords.
 *   EdenAccount.change(sb)            "Change password" while signed in (checks the current password first,
 *                                     and can sign out every other device, e.g. if the password leaked).
 *   EdenAccount.mustChange(sb)        Promise<boolean>: a manager set a temporary password for me.
 *   EdenAccount.choose(sb, opts)      Fill a "choose a new password" form (after a reset link or a temporary password).
 *   EdenAccount.resetFor(sb, person)  Owner/managers: set a temporary password for an employee (supabase/passwords.sql).
 */
(function () {
  'use strict';
  var MIN = 10;
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function check(a, b) {
    if (a.length < MIN) return 'Use at least ' + MIN + ' characters.';
    if (a !== b) return 'The two passwords don’t match.';
    return '';
  }
  function friendly(m) {
    m = String(m || '');
    if (/same|different from the old/i.test(m)) return 'Choose a password you haven’t used here before.';
    if (/weak|pwned|known|leaked/i.test(m)) return 'That password is too easy to guess. Try a longer one.';
    if (/reauth|recent/i.test(m)) return 'For security, sign out and sign back in, then change your password.';
    return m || 'Couldn’t save. Try again.';
  }
  function modal(title, body, onClose) {
    var back = h('div', { cls: 'acct-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    var card = h('div', { cls: 'acct-card' }, [h('h2', { text: title })].concat(body));
    back.appendChild(card);
    var close = function () { back.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(); };
    var esc = function (e) { if (e.key === 'Escape') close(); };
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    var first = card.querySelector('input'); if (first) first.focus();
    return close;
  }
  function pwInput(label, ac) { var i = h('input', { type: 'password', autocomplete: ac, required: true }); return [h('label', { cls: 'acct-f' }, [label, i]), i]; }
  function makeTemp() {   // easy to read out loud or text: Eden-plus words and digits, no look-alike letters
    var words = ['Basil', 'Cedar', 'Ember', 'Fennel', 'Garnet', 'Harbor', 'Juniper', 'Linen', 'Maple', 'Olive', 'Pepper', 'Quince', 'Saffron', 'Thyme', 'Walnut', 'Willow'];
    var r = new Uint32Array(3); (window.crypto || window.msCrypto).getRandomValues(r);
    return words[r[0] % words.length] + '-' + words[r[1] % words.length] + '-' + String(100 + r[2] % 900);
  }

  window.EdenAccount = {
    change: function (sb, done) {
      sb.auth.getSession().then(function (res) {
        var email = res && res.data && res.data.session && res.data.session.user && res.data.session.user.email;
        if (!email) return;
        var cur = pwInput('Current password', 'current-password'), a = pwInput('New password (at least ' + MIN + ' characters)', 'new-password'), b = pwInput('Repeat new password', 'new-password');
        var others = h('input', { type: 'checkbox', checked: true });
        var msg = h('p', { cls: 'acct-msg', role: 'status' });
        var save = h('button', { type: 'submit', cls: 'acct-primary', text: 'Change password' });
        var form = h('form', { novalidate: true }, [cur[0], a[0], b[0],
          h('label', { cls: 'acct-check' }, [others, ' Sign out on all my other phones, tablets and computers (recommended if someone else may know your password)']),
          msg, h('div', { cls: 'acct-row' }, [save, h('button', { type: 'button', cls: 'acct-ghost', text: 'Cancel', on: { click: function () { close(); } } })])]);
        var close = modal('Change your password', [h('p', { cls: 'acct-sub', text: 'Signed in as ' + email }), form]);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var bad = check(a[1].value, b[1].value); if (bad) { msg.textContent = bad; return; }
          if (!cur[1].value) { msg.textContent = 'Enter your current password.'; return; }
          save.disabled = true; msg.textContent = 'Checking…';
          sb.auth.signInWithPassword({ email: email, password: cur[1].value }).then(function (r) {
            if (r.error) { save.disabled = false; msg.textContent = /rate|too many/i.test(r.error.message || '') ? 'Too many attempts. Try again in a few minutes.' : 'Your current password isn’t right.'; return null; }
            msg.textContent = 'Saving…';
            return sb.auth.updateUser({ password: a[1].value }).then(function (u) {
              if (u.error) { save.disabled = false; msg.textContent = friendly(u.error.message); return; }
              var after = others.checked ? sb.auth.signOut({ scope: 'others' }).catch(function () {}) : Promise.resolve();
              return after.then(function () { return sb.rpc('password_changed').then(function () {}, function () {}); }).then(function () {
                form.replaceWith(h('div', null, [h('p', { text: 'Your password is changed.' + (others.checked ? ' Every other device has been signed out.' : '') }),
                  h('div', { cls: 'acct-row' }, [h('button', { type: 'button', cls: 'acct-primary', text: 'Done', on: { click: function () { close(); } } })])]));
                if (done) done();
              });
            });
          });
        });
      });
    },
    mustChange: function (sb) {
      return sb.rpc('must_change_password').then(function (r) { return !r.error && r.data === true; }, function () { return false; });
    },
    // Wire up a page's "choose a new password" form (fields password + password2, and a .msg).
    choose: function (sb, form, onDone) {
      var msg = form.querySelector('.msg');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var bad = check(form.password.value, form.password2.value); if (bad) { msg.textContent = bad; return; }
        msg.textContent = 'Saving…';
        sb.auth.updateUser({ password: form.password.value }).then(function (r) {
          if (r.error) { msg.textContent = friendly(r.error.message); return; }
          sb.rpc('password_changed').then(function () {}, function () {}).then(function () { form.reset(); msg.textContent = ''; onDone(); });
        });
      });
    },
    // Owner/managers: make (or fix) an employee's login with a temporary password, no email needed
    createFor: function (sb, person, done) {
      var temp = makeTemp(), fixing = !!person.fixing;
      var shown = h('input', { type: 'text', value: temp, cls: 'acct-temp', 'aria-label': 'Temporary password', spellcheck: 'false', autocomplete: 'off' });
      var msg = h('p', { cls: 'acct-msg', role: 'status' });
      var go = h('button', { type: 'button', cls: 'acct-primary', text: fixing ? 'Set password and switch on' : 'Create login' });
      var box = h('div', null, [
        h('p', { text: fixing
          ? (person.name || person.email) + ' started an account but never confirmed it (the confirmation email probably didn’t reach them). This switches the account on with the temporary password below.'
          : 'This makes a login for ' + (person.name || person.email) + ' straight away, with no email needed, using the temporary password below.' }),
        h('label', { cls: 'acct-f' }, ['Temporary password', shown]),
        h('p', { cls: 'acct-sub', text: 'Login email: ' + person.email }),
        msg, h('div', { cls: 'acct-row' }, [go, h('button', { type: 'button', cls: 'acct-ghost', text: 'Cancel', on: { click: function () { close(); } } })])
      ]);
      var close = modal(fixing ? 'Switch on login' : 'Create login', [box]);
      go.addEventListener('click', function () {
        var pw = shown.value.trim();
        if (pw.length < MIN) { msg.textContent = 'Use at least ' + MIN + ' characters.'; return; }
        go.disabled = true; msg.textContent = 'Saving…';
        sb.rpc('create_employee_login', { p_email: person.email, p_password: pw }).then(function (r) {
          var j = r.data || {};
          if (r.error) { go.disabled = false; msg.textContent = /create_employee_login|function|schema cache/i.test(r.error.message || '') ? 'Not switched on yet: run supabase/staff-logins.sql in Supabase.' : 'Couldn’t do it: ' + (r.error.message || 'try again.'); return; }
          if (!j.ok) { go.disabled = false; msg.textContent = j.message || 'Couldn’t do it.'; return; }
          var link = location.origin + '/team/';
          var note = 'Hi ' + String(person.name || '').split(' ')[0] + ', your Eden staff page login is ready. Go to ' + link + ' and sign in with ' + person.email + ' and the temporary password ' + pw + '. It will ask you to choose your own password.';
          box.replaceWith(h('div', null, [
            h('p', { text: 'Done. ' + (person.name || person.email) + ' can sign in now. Their temporary password is:' }),
            h('p', { cls: 'acct-big', text: pw }),
            h('p', { cls: 'acct-sub', text: 'Give it to them in person or by text. They sign in at ' + link + ' with ' + person.email + ', and choose their own password straight away. This window is the only place it’s shown.' }),
            h('div', { cls: 'acct-row' }, [
              h('button', { type: 'button', cls: 'acct-ghost', text: 'Copy a text message', on: { click: function (e) { var b = e.currentTarget; if (navigator.clipboard) navigator.clipboard.writeText(note).then(function () { b.textContent = 'Copied'; }); } } }),
              h('button', { type: 'button', cls: 'acct-primary', text: 'Done', on: { click: function () { close(); } } })])
          ]));
          if (done) done();
        });
      });
    },
    // Owner/managers: temporary password for an employee
    resetFor: function (sb, person, done) {
      var temp = makeTemp();
      var shown = h('input', { type: 'text', value: temp, cls: 'acct-temp', 'aria-label': 'Temporary password', spellcheck: 'false', autocomplete: 'off' });
      var msg = h('p', { cls: 'acct-msg', role: 'status' });
      var go = h('button', { type: 'button', cls: 'acct-primary', text: 'Set temporary password' });
      var box = h('div', null, [
        h('p', { text: 'This signs ' + (person.name || person.email) + ' out everywhere and replaces their password with the temporary one below. Tell them in person or by text; the next time they sign in, they’ll choose their own.' }),
        h('label', { cls: 'acct-f' }, ['Temporary password', shown]),
        h('p', { cls: 'acct-sub', text: 'Account: ' + person.email }),
        msg, h('div', { cls: 'acct-row' }, [go, h('button', { type: 'button', cls: 'acct-ghost', text: 'Cancel', on: { click: function () { close(); } } })])
      ]);
      var close = modal('Reset password', [box]);
      go.addEventListener('click', function () {
        var pw = shown.value.trim();
        if (pw.length < MIN) { msg.textContent = 'Use at least ' + MIN + ' characters.'; return; }
        go.disabled = true; msg.textContent = 'Saving…';
        sb.rpc('reset_employee_password', { p_email: person.email, p_password: pw }).then(function (r) {
          var j = r.data || {};
          if (r.error) {
            go.disabled = false;
            msg.textContent = /reset_employee_password|function|schema cache/i.test(r.error.message || '') ? 'Password resets aren’t switched on yet: run supabase/passwords.sql in Supabase.' : 'Couldn’t reset it: ' + (r.error.message || 'try again.');
            return;
          }
          if (!j.ok) { go.disabled = false; msg.textContent = j.message || 'Couldn’t reset it.'; return; }
          box.replaceWith(h('div', null, [
            h('p', { text: 'Done. ' + (person.name || person.email) + ' has been signed out. Their temporary password is:' }),
            h('p', { cls: 'acct-big', text: pw }),
            h('p', { cls: 'acct-sub', text: 'Give it to them in person or by text. When they sign in with it, they’ll be asked to choose their own password. This window is the only place it’s shown.' }),
            h('div', { cls: 'acct-row' }, [
              h('button', { type: 'button', cls: 'acct-ghost', text: 'Copy', on: { click: function (e) { var b = e.currentTarget; if (navigator.clipboard) navigator.clipboard.writeText(pw).then(function () { b.textContent = 'Copied'; }); } } }),
              h('button', { type: 'button', cls: 'acct-primary', text: 'Done', on: { click: function () { close(); } } })])
          ]));
          if (done) done();
        });
      });
    }
  };
})();
