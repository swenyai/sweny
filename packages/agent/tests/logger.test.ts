import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a Logger with all methods", () => {
    const logger = createLogger("test");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("suppresses debug messages at info level", () => {
    const logger = createLogger("test", "info");
    logger.debug("hidden");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("shows info messages at info level", () => {
    const logger = createLogger("test", "info");
    logger.info("visible");
    expect(logSpy).toHaveBeenCalledWith("[test]", "visible");
  });

  it("shows warn messages at info level", () => {
    const logger = createLogger("test", "info");
    logger.warn("warning!");
    expect(warnSpy).toHaveBeenCalledWith("[test]", "warning!");
  });

  it("shows error messages at info level", () => {
    const logger = createLogger("test", "info");
    logger.error("bad");
    expect(errorSpy).toHaveBeenCalledWith("[test]", "bad");
  });

  it("shows debug messages at debug level", () => {
    const logger = createLogger("test", "debug");
    logger.debug("detailed");
    expect(logSpy).toHaveBeenCalledWith("[test]", "detailed");
  });

  it("suppresses debug and info at warn level", () => {
    const logger = createLogger("test", "warn");
    logger.debug("hidden");
    logger.info("also hidden");
    expect(logSpy).not.toHaveBeenCalled();

    logger.warn("visible");
    expect(warnSpy).toHaveBeenCalledWith("[test]", "visible");
  });

  it("prefix appears in output", () => {
    const logger = createLogger("my-prefix", "info");
    logger.info("hello");
    expect(logSpy).toHaveBeenCalledWith("[my-prefix]", "hello");
  });

  it("defaults to info level when no level is provided", () => {
    const logger = createLogger("test");
    logger.debug("hidden");
    expect(logSpy).not.toHaveBeenCalled();

    logger.info("visible");
    expect(logSpy).toHaveBeenCalledWith("[test]", "visible");
  });

  it("passes extra arguments through", () => {
    const logger = createLogger("test", "debug");
    logger.debug("msg", { key: "value" }, 42);
    expect(logSpy).toHaveBeenCalledWith("[test]", "msg", { key: "value" }, 42);
  });
});
