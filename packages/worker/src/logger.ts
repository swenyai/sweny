/**
 * Simple structured JSON logger for the open-source SWEny worker.
 *
 * No external dependencies — writes JSON lines to stdout using console.log.
 * Each log line has { level, ts, msg, ...meta }.
 *
 * Usage:
 *   logger.info({ jobId }, "Starting job")
 *   logger.child({ jobId }).warn("Something unexpected")
 */

export interface Logger {
  info(meta: Record<string, unknown>, msg: string): void;
  info(msg: string): void;
  debug(meta: Record<string, unknown>, msg: string): void;
  debug(msg: string): void;
  warn(meta: Record<string, unknown>, msg: string): void;
  warn(msg: string): void;
  error(meta: Record<string, unknown>, msg: string): void;
  error(msg: string): void;
  child(meta: Record<string, unknown>): Logger;
}

type LogLevel = "debug" | "info" | "warn" | "error";

function createLogger(baseMeta: Record<string, unknown>): Logger {
  function log(level: LogLevel, metaOrMsg: Record<string, unknown> | string, msg?: string): void {
    const line: Record<string, unknown> = {
      level,
      ts: new Date().toISOString(),
      ...baseMeta,
    };

    if (typeof metaOrMsg === "string") {
      line["msg"] = metaOrMsg;
    } else {
      Object.assign(line, metaOrMsg);
      line["msg"] = msg ?? "";
    }

    console.log(JSON.stringify(line));
  }

  return {
    info(metaOrMsg: Record<string, unknown> | string, msg?: string): void {
      log("info", metaOrMsg as Record<string, unknown> | string, msg);
    },
    debug(metaOrMsg: Record<string, unknown> | string, msg?: string): void {
      log("debug", metaOrMsg as Record<string, unknown> | string, msg);
    },
    warn(metaOrMsg: Record<string, unknown> | string, msg?: string): void {
      log("warn", metaOrMsg as Record<string, unknown> | string, msg);
    },
    error(metaOrMsg: Record<string, unknown> | string, msg?: string): void {
      log("error", metaOrMsg as Record<string, unknown> | string, msg);
    },
    child(meta: Record<string, unknown>): Logger {
      return createLogger({ ...baseMeta, ...meta });
    },
  };
}

export const logger: Logger = createLogger({});
