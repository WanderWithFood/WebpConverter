(function () {
  var B = window.BINI = window.BINI || {};

  B.$ = function (s, r) { return (r || document).querySelector(s); };

  B.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  B.kb = function (b) {
    return b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : (b / 1024).toFixed(1) + ' KB';
  };

  B.baseName = function (n) { return n.replace(/\.[^.]+$/, ''); };

  var toastTimer;
  B.toast = function (msg) {
    var el = B.$('#toast');
    el.innerHTML = '<div class="toast">' + B.esc(msg) + '</div>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.innerHTML = ''; }, 2800);
  };

  B.saveBlob = function (blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    B.toast('Download started: ' + name);
  };
})();
