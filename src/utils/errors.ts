export class NabiError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "NabiError";
  }
}

export const formatError = (error: unknown) =>
  error instanceof NabiError
    ? error.message
    : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
