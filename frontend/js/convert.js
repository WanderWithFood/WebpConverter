/* Browser-side conversion. Files stay on the computer.
   Metadata (location, device data) is removed because only pixels are redrawn to a canvas. */
(function () {
  var B = window.BINI;
  var MAX_PIXELS = 100000000; // 100 megapixels

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('decode')); };
      im.src = url;
    });
  }

  /* opts: { aspect, mode, q, rot, fh, fv } -> Promise<Blob (image/webp)> */
  function encode(item, opts) {
    return loadImage(item.url).then(function (im) {
      var w = im.naturalWidth, h = im.naturalHeight;
      var sx = 0, sy = 0, sw = w, sh = h;
      if (w * h > MAX_PIXELS) throw new Error('size');
      if (opts.aspect !== 'original') {
        var p = opts.aspect.split(':');
        var r = p[0] / p[1];
        if (w / h > r) { sw = Math.round(h * r); sx = Math.round((w - sw) / 2); }
        else { sh = Math.round(w / r); sy = Math.round((h - sh) / 2); }
      }
      var turned = opts.rot % 180 !== 0;
      var c = document.createElement('canvas');
      c.width = turned ? sh : sw;
      c.height = turned ? sw : sh;
      var x = c.getContext('2d');
      x.translate(c.width / 2, c.height / 2);
      x.rotate(opts.rot * Math.PI / 180);
      x.scale(opts.fh ? -1 : 1, opts.fv ? -1 : 1);
      x.drawImage(im, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) {
          if (!b || b.type !== 'image/webp') reject(new Error('encode'));
          else resolve(b);
        }, 'image/webp', opts.mode === 'lossless' ? 1 : opts.q / 100);
      });
    });
  }

  B.convert = {
    loadImage: loadImage,
    encode: encode,
    maxPixels: MAX_PIXELS,
    reason: function (e) {
      if (e && e.message === 'size') return 'Image is too large to process';
      if (e && e.message === 'encode') return 'This browser could not create WebP';
      return 'File could not be read';
    }
  };
})();
