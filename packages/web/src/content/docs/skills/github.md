---
title: GitHub
description: Search code, manage issues, and create pull requests on GitHub.
---

The GitHub skill gives Claude access to repositories, issues, pull requests, and code search. It covers both source control and issue tracking, making it the most widely used skill across built-in workflows.

## Metadata

| Field | Value |
|-------|-------|
| **ID** | `github` |
| **Category** | `git` |
| **Required env vars** | `GITHUB_TOKEN` |

## Tools

| Tool | Description |
|------|-------------|
| `github_search_code` | Search for code in a repository using GitHub code search syntax |
| `github_get_issue` | Get details of a GitHub issue by number |
| `github_search_issues` | Search issues and pull requests across a repo or globally |
| `github_create_issue` | Create a new GitHub issue with title, body, and labels |
| `github_create_pr` | Create a pull request from a head branch to a base branch |
| `github_list_recent_commits` | List recent commits on a branch (default: main) |
| `github_get_file` | Get a file's contents from a repository at a given ref |

## Setup

The GitHub skill requires a personal access token (PAT) or GitHub App installation token.

### Fine-grained PAT (recommended)

1. Go to **GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens**.
2. Create a token scoped to the repositories SWEny will access.
3. Grant these permissions:
   - **Contents**: Read and write (for code search, file reads, and commits)
   - **Issues**: Read and write (for issue search and creation)
   - **Pull requests**: Read and write (for PR creation)
   - **Metadata**: Read-only (required by default)
4. Set the environment variable:

```bash
export GITHUB_TOKEN="github_pat_..."
```

### GitHub Actions

In a GitHub Actions workflow, the built-in `GITHUB_TOKEN` is automatically available:

```yaml
env:
  GITHUB_TOKEN: ${{ github.token }}
```

For cross-repository access, use a PAT or GitHub App token instead.

:::note[Classic vs. fine-grained tokens]
Fine-grained tokens are preferred because you can scope them to specific repositories. Classic tokens grant access to all repositories the user owns, which is broader than necessary.
:::

## Workflow usage

The GitHub skill appears in nearly every node of the built-in workflows:

**Triage workflow:**
- **gather** — Search code and recent commits to understand what changed
- **investigate** — Read source files to correlate errors with code
- **create_issue** — File an issue when no existing ticket covers the problem

**Implement workflow:**
- **analyze** — Fetch the issue and read relevant source files
- **implement** — Create a branch and commit the fix
- **create_pr** — Open a pull request referencing the original issue
- **skip** — Comment on the issue if the fix is too complex
