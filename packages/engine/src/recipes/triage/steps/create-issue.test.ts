import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { createProviderRegistry } from "../../../runner.js";
import { createIssue } from "./create-issue.js";
import { createCtx } from "../test-helpers.js";

vi.mock("fs");

describe("createIssue", () => {
  const getIssue = vi.fn();
  const searchIssues = vi.fn();
  const createIssueFn = vi.fn();
  const addComment = vi.fn();

  function buildRegistry() {
    const registry = createProviderRegistry();
    registry.set("issueTracker", { getIssue, searchIssues, createIssue: createIssueFn, addComment });
    return registry;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    getIssue.mockReset();
    searchIssues.mockReset();
    createIssueFn.mockReset();
    addComment.mockReset();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("");
  });

  it("extracts heading from best-candidate.md", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("# Fix null pointer in auth handler\nSome details");
    searchIssues.mockResolvedValue([]);
    createIssueFn.mockResolvedValue({
      id: "id-1",
      identifier: "ENG-1",
      title: "Fix null pointer in auth handler",
      url: "https://example.com/ENG-1",
      branchName: "eng-1-fix",
    });
    const ctx = createCtx({ providers: buildRegistry() });
    const result = await createIssue(ctx);
    expect(result.status).toBe("success");
    expect(createIssueFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Fix null pointer in auth handler" }));
  });

  it("strips backticks from title", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("# Fix `auth` handler `error`\nDetails");
    searchIssues.mockResolvedValue([]);
    createIssueFn.mockResolvedValue({
      id: "id-1",
      identifier: "ENG-1",
      title: "Fix auth handler error",
      url: "https://example.com/ENG-1",
      branchName: "eng-1-fix",
    });
    const ctx = createCtx({ providers: buildRegistry() });
    await createIssue(ctx);
    expect(createIssueFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Fix auth handler error" }));
  });

  it("strips 'Best Candidate Fix:' prefix", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("# Best Candidate Fix: Resolve timeout issue\nDetails");
    searchIssues.mockResolvedValue([]);
    createIssueFn.mockResolvedValue({
      id: "id-1",
      identifier: "ENG-1",
      title: "Resolve timeout issue",
      url: "https://example.com/ENG-1",
      branchName: "eng-1-fix",
    });
    const ctx = createCtx({ providers: buildRegistry() });
    await createIssue(ctx);
    expect(createIssueFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Resolve timeout issue" }));
  });

  it("caps title at 100 chars", async () => {
    const longTitle = "A".repeat(200);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`# ${longTitle}\nDetails`);
    searchIssues.mockResolvedValue([]);
    createIssueFn.mockResolvedValue({
      id: "id-1",
      identifier: "ENG-1",
      title: longTitle.slice(0, 100),
      url: "https://example.com/ENG-1",
      branchName: "eng-1-fix",
    });
    const ctx = createCtx({ providers: buildRegistry() });
    await createIssue(ctx);
    const callTitle = createIssueFn.mock.calls[0][0].title;
    expect(callTitle.length).toBeLessThanOrEqual(100);
  });

  it("uses default title when no heading found", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("No heading here, just text");
    searchIssues.mockResolvedValue([]);
    createIssueFn.mockResolvedValue({
      id: "id-1",
      identifier: "ENG-1",
      title: "SWEny Triage: Automated bug fix",
      url: "https://example.com/ENG-1",
      branchName: "eng-1-fix",
    });
    const ctx = createCtx({ providers: buildRegistry() });
    await createIssue(ctx);
    expect(createIssueFn).toHaveBeenCalledWith(expect.objectContaining({ title: "SWEny Triage: Automated bug fix" }));
  });

  it("issueOverride: calls getIssue directly, skips search", async () => {
    getIssue.mockResolvedValue({
      id: "id-override",
      identifier: "ENG-99",
      title: "Override Issue",
      url: "https://example.com/ENG-99",
      branchName: "eng-99-fix",
    });
    const ctx = createCtx({ config: { issueOverride: "ENG-99" }, providers: buildRegistry() });
    const result = await createIssue(ctx);
    expect(result.status).toBe("success");
    expect(getIssue).toHaveBeenCalledWith("ENG-99");
    expect(searchIssues).not.toHaveBeenCalled();
    expect(createIssueFn).not.toHaveBeenCalled();
    expect(result.data?.issueIdentifier).toBe("ENG-99");
  });

  it("no override + search finds match: adds +1 comment", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    searchIssues.mockResolvedValue([
      {
        id: "id-existing",
        identifier: "ENG-10",
        title: "Existing Bug",
        url: "https://example.com/ENG-10",
        branchName: "eng-10-fix",
      },
    ]);
    addComment.mockResolvedValue(undefined);
    const ctx = createCtx({ providers: buildRegistry() });
    const result = await createIssue(ctx);
    expect(result.status).toBe("success");
    expect(searchIssues).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj-1", labels: ["label-bug"] }));
    expect(addComment).toHaveBeenCalledWith("id-existing", expect.stringContaining("+1 detected on"));
    expect(createIssueFn).not.toHaveBeenCalled();
    expect(result.data?.issueIdentifier).toBe("ENG-10");
  });

  it("no override + no match: creates new issue with correct params", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("# Fix the auth bug\nDescription content here");
    searchIssues.mockResolvedValue([]);
    createIssueFn.mockResolvedValue({
      id: "id-new",
      identifier: "ENG-50",
      title: "Fix the auth bug",
      url: "https://example.com/ENG-50",
      branchName: "eng-50-fix",
    });
    const ctx = createCtx({ providers: buildRegistry() });
    const result = await createIssue(ctx);
    expect(result.status).toBe("success");
    expect(createIssueFn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Fix the auth bug",
        projectId: "proj-1",
        labels: ["label-bug", "label-triage"],
        priority: 2,
        stateId: "state-backlog",
      }),
    );
    expect(result.data?.issueIdentifier).toBe("ENG-50");
  });

  it("includes description from best-candidate.md (up to 10k chars)", async () => {
    const longContent = "X".repeat(15000);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`# Title\n${longContent}`);
    searchIssues.mockResolvedValue([]);
    createIssueFn.mockResolvedValue({
      id: "id-1",
      identifier: "ENG-1",
      title: "Title",
      url: "https://example.com/ENG-1",
      branchName: "eng-1-fix",
    });
    const ctx = createCtx({ providers: buildRegistry() });
    await createIssue(ctx);
    const desc = createIssueFn.mock.calls[0][0].description;
    expect(desc.length).toBeLessThanOrEqual(10000);
  });
});
