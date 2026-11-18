/* API layer. The screens only talk to BINI.api, never to a server directly.
   - mock: runs on built-in sample data (USE_MOCK = true).
   - live: calls the real backend at API_BASE (USE_MOCK = false). The endpoints below are a proposed
           contract and should be aligned with the backend once it is built.

   Methods (all return Promises):
     session()                      -> user {name, role} or null
     signIn()                       -> user
     breakGlass()                   -> rejects until backend exists
     signOut()
     getSettings()                  -> {maxMb, maxFiles, defq, retain}
     saveSettings(values, pin)      -> saved settings         (needs PIN)
     changePin(currentPin, newPin)
     listSystems()                  -> [{name, code, keyHint, lastUsed, requests, success, status}]
     rotateKey(code, pin)           -> {key, signingSecret}  shown once  (needs PIN)
     logConversion(summary)         -> records a browser batch: counts and sizes only
     listActivity()                 -> [{time, who, kind, detail, size, result}]
   PIN errors reject with err.code = 'BAD_PIN' (err.attemptsLeft) or 'LOCKED'. */
(function () {
  var B = window.BINI;
  var cfg = window.BINI_CONFIG || {};

  function fail(code, extra) {
    var e = new Error(code);
    e.code = code;
    for (var k in extra) e[k] = extra[k];
    return Promise.reject(e);
  }
  function later(v) {
    return new Promise(function (res) { setTimeout(function () { res(v); }, 150); });
  }

  /* ---------- mock ---------- */
  var mock = (function () {
    var PIN = '482913'; // sample PIN for demo mode only
    var LOCK_MS = 15 * 60 * 1000;
    var fails = 0, lockedUntil = 0;
    var user = { name: 'Demo Admin', role: 'Admin' };
    var settings = { maxMb: 50, maxFiles: 50, defq: 75, retain: 30 };
    var systems = [
      { name: 'BINI Website', code: 'WEB', keyHint: 'web_live_••••9f3a', lastUsed: '2 days ago', requests: 1284, success: 99.4, status: 'Active' },
      { name: 'Founders Desk', code: 'FDK', keyHint: 'fdk_live_••••71bc', lastUsed: 'Today, 11:42', requests: 642, success: 99.8, status: 'Active' },
      { name: 'Help Desk', code: 'HLP', keyHint: 'hlp_live_••••c20d', lastUsed: 'Today, 09:15', requests: 318, success: 98.7, status: 'Active' },
      { name: 'Campaign Management', code: 'CMP', keyHint: 'cmp_live_••••4e88', lastUsed: 'Yesterday', requests: 207, success: 99.5, status: 'Active' },
      { name: 'Bug Logs Portal', code: 'BLG', keyHint: 'blg_live_••••a1d6', lastUsed: 'Today, 13:02', requests: 156, success: 100, status: 'Active' },
      { name: 'Wander With Food', code: 'W2F', keyHint: 'w2f_live_••••3b95', lastUsed: 'Today, 14:05', requests: 5921, success: 99.1, status: 'Active' }
    ];
    var log = [
      { time: '10 Nov 2026, 14:05', who: 'W2F', kind: 'System', detail: '3 images', size: '2.1 MB to 0.7 MB', result: 'Success' },
      { time: '10 Nov 2026, 13:02', who: 'BLG', kind: 'System', detail: '5 images', size: '1.4 MB to 0.5 MB', result: 'Success' },
      { time: '10 Nov 2026, 12:20', who: 'Staff A', kind: 'Staff', detail: '8 images', size: '6.2 MB to 2.0 MB', result: 'Success' },
      { time: '10 Nov 2026, 11:42', who: 'FDK', kind: 'System', detail: '1 image', size: '0.4 MB to 0.1 MB', result: 'Success' },
      { time: '10 Nov 2026, 10:31', who: 'HLP', kind: 'System', detail: '2 images', size: '0.9 MB to 0.3 MB', result: 'Rejected: file type' },
      { time: '09 Nov 2026, 17:48', who: 'Admin A', kind: 'Admin', detail: 'Key rotated: WEB', size: '', result: 'Success' }
    ];

    function stamp() {
      return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    }
    function addLog(detail, result) {
      log.unshift({ time: stamp(), who: user.name, kind: 'Admin', detail: detail, size: '', result: result });
    }
    /* returns a rejected Promise when the PIN is wrong or locked, otherwise null */
    function checkPin(pin) {
      if (Date.now() < lockedUntil) return fail('LOCKED');
      if (pin !== PIN) {
        fails++;
        if (fails >= 3) {
          fails = 0;
          lockedUntil = Date.now() + LOCK_MS;
          addLog('PIN locked for 15 minutes after 3 wrong attempts', 'Alert for core admin');
          return fail('LOCKED');
        }
        return fail('BAD_PIN', { attemptsLeft: 3 - fails });
      }
      fails = 0;
      return null;
    }
    function randomKey(code) {
      var s = '';
      for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
      return code.toLowerCase() + '_live_' + s;
    }

    return {
      session: function () {
        var on = false;
        try { on = sessionStorage.getItem('bini_mock_auth') === '1'; } catch (e) {}
        return later(on ? user : null);
      },
      signIn: function () {
        try { sessionStorage.setItem('bini_mock_auth', '1'); } catch (e) {}
        return later(user);
      },
      breakGlass: function () { return fail('NOT_AVAILABLE'); },
      signOut: function () {
        try { sessionStorage.removeItem('bini_mock_auth'); } catch (e) {}
        return later(true);
      },
      getSettings: function () { return later(JSON.parse(JSON.stringify(settings))); },
      saveSettings: function (values, pin) {
        var bad = checkPin(pin); if (bad) return bad;
        settings = JSON.parse(JSON.stringify(values));
        addLog('Settings changed', 'Success');
        return later(JSON.parse(JSON.stringify(settings)));
      },
      changePin: function (current, next) {
        var bad = checkPin(current); if (bad) return bad;
        PIN = next;
        addLog('System PIN changed', 'Success');
        return later(true);
      },
      listSystems: function () { return later(JSON.parse(JSON.stringify(systems))); },
      logConversion: function () { return later(true); },
      rotateKey: function (code, pin) {
        var bad = checkPin(pin); if (bad) return bad;
        var key = randomKey(code);
        systems.forEach(function (s) {
          if (s.code === code) s.keyHint = code.toLowerCase() + '_live_••••' + key.slice(-4);
        });
        addLog('Key rotated: ' + code, 'Success');
        return later({ key: key, signingSecret: randomKey('sig').split('_live_')[1] });
      },
      listActivity: function () { return later(JSON.parse(JSON.stringify(log))); }
    };
  })();

  /* ---------- live (proposed contract) ---------- */
  function when(iso) {
    if (!iso) return 'Never';
    var d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function http(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch((cfg.API_BASE || '') + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var e = new Error(d.error || 'Request failed (' + r.status + ')');
          e.code = d.code || 'HTTP_' + r.status;
          e.attemptsLeft = d.attemptsLeft;
          if (e.code === 'NO_SESSION') location.href = '/login.html'; // session ended
          throw e;
        }
        return d;
      });
    });
  }
  function send(method, path, body) {
    return http(path, { method: method, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  var live = {
    session: function () { return http('/session').then(function (d) { return d.user || null; }, function () { return null; }); },
    signIn: function () {
      location.href = (cfg.API_BASE || '') + '/auth/login'; // Founders Desk single sign-on
      return new Promise(function () {});
    },
    breakGlass: function () {
      location.href = (cfg.API_BASE || '') + '/auth/break-glass';
      return new Promise(function () {});
    },
    signOut: function () { return send('POST', '/auth/logout'); },
    getSettings: function () { return http('/settings'); },
    saveSettings: function (values, pin) { return send('PUT', '/settings', { values: values, pin: pin }); },
    changePin: function (current, next) { return send('POST', '/pin/change', { current: current, next: next }); },
    listSystems: function () {
      return http('/systems').then(function (d) {
        return (d.systems || []).map(function (s) { s.lastUsed = when(s.lastUsed); return s; });
      });
    },
    rotateKey: function (code, pin) { return send('POST', '/systems/' + encodeURIComponent(code) + '/rotate', { pin: pin }); },
    listActivity: function () {
      return http('/activity').then(function (d) {
        return (d.entries || []).map(function (e) { e.time = when(e.time); return e; });
      });
    },
    logConversion: function (summary) { return send('POST', '/activity/conversion', summary); }
  };

  B.api = cfg.USE_MOCK ? mock : live;
})();
