import type { MemoryEntry } from "../storage/memory/types.js";

export interface SystemPromptOpts {
  name: string;
  basePrompt?: string;
  pluginSections: string;
  memories: MemoryEntry[];
}

const DEFAULT_BASE_PROMPT = `You are a helpful assistant. You are knowledgeable, concise, and friendly.

## Formatting
- Format your responses for Slack using Slack's mrkdwn syntax.
- Use *bold* for emphasis, \`code\` for inline code, and \`\`\` for code blocks.
- Use bullet points for lists.
- Keep responses concise and actionable.
- If you are unsure about something, say so rather than guessing.`;

export function buildSystemPrompt(opts: SystemPromptOpts): string {
  const sections: string[] = [];

  // Identity
  sections.push(`Your name is ${opts.name}.`);

  // Base instructions
  sections.push(opts.basePrompt ?? DEFAULT_BASE_PROMPT);

  // Plugin-provided sections
  if (opts.pluginSections.trim()) {
    sections.push(opts.pluginSections);
  }

  // User memories
  if (opts.memories.length > 0) {
    const memoryLines = opts.memories.map((m) => `- ${m.text}`).join("\n");
    sections.push(
      `## Things you remember about this user\n${memoryLines}`,
    );
  }

  return sections.join("\n\n");
}
