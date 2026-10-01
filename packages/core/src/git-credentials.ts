/**
 * Persisted git credentials in the checkout (#473).
 *
 * `actions/checkout` keeps the job token on disk by default
 * (`persist-credentials: true`): v4 and v5 write it into `.git/config` as an
 * `http.<origin>/.extraheader`; v6 and later write it to a separate file under
 * `$RUNNER_TEMP` that `.git/config` pulls in with `includeIf.gitdir:...path`.
 * Either way, any agent that can read the repo can read a token that pushes to
 * it. Env scoping cannot reach a file.
 *
 * {@link scanGitCredentials} finds the files that hold such a credential, so a
 * harness can make them unreadable to the agent of a read-only or staged node
 * (the process wrapper's `denyRead`, Claude Code's `Read(...)` deny rules and
 * SDK sandbox `denyRead`), or report the node `degraded` (refused under strict)
 * where it cannot. The fix that needs no masking at all is
 * `persist-credentials: false`: sweny pushes the PR branch itself
 * (`github_create_pr`), with the skill's own token, in the sweny process.
 *
 * What counts as a credential:
 * - `http.extraheader` / `http.<url>.extraheader` (the checkout's header);
 * - `credential.helper` with an inline secret (`!f() { echo password=...; }; f`);
 *   a `store` helper's file (default `~/.git-credentials`, or `--file <path>`);
 * - `url.<base>.insteadOf` / `pushInsteadOf` whose base carries userinfo with
 *   a password or a token, and `remote.<name>.url` / `pushurl` that do.
 *
 * Files scanned: the repo config (`<commondir>/config`), the worktree config
 * (`<gitdir>/config.worktree`), the global config (`GIT_CONFIG_GLOBAL`, else
 * `~/.gitconfig` and `$XDG_CONFIG_HOME/git/config`), and every file they
 * include (`include.path`, and `includeIf.*.path` whatever the condition).
 * Values never leave this module: findings carry the file and a redacted key.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

export { gitCredentialGap } from "./harness/policy.js";

export type GitCredentialKind = "extraheader" | "credential-helper" | "credential-store" | "url-userinfo";

export interface GitCredentialFinding {
  /** The file holding the credential (absolute, symlinks resolved). */
  file: string;
  /** The config key, with any embedded credential redacted (`url.<redacted>.insteadof`). */
  key: string;
  kind: GitCredentialKind;
}

export interface GitCredentialScan {
  findings: GitCredentialFinding[];
  /** Every file to keep from the agent, deduplicated, in scan order. */
  files: string[];
}

export interface ScanGitCredentialsOptions {
  env?: Record<string, string | undefined>;
  /** Test seam. Default: `fs.readFileSync(p, "utf8")`; a throw means "not there". */
  readFile?: (p: string) => string;
  /** Test seam. Default: `fs.existsSync`. */
  exists?: (p: string) => boolean;
}

/** Tokens git hosts mint (GitHub classic and fine-grained, GitLab), and the names checkout-style auth uses. */
const TOKEN_PATTERN =
  /(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|x-access-token|x-oauth-basic|oauth2:)/i;

const MAX_INCLUDE_DEPTH = 10;

/** Does a URL carry a credential in its userinfo (`https://user:pass@`, `https://<token>@`)? */
export function urlHasCredential(url: string): boolean {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)@/i.exec(url.trim());
  if (!m) return false;
  const userinfo = m[1];
  if (userinfo.includes(":")) return true;
  return TOKEN_PATTERN.test(userinfo);
}

/** Does a `credential.helper` value hold the secret itself (an inline shell helper)? */
export function helperHasInlineSecret(value: string): boolean {
  const v = value.trim();
  if (!v.startsWith("!")) return false;
  return /password=/i.test(v) || TOKEN_PATTERN.test(v);
}

/** The file a `store` credential helper writes, or undefined when the helper is not `store`. */
export function storeHelperFiles(value: string, env: Record<string, string | undefined>): string[] | undefined {
  const parts = value.trim().split(/\s+/);
  const name = parts[0];
  if (name !== "store" && name !== "git-credential-store") return undefined;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith("--file=")) return [expandHome(p.slice("--file=".length), env)];
    if (p === "--file" && parts[i + 1]) return [expandHome(parts[i + 1], env)];
  }
  const home = env.HOME ?? homedir();
  const xdg = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [path.join(home, ".git-credentials"), path.join(xdg, "git", "credentials")];
}

function expandHome(p: string, env: Record<string, string | undefined>): string {
  const unquoted = p.replace(/^["']|["']$/g, "");
  if (unquoted === "~") return env.HOME ?? homedir();
  if (unquoted.startsWith("~/")) return path.join(env.HOME ?? homedir(), unquoted.slice(2));
  return unquoted;
}

function realOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

interface ConfigEntry {
  section: string;
  /** Case preserved, as git does. */
  subsection?: string;
  key: string;
  value: string;
}

/**
 * Minimal git-config parser: `[section]`, `[section "sub"]`, the legacy
 * `[section.sub]`, `key = value`, bare `key` (boolean), quoted values with
 * escapes, `#` and `;` comments, and `\` line continuations. Section and key
 * names are lowercased; subsections keep their case. Enough to find keys; not
 * a validator.
 */
export function parseGitConfig(text: string): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  let section = "";
  let subsection: string | undefined;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Join continuation lines (a trailing unescaped backslash).
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i];
    }
    let rest = line.trim();
    if (rest === "" || rest.startsWith("#") || rest.startsWith(";")) continue;
    if (rest.startsWith("[")) {
      const close = rest.indexOf("]");
      if (close === -1) continue;
      const header = rest.slice(1, close).trim();
      const q = /^([A-Za-z0-9.-]+)\s+"((?:[^"\\]|\\.)*)"$/.exec(header);
      if (q) {
        section = q[1].toLowerCase();
        subsection = q[2].replace(/\\(.)/g, "$1");
      } else {
        const dot = header.indexOf(".");
        section = (dot === -1 ? header : header.slice(0, dot)).toLowerCase();
        subsection = dot === -1 ? undefined : header.slice(dot + 1).toLowerCase();
      }
      rest = rest.slice(close + 1).trim();
      if (rest === "" || rest.startsWith("#") || rest.startsWith(";")) continue;
    }
    if (!section) continue;
    const m = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=(.*))?$/.exec(rest);
    if (!m) continue;
    out.push({ section, subsection, key: m[1].toLowerCase(), value: m[2] === undefined ? "true" : unquote(m[2]) });
  }
  return out;
}

/** A git-config value: strip comments outside quotes, drop the quotes, resolve escapes. */
function unquote(raw: string): string {
  let out = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && i + 1 < raw.length) {
      const n = raw[++i];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && (c === "#" || c === ";")) {
      break;
    } else {
      out += c;
    }
  }
  return out.trim();
}

/** The repo's git dir and common dir for `cwd`, walking up to the filesystem root. */
export function findGitDirs(
  cwd: string,
  readFile: (p: string) => string,
  exists: (p: string) => boolean,
): { gitDir: string; commonDir: string } | undefined {
  let dir = path.resolve(cwd);
  for (;;) {
    const dotGit = path.join(dir, ".git");
    if (exists(dotGit)) {
      let gitDir: string | undefined;
      try {
        if (statSync(dotGit).isDirectory()) gitDir = dotGit;
      } catch {
        // fall through to the file form
      }
      if (!gitDir) {
        try {
          const m = /^gitdir:\s*(.+)$/m.exec(readFile(dotGit));
          if (m) gitDir = path.resolve(dir, m[1].trim());
        } catch {
          // unreadable .git file
        }
      }
      if (!gitDir) return undefined;
      let commonDir = gitDir;
      try {
        commonDir = path.resolve(gitDir, readFile(path.join(gitDir, "commondir")).trim());
      } catch {
        // not a linked worktree
      }
      return { gitDir, commonDir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Find persisted git credentials visible from `cwd`. Pure apart from reading
 * config files; never returns a credential value.
 */
export function scanGitCredentials(cwd: string, opts: ScanGitCredentialsOptions = {}): GitCredentialScan {
  const env = opts.env ?? process.env;
  const readFile = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const exists = opts.exists ?? existsSync;
  const findings: GitCredentialFinding[] = [];
  const files: string[] = [];
  const addFile = (p: string) => {
    const r = realOrSelf(p);
    if (!files.includes(r)) files.push(r);
    return r;
  };

  const roots: string[] = [];
  const dirs = findGitDirs(cwd, readFile, exists);
  if (dirs) {
    roots.push(path.join(dirs.commonDir, "config"));
    roots.push(path.join(dirs.gitDir, "config.worktree"));
  }
  const home = env.HOME ?? homedir();
  if (env.GIT_CONFIG_GLOBAL) {
    roots.push(expandHome(env.GIT_CONFIG_GLOBAL, env));
  } else {
    roots.push(path.join(home, ".gitconfig"));
    roots.push(path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "git", "config"));
  }

  const visited = new Set<string>();
  const visit = (file: string, depth: number) => {
    if (depth > MAX_INCLUDE_DEPTH) return;
    const real = realOrSelf(file);
    if (visited.has(real)) return;
    visited.add(real);
    let text: string;
    try {
      text = readFile(file);
    } catch {
      return;
    }
    const includes: string[] = [];
    for (const e of parseGitConfig(text)) {
      // A subsection is a URL for http.* and credential.*: never echo one that carries a credential.
      const sub = e.subsection && urlHasCredential(e.subsection) ? "<redacted>" : e.subsection;
      if (e.section === "http" && e.key === "extraheader" && e.value !== "") {
        findings.push({ file: addFile(file), key: `http.${sub ? `${sub}.` : ""}extraheader`, kind: "extraheader" });
      } else if (e.section === "credential" && e.key === "helper") {
        const key = `credential.${sub ? `${sub}.` : ""}helper`;
        if (helperHasInlineSecret(e.value)) {
          findings.push({ file: addFile(file), key, kind: "credential-helper" });
        }
        for (const store of storeHelperFiles(e.value, env) ?? []) {
          if (exists(store)) findings.push({ file: addFile(store), key, kind: "credential-store" });
        }
      } else if (e.section === "url" && (e.key === "insteadof" || e.key === "pushinsteadof")) {
        if (sub === "<redacted>" || urlHasCredential(e.value)) {
          findings.push({ file: addFile(file), key: `url.<redacted>.${e.key}`, kind: "url-userinfo" });
        }
      } else if (e.section === "remote" && (e.key === "url" || e.key === "pushurl")) {
        if (urlHasCredential(e.value)) {
          findings.push({ file: addFile(file), key: `remote.${sub ?? ""}.${e.key}`, kind: "url-userinfo" });
        }
      } else if ((e.section === "include" || e.section === "includeif") && e.key === "path" && e.value) {
        const p = expandHome(e.value, env);
        includes.push(path.isAbsolute(p) ? p : path.resolve(path.dirname(file), p));
      }
    }
    for (const inc of includes) visit(inc, depth + 1);
  };
  for (const root of roots) visit(root, 0);

  // Same credential twice in one file is one finding.
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const id = `${f.file}\0${f.key}\0${f.kind}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { findings: unique, files };
}

/**
 * The files to keep from one node's agent: the scan's files for a read-only
 * node or a staged write node, nothing otherwise. A default write node keeps
 * today's behavior (it may push with the checkout's credential); the
 * recommended `persist-credentials: false` leaves nothing to find.
 */
export function gitCredentialMask(
  cwd: string,
  node: { readOnly: boolean; staged: boolean },
  opts: ScanGitCredentialsOptions = {},
): string[] {
  if (!node.readOnly && !node.staged) return [];
  return scanGitCredentials(cwd, opts).files;
}

/** The run-start warning for a checkout that persists a credential. Paths and kinds only. */
export function gitCredentialWarning(scan: GitCredentialScan): string | undefined {
  if (scan.findings.length === 0) return undefined;
  const where = [...new Set(scan.findings.map((f) => `${f.key} in ${f.file}`))].join("; ");
  return (
    `persisted git credential found (${where}). Read-only and staged nodes run with it masked where the harness ` +
    `can (reported degraded, refused under strict, where it cannot); other nodes' agents can read it. ` +
    `Recommended: actions/checkout with persist-credentials: false. sweny pushes the PR branch itself with the github skill's token.`
  );
}

/**
 * The `NodePolicy.gitCredentials` fragment for one node run (#473): the
 * credential files to keep from a read-only or staged node's agent, or
 * nothing. Adapters spread it into the policy they gate and wrap with.
 */
export function gitCredentialPolicy(
  cwd: string,
  node: { readOnly: boolean; noPush?: boolean },
  opts: ScanGitCredentialsOptions = {},
): { gitCredentials?: string[] } {
  const files = gitCredentialMask(cwd, { readOnly: node.readOnly, staged: node.noPush === true }, opts);
  return files.length > 0 ? { gitCredentials: files } : {};
}
