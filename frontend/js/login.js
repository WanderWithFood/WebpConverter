(function () {
  var $ = function (s) { return document.querySelector(s); };

  // Already signed in: go straight to the portal.
  fetch('/session', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.user) location.replace('/');
  }, function () {});

  $('#bg-toggle').addEventListener('click', function () {
    var f = $('#bg');
    f.hidden = !f.hidden;
    if (!f.hidden) $('#u').focus();
  });

  $('#bg').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#err');
    err.hidden = true;
    fetch('/auth/break-glass', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#u').value, password: $('#p').value, code: $('#c').value })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      if (res.ok) { location.replace('/'); return; }
      err.textContent = res.d.error || 'Sign-in failed.';
      err.hidden = false;
      $('#p').value = '';
      $('#c').value = '';
    }, function () {
      err.textContent = 'Could not reach the server.';
      err.hidden = false;
    });
  });
})();
