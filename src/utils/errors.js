export class NabiError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "NabiError";
  }
}

export const formatError = (error) =>
  error instanceof NabiError ? error.message : `Unexpected error: ${error.message}`;
