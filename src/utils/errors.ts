export class NabiError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "NabiError";
  }
}

type FormatErrorOptions = { color?: boolean };

const color = (code: number, value: string, enabled: boolean) => {
  return enabled ? `\u001B[${code}m${value}\u001B[0m` : value;
};

const formatNabiError = (message: string, colorEnabled: boolean) => {
  const [title, ...details] = message.split("\n");
  const heading = `${color(31, "[ERROR]", colorEnabled)} ${color(1, title ?? "Nabi error", colorEnabled)}`;

  return details.length ? `${heading}\n${details.join("\n")}` : heading;
};

export const formatError = (error: unknown, options: FormatErrorOptions = {}) => {
  const colorEnabled = options.color ?? (Boolean(process.stderr.isTTY) && !process.env.NO_COLOR);

  if (error instanceof NabiError) return formatNabiError(error.message, colorEnabled);

  const message = error instanceof Error ? error.message : String(error);

  return `${color(31, "[ERROR]", colorEnabled)} ${color(1, `Unexpected error: ${message}`, colorEnabled)}`;
};
