import * as core from "@actions/core";
import { parseInputs } from "./config.js";
import { createProviders } from "./providers/index.js";
import { investigate } from "./phases/investigate.js";
import { implement } from "./phases/implement.js";
import { notify } from "./phases/notify.js";

async function run(): Promise<void> {
  try {
    const config = parseInputs();
    const providers = createProviders(config);

    // Phase 1: Investigate
    core.startGroup("Phase 1: Investigate Production Logs");
    const findings = await investigate(config, providers);
    core.endGroup();

    core.setOutput("issues-found", String(findings.issuesFound));
    core.setOutput("recommendation", findings.recommendation);

    // Phase 2: Implement (if applicable)
    let implementation;
    if (findings.shouldImplement && !config.dryRun) {
      core.startGroup("Phase 2: Implement Fix");
      implementation = await implement(config, providers, findings);
      core.endGroup();

      if (!implementation.skipped) {
        core.setOutput("issue-identifier", implementation.issueIdentifier);
        core.setOutput("issue-url", implementation.issueUrl);
        core.setOutput("pr-url", implementation.prUrl);
        core.setOutput("pr-number", String(implementation.prNumber));
      }
    }

    // Phase 3: Notify
    core.startGroup("Phase 3: Create Summary");
    await notify(config, findings, implementation);
    core.endGroup();
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
