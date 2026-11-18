/* Screens. Each function takes the app state and returns an HTML string. */
(function () {
  var B = window.BINI, esc = B.esc, kb = B.kb;
  var cfg = window.BINI_CONFIG || {};

  var NAV = [
    ['convert', 'Convert', 'fa-image'],
    ['api', 'API Integrations', 'fa-code'],
    ['log', 'Activity Log', 'fa-clipboard-list'],
    ['set', 'Settings', 'fa-gear']
  ];
  var TITLES = {
    convert: ['Convert images', 'Convert images to WebP before using them in any BINI system'],
    api: ['API integrations', 'Connected systems, keys and usage'],
    log: ['Activity log', 'Every conversion and key action'],
    set: ['Settings', 'Limits and defaults for this portal']
  };

  function initials(name) {
    return (name || '?').split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }
  function validFiles(S) { return S.files.filter(function (f) { return f.valid; }); }
  function saved(orig, now) {
    var p = Math.round((1 - now / orig) * 100);
    return p >= 0 ? { text: p + '%', cls: 'p-ok' } : { text: 'Larger', cls: 'p-warn' };
  }

  /* ---------- sign in ---------- */
  function login() {
    return '<div class="login"><div class="card lc">' +
      '<div class="logo logo-lg">B</div>' +
      '<h1>BINI Image Converter</h1>' +
      '<p>Private portal for BINI staff and connected systems. Sign in with your BINI account.</p>' +
      '<button class="btn pri" data-act="sso">Sign in with Founders Desk</button>' +
      '<div class="hr">Core admin only</div>' +
      '<button class="btn" data-act="bg">Use break-glass account</button>' +
      '<p class="fine">Access is granted by the core admin. Contact the core admin if you cannot sign in.</p>' +
      '</div></div>';
  }

  /* ---------- shell ---------- */
  function shell(S) {
    var t = TITLES[S.page];
    var nav = NAV.map(function (n, i) {
      return (i === 1 ? '<div class="nlab">Manage</div>' : '') +
        '<button class="nav' + (S.page === n[0] ? ' on' : '') + '" data-act="go" data-page="' + n[0] + '"><i class="fa-solid ' + n[2] + '"></i>' + n[1] + '</button>';
    }).join('');
    var body = S.page === 'convert' ? convert(S) : S.page === 'api' ? apiPage(S) : S.page === 'log' ? logPage(S) : settingsPage(S);
    return '<div class="app"><aside class="side">' +
      '<div class="brand"><div class="logo">B</div><div><b>BINI Portal</b><span>Image Converter</span></div></div>' +
      '<div class="nlab">Tools</div>' + nav + '</aside>' +
      '<main class="main">' +
      (cfg.USE_MOCK ? '<div class="banner">Demo mode: sample data, no server connected.</div>' : '') +
      '<div class="top"><div><h1>' + t[0] + '</h1><p>' + t[1] + '</p></div>' +
      '<div class="who"><div class="av">' + esc(initials(S.user.name)) + '</div><div><div style="font-weight:600">' + esc(S.user.name) + '</div><div class="sub">' + esc(S.user.role || '') + '</div></div>' +
      '<button class="tb" data-act="out">Sign out</button></div></div>' +
      '<div class="pg">' + body + '</div></main></div>' + (S.modal ? modal(S) : '');
  }

  /* ---------- convert ---------- */
  function stepsBar(S) {
    var names = ['Upload', 'Settings', 'Convert', 'Download'];
    return '<div class="steps">' + names.map(function (t, i) {
      var c = S.step === i + 1 ? 'on' : S.step > i + 1 ? 'done' : '';
      return '<div class="step ' + c + '"><i>' + (S.step > i + 1 ? '&#10003;' : i + 1) + '</i>' + t + '</div>';
    }).join('') + '</div>';
  }

  function convert(S) {
    var h = stepsBar(S) + '<div class="card">';
    if (S.step === 1) h += step1(S);
    else if (S.step === 2) h += step2(S);
    else if (S.step === 3) h += step3(S);
    else h += step4(S);
    return h + '</div>';
  }

  function step1(S) {
    var ok = validFiles(S).length;
    var checking = S.files.filter(function (f) { return f.checking; }).length;
    var rejected = S.files.filter(function (f) { return !f.valid && !f.checking; }).length;
    var h = '<div class="ch"><h2>Upload images</h2><span class="sub">PNG, JPG, WebP, BMP, GIF, AVIF. Up to ' + S.set.maxMb + ' MB per file, ' + S.set.maxFiles + ' files per batch</span></div>' +
      '<div class="cb"><div class="drop" id="drop"><h3>Drag and drop images here</h3><p>or choose files from your computer</p>' +
      '<button class="btn" data-act="pick">Choose files</button><input type="file" id="fi" multiple accept="image/*" hidden></div>' +
      '<p class="sub" style="margin:10px 0 0">Conversion runs in this browser. Files are not uploaded.</p>';
    if (S.files.length) {
      h += '<div class="lab">File queue &nbsp;<span class="pill p-n">' + S.files.length + ' files</span> <span class="pill p-ok">' + ok + ' valid</span> ' +
        (rejected ? '<span class="pill p-bad">' + rejected + ' rejected</span>' : '') + '</div>' +
        '<div class="tw"><table><thead><tr><th>File</th><th>Dimensions</th><th>Size</th><th>Status</th><th></th></tr></thead><tbody>' +
        S.files.map(function (f, i) {
          var status = f.checking ? '<span class="pill p-n">Checking</span>' : f.valid ? '<span class="pill p-ok">Valid</span>' : '<span class="pill p-bad">' + esc(f.err) + '</span>';
          return '<tr><td><div class="fn"><img class="thumb" src="' + f.url + '" alt=""><b>' + esc(f.name) + '</b></div></td>' +
            '<td>' + (f.w ? f.w + ' x ' + f.h : '-') + '</td><td>' + kb(f.size) + '</td><td>' + status + '</td>' +
            '<td><button class="btn sm dng" data-act="rm" data-i="' + i + '">Remove</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    h += '<div class="foot"><button class="btn" data-act="clear"' + (S.files.length ? '' : ' disabled') + '>Clear queue</button>' +
      '<button class="btn pri" data-act="next"' + (ok && !checking ? '' : ' disabled') + '>Continue to settings</button></div></div>';
    return h;
  }

  function estText(S) {
    var v = validFiles(S);
    var tot = v.reduce(function (a, b) { return a + b.size; }, 0);
    var r = S.est && S.est.key === S.estKeyNow ? S.est.ratio : null;
    if (r === null) return 'Estimated WebP size: measuring on the selected file...';
    var size = kb(Math.round(tot * r));
    return r >= 1 ? 'Estimated WebP size: ' + size + ' (not smaller than the original, measured on the selected file)'
      : 'Estimated WebP size: ' + size + ' (' + Math.round((1 - r) * 100) + '% smaller, measured on the selected file)';
  }

  function step2(S) {
    var v = validFiles(S);
    var f = v[S.cur] || v[0];
    var tot = v.reduce(function (a, b) { return a + b.size; }, 0);
    var asp = [['original', 'Original'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']];
    var presets = [[50, 'Small 50'], [75, 'Standard 75'], [90, 'High 90']];
    return '<div class="ch"><h2>Conversion settings</h2><span class="sub">Applied to all files in this batch</span></div><div class="cb"><div class="grid2"><div>' +
      '<select data-change="cur" aria-label="Preview file">' + v.map(function (x, i) {
        return '<option value="' + i + '"' + (i === S.cur ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(x.name) + ' (' + kb(x.size) + ')</option>';
      }).join('') + '</select>' +
      '<div class="prev" style="margin-top:10px"><img src="' + f.url + '" alt="Preview" style="transform:rotate(' + S.rot + 'deg) scale(' + (S.fh ? -1 : 1) + ',' + (S.fv ? -1 : 1) + ')"></div>' +
      '<div class="seg" style="margin-top:10px"><button data-act="rot">Rotate 90</button><button data-act="fh">Flip horizontal</button><button data-act="fv">Flip vertical</button><button data-act="reset">Reset</button></div>' +
      '<div class="sub" style="margin-top:8px">' + f.w + ' x ' + f.h + ' px, ' + (f.w > f.h ? 'Landscape' : f.w < f.h ? 'Portrait' : 'Square') +
      (S.aspect !== 'original' ? '. Output is cropped to ' + S.aspect + ' from the centre.' : '') + '</div></div>' +
      '<div><div class="lab">Aspect ratio</div><div class="seg">' + asp.map(function (a) {
        return '<button data-act="asp" data-v="' + a[0] + '" class="' + (S.aspect === a[0] ? 'on' : '') + '">' + a[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="lab">Encoding</div><div class="seg">' +
      '<button data-act="mode" data-v="lossy" class="' + (S.mode === 'lossy' ? 'on' : '') + '">Lossy (smaller files)</button>' +
      '<button data-act="mode" data-v="lossless" class="' + (S.mode === 'lossless' ? 'on' : '') + '">Lossless (exact pixels)</button></div>' +
      (S.mode === 'lossy' ? '<div class="lab">Quality &nbsp;<span id="qv" style="color:var(--acc)">' + S.q + '%</span></div>' +
        '<input type="range" min="10" max="100" value="' + S.q + '" data-q aria-label="Quality">' +
        '<div class="seg" style="margin-top:8px">' + presets.map(function (p) {
          return '<button data-act="qp" data-v="' + p[0] + '" class="' + (S.q === p[0] ? 'on' : '') + '">' + p[1] + '</button>';
        }).join('') + '</div>' : '') +
      '<div class="lab">Estimate</div><div class="note">Files: ' + v.length + '<br>Original size: ' + kb(tot) + '<br><span id="est">' + estText(S) + '</span><br>Location and device data are removed from every file.</div>' +
      '</div></div>' +
      '<div class="foot"><button class="btn" data-act="back">Back</button><button class="btn pri" data-act="conv">Convert ' + v.length + ' file' + (v.length > 1 ? 's' : '') + '</button></div></div>';
  }

  function step3(S) {
    return '<div class="ch"><h2>Converting</h2></div><div class="cb"><div class="bar"><div id="pb" style="width:' + S.prog + '%"></div></div>' +
      '<p class="sub" id="pt" style="margin-top:8px">Processing files. Keep this tab open.</p></div>';
  }

  function step4(S) {
    var done = S.res.filter(function (r) { return r.blob; });
    var o = done.reduce(function (a, b) { return a + b.orig; }, 0);
    var w = done.reduce(function (a, b) { return a + b.blob.size; }, 0);
    var tot = o ? saved(o, w) : { text: '0%' };
    return '<div class="ch"><h2>Results</h2><span class="sub">Completed ' + esc(S.doneAt ? S.doneAt.toLocaleString() : '') + '</span></div><div class="cb">' +
      '<div class="kp" style="margin-bottom:14px">' +
      '<div class="card k"><small>Files converted</small><div>' + done.length + ' of ' + S.res.length + '</div></div>' +
      '<div class="card k"><small>Original size</small><div>' + kb(o) + '</div></div>' +
      '<div class="card k"><small>WebP size</small><div>' + kb(w) + '</div></div>' +
      '<div class="card k"><small>Saved</small><div>' + tot.text + '</div></div></div>' +
      '<div class="tw"><table><thead><tr><th>File</th><th>Original</th><th>WebP</th><th>Saved</th><th></th></tr></thead><tbody>' +
      S.res.map(function (r, i) {
        var s = r.blob ? saved(r.orig, r.blob.size) : null;
        return '<tr><td><div class="fn"><img class="thumb" src="' + r.url + '" alt=""><b>' + esc(r.name) + '</b></div></td>' +
          '<td>' + kb(r.orig) + '</td><td>' + (r.blob ? kb(r.blob.size) : '-') + '</td>' +
          '<td>' + (r.blob ? '<span class="pill ' + s.cls + '">' + s.text + '</span>' : '<span class="pill p-bad">Failed</span> <span class="sub">' + esc(r.err || '') + '</span>') + '</td>' +
          '<td>' + (r.blob ? '<button class="btn sm" data-act="dl" data-i="' + i + '">Download</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="foot"><button class="btn" data-act="again">Convert another batch</button>' +
      '<button class="btn pri" data-act="zip"' + (done.length ? '' : ' disabled') + '>Download all as ZIP</button></div></div>';
  }

  /* ---------- API integrations ---------- */
  function apiPage(S) {
    if (!S.systems) return '<div class="card"><div class="empty">' + (S.loadError ? esc(S.loadError) : 'Loading...') + '</div></div>';
    var sys = S.systems;
    var tot = sys.reduce(function (a, b) { return a + b.requests; }, 0);
    var rate = sys.length && tot ? (sys.reduce(function (a, b) { return a + b.success * b.requests; }, 0) / tot).toFixed(1) + '%' : '-';
    return '<div class="kp"><div class="card k"><small>Connected systems</small><div>' + sys.length + '</div></div>' +
      '<div class="card k"><small>Requests, last 30 days</small><div>' + tot.toLocaleString() + '</div></div>' +
      '<div class="card k"><small>Success rate</small><div>' + rate + '</div></div>' +
      '<div class="card k"><small>Systems with active keys</small><div>' + sys.filter(function (s) { return s.status === 'Active'; }).length + '</div></div></div>' +
      '<div class="card"><div class="ch"><h2>Connected systems</h2><span class="sub">One key per system. Keys rotate every 90 days.</span></div><div class="tw"><table><thead><tr><th>System</th><th>Code</th><th>Key</th><th>Last used</th><th>Requests (30 d)</th><th>Success</th><th>Status</th><th></th></tr></thead><tbody>' +
      sys.map(function (s) {
        return '<tr><td><b style="font-weight:600">' + esc(s.name) + '</b></td><td class="mono">' + esc(s.code) + '</td><td class="mono">' + esc(s.keyHint) + '</td><td>' + esc(s.lastUsed) + '</td><td>' + s.requests.toLocaleString() + '</td><td>' + (s.success === null || s.success === undefined ? '-' : s.success + '%') + '</td>' +
          '<td><span class="pill ' + (s.status === 'Active' ? 'p-ok' : 'p-warn') + '">' + esc(s.status) + '</span></td>' +
          '<td><button class="btn sm" data-act="rotkey" data-code="' + esc(s.code) + '" data-name="' + esc(s.name) + '">' + (s.status === 'No key' ? 'Create key' : 'Rotate key') + '</button></td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '<div class="card" style="margin-top:18px"><div class="ch"><h2>Endpoint reference</h2><span class="sub">For developers</span></div><div class="cb">' +
      '<div class="note">Each system calls the service with its own key, signed with HMAC and a timestamp valid for 5 minutes. A signature can be used once. Calls are logged against the system code.</div>' +
      '<div class="lab">Request</div><pre>POST /v1/convert\nAuthorization: Bearer &lt;system key&gt;\nX-Timestamp: &lt;unix seconds&gt;\nX-Signature: &lt;hmac-sha256&gt;\nContent-Type: multipart/form-data\n\nfile      image file (required)\nquality   10 to 100 (default 75)\nmode      lossy | lossless\naspect    original | 16:9 | 9:16 | 1:1</pre>' +
      '<div class="lab">Signature</div><pre>X-Signature = hex( HMAC-SHA256( signing secret, X-Timestamp + "." + raw request body ) )</pre>' +
      '<div class="lab">Response</div><pre>{\n  "system": "WPC",\n  "type": "IMG",\n  "id": "WPC-IMG-000412",\n  "requested_by": "BLG",\n  "format": "webp",\n  "bytes_in": 345600,\n  "bytes_out": 118912,\n  "url": "https://&lt;signed link&gt;",\n  "expires_at": "&lt;15 minutes from now&gt;"\n}</pre>' +
      '<div class="lab">Limits and errors</div><div class="tw"><table><tbody>' +
      '<tr><td class="mono">400</td><td>Missing or invalid parameter</td></tr>' +
      '<tr><td class="mono">401</td><td>Bad key, signature or expired timestamp</td></tr>' +
      '<tr><td class="mono">413</td><td>File larger than ' + S.set.maxMb + ' MB</td></tr>' +
      '<tr><td class="mono">415</td><td>File content is not an allowed image type</td></tr>' +
      '<tr><td class="mono">429</td><td>Too many requests from this system</td></tr></tbody></table></div></div></div>';
  }

  /* ---------- activity log ---------- */
  function logPage(S) {
    if (!S.log) return '<div class="card"><div class="empty">' + (S.loadError ? esc(S.loadError) : 'Loading...') + '</div></div>';
    return '<div class="card"><div class="ch"><h2>Recent activity</h2></div>' +
      (S.log.length ? '<div class="tw"><table><thead><tr><th>Time</th><th>Who</th><th>Type</th><th>Detail</th><th>Size change</th><th>Result</th></tr></thead><tbody>' +
        S.log.map(function (r) {
          return '<tr><td>' + esc(r.time) + '</td><td>' + esc(r.who) + '</td><td>' + esc(r.kind) + '</td><td>' + esc(r.detail) + '</td><td>' + esc(r.size) + '</td>' +
            '<td><span class="pill ' + (r.result === 'Success' ? 'p-ok' : 'p-warn') + '">' + esc(r.result) + '</span></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">No activity yet.</div>') +
      '</div><p class="sub" style="margin-top:10px">Only names, counts and sizes are logged. Image content is not stored.</p>';
  }

  /* ---------- settings ---------- */
  function settingsPage(S) {
    var D = S.setDraft || S.set;
    return '<div class="card"><div class="ch"><h2>Limits and defaults</h2><span class="sub">Apply to the browser tool and to every connected system</span></div><div class="cb">' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">' +
      '<div class="fld"><label for="s1">Maximum file size (MB)</label><input id="s1" type="number" min="1" max="100" value="' + D.maxMb + '" data-n="maxMb"></div>' +
      '<div class="fld"><label for="s2">Files per batch</label><input id="s2" type="number" min="1" max="100" value="' + D.maxFiles + '" data-n="maxFiles"></div>' +
      '<div class="fld"><label for="s3">Default quality (%)</label><input id="s3" type="number" min="10" max="100" value="' + D.defq + '" data-n="defq"></div>' +
      '<div class="fld"><label for="s4">Log retention (days)</label><input id="s4" type="number" min="7" max="365" value="' + D.retain + '" data-n="retain"></div></div>' +
      '<div class="foot"><span class="sub">Saving needs this system PIN and is written to the activity log.</span><button class="btn pri" data-act="save">Save settings</button></div></div></div>' +
      '<div class="card" style="margin-top:18px"><div class="ch"><h2>Fixed rules</h2><span class="sub">Set in the build. Not changeable here.</span></div><div class="tw"><table><tbody>' +
      '<tr><td style="width:240px"><b style="font-weight:600">Allowed file types</b></td><td>PNG, JPG, WebP, BMP, GIF, AVIF</td></tr>' +
      '<tr><td><b style="font-weight:600">Metadata</b></td><td>Location and device data are always removed</td></tr>' +
      '<tr><td><b style="font-weight:600">Original files</b></td><td>Never stored. Deleted as soon as conversion ends</td></tr></tbody></table></div></div>' +
      '<div class="card" style="margin-top:18px"><div class="ch"><h2>Security</h2></div><div class="cb" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
      '<div><b style="font-weight:600">System PIN</b><div class="sub">Needed to rotate keys and save settings. This PIN is only for the Image Converter.</div></div>' +
      '<button class="btn" data-act="chpin">Change PIN</button></div></div>';
  }

  /* ---------- modal ---------- */
  function modal(S) {
    var m = S.modal;
    if (m.kind === 'key') {
      return '<div class="modal"><div class="mb"><h3>New key for ' + esc(m.name) + '</h3>' +
        '<p>Copy these now. They are shown only once and cannot be viewed again. Pass them to the system\'s developers securely, never by chat or email in plain text.</p>' +
        '<div class="lab">API key</div><code class="keybox">' + esc(m.key) + '</code>' +
        (m.signingSecret ? '<div class="lab">Signing secret</div><code class="keybox">' + esc(m.signingSecret) + '</code>' : '') +
        '<div class="row"><button class="btn" data-act="copykey">Copy key</button>' + (m.signingSecret ? '<button class="btn" data-act="copysecret">Copy signing secret</button>' : '') + '<button class="btn pri" data-act="mc">Done</button></div></div></div>';
    }
    var title = m.kind === 'save' ? 'Confirm settings change' : m.kind === 'pin' ? 'Change system PIN' : 'Rotate API key';
    var text = m.kind === 'save' ? 'Changes to limits and defaults apply to every system at once.' :
      m.kind === 'pin' ? 'Enter the current PIN, then choose a new 6-digit PIN.' :
      'The old key for ' + esc(m.name) + ' stops working at once.';
    return '<div class="modal"><div class="mb" role="dialog" aria-modal="true" aria-label="' + title + '"><h3>' + title + '</h3><p>' + text + '</p>' +
      '<div class="fld"><label for="pin">System PIN</label><input type="password" id="pin" inputmode="numeric" maxlength="6" autocomplete="off"' + (m.locked ? ' disabled' : '') + '></div>' +
      (m.kind === 'pin' ? '<div class="fld"><label for="np1">New PIN (6 digits)</label><input type="password" id="np1" inputmode="numeric" maxlength="6" autocomplete="off"></div>' +
        '<div class="fld"><label for="np2">Confirm new PIN</label><input type="password" id="np2" inputmode="numeric" maxlength="6" autocomplete="off"></div>' : '') +
      (m.locked ? '<div class="pill p-bad">Locked for 15 minutes. The core admin has been alerted.</div>' : m.err ? '<div class="pill p-bad">' + esc(m.err) + '</div>' : '') +
      '<div class="row"><button class="btn" data-act="mc">Cancel</button><button class="btn pri" data-act="mk"' + (m.locked ? ' disabled' : '') + '>' +
      (m.kind === 'save' ? 'Confirm' : m.kind === 'pin' ? 'Change PIN' : 'Rotate key') + '</button></div></div></div>';
  }

  B.views = { login: login, shell: shell, estText: estText };
})();
