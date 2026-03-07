import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const fileConfigSchema = z.object({
  path: z.string().min(1, "Log file path is required"),
  logger: z.custom<Logger>().optional(),
});

export type FileConfig = z.infer<typeof fileConfigSchema>;

export function file(config: FileConfig): ObservabilityProvider {
  const parsed = fileConfigSchema.parse(config);
  return new FileProvider(parsed);
}

class FileProvider implements ObservabilityProvider {
  private readonly path: string;
  private readonly log: Logger;
  private entries: LogEntry[] | null = null;

  constructor(config: FileConfig) {
    this.path = config.path;
    this.log = config.logger ?? consoleLogger;
  }

  private load(): LogEntry[] {
    if (this.entries) return this.entries;

    this.log.info(`Loading logs from ${this.path}`);
    const raw = readFileSync(this.path, "utf-8");
    const parsed = JSON.parse(raw);

    // Support both array of entries and { logs: [...] } wrapper
    const entries: unknown[] = Array.isArray(parsed) ? parsed : parsed.logs;
    if (!Array.isArray(entries)) {
      throw new Error(`Invalid log file format: expected array or { logs: [...] }`);
    }

    this.entries = entries.map((e: unknown) => {
      const entry = e as Record<string, unknown>;
      return {
        timestamp: String(entry.timestamp ?? new Date().toISOString()),
        service: String(entry.service ?? "unknown"),
        level: String(entry.level ?? entry.status ?? "error"),
        message: String(entry.message ?? ""),
        attributes: (entry.attributes as Record<string, unknown>) ?? {},
      };
    });

    this.log.info(`Loaded ${this.entries.length} log entries`);
    return this.entries;
  }

  private filter(entries: LogEntry[], opts: { serviceFilter: string; severity?: string }): LogEntry[] {
    return entries.filter((e) => {
      if (opts.serviceFilter && opts.serviceFilter !== "*" && e.service !== opts.serviceFilter) return false;
      if (opts.severity && e.level !== opts.severity) return false;
      return true;
    });
  }

  async verifyAccess(): Promise<void> {
    this.load();
    this.log.info("File provider access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    let all: LogEntry[];
    try {
      all = this.load();
    } catch (err) {
      this.log.warn(`Could not load log file: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
    const filtered = this.filter(all, { serviceFilter: opts.serviceFilter, severity: opts.severity });
    this.log.info(`Found ${filtered.length} ${opts.severity} logs for ${opts.serviceFilter}`);
    return filtered;
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    const all = this.load();
    const filtered = this.filter(all, { serviceFilter: opts.serviceFilter });

    const counts = new Map<string, number>();
    for (const entry of filtered) {
      counts.set(entry.service, (counts.get(entry.service) ?? 0) + 1);
    }

    const results = Array.from(counts.entries())
      .map(([service, count]) => ({ service, count }))
      .sort((a, b) => b.count - a.count);

    this.log.info(`Aggregated ${results.length} service groups from file`);
    return results;
  }

  getAgentEnv(): Record<string, string> {
    return { SWENY_LOG_FILE: this.path };
  }

  getPromptInstructions(): string {
    return `### Local Log File

Your log data is in a local file. Use standard shell commands to read it.

**Log file path**: \`${this.path}\`

\`\`\`bash
# View the whole file
cat "${this.path}"

# View the last 200 lines (useful for large files)
tail -200 "${this.path}"

# Filter for errors
grep -i "error\\|exception\\|fatal" "${this.path}"

# If the file contains JSON lines (one JSON object per line):
cat "${this.path}" | jq 'select(.level == "error")' 2>/dev/null || grep -i error "${this.path}"

# If the file is a JSON array (e.g. exported from a monitoring tool):
cat "${this.path}" | jq '.[:10]'
\`\`\`

Read the file, identify the top errors by frequency and severity, and proceed
with the standard investigation output format.`;
  }
}
