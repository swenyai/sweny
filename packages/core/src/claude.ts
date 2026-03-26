/**
 * Claude Client — Anthropic SDK wrapper
 *
 * Handles the tool-use loop: send instruction + tools → Claude calls
 * tools → we execute them → send results back → repeat until done.
 *
 * This is the only file that imports the Anthropic SDK.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Claude, Tool, ToolContext, NodeResult, ToolCall, JSONSchema } from "./types.js";
import { consoleLogger } from "./types.js";

const SYSTEM_PROMPT = `You are a step in an automated workflow. Execute the instruction precisely using the tools available to you. Be thorough but concise. When you're done, summarize your findings and results.`;

export interface ClaudeClientOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  maxTurns?: number;
  /** Default tool context used when ClaudeClient is called directly (not via executor) */
  defaultContext?: ToolContext;
}

export class ClaudeClient implements Claude {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private maxTurns: number;
  private defaultContext: ToolContext;

  constructor(opts: ClaudeClientOptions = {}) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? "claude-sonnet-4-20250514";
    this.maxTokens = opts.maxTokens ?? 4096;
    this.maxTurns = opts.maxTurns ?? 20;
    this.defaultContext = opts.defaultContext ?? { config: {}, logger: consoleLogger };
  }

  async run(opts: {
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
  }): Promise<NodeResult> {
    const { instruction, context, tools, outputSchema } = opts;

    const userMessage = [
      `## Instruction\n\n${instruction}`,
      `## Context\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
      outputSchema
        ? `## Required Output\n\nYou MUST end with a JSON object matching this schema:\n\`\`\`json\n${JSON.stringify(outputSchema, null, 2)}\n\`\`\``
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const claudeTools: Anthropic.Messages.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
    }));

    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userMessage }];

    const handlerMap = new Map(tools.map((t) => [t.name, t.handler]));
    const toolCalls: ToolCall[] = [];
    let turns = 0;

    while (turns++ < this.maxTurns) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: SYSTEM_PROMPT,
        messages,
        ...(claudeTools.length > 0 ? { tools: claudeTools } : {}),
      });

      const toolUseBlocks = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
      const textBlocks = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");

      // If no tool calls or end_turn — we're done
      if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
        const text = textBlocks.map((b) => b.text).join("\n");
        return {
          status: "success",
          data: { summary: text, ...tryParseJSON(text) },
          toolCalls,
        };
      }

      // Execute tool calls
      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        const handler = handlerMap.get(block.name);
        if (!handler) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true,
          });
          continue;
        }

        try {
          const output = await handler(block.input, this.defaultContext);
          toolCalls.push({ tool: block.name, input: block.input, output });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: typeof output === "string" ? output : JSON.stringify(output),
          });
        } catch (err: any) {
          toolCalls.push({ tool: block.name, input: block.input, output: { error: err.message } });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${err.message}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    // Exceeded max turns
    return {
      status: "failed",
      data: { reason: `Exceeded max turns (${this.maxTurns})` },
      toolCalls,
    };
  }

  async evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
  }): Promise<string> {
    const { question, context, choices } = opts;

    const choiceList = choices.map((c) => `- "${c.id}": ${c.description}`).join("\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            question,
            `\nContext:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
            `\nChoices:\n${choiceList}`,
            `\nRespond with ONLY the choice ID, nothing else.`,
          ].join("\n"),
        },
      ],
    });

    const text = response.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text?.trim() ?? "";

    const validIds = choices.map((c) => c.id);

    // Exact match
    if (validIds.includes(text)) return text;

    // Fuzzy — look for an ID embedded in the response
    const match = validIds.find((id) => text.includes(id));
    if (match) return match;

    // Fallback to first choice
    return validIds[0];
  }
}

/**
 * Extract a JSON object from Claude's text response.
 *
 * Strategy (in order):
 * 1. ```json code block``` — most reliable, Claude often wraps JSON this way
 * 2. Last brace-delimited `{...}` block — handles inline JSON at end of text
 * 3. Full text parse — for responses that are pure JSON
 * 4. Empty object — safe fallback
 */
function tryParseJSON(text: string): Record<string, unknown> {
  // 1. Code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      /* try next strategy */
    }
  }

  // 2. Last brace-delimited block (scan backwards for matching braces)
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace !== -1) {
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (text[i] === "}") depth++;
      else if (text[i] === "{") depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(i, lastBrace + 1));
          if (typeof parsed === "object" && parsed !== null) return parsed;
        } catch {
          /* try next strategy */
        }
        break;
      }
    }
  }

  // 3. Full text parse
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    /* fall through */
  }

  return {};
}
