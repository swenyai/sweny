#!/usr/bin/env node
/**
 * Linear API Client for GitHub Actions
 *
 * Creates issues, updates status, and manages Linear tickets
 * for the SWEny triage workflow.
 */

import { program } from 'commander';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

interface LinearConfig {
  apiKey: string;
}

interface IssueCreateInput {
  title: string;
  description?: string;
  teamId: string;
  labelIds?: string[];
  priority?: number;
  stateId?: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName: string;
}

function getConfig(): LinearConfig {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error('Error: LINEAR_API_KEY environment variable is required');
    process.exit(1);
  }
  return { apiKey };
}

async function linearRequest<T>(config: LinearConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: config.apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
  }

  return json.data as T;
}

// ============================================================================
// COMMAND: create-issue - Create a new Linear issue
// ============================================================================
program
  .command('create-issue')
  .description('Create a new Linear issue for triage workflow findings')
  .requiredOption('--title <title>', 'Issue title')
  .requiredOption('--team-id <teamId>', 'Linear team ID')
  .option('--description <description>', 'Issue description (markdown)')
  .option('--labels <labelIds>', 'Comma-separated label IDs')
  .option('--priority <priority>', 'Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low', '3')
  .option('--state-id <stateId>', 'Initial state ID')
  .action(async (options) => {
    try {
      const config = getConfig();

      const input: IssueCreateInput = {
        title: options.title,
        teamId: options.teamId,
        priority: parseInt(options.priority, 10),
      };

      if (options.description) {
        input.description = options.description;
      }

      if (options.labels) {
        input.labelIds = options.labels.split(',').map((id: string) => id.trim());
      }

      if (options.stateId) {
        input.stateId = options.stateId;
      }

      const mutation = `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
              branchName
            }
          }
        }
      `;

      const result = await linearRequest<{
        issueCreate: {
          success: boolean;
          issue: LinearIssue;
        };
      }>(config, mutation, { input });

      if (!result.issueCreate.success) {
        throw new Error('Failed to create issue');
      }

      const issue = result.issueCreate.issue;

      // Output in a format that can be parsed by GitHub Actions
      console.log(`ISSUE_ID=${issue.id}`);
      console.log(`ISSUE_IDENTIFIER=${issue.identifier}`);
      console.log(`ISSUE_URL=${issue.url}`);
      console.log(`ISSUE_BRANCH=${issue.branchName}`);
      console.log(`ISSUE_TITLE=${issue.title}`);

      // Also output JSON for easier parsing
      console.log(`ISSUE_JSON=${JSON.stringify(issue)}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: update-issue - Update an existing Linear issue
// ============================================================================
program
  .command('update-issue')
  .description('Update an existing Linear issue')
  .requiredOption('--issue-id <issueId>', 'Issue ID to update')
  .option('--state-id <stateId>', 'New state ID')
  .option('--description <description>', 'Updated description')
  .option('--add-comment <comment>', 'Add a comment to the issue')
  .action(async (options) => {
    try {
      const config = getConfig();

      // Update issue if state or description provided
      if (options.stateId || options.description) {
        const updateInput: Record<string, unknown> = {};
        if (options.stateId) updateInput.stateId = options.stateId;
        if (options.description) updateInput.description = options.description;

        const mutation = `
          mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                id
                identifier
                state {
                  name
                }
              }
            }
          }
        `;

        await linearRequest(config, mutation, {
          id: options.issueId,
          input: updateInput,
        });

        console.log(`Issue ${options.issueId} updated`);
      }

      // Add comment if provided
      if (options.addComment) {
        const commentMutation = `
          mutation CreateComment($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
            }
          }
        `;

        await linearRequest(config, commentMutation, {
          input: {
            issueId: options.issueId,
            body: options.addComment,
          },
        });

        console.log(`Comment added to issue ${options.issueId}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: link-pr - Add PR link to Linear issue
// ============================================================================
program
  .command('link-pr')
  .description('Link a GitHub PR to a Linear issue')
  .requiredOption('--issue-id <issueId>', 'Linear issue ID')
  .requiredOption('--pr-url <prUrl>', 'GitHub PR URL')
  .requiredOption('--pr-number <prNumber>', 'GitHub PR number')
  .action(async (options) => {
    try {
      const config = getConfig();

      // Add attachment link
      const mutation = `
        mutation CreateAttachment($input: AttachmentCreateInput!) {
          attachmentCreate(input: $input) {
            success
            attachment {
              id
            }
          }
        }
      `;

      await linearRequest(config, mutation, {
        input: {
          issueId: options.issueId,
          url: options.prUrl,
          title: `GitHub PR #${options.prNumber}`,
        },
      });

      // Also add a comment
      const commentMutation = `
        mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
          }
        }
      `;

      await linearRequest(config, commentMutation, {
        input: {
          issueId: options.issueId,
          body: `**Pull Request Created**: [PR #${options.prNumber}](${options.prUrl})`,
        },
      });

      console.log(`PR #${options.prNumber} linked to Linear issue ${options.issueId}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: search-issues - Search for existing issues
// ============================================================================
program
  .command('search-issues')
  .description('Search for existing issues by title pattern')
  .requiredOption('--team-id <teamId>', 'Linear team ID')
  .requiredOption('--query <query>', 'Search query (matches title)')
  .option('--label-id <labelId>', 'Filter by label ID')
  .option(
    '--states <states>',
    'Comma-separated state names to include (default: open states)',
    'Triage,Backlog,Todo,In Progress,Peer Review,In Review,QA,Blocked',
  )
  .action(async (options) => {
    try {
      const config = getConfig();

      // Search for issues matching the query
      const query = `
        query SearchIssues($teamId: String!, $filter: IssueFilter) {
          team(id: $teamId) {
            issues(filter: $filter, first: 10) {
              nodes {
                id
                identifier
                title
                url
                branchName
                state {
                  name
                }
                createdAt
                updatedAt
              }
            }
          }
        }
      `;

      // Build filter - search in title
      const stateNames = options.states.split(',').map((s: string) => s.trim());
      const filter: Record<string, unknown> = {
        title: { containsIgnoreCase: options.query },
        state: { name: { in: stateNames } },
      };

      if (options.labelId) {
        filter.labels = { id: { eq: options.labelId } };
      }

      const result = await linearRequest<{
        team: {
          issues: {
            nodes: Array<{
              id: string;
              identifier: string;
              title: string;
              url: string;
              branchName: string;
              state: { name: string };
              createdAt: string;
              updatedAt: string;
            }>;
          };
        };
      }>(config, query, { teamId: options.teamId, filter });

      const issues = result.team?.issues?.nodes ?? [];

      if (issues.length === 0) {
        console.log('FOUND=false');
        console.log('COUNT=0');
      } else {
        console.log('FOUND=true');
        console.log(`COUNT=${issues.length}`);
        // Return the most recently updated matching issue
        const mostRecent = issues[0];
        console.log(`ISSUE_ID=${mostRecent.id}`);
        console.log(`ISSUE_IDENTIFIER=${mostRecent.identifier}`);
        console.log(`ISSUE_URL=${mostRecent.url}`);
        console.log(`ISSUE_BRANCH=${mostRecent.branchName}`);
        console.log(`ISSUE_TITLE=${mostRecent.title}`);
        console.log(`ISSUE_STATE=${mostRecent.state.name}`);
        console.log(`ISSUES_JSON=${JSON.stringify(issues)}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: add-occurrence - Add a +1 occurrence comment to an issue
// ============================================================================
program
  .command('add-occurrence')
  .description('Add a lightweight +1 occurrence comment to an existing issue')
  .requiredOption('--issue-id <issueId>', 'Linear issue ID')
  .option('--date <date>', 'Date of occurrence (default: now)')
  .action(async (options) => {
    try {
      const config = getConfig();

      const date = options.date ?? new Date().toISOString().split('T')[0];

      const commentMutation = `
        mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
          }
        }
      `;

      await linearRequest(config, commentMutation, {
        input: {
          issueId: options.issueId,
          body: `+1 detected on ${date}`,
        },
      });

      console.log(`COMMENTED=true`);
      console.log(`Added occurrence to issue ${options.issueId}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: get-team - Get team info by name
// ============================================================================
program
  .command('get-team')
  .description('Get team ID by name')
  .requiredOption('--name <name>', 'Team name')
  .action(async (options) => {
    try {
      const config = getConfig();

      const query = `
        query Teams {
          teams {
            nodes {
              id
              name
              key
            }
          }
        }
      `;

      const result = await linearRequest<{
        teams: {
          nodes: Array<{ id: string; name: string; key: string }>;
        };
      }>(config, query);

      const team = result.teams.nodes.find((t) => t.name.toLowerCase() === options.name.toLowerCase());

      if (!team) {
        console.error(`Team "${options.name}" not found`);
        console.error('Available teams:', result.teams.nodes.map((t) => t.name).join(', '));
        process.exit(1);
      }

      console.log(`TEAM_ID=${team.id}`);
      console.log(`TEAM_KEY=${team.key}`);
      console.log(`TEAM_NAME=${team.name}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: get-labels - Get labels for a team
// ============================================================================
program
  .command('get-labels')
  .description('Get available labels for a team')
  .option('--team-id <teamId>', 'Team ID to filter by')
  .action(async (options) => {
    try {
      const config = getConfig();

      let query: string;
      let variables: Record<string, unknown> | undefined;

      if (options.teamId) {
        query = `
          query TeamLabels($teamId: String!) {
            team(id: $teamId) {
              labels {
                nodes {
                  id
                  name
                  color
                }
              }
            }
          }
        `;
        variables = { teamId: options.teamId };
      } else {
        query = `
          query Labels {
            issueLabels {
              nodes {
                id
                name
                color
              }
            }
          }
        `;
      }

      const result = await linearRequest<{
        team?: { labels: { nodes: Array<{ id: string; name: string; color: string }> } };
        issueLabels?: { nodes: Array<{ id: string; name: string; color: string }> };
      }>(config, query, variables);

      const labels = result.team?.labels.nodes ?? result.issueLabels?.nodes ?? [];

      for (const label of labels) {
        console.log(`${label.id}\t${label.name}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: get-issue - Get issue details by identifier
// ============================================================================
program
  .command('get-issue')
  .description('Get issue details by identifier (e.g., ENG-123)')
  .requiredOption('--identifier <identifier>', 'Issue identifier (e.g., ENG-123)')
  .action(async (options) => {
    try {
      const config = getConfig();

      const query = `
        query GetIssue($identifier: String!) {
          issue(id: $identifier) {
            id
            identifier
            title
            url
            branchName
            state {
              name
            }
          }
        }
      `;

      const result = await linearRequest<{
        issue: {
          id: string;
          identifier: string;
          title: string;
          url: string;
          branchName: string;
          state: { name: string };
        };
      }>(config, query, { identifier: options.identifier });

      if (!result.issue) {
        console.error(`Issue "${options.identifier}" not found`);
        process.exit(1);
      }

      const issue = result.issue;

      console.log(`ISSUE_ID=${issue.id}`);
      console.log(`ISSUE_IDENTIFIER=${issue.identifier}`);
      console.log(`ISSUE_URL=${issue.url}`);
      console.log(`ISSUE_BRANCH=${issue.branchName}`);
      console.log(`ISSUE_TITLE=${issue.title}`);
      console.log(`ISSUE_STATE=${issue.state.name}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: list-triage-history - List recent triage issues for dedup context
// ============================================================================
program
  .command('list-triage-history')
  .description('List recent triage issues for known-issues context')
  .requiredOption('--team-id <teamId>', 'Linear team ID')
  .requiredOption('--label-id <labelId>', 'Triage label ID')
  .option('--days <days>', 'Number of days to look back', '30')
  .action(async (options) => {
    try {
      const config = getConfig();
      const daysAgo = parseInt(options.days, 10);
      const since = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

      const query = `
        query TriageHistory($teamId: String!, $filter: IssueFilter) {
          team(id: $teamId) {
            issues(filter: $filter, first: 50, orderBy: createdAt) {
              nodes {
                id
                identifier
                title
                url
                description
                state {
                  name
                  type
                }
                createdAt
                updatedAt
                labels {
                  nodes {
                    name
                  }
                }
              }
            }
          }
        }
      `;

      const filter: Record<string, unknown> = {
        labels: { id: { eq: options.labelId } },
        createdAt: { gte: since },
      };

      const result = await linearRequest<{
        team: {
          issues: {
            nodes: Array<{
              id: string;
              identifier: string;
              title: string;
              url: string;
              description: string | null;
              state: { name: string; type: string };
              createdAt: string;
              updatedAt: string;
              labels: { nodes: Array<{ name: string }> };
            }>;
          };
        };
      }>(config, query, { teamId: options.teamId, filter });

      const issues = result.team?.issues?.nodes ?? [];

      // Extract fingerprints from descriptions
      const output = issues.map((issue) => {
        let fingerprint: string | null = null;
        if (issue.description) {
          const match = issue.description.match(/<!-- TRIAGE_FINGERPRINT\n([\s\S]*?)-->/);
          if (match) {
            fingerprint = match[1].trim();
          }
        }

        return {
          identifier: issue.identifier,
          title: issue.title,
          state: issue.state.name,
          stateType: issue.state.type,
          url: issue.url,
          descriptionSnippet: issue.description ? issue.description.slice(0, 200) : null,
          fingerprint,
          createdAt: issue.createdAt,
          labels: issue.labels.nodes.map((l) => l.name),
        };
      });

      console.log(`COUNT=${output.length}`);
      console.log(`ISSUES_JSON=${JSON.stringify(output)}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// ============================================================================
// COMMAND: search-by-fingerprint - Search issues by error fingerprint
// ============================================================================
program
  .command('search-by-fingerprint')
  .description('Search for existing issues matching an error fingerprint in description')
  .requiredOption('--team-id <teamId>', 'Linear team ID')
  .requiredOption('--error-pattern <pattern>', 'Error message pattern to search for')
  .option('--label-id <labelId>', 'Filter by label ID')
  .option('--service <service>', 'Service name to match')
  .action(async (options) => {
    try {
      const config = getConfig();

      // Fetch recent triage issues with descriptions
      const query = `
        query FingerprintSearch($teamId: String!, $filter: IssueFilter) {
          team(id: $teamId) {
            issues(filter: $filter, first: 50, orderBy: updatedAt) {
              nodes {
                id
                identifier
                title
                url
                branchName
                description
                state {
                  name
                  type
                }
              }
            }
          }
        }
      `;

      const filter: Record<string, unknown> = {};
      if (options.labelId) {
        filter.labels = { id: { eq: options.labelId } };
      }
      // Only look at non-cancelled issues from last 90 days
      filter.createdAt = { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() };

      const result = await linearRequest<{
        team: {
          issues: {
            nodes: Array<{
              id: string;
              identifier: string;
              title: string;
              url: string;
              branchName: string;
              description: string | null;
              state: { name: string; type: string };
            }>;
          };
        };
      }>(config, query, { teamId: options.teamId, filter });

      const issues = result.team?.issues?.nodes ?? [];
      const errorPattern = options.errorPattern.toLowerCase();
      const service = options.service?.toLowerCase();

      // Search descriptions for fingerprint match
      const matches = issues.filter((issue) => {
        if (!issue.description) return false;
        const desc = issue.description.toLowerCase();

        // Check fingerprint block first
        const fpMatch = desc.match(/<!-- triage_fingerprint\n([\s\S]*?)-->/);
        if (fpMatch) {
          const fp = fpMatch[1];
          const hasErrorMatch = fp.includes(errorPattern);
          const hasServiceMatch = !service || fp.includes(service);
          if (hasErrorMatch && hasServiceMatch) return true;
        }

        // Fall back to searching the full description
        return desc.includes(errorPattern);
      });

      if (matches.length === 0) {
        console.log('FOUND=false');
        console.log('COUNT=0');
      } else {
        const best = matches[0];
        console.log('FOUND=true');
        console.log(`COUNT=${matches.length}`);
        console.log(`ISSUE_ID=${best.id}`);
        console.log(`ISSUE_IDENTIFIER=${best.identifier}`);
        console.log(`ISSUE_URL=${best.url}`);
        console.log(`ISSUE_BRANCH=${best.branchName}`);
        console.log(`ISSUE_TITLE=${best.title}`);
        console.log(`ISSUE_STATE=${best.state.name}`);
        console.log(
          `ISSUES_JSON=${JSON.stringify(
            matches.map((m) => ({ identifier: m.identifier, title: m.title, state: m.state.name, url: m.url })),
          )}`,
        );
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Main
program.name('linear-client').description('Linear API client for GitHub Actions workflows').version('1.0.0');

program.parse();
