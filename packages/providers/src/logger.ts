export interface Logger {
  info(msg: string): void;
  debug(msg: string): void;
  warn(msg: string): void;
}

export const consoleLogger: Logger = {
  info: (msg) => console.log(msg),
  debug: (msg) => console.debug(msg),
  warn: (msg) => console.warn(msg),
};
