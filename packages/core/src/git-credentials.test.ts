import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  gitCredentialMask,
  gitCredentialPolicy,
  gitCredentialWarning,
  helperHasInlineSecret,
  parseGitConfig,
  scanGitCredentials,
  urlHasCredential,
} from "./git-credentials.js";

// #473: what actions/checkout leaves on disk, and the other ways a git config
// can carry a credential. No value may ever leave the scanner.
const SECRET = "ghs_canaryCanaryCanaryCanary0473";
const BASIC = Buffer.from(`x-access-token:${SECRET}`).toString("base64");

let root: string;
let home: string;
let repo: string;

function write(p: string, text: string): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, text);
  return realpathSync(p);
}

function scan(cwd = repo) {
  return scanGitCredentials(cwd, { env: { HOME: home } });
}

function noSecret(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(BASIC);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "sweny-gitcred-")));
  home = path.join(root, "home");
  repo = path.join(root, "repo");
  mkdirSync(home, { recursive: true });
  mkdirSync(path.join(repo, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scanGitCredentials", () => {
  it("finds the checkout v4/v5 extraheader in .git/config, and only that file", () => {
    const config = write(
      path.join(repo, ".git", "config"),
      `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/o/r\n` +
        `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${BASIC}\n`,
    );
    const s = scan();
    expect(s.files).toEqual([config]);
    expect(s.findings).toEqual([{ file: config, key: "http.https://github.com/.extraheader", kind: "extraheader" }]);
    noSecret(s);
  });

  it("finds the checkout v6+ credential in the includeIf file, not in .git/config", () => {
    const creds = write(
      path.join(root, "runner-temp", "git-credentials-1234.config"),
      `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${BASIC}\n`,
    );
    write(
      path.join(repo, ".git", "config"),
      `[core]\n\tbare = false\n[includeIf "gitdir:${path.join(repo, ".git")}/"]\n\tpath = ${creds}\n`,
    );
    const s = scan();
    expect(s.files).toEqual([creds]);
    expect(s.findings.map((f) => f.kind)).toEqual(["extraheader"]);
    noSecret(s);
  });

  it("follows a relative include and a subdirectory cwd", () => {
    const inc = write(
      path.join(repo, ".git", "creds.inc"),
      `[http]\n\textraHeader = Authorization: Bearer ${SECRET}\n`,
    );
    write(path.join(repo, ".git", "config"), `[include]\n\tpath = creds.inc\n`);
    mkdirSync(path.join(repo, "src", "deep"), { recursive: true });
    expect(scan(path.join(repo, "src", "deep")).files).toEqual([inc]);
  });

  it("finds credentials in remote URLs, insteadOf bases and inline helpers, redacting keys", () => {
    const config = write(
      path.join(repo, ".git", "config"),
      `[remote "origin"]\n\turl = https://x-access-token:${SECRET}@github.com/o/r.git\n` +
        `[url "https://${SECRET}@github.com/"]\n\tinsteadOf = https://github.com/\n` +
        `[credential]\n\thelper = "!f() { echo username=x; echo password=${SECRET}; }; f"\n`,
    );
    const s = scan();
    expect(s.files).toEqual([config]);
    expect(s.findings.map((f) => f.key)).toEqual([
      "remote.origin.url",
      "url.<redacted>.insteadof",
      "credential.helper",
    ]);
    noSecret(s);
  });

  it("masks a store helper's file, not the config naming it", () => {
    const store = write(path.join(root, "store", "creds"), `https://x:${SECRET}@github.com\n`);
    write(path.join(repo, ".git", "config"), `[credential]\n\thelper = store --file ${store}\n`);
    const s = scan();
    expect(s.files).toEqual([store]);
    expect(s.findings[0]).toMatchObject({ kind: "credential-store", file: store });
  });

  it("scans the global config too", () => {
    const global = write(path.join(home, ".gitconfig"), `[http "https://github.com/"]\n\textraheader = x: ${SECRET}\n`);
    write(path.join(repo, ".git", "config"), `[core]\n\tbare = false\n`);
    expect(scan().files).toEqual([global]);
  });

  it("resolves a linked worktree's .git file and commondir", () => {
    const main = path.join(root, "main");
    const config = write(
      path.join(main, ".git", "config"),
      `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${BASIC}\n`,
    );
    const wtGit = path.join(main, ".git", "worktrees", "wt");
    write(path.join(wtGit, "commondir"), "../..\n");
    const wt = path.join(root, "wt");
    write(path.join(wt, ".git"), `gitdir: ${wtGit}\n`);
    expect(scan(wt).files).toEqual([config]);
  });

  it("finds nothing in a clean checkout (persist-credentials: false)", () => {
    write(
      path.join(repo, ".git", "config"),
      `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/o/r\n` +
        `[credential]\n\thelper = osxkeychain\n[url "git@github.com:"]\n\tinsteadOf = https://github.com/\n`,
    );
    expect(scan()).toEqual({ findings: [], files: [] });
    expect(gitCredentialWarning(scan())).toBeUndefined();
  });

  it("survives an include loop", () => {
    write(path.join(repo, ".git", "a"), `[include]\n\tpath = b\n`);
    write(path.join(repo, ".git", "b"), `[include]\n\tpath = a\n`);
    write(path.join(repo, ".git", "config"), `[include]\n\tpath = a\n`);
    expect(scan().files).toEqual([]);
  });
});

describe("per-node mask", () => {
  beforeEach(() => {
    write(
      path.join(repo, ".git", "config"),
      `[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${BASIC}\n`,
    );
  });

  it("masks read-only and staged nodes, never a default write node", () => {
    const opts = { env: { HOME: home } };
    expect(gitCredentialMask(repo, { readOnly: true, staged: false }, opts)).toHaveLength(1);
    expect(gitCredentialMask(repo, { readOnly: false, staged: true }, opts)).toHaveLength(1);
    expect(gitCredentialMask(repo, { readOnly: false, staged: false }, opts)).toEqual([]);
    expect(gitCredentialPolicy(repo, { readOnly: false }, opts)).toEqual({});
    expect(gitCredentialPolicy(repo, { readOnly: false, noPush: true }, opts).gitCredentials).toHaveLength(1);
  });

  it("the run-start warning names the file and key, never the value, and recommends persist-credentials: false", () => {
    const w = gitCredentialWarning(scan())!;
    expect(w).toContain(path.join(repo, ".git", "config"));
    expect(w).toContain("http.https://github.com/.extraheader");
    expect(w).toContain("persist-credentials: false");
    noSecret(w);
  });
});

describe("helpers", () => {
  it("urlHasCredential", () => {
    expect(urlHasCredential(`https://x-access-token:${SECRET}@github.com/o/r`)).toBe(true);
    expect(urlHasCredential(`https://${SECRET}@github.com/o/r`)).toBe(true);
    expect(urlHasCredential("https://user:pw@example.com/")).toBe(true);
    expect(urlHasCredential("https://github.com/o/r")).toBe(false);
    expect(urlHasCredential("git@github.com:o/r.git")).toBe(false);
    expect(urlHasCredential("ssh://git@github.com/o/r")).toBe(false);
  });

  it("helperHasInlineSecret", () => {
    expect(helperHasInlineSecret(`!f() { echo password=${SECRET}; }; f`)).toBe(true);
    expect(helperHasInlineSecret("!gh auth git-credential")).toBe(false);
    expect(helperHasInlineSecret("osxkeychain")).toBe(false);
  });

  it("parseGitConfig reads sections, subsections, quotes and comments", () => {
    const e = parseGitConfig(
      `# c\n[HTTP "https://Host/"] ; c\n  ExtraHeader = "a b" # c\n[remote.origin]\nurl=x\n[core]\nbare\n`,
    );
    expect(e).toEqual([
      { section: "http", subsection: "https://Host/", key: "extraheader", value: "a b" },
      { section: "remote", subsection: "origin", key: "url", value: "x" },
      { section: "core", subsection: undefined, key: "bare", value: "true" },
    ]);
  });
});
