---
title: "Data Pipelines, Reimagined"
description: How a SWEny workflow replaces brittle scrapers and manual QA with LLM extraction, automated quality gates, and incremental expansion.
---

You have 200 suppliers. Their risk profiles live in news articles, financial filings, regulatory notices, and internal assessments — all unstructured, all in different formats. Your current pipeline is a tangle of custom scrapers, cron jobs, and manual spot-checks. When a supplier's situation changes, you find out weeks later. When a source changes its HTML layout, your scraper breaks silently and publishes stale data until someone notices.

This is the story of replacing that pipeline with a single SWEny workflow.

## The DAG

The workflow is a DAG with conditional routing and three operational modes:

```
                    ┌──────────────┐
                    │ Route by Mode│
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Retry    │ │ Monitor  │ │ Expand   │
        │ Failures │ │ All      │ │ One New  │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             └─────────────┼────────────┘
                           ▼
                    ┌──────────────┐
                    │Check Sources │
                    │(content hash)│
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │  Download    │
                    │  Changed     │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │  Extract     │
                    │  Risk Signals│
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │  Validate    │
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │  LLM Judge   │
                    └───┬──────┬───┘
                        │      │
                  pass ▼      ▼ fail
              ┌─────────┐ ┌──────────┐
              │ Publish  │ │ Flag for │
              │          │ │ Review   │
              └────┬─────┘ └────┬─────┘
                   └────────────┘
                        ▼
                  ┌──────────┐
                  │  Report  │
                  └──────────┘
```

**Three modes, one cron schedule:**

- **monitor** — Check all tracked suppliers for source changes. Only reprocess what actually changed.
- **expand** — Onboard one new supplier: discover sources, download, extract, validate, publish.
- **auto** — Run all three phases in sequence: retry past failures, monitor everything, then expand one. This is what runs on the weekly cron.

The `auto` mode is the default. A single Monday morning cron invocation handles maintenance, monitoring, and growth — no human intervention needed for the happy path.

## Pattern: LLM-as-Judge

This is the pattern that changes everything.

Traditional data pipelines have a quality problem: they publish whatever they extract. If a scraper misreads a PDF table, the bad data flows downstream silently. You find out when a customer complains or an analyst spots a number that doesn't look right.

The LLM judge node sits between extraction and publishing. It receives the extracted structured data and the raw source text, then compares them field by field. Each field gets a confidence score from 0.0 to 1.0. The threshold is strict: 0.9 or above to pass.

When a field fails, the judge doesn't just say "wrong." It writes field-level feedback explaining exactly what's wrong: *"The `revenue` field says $2.1B but the source document shows $2.1M on page 3, paragraph 2."* That feedback becomes context for the next extraction attempt.

The DAG handles the retry loop automatically. On failure, the workflow routes to a `flag_for_review` node that stores the judge's feedback and increments an attempt counter. On the next `auto` run, the retry phase picks up failed suppliers and feeds the accumulated feedback into the extraction node — so each attempt gets better. After 3 failed attempts, the workflow creates a ticket for human review instead of retrying forever.

**The result:** bad data never ships. And extraction quality improves over time as the feedback accumulates.

## Pattern: Multi-Phase Expansion

Most data pipelines are static — you build them for a fixed set of sources, and adding a new one means engineering work. This workflow grows itself.

The `auto` mode runs three phases in a single cron invocation:

1. **Retry** — Pick up suppliers that failed the judge on previous runs. Feed accumulated feedback into extraction. This phase exists so failures heal themselves.
2. **Monitor** — Check all tracked suppliers for source changes via content hashing (ETags, SHA-256). Only download and reprocess what actually changed. This is the steady-state phase.
3. **Expand** — Discover sources for one new supplier, download, extract, validate, and publish. One new supplier per week, fully automated.

After 200 weeks? Full coverage. In practice the team intervenes occasionally when the judge flags something tricky, but the growth is automatic. Coverage goes up every Monday with zero effort.

## Before and After

| | Traditional Pipeline | SWEny Pipeline |
|---|---|---|
| **Parsing** | Custom scraper per source format — breaks when layouts change | Natural-language node instructions; LLM handles any format |
| **Quality** | Manual spot-checks; bad data ships silently | LLM judge with 0.9 threshold, field-level feedback, retry loops |
| **Change detection** | Poll everything on a schedule, reprocess all | Content hashing (ETag, SHA-256); only reprocess what changed |
| **Expansion** | Weeks of engineering per new source | One cron cycle to discover, extract, validate, and publish |
| **Maintenance** | Breaks when source format changes; requires code fixes | LLM adapts to new formats; judge catches regressions |

## What the YAML looks like

Here's a trimmed excerpt showing the extraction, judge, and routing nodes:

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
        financial_health:
          type: string
          enum: [strong, stable, declining, critical]
        regulatory_status:
          type: string
        news_sentiment:
          type: number
        overall_risk_score:
          type: number
      required: [financial_health, overall_risk_score]

  llm_judge:
    name: LLM Quality Judge
    instruction: |
      Compare each extracted field against the raw source text.
      Score confidence 0.0-1.0. Flag any field where the extraction
      contradicts, overstates, or cannot be verified from the source.
      Pass threshold: 0.9. On failure, write field-level feedback
      explaining exactly what is wrong and how to fix it.

edges:
  - from: extract_risk_signals
    to: validate
  - from: validate
    to: llm_judge
  - from: llm_judge
    to: publish
    when: "All extracted fields scored 0.9 or above"
  - from: llm_judge
    to: flag_for_review
    when: "Any extracted field scored below 0.9"
```

Every node instruction is natural language. No regex, no XPath, no format-specific parsing code. When a source changes its layout, the LLM adapts. When it gets something wrong, the judge catches it and the feedback loop fixes it on the next run.

## Getting started

This workflow uses features available today:

1. **[Create a workflow](/workflows/custom/)** from a natural-language description — or write the YAML directly using the [YAML reference](/workflows/yaml-reference/)
2. **[Run it locally](/cli/)** with `sweny workflow run` to iterate on the DAG
3. **[Deploy to GitHub Actions](/action/)** with a cron schedule for automated weekly runs
4. **[Watch it execute](/studio/live/)** in Studio's live mode to see each node fire in real time

The patterns here — LLM extraction, quality gates, change detection, multi-phase expansion — aren't specific to supply chain. They work for any domain where you need to turn unstructured data into structured, validated output. See the [other use cases](/use-cases/) for more examples.
