# SWEny Workflow Marketplace — Design Spec

## Overview

A public marketplace for discovering, sharing, and creating SWEny workflows. Community contributors submit YAML workflow files via PR. The site provides a beautiful browse experience with interactive DAG visualization, and an AI-powered creation flow that generates workflows from natural language.

**Repo:** `swenyai/workflows` (new, public, separate from core)
**Domain:** `marketplace.sweny.ai`
**Framework:** Next.js 15 (App Router) deployed to Vercel
**AI:** Vercel AI Gateway → Anthropic Claude for workflow generation

## Architecture

```
swenyai/workflows/
├── workflows/                    # YAML workflow files
│   ├── official/                 # Maintained by sweny-ai team
│   │   ├── triage.yml
│   │   ├── implement.yml
│   │   └── seed-content.yml
│   └── community/                # Submitted via PR
│       ├── security-audit.yml
│       ├── pr-review-bot.yml
│       └── ...
├── site/                         # Next.js 15 app
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # Browse: gallery grid + detail panel
│   │   │   ├── workflows/[id]/
│   │   │   │   └── page.tsx          # Permalink: full-page detail
│   │   │   ├── create/
│   │   │   │   └── page.tsx          # Create: AI prompt + Studio editor
│   │   │   └── api/
│   │   │       └── generate/
│   │   │           └── route.ts      # AI generation endpoint (streaming)
│   │   ├── components/
│   │   │   ├── WorkflowCard.tsx      # Gallery card with SVG mini-DAG
│   │   │   ├── WorkflowGrid.tsx      # Responsive card grid
│   │   │   ├── WorkflowDetail.tsx    # Detail panel (DAG + tabs + actions)
│   │   │   ├── SearchBar.tsx         # Cmd+K search with fuzzy matching
│   │   │   ├── CategoryFilter.tsx    # Filter pill bar
│   │   │   ├── CreatePrompt.tsx      # Natural language input for AI generation
│   │   │   └── SubmitFlow.tsx        # GitHub OAuth + fork + PR flow
│   │   └── lib/
│   │       ├── workflows.ts          # Load + index YAML files at build time
│   │       ├── search.ts             # Client-side fuzzy search over index
│   │       └── github.ts             # GitHub API helpers (fork, commit, PR)
│   ├── public/
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── .github/workflows/
│   ├── validate.yml                  # CI: validate YAML on PR
│   └── deploy.yml                    # Deploy site on merge to main
├── CONTRIBUTING.md
└── package.json                      # Root workspace
```

## Workflow YAML Format

Every workflow includes standard SWEny fields plus marketplace metadata:

```yaml
# --- Marketplace metadata ---
id: security-audit                    # Unique, URL-safe identifier
name: Security Audit                  # Display name
description: >-                       # One-liner for cards, SEO
  Scan dependencies for CVEs, check OWASP top 10, generate a security report
author: alice                         # GitHub username
category: security                    # Primary bucket (see categories below)
tags: [cve, owasp, dependencies]      # Free-form search terms
icon: shield                          # Optional: preset icon (see icon set)
color: red                            # Optional: card accent (red|blue|purple|orange|green|yellow)
version: 1.0.0                        # Semver
sweny_version: ">=4.0.0"              # Engine compatibility

# --- Standard SWEny workflow ---
entry: scan
nodes:
  scan:
    name: Scan Dependencies
    instruction: ...
    skills: [github]
  # ...
edges:
  - from: scan
    to: analyze
  # ...
```

### Categories

| Category | Description | Icon | Color |
|----------|-------------|------|-------|
| `triage` | Alert investigation, incident response | alert-triangle | blue |
| `security` | Vulnerability scanning, audits, compliance | shield | red |
| `devops` | CI/CD, deployment, infrastructure | server | orange |
| `code-review` | PR review, code quality, style checking | git-pull-request | purple |
| `testing` | Test generation, coverage analysis | check-circle | green |
| `content` | Documentation, READMEs, changelogs | file-text | yellow |
| `ops` | Monitoring, runbooks, on-call automation | activity | cyan |

### Metadata Validation

CI validates on every PR:
- `id`: required, unique across all workflows, URL-safe (`^[a-z0-9-]+$`)
- `name`: required, 3-80 characters
- `description`: required, 10-300 characters
- `author`: required, valid GitHub username
- `category`: required, must be one of the defined categories
- `tags`: required, 1-10 tags, each 2-30 characters
- `version`: required, valid semver
- `sweny_version`: optional, valid semver range
- Standard workflow validation via `@sweny-ai/core`'s `parseWorkflow()` + `validateWorkflow()`

## Pages & UX

### 1. Browse (`/`)

**Layout:** Gallery grid on the left, detail panel on the right (opens when a card is selected).

**Gallery Grid:**
- Responsive card grid (2 cols on the left panel, or 3-4 cols full-width when no detail panel open)
- Each card shows:
  - Color-coded category icon + workflow name
  - One-line description
  - SVG mini-DAG preview (generated at build time from the workflow)
  - Skill badges (github, sentry, slack, etc.)
  - Author avatar + username
  - Official/Community badge
- Cards are interactive — hover highlights, click selects and opens detail panel

**Search:**
- `Cmd+K` shortcut opens search overlay
- Also inline search bar at the top
- Client-side fuzzy search over pre-built index (name, description, tags, skills, author)
- Results update as you type

**Filters:**
- Category pills below search bar (All, Triage, Security, DevOps, etc.)
- Sort: Popular (default), Recent, Name A-Z
- Active filter state in URL params for shareability

**Detail Panel (right side):**
- Opens when a card is selected, slides in from right
- Header: icon + name + badge (official/community) + description
- Meta bar: author avatar, node count, edge count, version, last updated
- Interactive DAG: full `@sweny-ai/studio` WorkflowViewer component — pannable, zoomable, click nodes to inspect
- Tabbed content below DAG:
  - **Skills Required:** grid of skills with env var names and configured/not status
  - **YAML Source:** syntax-highlighted YAML with copy button
  - **Usage:** generated `.github/workflows/sweny.yml` snippet ready to copy-paste
- Action buttons:
  - "Use This Workflow" → copies the GitHub Action YAML snippet
  - "Fork & Edit" → opens `/create` pre-loaded with this workflow
  - "View on GitHub" → links to the YAML file in the repo

### 2. Permalink (`/workflows/[id]`)

- Full-page version of the detail panel (for sharing, SEO)
- Same content: DAG viewer, tabs, actions
- OpenGraph meta tags with workflow name, description
- OG image: static DAG render (generated at build time)

### 3. Create (`/create`)

**Primary flow: AI-powered generation**

1. User lands on a clean page with a prominent text input:
   > "Describe what your workflow should do"
2. Example prompts shown as clickable suggestions below
3. User types a natural language description
4. Hits Enter → API route streams the response
5. Generated YAML appears in real-time (left panel), DAG updates live in Studio viewer (right panel)
6. User can refine conversationally: "add a Slack notification at the end", "make the scan node check for OWASP too"
7. Each refinement streams an updated YAML

**Secondary flow: Manual Studio editor**

- Tab/toggle to switch from "AI" to "Manual" mode
- Full `@sweny-ai/studio/editor` embedded — node toolbox, edge drawing, properties panel
- For users who want fine-grained control

**Metadata form:**

- After the workflow is generated/edited, a metadata panel collects: name, description, category, tags
- Pre-filled from AI generation where possible

**Submit flow:**

1. User clicks "Submit to Marketplace"
2. If not authenticated → GitHub OAuth popup (scope: `public_repo`)
3. Client-side via GitHub API:
   - Fork `swenyai/workflows` (if not already forked)
   - Create branch `add-{workflow-id}`
   - Commit YAML to `workflows/community/{id}.yml`
   - Open PR with title "Add: {workflow name}" and auto-generated body
4. User sees "PR created!" with link to the PR
5. CI validates on the PR, maintainers review + merge

**Fork & Edit flow:**

- Same as create, but pre-loads an existing workflow
- Submit creates a new YAML file (new id, credits original in description)

## AI Generation Endpoint

### `POST /api/generate` (streaming)

**Request:**
```json
{
  "prompt": "Scan my codebase for TODO comments, create Linear issues, post summary to Slack",
  "existingWorkflow": null | "<yaml string for refinement>"
}
```

**Response:** Server-Sent Events stream

```
data: {"type": "token", "content": "id: todo-scanner\n"}
data: {"type": "token", "content": "name: TODO Scanner\n"}
...
data: {"type": "complete", "yaml": "<full yaml>", "valid": true}
```

Or on validation failure:
```
data: {"type": "complete", "yaml": "<full yaml>", "valid": false, "errors": ["..."]}
```

**Implementation:**
- Uses Vercel AI Gateway (`ai-gateway.vercel.sh`) → Anthropic Claude
- System prompt includes:
  - SWEny workflow JSON schema (from `@sweny-ai/core/schema`)
  - Full skill catalog with descriptions (from `@sweny-ai/core/skills`)
  - 2-3 example workflows (triage, implement) as few-shot examples
  - Metadata format requirements
- Response validated with `parseWorkflow()` + `validateWorkflow()` before sending `complete` event
- Rate limited: 10 generations per hour per IP (unauthenticated), 30 per hour (authenticated)

**Environment:**
- `VERCEL_AI_GATEWAY_TOKEN` — Vercel AI Gateway API key (env var, never in code)

## CI Pipeline

### `validate.yml` (on PR)

```yaml
on: pull_request
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: node scripts/validate.mjs  # Parse + validate all changed .yml files
      - run: node scripts/check-unique-ids.mjs  # No duplicate workflow IDs
      - run: node scripts/render-dag.mjs  # Comment PR with Mermaid DAG
```

The validation script:
1. Finds all `.yml` files changed in the PR
2. Parses each with `@sweny-ai/core`'s `parseWorkflow()`
3. Validates DAG integrity with `validateWorkflow()`
4. Validates marketplace metadata (author, category, tags, etc.)
5. Reports errors as PR check annotations

The DAG render script:
1. Converts workflow to Mermaid via `@sweny-ai/core`'s `toMermaid()`
2. Comments on the PR with the rendered diagram (GitHub renders Mermaid natively)

### `deploy.yml` (on merge to main)

```yaml
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: cd site && npm run build
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

## Build-Time Processing

At `next build`, a script:
1. Reads all YAML files from `../workflows/`
2. Parses and validates each
3. Generates SVG mini-DAG previews for card thumbnails (using `toMermaid()` or a lightweight SVG renderer)
4. Builds a search index (JSON) with: id, name, description, tags, skills, author, category
5. Outputs static data to `src/app/_data/` for import by pages

This means the browse page is fully static (SSG) — fast, cacheable, SEO-friendly. Only the create page and API route need server-side rendering.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router) | SSG + API routes, same stack as cloud.sweny.ai |
| Styling | Tailwind CSS | Consistent with sweny ecosystem |
| DAG Viewer | `@sweny-ai/studio/viewer` | Already built, interactive, production-quality |
| DAG Editor | `@sweny-ai/studio/editor` | Already built, full visual editor |
| AI | Vercel AI Gateway → Claude | Streaming, fast, managed |
| Search | Client-side fuzzy (fuse.js or similar) | No backend needed, works with SSG |
| Auth | GitHub OAuth (for submit only) | Lightweight, no user accounts needed for browsing |
| Hosting | Vercel | Native Next.js support, same org as cloud |
| CI | GitHub Actions | Validate YAML on PR, deploy on merge |
| YAML parsing | `@sweny-ai/core` | Existing schema, validation, types |

## Design System

- **Dark theme** (consistent with cloud.sweny.ai and Studio)
- **Brand color:** blue-500 (`#3b82f6`)
- **Card accents:** category-derived colors (see categories table)
- **Typography:** system font stack (or Geist if we want consistency with cloud)
- **Official badge:** blue background, blue text
- **Community badge:** green background, green text
- **Mobile responsive:** cards stack to single column, detail panel becomes full-screen overlay

## Data Flow

```
Contributor submits YAML (via PR or AI create flow)
    ↓
CI validates (parseWorkflow + validateWorkflow + metadata check)
    ↓
Maintainer reviews + merges
    ↓
Deploy pipeline builds site (reads YAML → generates index + SVG previews)
    ↓
Static site served from Vercel CDN
    ↓
User browses → clicks card → sees interactive DAG
    ↓
"Use This Workflow" → copies GitHub Action YAML snippet to clipboard
    ↓
User adds to their repo → runs SWEny with that workflow
```

## Cold Start: Seed Workflows

Before launch, seed the marketplace with 10-15 diverse workflows:

| Workflow | Category | Source |
|----------|----------|--------|
| Alert Triage | triage | existing (official) |
| Implement Fix | triage | existing (official) |
| Seed Content | content | existing (official) |
| Security Audit | security | generate with AI |
| PR Review Bot | code-review | generate with AI |
| Deploy Guard | devops | generate with AI |
| Onboarding Docs | content | generate with AI |
| Test Coverage Check | testing | generate with AI |
| Dependency Update | devops | generate with AI |
| API Endpoint Review | code-review | generate with AI |
| Incident Runbook | ops | generate with AI |
| Changelog Generator | content | generate with AI |

## Success Metrics

1. **Workflows published:** 20 community workflows within 60 days of launch
2. **Browse engagement:** avg time on site > 2 min
3. **Create completion:** > 30% of users who start AI generation submit a PR
4. **Conversion to SWEny:** > 10% of "Use This Workflow" clicks lead to a SWEny Action run within 7 days
5. **SEO traffic:** workflow permalink pages ranking for relevant queries within 90 days

## What's NOT in Scope

- User accounts or profiles (GitHub OAuth is session-only for PR submission)
- Ratings, reviews, or comments (use GitHub PR/issue discussions)
- Workflow versioning beyond semver in metadata (no registry, just files)
- Private/paid workflows (everything is public and open source)
- Execution/testing from the site (users run workflows in their own CI)
- Analytics dashboard for workflow authors (use GitHub traffic insights)
