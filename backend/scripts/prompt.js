// Asks for a secret in the terminal without showing it.
module.exports = function ask(label) {
  return new Promise(function (resolve) {
    process.stdout.write(label);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', function (d) { data += d; });
      stdin.on('end', function () { resolve(data.split(/\r?\n/)[0]); });
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', function onData(ch) {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.exit(1);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    });
  });
};
