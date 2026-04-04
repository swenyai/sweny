# Use Cases Documentation — Design Spec

**Date:** 2026-04-03
**Goal:** Add a "Use Cases" section to docs.sweny.ai that shows SWEny is a general-purpose AI workflow engine, not just a DevOps triage tool. All content is contrived and anonymized — no reference to any real customer or project.

**Target audience:** Both existing SWEny users who only know triage/implement, and new visitors who wouldn't have considered SWEny for data pipelines or research automation.

---

## 1. Site Structure Changes

### New sidebar group: "Use Cases"

Positioned between "Workflows" and "GitHub Action" in `astro.config.mjs`:

```
Workflows
  ...
Use Cases
  Overview           → use-cases/index.md     (hub page)
  Data Pipelines     → use-cases/data-pipelines.md  (flagship deep-dive)
GitHub Action
  ...
```

### New content files

| File | Type | Purpose |
|------|------|---------|
| `packages/web/src/content/docs/use-cases/index.md` | Hub page | Intro + card grid linking to all use cases |
| `packages/web/src/content/docs/use-cases/data-pipelines.md` | Deep-dive | Flagship ~1200-word narrative page |

### Modified files

| File | Change |
|------|--------|
| `packages/web/astro.config.mjs` | Add "Use Cases" sidebar group |
| `packages/web/src/content/docs/index.mdx` | Add "Beyond DevOps" section |

---

## 2. Flagship Deep-Dive: Data Pipelines, Reimagined

File: `use-cases/data-pipelines.md`
Length: ~1200 words
Tone: Narrative, not tutorial — the goal is to shift the reader's mental model

### Contrived example: Supply Chain Risk Monitoring

A procurement/ops team tracks 200+ suppliers. Risk profiles live in news articles, financial filings, regulatory notices, and internal assessments — all unstructured, all in different formats. The current approach is custom scrapers, cron jobs, and manual spot-checks. When a supplier's situation changes, the team finds out weeks later.

### Page structure

#### Opening hook (2 paragraphs max)
Sets up the problem. Familiar pain: unstructured data from many sources, brittle custom pipelines, stale information, no quality guarantees.

#### The DAG (~10 nodes)
ASCII or Mermaid rendering of the workflow. Key nodes:

| Node | Purpose |
|------|---------|
| `route_by_mode` | Entry — routes to monitor, expand, or auto mode |
| `triage_suppliers` | Auto mode: scans for past failures, plans phases |
| `check_sources` | HTTP HEAD change detection via content hashing (etag, last-modified) |
| `download_changed` | Downloads only changed documents, stores with content hash |
| `extract_risk_signals` | LLM extracts structured JSON from PDFs/HTML/filings |
| `validate` | Schema compliance + logical consistency checks |
| `llm_judge` | Quality gate — compares extraction against raw source, scores ≥0.9 to pass |
| `publish` | Passes: syncs validated data to data store |
| `flag_for_review` | Fails: writes field-level feedback, retries up to 3x, then flags human |
| `report` | Coverage report, run summary |

Three operational modes:
- **monitor** — Check existing suppliers for source changes
- **expand** — Onboard one new supplier (discover sources, extract, validate)
- **auto** — All three phases: retry failures → monitor all → expand one

#### Pattern Spotlight: LLM-as-Judge
Its own subsection. This is the "aha" moment.

The judge node compares extracted structured data against the raw source text. It scores confidence 0.0–1.0 and must hit ≥0.9 to pass. On failure, it writes field-level feedback explaining exactly what's wrong ("revenue field says $2.1B but source document shows $2.1M"). That feedback is fed back into the next extraction attempt as context.

The DAG handles the retry loop: up to 3 attempts with accumulating feedback, then flags for human review if still failing.

**Before/after comparison:** Traditional pipelines publish bad data silently. This pipeline refuses to publish until quality passes. The feedback loop means extractions get better over time.

#### Pattern Spotlight: Multi-Phase Expansion
The `auto` mode runs three phases in a single cron invocation:
1. Retry past judge failures (with accumulated feedback)
2. Monitor all tracked suppliers for source changes
3. Onboard one new supplier

Coverage grows week over week. No human intervention needed for the happy path. The team only gets involved when the judge can't resolve something after 3 attempts.

#### Before/After Table

| | Traditional Pipeline | SWEny Pipeline |
|---|---|---|
| **Parsing** | Custom scraper per source format | Natural-language node instructions; LLM handles any format |
| **Quality** | Manual spot-checks, bad data ships silently | LLM judge with ≥0.9 threshold, field-level feedback, retry loops |
| **Change detection** | Poll everything on a schedule | Content hashing (etag, SHA-256); only reprocess what changed |
| **Expansion** | Weeks of engineering per new source | One cron cycle to discover, extract, validate, and publish |
| **Maintenance** | Breaks when source format changes | LLM adapts; judge catches regressions |

#### Sample YAML Snippet
A trimmed excerpt showing 3-4 key nodes: the extract node, the judge node, and the conditional routing edge. Enough to show it's real YAML, not pseudocode. Not a full workflow file.

```yaml
nodes:
  extract_risk_signals:
    name: Extract Risk Signals
    instruction: |
      Extract structured risk signals from the downloaded documents.
      Output JSON matching the supplier risk schema: financial_health,
      regulatory_status, news_sentiment, overall_risk_score.
      Consult any prior judge feedback for this supplier to avoid
      repeating the same extraction errors.
    output:
      type: object
      properties:
        financial_health: { type: string, enum: [strong, stable, declining, critical] }
        regulatory_status: { type: string }
        news_sentiment: { type: number }
        overall_risk_score: { type: number }
      required: [financial_health, overall_risk_score]

  llm_judge:
    name: LLM Quality Judge
    instruction: |
      Compare each extracted field against the raw source text.
      Score confidence 0.0–1.0. Flag any field where the extraction
      contradicts, overstates, or cannot be verified from the source.
      Pass threshold: 0.9. On failure, write field-level feedback
      explaining exactly what is wrong and how to fix it.

edges:
  - from: llm_judge
    to: publish
    when: "All extracted fields scored 0.9 or above"
  - from: llm_judge
    to: flag_for_review
    when: "Any extracted field scored below 0.9"
```

---

## 3. Use Case Cards (Hub Page)

File: `use-cases/index.md`

### Intro
2-3 sentences: "SWEny ships with triage and implement for DevOps, but the workflow engine is general-purpose. Teams use it to replace brittle data pipelines, automate research, and build quality-gated extraction systems. Here's what's possible."

### Card grid
Links to the flagship deep-dive and anchors to the sections below.

### Five use case sections

Each gets: title, one-line hook, 2-3 paragraphs (problem → DAG shape → key patterns), and a badge list.

#### 1. Vendor Security Reviews
**Hook:** Stop spending 4 hours per questionnaire.
**Problem:** InfoSec team receives 30+ vendor security questionnaires monthly (SOC 2, SIG, CAIQ) — each in a slightly different format.
**DAG shape:** Ingest PDF → extract questions → match against security posture docs → draft answers → LLM judge validates no answer overstates a capability → flag uncertain answers for human review.
**Patterns:** `LLM Judge`, `Structured Extraction`

#### 2. Customer Feedback Intelligence
**Hook:** Every signal in one place, structured and prioritized.
**Problem:** Product team has feedback scattered across support tickets, NPS surveys, app reviews, and sales call transcripts. No single view of what customers actually want.
**DAG shape:** Pull from all sources → classify (feature request, bug, churn risk, praise) → extract structured signals → deduplicate across sources → produce weekly prioritized brief.
**Patterns:** `Multi-Source Aggregation`, `LLM Judge`, `Scheduled Runs`

#### 3. Competitive Monitoring
**Hook:** Know when competitors ship before your customers tell you.
**Problem:** Product team manually checks competitor changelogs, pricing pages, and docs. Changes slip through unnoticed for weeks.
**DAG shape:** Check tracked pages for changes (content hashing) → download changed pages → extract structured diffs (new features, pricing changes, positioning shifts) → produce comparison report.
**Patterns:** `Change Detection`, `Structured Extraction`, `Scheduled Runs`

#### 4. Contract Lifecycle Management
**Hook:** Never miss a renewal date buried in a PDF again.
**Problem:** Legal team managing hundreds of vendor/client contracts. Key terms (renewal dates, SLA thresholds, termination clauses) are buried in PDFs nobody reads until it's too late.
**DAG shape:** Ingest contract PDFs → extract key terms into structured JSON → validate against schema → flag upcoming expirations → detect unfavorable clause changes on renewals → produce weekly digest.
**Patterns:** `Structured Extraction`, `Change Detection`, `LLM Judge`

#### 5. Internal Knowledge Base Curation
**Hook:** Find out which docs are lying to you.
**Problem:** Sprawling wiki/Confluence with hundreds of stale pages. Nobody knows which API docs are current, who owns what, or which pages contradict each other.
**DAG shape:** Crawl pages (phased: start with high-traffic, expand weekly) → extract structured metadata (API ownership, deprecation status, last verified date) → flag contradictions between pages → produce health report.
**Patterns:** `Multi-Phase Expansion`, `LLM Judge`, `Scheduled Runs`

---

## 4. Landing Page Change

File: `packages/web/src/content/docs/index.mdx`

New section between "Built-in workflows" and "Run it on a schedule":

```markdown
## Beyond DevOps

SWEny workflows aren't limited to triage and fixes. Teams use them to
replace brittle data pipelines, automate research, and build quality-gated
extraction systems.

<CardGrid>
  <Card title="Data Pipelines" icon="document">
    Turn unstructured documents into structured data with LLM extraction,
    automated quality gates, and change detection.
    [Read the deep-dive →](/use-cases/data-pipelines/)
  </Card>
  <Card title="Security Reviews" icon="shield">
    Ingest vendor questionnaires, draft answers from your security posture
    docs, and validate nothing is overstated.
  </Card>
  <Card title="See all use cases →" icon="right-arrow" href="/use-cases/">
    Competitive monitoring, contract management, feedback synthesis, and more.
  </Card>
</CardGrid>
```

Three cards. No prose beyond the intro sentence. Third card links to the hub.

---

## 5. Sidebar Config

In `astro.config.mjs`, add between the Workflows and GitHub Action groups:

```js
{
  label: "Use Cases",
  items: [
    { label: "Overview", slug: "use-cases" },
    { label: "Data Pipelines", slug: "use-cases/data-pipelines" },
  ],
},
```

---

## 6. What's NOT in scope

- No interactive React components (Studio viewer embed, etc.) — can be added later
- No real customer data, names, or traceable domain details
- No tutorial/runnable code — this is narrative content
- No changes to existing workflow docs or CLI examples
- No new skills or workflow YAML files in the repo
