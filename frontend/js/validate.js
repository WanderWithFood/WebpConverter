/* Real file-type check: reads the first bytes of the file and ignores the extension.
   Allowed types: PNG, JPG, WebP, BMP, GIF, AVIF. */
(function () {
  var B = window.BINI;

  function ascii(u8, from, to) {
    var s = '';
    for (var i = from; i < to && i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }

  function sniff(u8) {
    if (u8.length >= 8 && u8[0] === 0x89 && ascii(u8, 1, 4) === 'PNG' && u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a) return 'png';
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'jpg';
    var g = ascii(u8, 0, 6);
    if (g === 'GIF87a' || g === 'GIF89a') return 'gif';
    if (ascii(u8, 0, 2) === 'BM') return 'bmp';
    if (ascii(u8, 0, 4) === 'RIFF' && ascii(u8, 8, 12) === 'WEBP') return 'webp';
    if (ascii(u8, 4, 8) === 'ftyp') {
      var brands = ascii(u8, 8, 32);
      if (brands.indexOf('avif') > -1 || brands.indexOf('avis') > -1) return 'avif';
    }
    return null;
  }

  B.validate = {
    /* Resolves to { ok: true, type } or { ok: false } */
    inspect: function (file) {
      return file.slice(0, 32).arrayBuffer().then(function (buf) {
        var type = sniff(new Uint8Array(buf));
        return type ? { ok: true, type: type } : { ok: false };
      }, function () { return { ok: false }; });
    }
  };
})();
