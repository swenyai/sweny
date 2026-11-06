import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeQuietBillboard } from "./quiet-comment.js";
import { writePrCommentSummary } from "../pr-comment-summary.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("quiet billboard", () => {
  it("empties a stale file so the existing Action poster skips it, and explains the empty skip", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiet-comment-"));
    dirs.push(dir);
    const file = path.join(dir, "comment.md");
    const summary = path.join(dir, "summary.md");
    fs.writeFileSync(file, "old metadata billboard");
    fs.writeFileSync(summary, "");
    expect(writeQuietBillboard(file, "review", new Map(), { GITHUB_STEP_SUMMARY: summary })).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("");
    expect(fs.readFileSync(summary, "utf8")).toContain("PR comment skipped: no findings");
  });

  it("records unchanged skips in the step summary", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiet-summary-"));
    dirs.push(dir);
    const summary = path.join(dir, "summary.md");
    fs.writeFileSync(summary, "");
    writePrCommentSummary("review", "unchanged", { GITHUB_STEP_SUMMARY: summary });
    expect(fs.readFileSync(summary, "utf8")).toContain("PR comment skipped: findings unchanged since the last post");
  });

  it("never follows a summary symlink", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quiet-summary-"));
    dirs.push(dir);
    const target = path.join(dir, "target");
    const link = path.join(dir, "summary");
    fs.writeFileSync(target, "untouched");
    fs.symlinkSync(target, link);
    expect(writePrCommentSummary("review", "empty", { GITHUB_STEP_SUMMARY: link })).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("untouched");
  });
});
