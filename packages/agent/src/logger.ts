/* eslint-disable no-console */
export type { Logger } from "@swenyai/providers";

const LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(prefix: string, level?: string) {
  const threshold = LEVELS[level?.toLowerCase() ?? "info"] ?? 1;
  const tag = `[${prefix}]`;

  return {
    debug(msg: string, ...args: unknown[]) {
      if (threshold <= 0) console.log(tag, msg, ...args);
    },
    info(msg: string, ...args: unknown[]) {
      if (threshold <= 1) console.log(tag, msg, ...args);
    },
    warn(msg: string, ...args: unknown[]) {
      if (threshold <= 2) console.warn(tag, msg, ...args);
    },
    error(msg: string, ...args: unknown[]) {
      if (threshold <= 3) console.error(tag, msg, ...args);
    },
  };
}
