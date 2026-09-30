# 30-day launch metrics checklist

Refs swenyai/sweny#351, #366. Day 0 is the day the last launch post goes up.

## Kill criterion

Measured on day 30. **KILL** if the launch brings **fewer than 25 new GitHub stars AND fewer than 10 new
waitlist entries**. That means no further feature hours on sweny. **PASS** at 25+ new stars or 10+ new waitlist
entries, which reopens swenyai/cloud#59 and #60.

"New" means day-30 value minus the day-0 baseline below, not the absolute count.

## Day 0 baseline (record before posting)

- [ ] Stars: `gh repo view swenyai/sweny --json stargazerCount` (3 on 2026-09-30)
- [ ] Waitlist count: Vercel Blob store `store_CJiyVB1gHnKBzjMF` (`sweny-waitlist`), or `/api/admin/waitlist`
      on cloud.sweny.ai with `SWENY_ADMIN_TOKEN` (0 on 2026-09-20 per #351; re-read on day 0)
- [ ] npm downloads, last week: `curl -s https://api.npmjs.org/downloads/point/last-week/@sweny-ai/core`
      (context only: the owner's own CI pulls this package, so it is not demand evidence)
- [ ] nateross.dev pageviews by path, last 30 days (`aggregate_pageviews`, project `prj_ThEurC6HBWJw3DNWQjtcEtzI7L1m`)
- [ ] Clean-container quickstart is green on main (`scripts/quickstart-smoke.sh` job in CI)
- [ ] Post URLs recorded in a comment on #351 (blog, Show HN, r/ClaudeAI)

## Checks

| When | What |
|---|---|
| Day 0 to 2 | Read HN and Reddit comments twice a day. Agent drafts replies, owner posts. File every real bug as an issue. |
| Day 2 | Stars, waitlist, GitHub referrers (Insights, Traffic), blog pageviews for the new post path |
| Day 7 | Same, plus: new issues or PRs from people other than the owner; any `sweny` runs reported to cloud (none expected, cloud is closed) |
| Day 14 | Same. Save GitHub Traffic referrers now; GitHub only keeps 14 days |
| Day 30 | Final read of every number above, then the verdict |

## Other launch metrics from #366 (inform, don't decide)

- UTM visits per source (see `utm-links.md`)
- Clean-container first run green in CI for the whole window
- Second run within 7 days for Action users: no instrument exists today (runs are local-only unless cloud
  reporting is on). Record as "not measured" unless one ships in the window.

## Day 30 verdict

- [ ] New stars: ____ (day 30 minus day 0)
- [ ] New waitlist entries: ____
- [ ] Verdict: KILL / PASS, posted as a comment on #351 and #366 with the raw numbers and the commands used
