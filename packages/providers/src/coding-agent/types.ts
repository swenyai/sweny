export interface CodingAgentRunOptions {
  prompt: string;
  maxTurns: number;
  env?: Record<string, string>;
}

export interface CodingAgent {
  install(): Promise<void>;
  run(opts: CodingAgentRunOptions): Promise<number>;
}
