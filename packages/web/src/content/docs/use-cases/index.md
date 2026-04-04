---
title: Use Cases
description: SWEny workflows go far beyond DevOps — replace brittle data pipelines, automate research, and build quality-gated extraction systems.
---

SWEny ships with [triage](/workflows/triage/) and [implement](/workflows/implement/) for DevOps, but the workflow engine is general-purpose. Teams use it to replace brittle data pipelines, automate research, and build quality-gated extraction systems.

The [data pipelines deep-dive](/use-cases/data-pipelines/) walks through a full example with DAG diagrams, YAML, and reusable patterns. The use cases below show the breadth of what's possible.

---

## Vendor Security Reviews

**Stop spending 4 hours per questionnaire.**

InfoSec teams receive dozens of vendor security questionnaires every month — SOC 2, SIG, CAIQ — each in a slightly different PDF format. Today, an analyst reads each questionnaire, hunts through internal docs for the right answer, and manually fills in responses. It takes hours per vendor and the answers drift out of date.

A SWEny workflow handles this as a DAG: ingest the questionnaire PDF, extract the questions into structured form, match each question against the company's existing security posture documentation, draft answers, then run an LLM judge that validates no answer overstates a capability. Uncertain answers get flagged for human review instead of silently shipping wrong information.

**Key patterns:** `Structured Extraction` · `LLM Judge`

---

## Customer Feedback Intelligence

**Every signal in one place, structured and prioritized.**

Product teams have feedback scattered across support tickets, NPS surveys, app store reviews, and sales call transcripts. No single view of what customers actually want. Insights get lost, duplicated, or discovered months late.

A SWEny workflow pulls from all sources on a weekly cron, classifies each piece of feedback (feature request, bug report, churn risk, praise), extracts structured signals, deduplicates across sources, and produces a prioritized brief. An LLM judge catches hallucinated trends — if the summary claims "users are asking for dark mode" but only one ticket mentions it, the judge flags the discrepancy.

**Key patterns:** `Multi-Source Aggregation` · `LLM Judge` · `Scheduled Runs`

---

## Competitive Monitoring

**Know when competitors ship before your customers tell you.**

Product teams manually check competitor changelogs, pricing pages, and documentation. Changes slip through unnoticed for weeks. By the time someone spots a competitor's new feature, customers are already asking about it.

A SWEny workflow monitors tracked pages using content hashing — it only reprocesses pages that actually changed. When a change is detected, the workflow downloads the updated page, extracts structured diffs (new features, pricing changes, positioning shifts), and produces a comparison report. Run it on a weekly cron and never miss a competitor move again.

**Key patterns:** `Change Detection` · `Structured Extraction` · `Scheduled Runs`

---

## Contract Lifecycle Management

**Never miss a renewal date buried in a PDF again.**

Legal teams manage hundreds of vendor and client contracts. Key terms — renewal dates, SLA thresholds, termination clauses — are buried in PDFs that nobody reads until it's too late. A missed auto-renewal or an unfavorable clause change costs real money.

A SWEny workflow ingests contract PDFs, extracts key terms into structured JSON, validates against a schema, flags upcoming expirations, and detects unfavorable clause changes on renewals. An LLM judge cross-checks extracted dates and dollar amounts against the source text to catch extraction errors before they reach the team's dashboard.

**Key patterns:** `Structured Extraction` · `Change Detection` · `LLM Judge`

---

## Internal Knowledge Base Curation

**Find out which docs are lying to you.**

Every company has a sprawling wiki or Confluence with hundreds of stale pages. Nobody knows which API docs are current, who owns what, or which pages contradict each other. New engineers trust outdated docs and ship bugs because of it.

A SWEny workflow crawls pages in phases — starting with high-traffic pages, expanding coverage weekly. It extracts structured metadata (API ownership, deprecation status, last verified date), flags contradictions between pages, and produces a health report. The multi-phase expansion pattern means the workflow grows its coverage automatically without anyone managing a list of pages to check.

**Key patterns:** `Multi-Phase Expansion` · `LLM Judge` · `Scheduled Runs`
