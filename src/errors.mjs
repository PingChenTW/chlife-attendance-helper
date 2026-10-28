export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function ensure(value, status, code, message) {
  if (!value) throw new AppError(status, code, message);
}
