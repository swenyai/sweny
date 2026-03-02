import type { MemoryEntry } from "../storage/memory/types.js";

export interface SystemPromptOpts {
  name: string;
  basePrompt?: string;
  formatHint?: string;
  pluginSections: string;
  memories: MemoryEntry[];
}

export const FORMAT_HINTS: Record<string, string> = {
  "slack-mrkdwn": `Format your responses for Slack using Slack's mrkdwn syntax:
- *bold* and _italic_ (NOT **bold** or __italic__ — those are standard markdown, not Slack mrkdwn)
- \`inline code\` and \`\`\`language\\ncode block\`\`\`
- Bullet lists with • or - , numbered lists with 1.
- >blockquote for highlighting important information
- Use *bold text* for section headings — do NOT use ## or ### markdown headers (Slack ignores them)
- Keep responses concise; Slack renders best with shorter paragraphs and clear structure`,

  "discord-markdown": `Format your responses for Discord markdown:
- **bold**, *italic*, __underline__, ~~strikethrough~~
- \`inline code\` and \`\`\`language\\ncode block\`\`\` with syntax highlighting
- > blockquote for important notes; bullet lists with - or *, numbered with 1.
- Discord messages are capped at 2000 characters — keep responses concise and to the point;
  split very long answers into clearly separated parts
- Use **bold** for section headings — ## and ### headers are not rendered by Discord
- Avoid large walls of text; use line breaks between distinct points`,

  plaintext: `Format your responses as plain text for terminal output:
- No markdown syntax — asterisks and underscores render as literal characters
- Use simple indentation (2-4 spaces) for nested structure and dashes or numbers for lists
- Use ALL CAPS for top-level headings, underlines (===) for secondary headings
- Keep lines under 100 characters for readability in standard terminals
- Separate sections with a blank line`,

  "teams-markdown": `Format your responses for Microsoft Teams:
- **bold** and _italic_ are supported; \`inline code\` and \`\`\`code blocks\`\`\` work
- Bullet lists with - or *, numbered with 1.
- Use **bold** for section headings; avoid large H1 headings (they render very large in Teams)
- Keep paragraphs short — Teams renders best with concise, clearly separated points
- Avoid single large blocks of text; break content into small focused sections`,

  "github-markdown": `Format your responses using GitHub Flavored Markdown (GFM):
- **bold**, *italic*, ~~strikethrough~~
- \`inline code\` and \`\`\`language\\nfenced code blocks\`\`\` with syntax highlighting
- Tables, task lists (- [ ] / - [x]), and :emoji: shortcodes are supported
- ## Headings render clearly — use H2/H3 for sections (H1 is reserved for the page title)
- Use <details><summary>Summary text</summary>Long content</details> for collapsible sections
- Keep heading levels appropriate; avoid skipping levels`,
};

const DEFAULT_FORMAT_HINT = "slack-mrkdwn";

const DEFAULT_CORE_PROMPT = `You are a helpful assistant. You are knowledgeable, concise, and friendly.`;

function buildDefaultBasePrompt(formatHint?: string): string {
  const key = formatHint ?? DEFAULT_FORMAT_HINT;
  const formatting = FORMAT_HINTS[key] ?? FORMAT_HINTS[DEFAULT_FORMAT_HINT];
  return `${DEFAULT_CORE_PROMPT}

## Formatting
- ${formatting}
- Use bullet points for lists.
- Keep responses concise and actionable.
- If you are unsure about something, say so rather than guessing.`;
}

export function buildSystemPrompt(opts: SystemPromptOpts): string {
  const sections: string[] = [];

  // Identity
  sections.push(`Your name is ${opts.name}.`);

  // Base instructions
  sections.push(opts.basePrompt ?? buildDefaultBasePrompt(opts.formatHint));

  // Plugin-provided sections
  if (opts.pluginSections.trim()) {
    sections.push(opts.pluginSections);
  }

  // User memories
  if (opts.memories.length > 0) {
    const memoryLines = opts.memories.map((m) => `- ${m.text}`).join("\n");
    sections.push(`## Things you remember about this user\n${memoryLines}`);
  }

  return sections.join("\n\n");
}
