import type { Session } from "../session/manager.js";
import type { UserIdentity } from "../auth/types.js";
import type { MemoryEntry } from "../storage/memory/types.js";
import type { RunResult } from "../model/types.js";

export interface AgentRunOpts {
  prompt: string;
  session: Session;
  user: UserIdentity;
  memories: MemoryEntry[];
  formatHint?: string;
}

export interface AgentRunner {
  run(opts: AgentRunOpts): Promise<RunResult>;
}
