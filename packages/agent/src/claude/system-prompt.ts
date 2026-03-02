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
  "discord-markdown":
    "Format your responses using Discord markdown. Use **bold** for emphasis, `code` for inline code, and ``` for code blocks.",
  plaintext: "Format your responses as plain text. Use simple indentation and dashes for lists.",
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
