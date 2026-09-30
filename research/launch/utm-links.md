# UTM link list (launch)

Refs swenyai/sweny#351. Campaign for everything: `utm_campaign=sweny-launch`.
The blog set is the exact tag #351 specifies.

| Where the link lives | Target | Link |
|---|---|---|
| Blog post, repo | GitHub | `https://github.com/swenyai/sweny?utm_source=nateross.dev&utm_medium=blog&utm_campaign=sweny-launch` |
| Blog post, docs | Quick start | `https://docs.sweny.ai/getting-started/quick-start/?utm_source=nateross.dev&utm_medium=blog&utm_campaign=sweny-launch` |
| Blog post, waitlist | Cloud | `https://cloud.sweny.ai/?utm_source=nateross.dev&utm_medium=blog&utm_campaign=sweny-launch#waitlist` |
| Claude Code tutorial parts 1, 2, 3 (link to the post) | Blog post | `https://nateross.dev/blog/claude-code-workflows-you-can-check-in?utm_source=nateross.dev&utm_medium=tutorial-series&utm_campaign=sweny-launch` |
| Show HN | GitHub | `https://github.com/swenyai/sweny` (bare; see show-hn.md) |
| X / Bluesky | GitHub | `https://github.com/swenyai/sweny?utm_source=x&utm_medium=social&utm_campaign=sweny-launch` |
| LinkedIn | Blog post | `https://nateross.dev/blog/claude-code-workflows-you-can-check-in?utm_source=linkedin&utm_medium=social&utm_campaign=sweny-launch` |
| r/ClaudeAI | GitHub | `https://github.com/swenyai/sweny?utm_source=reddit&utm_medium=social&utm_campaign=sweny-launch` |

Where each one is measurable:
- nateross.dev: Vercel Analytics (`aggregate_pageviews` on `prj_ThEurC6HBWJw3DNWQjtcEtzI7L1m`, as in #351).
- docs.sweny.ai and cloud.sweny.ai: confirm Vercel Analytics is enabled on both projects before launch day.
- github.com links: GitHub does not report UTM parameters. Use Insights, Traffic (referring sites and popular
  content, 14-day window). Pull it at least every 14 days or the data is gone.
- cloud.sweny.ai: the waitlist count is the conversion.
