/* App state, events and flows. */
(function () {
  var B = window.BINI, $ = B.$, api = B.api, toast = B.toast;
  var root = $('#root');
  var uid = 0;

  var S = {
    boot: false, user: null, page: 'convert', step: 1,
    files: [], cur: 0, aspect: 'original', mode: 'lossy', q: 75, rot: 0, fh: false, fv: false,
    res: [], prog: 0, doneAt: null,
    set: { maxMb: 50, maxFiles: 50, defq: 75, retain: 30 }, setDraft: null,
    systems: null, log: null, loadError: '',
    modal: null, est: null, estKeyNow: '', measuring: ''
  };

  function cfgMock() { return !!(window.BINI_CONFIG && window.BINI_CONFIG.USE_MOCK); }
  function validFiles() { return S.files.filter(function (f) { return f.valid; }); }
  function opts() { return { aspect: S.aspect, mode: S.mode, q: S.q, rot: S.rot, fh: S.fh, fv: S.fv }; }
  function estKey() {
    var f = validFiles()[S.cur] || validFiles()[0];
    return f ? [f.id, S.aspect, S.mode, S.mode === 'lossy' ? S.q : '', S.rot, S.fh, S.fv].join('|') : '';
  }

  /* ---------- render ---------- */
  function render() {
    if (!S.boot) { root.innerHTML = '<div class="login"><p class="sub">Loading...</p></div>'; return; }
    if (S.step === 2) {
      var n = validFiles().length;
      if (S.cur >= n) S.cur = 0;
      S.estKeyNow = estKey();
    }
    root.innerHTML = S.user ? B.views.shell(S) : B.views.login();
    var pin = $('#pin');
    if (pin && !pin.disabled) pin.focus();
    if (S.user && S.page === 'convert' && S.step === 2) measure();
  }

  function measure() {
    var key = S.estKeyNow;
    if (!key || (S.est && S.est.key === key) || S.measuring === key) return;
    var f = validFiles()[S.cur] || validFiles()[0];
    S.measuring = key;
    B.convert.encode(f, opts()).then(function (blob) {
      return blob.size / f.size;
    }, function () { return null; }).then(function (ratio) {
      S.measuring = '';
      var el = $('#est');
      if (ratio === null) { if (el) el.textContent = 'Estimate not available for this file.'; return; }
      if (key !== S.estKeyNow) return; // settings changed meanwhile
      S.est = { key: key, ratio: ratio };
      el = $('#est');
      if (el) el.textContent = B.views.estText(S);
    });
  }

  /* ---------- data loading ---------- */
  function loadSettings() {
    return api.getSettings().then(function (set) {
      S.set = set;
      if (!S.files.length && S.step === 1) S.q = set.defq;
    }, function () {});
  }
  function loadPage(page) {
    S.loadError = '';
    var fail = function (e) { S.loadError = e && e.message ? e.message : 'Could not load data.'; if (S.page === page) render(); };
    if (page === 'api') api.listSystems().then(function (d) { S.systems = d; if (S.page === 'api') render(); }, fail);
    if (page === 'log') api.listActivity().then(function (d) { S.log = d; if (S.page === 'log') render(); }, fail);
    if (page === 'set') loadSettings().then(function () { S.setDraft = null; if (S.page === 'set') render(); });
  }
  function go(page) {
    S.page = page; S.modal = null;
    if (page === 'api') S.systems = null;
    if (page === 'log') S.log = null;
    render();
    loadPage(page);
  }

  /* ---------- upload ---------- */
  function reject(o, msg) { o.err = msg; o.valid = false; o.checking = false; render(); }

  function check(o) {
    if (o.size === 0) return reject(o, 'File is empty');
    if (o.size > S.set.maxMb * 1048576) return reject(o, 'Over ' + S.set.maxMb + ' MB');
    var prior = S.files.filter(function (x) { return x !== o && !x.err; }).length;
    if (prior >= S.set.maxFiles) return reject(o, 'Batch limit reached (' + S.set.maxFiles + ' files)');
    B.validate.inspect(o.file).then(function (r) {
      if (!r.ok) return reject(o, 'Not an allowed image type');
      return B.convert.loadImage(o.url).then(function (im) {
        if (im.naturalWidth * im.naturalHeight > B.convert.maxPixels) return reject(o, 'Image is too large to process');
        o.w = im.naturalWidth; o.h = im.naturalHeight; o.valid = true; o.checking = false; render();
      }, function () { reject(o, 'File is damaged or unreadable'); });
    });
  }

  function add(list) {
    Array.prototype.slice.call(list).forEach(function (f) {
      var o = { id: ++uid, name: f.name, size: f.size, file: f, url: URL.createObjectURL(f), valid: false, checking: true, err: '', w: 0, h: 0 };
      S.files.push(o);
      check(o);
    });
    render();
  }
  function dropFiles(arr) { arr.forEach(function (o) { URL.revokeObjectURL(o.url); }); }

  /* ---------- convert / download ---------- */
  function startConvert() {
    var v = validFiles(), i = 0, o = opts();
    S.step = 3; S.prog = 0; S.res = [];
    render();
    (function next() {
      if (i >= v.length) {
        S.step = 4; S.doneAt = new Date(); render();
        var done = S.res.filter(function (r) { return r.blob; });
        // Only counts and sizes are reported. The images never leave this computer.
        api.logConversion({
          count: S.res.length, failed: S.res.length - done.length,
          bytesIn: done.reduce(function (a, r) { return a + r.orig; }, 0),
          bytesOut: done.reduce(function (a, r) { return a + r.blob.size; }, 0)
        }).then(function () {}, function () {});
        return;
      }
      var f = v[i];
      B.convert.encode(f, o).then(function (blob) {
        S.res.push({ name: f.name, orig: f.size, url: f.url, blob: blob });
      }, function (e) {
        S.res.push({ name: f.name, orig: f.size, url: f.url, blob: null, err: B.convert.reason(e) });
      }).then(function () {
        i++;
        S.prog = Math.round(i / v.length * 100);
        var pb = $('#pb'); if (pb) pb.style.width = S.prog + '%';
        setTimeout(next, 0);
      });
    })();
  }

  function zipAll() {
    if (!window.JSZip) { toast('ZIP library did not load. Download files one by one.'); return; }
    var z = new JSZip(), used = {};
    S.res.forEach(function (r) {
      if (!r.blob) return;
      var base = B.baseName(r.name), name = base + '.webp', n = 1;
      while (used[name]) name = base + '-' + (++n) + '.webp';
      used[name] = true;
      z.file(name, r.blob);
    });
    z.generateAsync({ type: 'blob' }).then(function (b) { B.saveBlob(b, 'bini-webp-batch.zip'); });
  }

  function resetBatch() {
    dropFiles(S.files);
    S.files = []; S.res = []; S.step = 1; S.cur = 0; S.est = null;
    S.q = S.set.defq; S.rot = 0; S.fh = S.fv = false;
  }

  /* ---------- modal (PIN) ---------- */
  function confirmModal() {
    var m = S.modal;
    if (!m || m.busy) return;
    var pin = ($('#pin') || {}).value || '';
    var p;
    if (!/^\d{6}$/.test(pin)) { m.err = 'Enter your 6-digit PIN.'; render(); return; }
    if (m.kind === 'save') {
      p = api.saveSettings(m.vals, pin).then(function (set) {
        S.set = set; S.setDraft = null; S.modal = null;
        if (!S.files.length) S.q = set.defq;
        render(); toast('Settings saved and logged.');
      });
    } else if (m.kind === 'rotate') {
      p = api.rotateKey(m.code, pin).then(function (r) {
        S.modal = { kind: 'key', name: m.name, key: r.key, signingSecret: r.signingSecret };
        render(); loadPage('api');
      });
    } else {
      var a = ($('#np1') || {}).value || '', c = ($('#np2') || {}).value || '';
      if (!/^\d{6}$/.test(a)) { m.err = 'New PIN must be 6 digits.'; render(); return; }
      if (a !== c) { m.err = 'The two new PINs do not match.'; render(); return; }
      if (a === pin) { m.err = 'Choose a PIN different from the current one.'; render(); return; }
      p = api.changePin(pin, a).then(function () { S.modal = null; render(); toast('System PIN changed and logged.'); });
    }
    m.busy = true;
    p.catch(function (e) {
      m.busy = false;
      if (e.code === 'LOCKED') { m.locked = true; m.err = ''; }
      else if (e.code === 'BAD_PIN') m.err = 'Incorrect PIN. ' + e.attemptsLeft + ' attempt' + (e.attemptsLeft === 1 ? '' : 's') + ' left.';
      else m.err = e.message || 'Something went wrong. Try again.';
      render();
    });
  }

  function openSave() {
    var D = S.setDraft || S.set;
    var rules = [['maxMb', 'Maximum file size', 1, 100], ['maxFiles', 'Files per batch', 1, 100], ['defq', 'Default quality', 10, 100], ['retain', 'Log retention', 7, 365]];
    for (var i = 0; i < rules.length; i++) {
      var v = D[rules[i][0]];
      if (!isFinite(v) || Math.floor(v) !== v || v < rules[i][2] || v > rules[i][3]) {
        toast(rules[i][1] + ' must be a whole number from ' + rules[i][2] + ' to ' + rules[i][3] + '.');
        return;
      }
    }
    S.modal = { kind: 'save', vals: JSON.parse(JSON.stringify(D)) };
    render();
  }

  /* ---------- events ---------- */
  function copy(text, done) {
    if (text && navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast(done); }, function () { toast('Could not copy. Select the text and copy it.'); });
    else toast('Select the text and copy it.');
  }

  var actions = {
    sso: function () { api.signIn().then(function (u) { S.user = u; S.page = 'convert'; return loadSettings(); }).then(render, function (e) { toast(e.message || 'Sign-in failed.'); }); },
    bg: function () { api.breakGlass().then(function () {}, function () { toast('Break-glass sign-in is not available yet.'); }); },
    out: function () {
      api.signOut().then(function () {
        resetBatch(); S.user = null; S.modal = null;
        if (!cfgMock()) { location.href = '/login.html'; return; }
        render();
      });
    },
    go: function (t) { go(t.dataset.page); },
    pick: function () { var fi = $('#fi'); if (fi) fi.click(); },
    rm: function (t) { var i = +t.dataset.i; dropFiles(S.files.splice(i, 1)); render(); },
    clear: function () { dropFiles(S.files); S.files = []; render(); },
    next: function () { S.step = 2; S.cur = 0; render(); },
    back: function () { S.step = 1; render(); },
    rot: function () { S.rot = (S.rot + 90) % 360; render(); },
    fh: function () { S.fh = !S.fh; render(); },
    fv: function () { S.fv = !S.fv; render(); },
    reset: function () { S.rot = 0; S.fh = false; S.fv = false; render(); },
    asp: function (t) { S.aspect = t.dataset.v; render(); },
    mode: function (t) { S.mode = t.dataset.v; render(); },
    qp: function (t) { S.q = +t.dataset.v; render(); },
    conv: startConvert,
    dl: function (t) { var r = S.res[+t.dataset.i]; B.saveBlob(r.blob, B.baseName(r.name) + '.webp'); },
    zip: zipAll,
    again: function () { resetBatch(); render(); },
    rotkey: function (t) { S.modal = { kind: 'rotate', code: t.dataset.code, name: t.dataset.name }; render(); },
    save: openSave,
    chpin: function () { S.modal = { kind: 'pin' }; render(); },
    mc: function () { S.modal = null; render(); },
    mk: confirmModal,
    copykey: function () { copy(S.modal && S.modal.key, 'Key copied.'); },
    copysecret: function () { copy(S.modal && S.modal.signingSecret, 'Signing secret copied.'); }
  };

  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (t && actions[t.dataset.act]) actions[t.dataset.act](t);
  });
  root.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'fi') { add(t.files); t.value = ''; }
    else if (t.dataset.change === 'cur') { S.cur = +t.value; render(); }
    else if (t.hasAttribute('data-q')) { S.q = +t.value; render(); }
    else if (t.dataset.n) {
      S.setDraft = S.setDraft || JSON.parse(JSON.stringify(S.set));
      S.setDraft[t.dataset.n] = t.value === '' ? NaN : Number(t.value);
    }
  });
  root.addEventListener('input', function (e) {
    if (e.target.hasAttribute('data-q')) {
      S.q = +e.target.value;
      var qv = $('#qv'); if (qv) qv.textContent = S.q + '%';
    }
  });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.closest('.mb') && e.target.tagName === 'INPUT') confirmModal();
    if (e.key === 'Escape' && S.modal) { S.modal = null; render(); }
  });
  document.addEventListener('dragover', function (e) {
    var d = e.target.closest && e.target.closest('#drop');
    if (d) { e.preventDefault(); d.classList.add('over'); }
  });
  document.addEventListener('dragleave', function (e) {
    var d = e.target.closest && e.target.closest('#drop');
    if (d) d.classList.remove('over');
  });
  document.addEventListener('drop', function (e) {
    var d = e.target.closest && e.target.closest('#drop');
    if (d) { e.preventDefault(); d.classList.remove('over'); add(e.dataTransfer.files); }
  });
  // stop the browser opening a file that is dropped outside the drop box
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  /* ---------- start ---------- */
  render();
  api.session().then(function (u) {
    if (!u && !cfgMock()) { location.replace('/login.html'); return new Promise(function () {}); }
    S.user = u;
    return u ? loadSettings() : null;
  }).then(function () { S.boot = true; render(); });
})();
