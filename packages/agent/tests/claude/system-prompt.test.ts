import { describe, it, expect } from "vitest";
import { buildSystemPrompt, FORMAT_HINTS } from "../../src/claude/system-prompt.js";
import type { MemoryEntry } from "../../src/storage/memory/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemory(overrides?: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "mem-1",
    text: "Prefers dark mode",
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function baseOpts() {
  return {
    name: "TestBot",
    pluginSections: "",
    memories: [] as MemoryEntry[],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  // 1. Identity section — name always appears first
  describe("identity section", () => {
    it("places the name as the first line of the prompt", () => {
      const result = buildSystemPrompt(baseOpts());
      const firstLine = result.split("\n")[0];
      expect(firstLine).toBe("Your name is TestBot.");
    });

    it("uses the provided name verbatim", () => {
      const result = buildSystemPrompt({ ...baseOpts(), name: "Sweny AI" });
      expect(result).toMatch(/^Your name is Sweny AI\./);
    });
  });

  // 2. Default base prompt when no basePrompt provided
  describe("default base prompt", () => {
    it("includes the default core prompt when basePrompt is omitted", () => {
      const result = buildSystemPrompt(baseOpts());
      expect(result).toContain("You are a helpful assistant. You are knowledgeable, concise, and friendly.");
    });

    it("includes the formatting section with default slack-mrkdwn hint", () => {
      const result = buildSystemPrompt(baseOpts());
      expect(result).toContain("## Formatting");
      expect(result).toContain(FORMAT_HINTS["slack-mrkdwn"]);
    });

    it("includes standard formatting guidelines", () => {
      const result = buildSystemPrompt(baseOpts());
      expect(result).toContain("Use bullet points for lists.");
      expect(result).toContain("Keep responses concise and actionable.");
      expect(result).toContain("If you are unsure about something, say so rather than guessing.");
    });
  });

  // 3. Custom basePrompt overrides default
  describe("custom basePrompt", () => {
    it("uses the custom basePrompt instead of the default", () => {
      const custom = "You are a pirate. Speak like a pirate at all times.";
      const result = buildSystemPrompt({ ...baseOpts(), basePrompt: custom });
      expect(result).toContain(custom);
      expect(result).not.toContain("You are a helpful assistant. You are knowledgeable, concise, and friendly.");
    });

    it("does not include default formatting section when basePrompt is set", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        basePrompt: "Custom instructions.",
      });
      expect(result).not.toContain("## Formatting");
    });
  });

  // 4. FORMAT_HINTS — all keys resolve correctly
  describe("FORMAT_HINTS", () => {
    it("contains the slack-mrkdwn hint", () => {
      expect(FORMAT_HINTS["slack-mrkdwn"]).toContain("Slack");
      expect(FORMAT_HINTS["slack-mrkdwn"]).toContain("*bold*");
    });

    it("contains the discord-markdown hint", () => {
      expect(FORMAT_HINTS["discord-markdown"]).toContain("Discord");
      expect(FORMAT_HINTS["discord-markdown"]).toContain("**bold**");
    });

    it("discord-markdown hint mentions 2000-character limit", () => {
      expect(FORMAT_HINTS["discord-markdown"]).toContain("2000");
    });

    it("contains the plaintext hint", () => {
      expect(FORMAT_HINTS["plaintext"]).toContain("plain text");
      expect(FORMAT_HINTS["plaintext"]).toContain("indentation");
    });

    it("plaintext hint mentions terminal output", () => {
      expect(FORMAT_HINTS["plaintext"]).toContain("terminal");
    });

    it("contains the teams-markdown hint", () => {
      expect(FORMAT_HINTS["teams-markdown"]).toContain("Teams");
      expect(FORMAT_HINTS["teams-markdown"]).toContain("**bold**");
    });

    it("contains the github-markdown hint", () => {
      expect(FORMAT_HINTS["github-markdown"]).toContain("GitHub");
      expect(FORMAT_HINTS["github-markdown"]).toContain("GFM");
    });

    it("github-markdown hint mentions tables and collapsible sections", () => {
      expect(FORMAT_HINTS["github-markdown"]).toContain("Tables");
      expect(FORMAT_HINTS["github-markdown"]).toContain("<details>");
    });

    it("uses slack-mrkdwn hint when formatHint is 'slack-mrkdwn'", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        formatHint: "slack-mrkdwn",
      });
      expect(result).toContain(FORMAT_HINTS["slack-mrkdwn"]);
    });

    it("uses discord-markdown hint when formatHint is 'discord-markdown'", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        formatHint: "discord-markdown",
      });
      expect(result).toContain(FORMAT_HINTS["discord-markdown"]);
      expect(result).not.toContain(FORMAT_HINTS["slack-mrkdwn"]);
    });

    it("uses plaintext hint when formatHint is 'plaintext'", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        formatHint: "plaintext",
      });
      expect(result).toContain(FORMAT_HINTS["plaintext"]);
      expect(result).not.toContain(FORMAT_HINTS["slack-mrkdwn"]);
    });
  });

  // 5. Unknown formatHint falls back to slack-mrkdwn
  describe("unknown formatHint fallback", () => {
    it("falls back to slack-mrkdwn for an unrecognized formatHint", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        formatHint: "some-unknown-format",
      });
      expect(result).toContain(FORMAT_HINTS["slack-mrkdwn"]);
    });
  });

  // 6. formatHint=undefined falls back to slack-mrkdwn
  describe("formatHint undefined fallback", () => {
    it("falls back to slack-mrkdwn when formatHint is undefined", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        formatHint: undefined,
      });
      expect(result).toContain(FORMAT_HINTS["slack-mrkdwn"]);
    });

    it("falls back to slack-mrkdwn when formatHint is not provided at all", () => {
      const result = buildSystemPrompt(baseOpts());
      expect(result).toContain(FORMAT_HINTS["slack-mrkdwn"]);
    });
  });

  // 7. Plugin sections — included when non-empty, excluded when empty/whitespace
  describe("plugin sections", () => {
    it("includes plugin sections when non-empty", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        pluginSections: "## Jira\nYou can look up tickets.",
      });
      expect(result).toContain("## Jira\nYou can look up tickets.");
    });

    it("excludes plugin sections when empty string", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        pluginSections: "",
      });
      // Should only have identity + base prompt (two sections)
      const sections = result.split("\n\n");
      // No extra empty section from plugins
      expect(sections.every((s) => s.trim().length > 0)).toBe(true);
    });

    it("excludes plugin sections when whitespace-only", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        pluginSections: "   \n  \t  ",
      });
      expect(result).not.toContain("   \n  \t  ");
      // Verify prompt is clean — no trailing whitespace sections
      const sections = result.split("\n\n");
      expect(sections.every((s) => s.trim().length > 0)).toBe(true);
    });
  });

  // 8. Memories section — included with entries, excluded when empty
  describe("memories section", () => {
    it("includes the memories heading when entries exist", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        memories: [makeMemory()],
      });
      expect(result).toContain("## Things you remember about this user");
    });

    it("includes memory text as bullet points", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        memories: [makeMemory({ text: "Likes TypeScript" })],
      });
      expect(result).toContain("- Likes TypeScript");
    });

    it("excludes the memories section when memories array is empty", () => {
      const result = buildSystemPrompt({
        ...baseOpts(),
        memories: [],
      });
      expect(result).not.toContain("Things you remember about this user");
    });
  });

  // 9. Multiple memories formatted correctly
  describe("multiple memories", () => {
    it("renders each memory as a separate bullet point", () => {
      const memories: MemoryEntry[] = [
        makeMemory({ id: "m1", text: "Prefers dark mode" }),
        makeMemory({ id: "m2", text: "Works on the payments team" }),
        makeMemory({ id: "m3", text: "Timezone is PST" }),
      ];
      const result = buildSystemPrompt({ ...baseOpts(), memories });

      expect(result).toContain("- Prefers dark mode");
      expect(result).toContain("- Works on the payments team");
      expect(result).toContain("- Timezone is PST");
    });

    it("joins multiple memories with newlines under the heading", () => {
      const memories: MemoryEntry[] = [
        makeMemory({ id: "m1", text: "Fact A" }),
        makeMemory({ id: "m2", text: "Fact B" }),
      ];
      const result = buildSystemPrompt({ ...baseOpts(), memories });

      expect(result).toContain("## Things you remember about this user\n- Fact A\n- Fact B");
    });
  });

  // 10. Full prompt assembly — all sections joined with double newline
  describe("full prompt assembly", () => {
    it("joins all sections with double newlines", () => {
      const result = buildSystemPrompt({
        name: "Sweny",
        pluginSections: "## GitHub\nCan search repos.",
        memories: [makeMemory({ text: "Uses VS Code" })],
      });

      const sections = result.split("\n\n");

      // First section: identity
      expect(sections[0]).toBe("Your name is Sweny.");

      // Second section: default base prompt (starts with core prompt)
      expect(sections[1]).toContain("You are a helpful assistant.");

      // Plugin section appears somewhere after base prompt
      expect(result).toContain("## GitHub\nCan search repos.");

      // Memory section appears at the end
      expect(result).toContain("## Things you remember about this user\n- Uses VS Code");
    });

    it("assembles correctly with custom basePrompt and all sections", () => {
      const result = buildSystemPrompt({
        name: "Bot",
        basePrompt: "Custom base.",
        pluginSections: "Plugin info.",
        memories: [makeMemory({ text: "Mem entry" })],
      });

      // Should have exactly 4 top-level sections separated by \n\n:
      // identity, basePrompt, pluginSections, memories
      expect(result).toBe(
        [
          "Your name is Bot.",
          "Custom base.",
          "Plugin info.",
          "## Things you remember about this user\n- Mem entry",
        ].join("\n\n"),
      );
    });

    it("assembles correctly with only required fields (no plugins, no memories)", () => {
      const result = buildSystemPrompt({
        name: "MinBot",
        basePrompt: "Just be helpful.",
        pluginSections: "",
        memories: [],
      });

      expect(result).toBe("Your name is MinBot.\n\nJust be helpful.");
    });

    it("does not produce triple newlines or trailing whitespace", () => {
      const result = buildSystemPrompt({
        name: "CleanBot",
        pluginSections: "",
        memories: [],
      });

      expect(result).not.toContain("\n\n\n");
      expect(result).toBe(result.trimEnd());
    });
  });
});
