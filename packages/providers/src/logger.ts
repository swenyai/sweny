/* eslint-disable no-console */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export const consoleLogger: Logger = {
  info: (msg, ...args) => console.log(msg, ...args),
  debug: (msg, ...args) => console.debug(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
};
