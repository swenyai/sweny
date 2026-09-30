/**
 * Env-scope notice noise: runner-image variables are summarized in one plain
 * log line; only non-baseline withheld names raise a warning; everything is
 * reported once per process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyWithheld,
  isRunnerBaselineVar,
  reportWithheldEnv,
  resetWithheldReport,
  formatScopeSummary,
  WITHHELD_WARNING_CAP,
} from "../agent-env.js";

const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

// Names from a real GitHub-hosted run (run 36761124645) plus documented image env.
const RUNNER = [
  "ACCEPT_EULA",
  "ACTIONS_ORCHESTRATION_ID",
  "ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE",
  "AGENT_TOOLSDIRECTORY",
  "ANDROID_HOME",
  "ANDROID_NDK_LATEST_HOME",
  "ANT_HOME",
  "AZURE_EXTENSION_DIR",
  "BOOTSTRAP_HASKELL_NONINTERACTIVE",
  "CHROMEWEBDRIVER",
  "CHROME_BIN",
  "CONDA",
  "DEBIAN_FRONTEND",
  "DOTNET_NOLOGO",
  "EDGEWEBDRIVER",
  "ENABLE_RUNNER_TRACING",
  "GECKOWEBDRIVER",
  "GHCUP_INSTALL_BASE_PREFIX",
  "GOROOT_1_22_X64",
  "ImageOS",
  "ImageVersion",
  "JAVA_HOME_21_X64",
  "LEIN_HOME",
  "PIPX_BIN_DIR",
  "POWERSHELL_DISTRIBUTION_CHANNEL",
  "RUNNER_ARCH",
  "SWIFT_PATH",
  "VCPKG_INSTALLATION_ROOT",
  "GITHUB_ACTOR",
  "GITHUB_OUTPUT",
];

describe("runner baseline classification", () => {
  it("recognizes CI image variables", () => {
    for (const n of RUNNER) expect(isRunnerBaselineVar(n), n).toBe(true);
  });

  it("never treats user or secret names as baseline", () => {
    for (const n of [
      "GITHUB_TOKEN",
      "NPM_TOKEN",
      "DATABASE_URL",
      "BASE_URL",
      "AWS_SECRET_ACCESS_KEY",
      "LINEAR_API_KEY",
      "SENTRY_AUTH_TOKEN",
      "AZURE_CLIENT_SECRET",
      "DEV",
    ]) {
      expect(isRunnerBaselineVar(n), n).toBe(false);
    }
  });

  it("splits into sorted baseline and other", () => {
    const { baseline, other } = classifyWithheld(["DATABASE_URL", "ANDROID_HOME", "ACCEPT_EULA", "BASE_URL"]);
    expect(baseline).toEqual(["ACCEPT_EULA", "ANDROID_HOME"]);
    expect(other).toEqual(["BASE_URL", "DATABASE_URL"]);
  });
});

describe("reportWithheldEnv", () => {
  beforeEach(() => resetWithheldReport());

  it("baseline only: one plain info line, no warning", () => {
    const log = logger();
    reportWithheldEnv(RUNNER, log, { GITHUB_ACTIONS: "true" });
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledOnce();
    const line = String(log.info.mock.calls[0][0]);
    expect(line).toBe(formatScopeSummary(RUNNER.length, RUNNER.length));
    expect(line).toContain(`${RUNNER.length} withheld, ${RUNNER.length} from the CI image`);
    expect(line).toContain("env-passthrough");
    expect(line).toContain("--verbose");
    expect(line).not.toContain("::warning");
    expect(line).not.toContain("ANDROID_HOME");
  });

  it("non-baseline names warn, listing only those (annotation under Actions)", () => {
    const log = logger();
    reportWithheldEnv([...RUNNER, "DATABASE_URL", "BASE_URL"], log, { GITHUB_ACTIONS: "true" });
    expect(log.warn).toHaveBeenCalledOnce();
    const w = String(log.warn.mock.calls[0][0]);
    expect(w.startsWith("::warning title=SWEny agent env::")).toBe(true);
    expect(w).toContain("withheld 2 environment variable(s)");
    expect(w).toContain("BASE_URL, DATABASE_URL");
    expect(w).not.toContain("ANDROID_HOME");
    expect(String(log.info.mock.calls[0][0])).toContain(`${RUNNER.length + 2} withheld, ${RUNNER.length} from`);
  });

  it("no annotation prefix outside GitHub Actions", () => {
    const log = logger();
    reportWithheldEnv(["DATABASE_URL"], log, {});
    expect(String(log.warn.mock.calls[0][0]).startsWith("::warning")).toBe(false);
  });

  it("caps the warning at 30 names", () => {
    const log = logger();
    const many = Array.from({ length: 35 }, (_, i) => `APP_VAR_${String(i).padStart(2, "0")}`);
    reportWithheldEnv(many, log, {});
    const w = String(log.warn.mock.calls[0][0]);
    expect(WITHHELD_WARNING_CAP).toBe(30);
    expect(w).toContain("and 5 more");
    expect(w).not.toContain("APP_VAR_30");
  });

  it("debug (--verbose) lists every name, baseline included", () => {
    const log = logger();
    reportWithheldEnv([...RUNNER, "DATABASE_URL"], log, {});
    const d = String(log.debug.mock.calls[0][0]);
    expect(d).toContain("ANDROID_HOME");
    expect(d).toContain("DATABASE_URL");
  });

  it("reports once per process", () => {
    const log = logger();
    reportWithheldEnv(["DATABASE_URL"], log, {});
    reportWithheldEnv(["DATABASE_URL"], log, {});
    reportWithheldEnv(["OTHER_THING"], log, {});
    expect(log.info).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("nothing withheld: silent and does not burn the once-flag", () => {
    const log = logger();
    reportWithheldEnv([], log, {});
    expect(log.info).not.toHaveBeenCalled();
    reportWithheldEnv(["DATABASE_URL"], log, {});
    expect(log.info).toHaveBeenCalledOnce();
  });
});
