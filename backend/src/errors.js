class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra) Object.assign(this, extra);
  }
}
module.exports = { HttpError };
