export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

const LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(prefix: string, level?: string): Logger {
  const threshold = LEVELS[level?.toLowerCase() ?? "info"] ?? LEVELS.info!;
  const tag = `[${prefix}]`;

  return {
    debug(msg: string, ...args: unknown[]) {
      if (threshold <= LEVELS.debug!) console.log(tag, msg, ...args);
    },
    info(msg: string, ...args: unknown[]) {
      if (threshold <= LEVELS.info!) console.log(tag, msg, ...args);
    },
    warn(msg: string, ...args: unknown[]) {
      if (threshold <= LEVELS.warn!) console.warn(tag, msg, ...args);
    },
    error(msg: string, ...args: unknown[]) {
      if (threshold <= LEVELS.error!) console.error(tag, msg, ...args);
    },
  };
}
