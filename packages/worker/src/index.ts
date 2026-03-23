/**
 * Open-source SWEny worker entry point.
 *
 * Starts a BullMQ Worker that processes "triage" and "implement" jobs from
 * the configured Redis queue. Each job calls runJob() which:
 *   1. Fetches credentials from the internal API
 *   2. Clones the repo to a temp dir
 *   3. Runs the appropriate recipe (triage or implement)
 *   4. Reports the outcome back to the internal API
 */

import { Worker } from "bullmq";
import { claudeCode } from "@sweny-ai/providers/coding-agent";
import type { WorkerJobPayload } from "@sweny-ai/shared";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { runJob, pendingWorkDirs } from "./runner.js";

// ---------------------------------------------------------------------------
// Uncaught exception handlers — log pending work dirs for ops recovery
// ---------------------------------------------------------------------------

process.on("uncaughtException", (err: Error) => {
  const dirs = [...pendingWorkDirs].join(", ") || "(none)";
  logger.error({ err: err.message, stack: err.stack }, `Uncaught exception. Pending worktrees: ${dirs}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  const dirs = [...pendingWorkDirs].join(", ") || "(none)";
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error({ reason: msg }, `Unhandled rejection. Pending worktrees: ${dirs}`);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Startup: install coding agent CLI if needed
// ---------------------------------------------------------------------------

async function startup(): Promise<void> {
  if (env.CODING_AGENT === "claude") {
    logger.info("Installing Claude Code CLI...");
    try {
      const agent = claudeCode({});
      await agent.install();
      logger.info("Claude Code CLI ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, "Claude Code CLI install failed — will retry on first use");
    }
  }
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processor(job: { data: WorkerJobPayload }): Promise<void> {
  const payload = job.data;
  const { jobId, orgId, jobType } = payload;

  logger.info(
    {
      jobId,
      orgId,
      jobType,
      repo: `${payload.repoOwner}/${payload.repoName}`,
    },
    "Processing job",
  );

  await runJob(payload, env.INTERNAL_API_URL, env.CODING_AGENT);

  logger.info({ jobId, orgId }, "Job finished");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info(
    {
      queue: env.QUEUE_NAME,
      concurrency: env.CONCURRENCY,
      codingAgent: env.CODING_AGENT,
    },
    "SWEny worker starting",
  );

  await startup();

  const worker = new Worker<WorkerJobPayload>(env.QUEUE_NAME, processor, {
    connection: { url: env.REDIS_URL },
    concurrency: env.CONCURRENCY,
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job.data.jobId }, "BullMQ job completed");
  });

  worker.on("failed", (job, err) => {
    const jobId = job?.data.jobId ?? "unknown";
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err: msg }, "BullMQ job failed");
  });

  worker.on("error", (err: Error) => {
    logger.error({ err: err.message }, "BullMQ worker error");
  });

  logger.info({ queue: env.QUEUE_NAME, concurrency: env.CONCURRENCY }, "SWEny worker ready — waiting for jobs");

  // Graceful shutdown on SIGTERM / SIGINT
  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "Shutting down worker...");
    await worker.close();
    logger.info("Worker closed. Goodbye.");
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ err: msg }, "Fatal error during startup");
  process.exit(1);
});
