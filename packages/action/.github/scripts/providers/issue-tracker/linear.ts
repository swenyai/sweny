#!/usr/bin/env npx tsx
/**
 * Linear Issue Tracker Provider
 *
 * Thin wrapper around the linear-cli that conforms to the issue tracker provider contract.
 * Delegates all operations to the linear-client CLI.
 *
 * Required env vars:
 *   LINEAR_API_KEY — Linear API key
 */
import { execSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

function runLinearCli(cliCommand: string, cliArgs: string[]): string {
  const cmd = `linear-client ${cliCommand} ${cliArgs.join(" ")}`;
  return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

try {
  switch (command) {
    case "create-issue": {
      const cliArgs = [];
      const title = getFlag("title");
      const teamId = getFlag("team-id");
      if (title) cliArgs.push(`--title "${title}"`);
      if (teamId) cliArgs.push(`--team-id "${teamId}"`);
      const labels = getFlag("labels");
      if (labels) cliArgs.push(`--labels "${labels}"`);
      const priority = getFlag("priority");
      if (priority) cliArgs.push(`--priority ${priority}`);
      const stateId = getFlag("state-id");
      if (stateId) cliArgs.push(`--state-id "${stateId}"`);
      const description = getFlag("description");
      if (description) cliArgs.push(`--description "${description}"`);
      console.log(runLinearCli("create-issue", cliArgs));
      break;
    }
    case "update-issue": {
      const cliArgs = [];
      const issueId = getFlag("issue-id");
      if (issueId) cliArgs.push(`--issue-id "${issueId}"`);
      const stateId = getFlag("state-id");
      if (stateId) cliArgs.push(`--state-id "${stateId}"`);
      const description = getFlag("description");
      if (description) cliArgs.push(`--description "${description}"`);
      const comment = getFlag("add-comment");
      if (comment) cliArgs.push(`--add-comment "${comment}"`);
      console.log(runLinearCli("update-issue", cliArgs));
      break;
    }
    case "get-issue": {
      const identifier = getFlag("identifier");
      console.log(runLinearCli("get-issue", [`--identifier "${identifier}"`]));
      break;
    }
    case "search-issues": {
      const cliArgs = [];
      const teamId = getFlag("team-id");
      if (teamId) cliArgs.push(`--team-id "${teamId}"`);
      const query = getFlag("query");
      if (query) cliArgs.push(`--query "${query}"`);
      const labelId = getFlag("label-id");
      if (labelId) cliArgs.push(`--label-id "${labelId}"`);
      console.log(runLinearCli("search-issues", cliArgs));
      break;
    }
    case "link-pr": {
      const cliArgs = [];
      const issueId = getFlag("issue-id");
      if (issueId) cliArgs.push(`--issue-id "${issueId}"`);
      const prUrl = getFlag("pr-url");
      if (prUrl) cliArgs.push(`--pr-url "${prUrl}"`);
      const prNumber = getFlag("pr-number");
      if (prNumber) cliArgs.push(`--pr-number "${prNumber}"`);
      console.log(runLinearCli("link-pr", cliArgs));
      break;
    }
    case "add-occurrence": {
      const issueId = getFlag("issue-id");
      console.log(runLinearCli("add-occurrence", [`--issue-id "${issueId}"`]));
      break;
    }
    case "list-history": {
      const cliArgs = [];
      const teamId = getFlag("team-id");
      if (teamId) cliArgs.push(`--team-id "${teamId}"`);
      const labelId = getFlag("label-id");
      if (labelId) cliArgs.push(`--label-id "${labelId}"`);
      const days = getFlag("days");
      if (days) cliArgs.push(`--days ${days}`);
      console.log(runLinearCli("list-triage-history", cliArgs));
      break;
    }
    case "search-fingerprint": {
      const cliArgs = [];
      const teamId = getFlag("team-id");
      if (teamId) cliArgs.push(`--team-id "${teamId}"`);
      const errorPattern = getFlag("error-pattern");
      if (errorPattern) cliArgs.push(`--error-pattern "${errorPattern}"`);
      const labelId = getFlag("label-id");
      if (labelId) cliArgs.push(`--label-id "${labelId}"`);
      const service = getFlag("service");
      if (service) cliArgs.push(`--service "${service}"`);
      console.log(runLinearCli("search-by-fingerprint", cliArgs));
      break;
    }
    default:
      console.error(`Usage: linear.ts <create-issue|update-issue|get-issue|search-issues|link-pr|add-occurrence|list-history|search-fingerprint>`);
      process.exit(1);
  }
} catch (err) {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
}
