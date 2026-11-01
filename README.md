# Kompass

A local job-search funnel for the German market: finds ads (Arbeitsagentur API, company career feeds, optional Chrome search on portals, links you add yourself), ranks them against what you actually want, drafts tailored applications you approve with one keystroke, and tracks every job to an offer. AI runs on a Claude Max subscription through the Claude Code CLI.

- **Set up:** [SETUP.md](SETUP.md)
- **How it works and why:** [PLAN.md](PLAN.md)
- **Design reference:** [design/prototype.html](design/prototype.html)

```bash
npm install && npx playwright install chromium && npm start
```
```bash
npm test
```
