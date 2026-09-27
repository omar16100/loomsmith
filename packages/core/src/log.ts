export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogData = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  data: LogData | null;
}

export const null_logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function create_memory_logger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const push =
    (level: LogLevel) =>
    (message: string, data?: LogData): void => {
      entries.push({ level, message, data: data ?? null });
    };
  return { entries, debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") };
}
