# JobFinder — local job-search funnel

A local Mac app that finds German job ads, ranks them against what you actually want, drafts tailored applications for your approval, and tracks every job through to an offer. All AI runs through your Claude Max subscription via the Claude Code CLI.

Visual prototype of the UI: [`design/prototype.html`](design/prototype.html)

---

## 1. Decisions so far

| Area | Decision |
|---|---|
| Sending | Claude drafts → you approve → it goes out |
| Volume | 30+ applications per week |
| Sources (v1) | Arbeitsagentur API, company career-page watchlist, Chrome search on portals |
| Interface | Local web app on `localhost`, SQLite, background worker |
| Language | Applications: same as the job ad (DE or EN). App UI: English |
| Email tracking | Later. v1: you move cards yourself |
| Materials | CV (PDF + Word), old cover letters, Zeugnisse/certificates |
| Target roles | Learned from example ads + keywords you enter |

---

## 2. Funnel

```
Sourced ─► Discover ─► Shortlist ─► Drafting ─► Review ─► Applied ─► In contact ─► Round 1 ─► Final
  (auto)   (triage)     (auto)      (Claude)    (you)     (auto)      (manual)      (manual)   (manual)
                                                                   └──────── Rejected / Ghosted / Withdrawn (any stage) ───┘
```

| Stage | What happens | Who moves it |
|---|---|---|
| **Sourced** | Raw ads arrive, get merged with duplicates, run through hard filters. Filtered-out ads stay visible in an "Excluded" list with the reason. | Worker |
| **Discover** | Scored ads, best first. Keyboard triage: **D** dream, **A** apply, **X** reject + reason, **S** skip. | You |
| **Shortlist** | Approved for applying. Queued for drafting, dream jobs first. | Worker |
| **Drafting** | Claude researches the company, writes the letter, tailors the CV, builds the PDF bundle, fact-checks. | Worker |
| **Review** | Side-by-side: ad ↔ letter. Edit, regenerate with an instruction, or approve. | You |
| **Applied** | Email ads: a ready Apple Mail draft with attachments is opened; you hit send. Portal ads: Chrome opens the form pre-filled; you press submit. Then you confirm "sent". | You (1 click) |
| **In contact** | Any reply that isn't a rejection: phone screen, video call, task. | You |
| **Round 1** | In-person interview scheduled. Triggers an interview prep pack. | You |
| **Final** | Final round / offer, for tracking. | You |
| **Closed** | Rejected, ghosted (auto-suggested after 21 days of silence), withdrawn. The reason is recorded and feeds learning. | You |

---

## 3. Architecture

```
┌──────────────────────────── Mac (all local) ──────────────────────────────┐
│                                                                            │
│  Next.js web app (localhost:4317)        Worker (Node, launchd agent)      │
│  ├─ UI (React, Tailwind v4, Motion)      ├─ source runners (cron-like)     │
│  ├─ API routes ───────┐                  ├─ job queue (SQLite table)       │
│  └─ SSE live updates  │                  ├─ Claude runner ──► `claude -p`  │
│                       ▼                  ├─ Chrome runner ──► Playwright   │
│                 SQLite (data/kompass.db) ◄┘  (own Chrome profile)          │
│                 files/ (CVs, PDFs, ad snapshots)                           │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Stack**

- **App:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui (restyled), Motion (`motion/react`), Lucide icons, `cmdk` for the command palette, `@dnd-kit` for the kanban board.
- **Data:** SQLite through `better-sqlite3` + Drizzle ORM. One file, easy to back up.
- **Worker:** a separate Node process started by a launchd agent so it runs while the browser is closed. It shares the DB with the app. Job queue = a `tasks` table with priority, retries, and a lock.
- **Claude:** the `claude` CLI in headless mode (`claude -p --output-format json --model <m>`), started as a child process. Every prompt lives in `prompts/*.md`, versioned. Output is validated against a Zod schema; one automatic retry on invalid JSON.
- **Browser:** Playwright driving a dedicated Chrome profile (`~/.kompass/chrome`). You log in to portals there once yourself. For hard pages, Claude runs headless with the Playwright MCP server and reads the page itself.
- **PDF:** HTML templates → PDF via Playwright print. `pdf-lib` merges Anschreiben + Lebenslauf + Zeugnisse into one file (≤ 5 MB, which most German portals require).
- **Local embeddings:** `transformers.js` with a small multilingual model (e.g. `multilingual-e5-small`) for duplicate detection and similarity to liked and rejected ads. No quota used.
- **Notifications:** macOS notifications via `osascript` for the morning digest and "action needed" (CAPTCHA, login wall, quota).

**Target machine:** the app is built here but runs on the job seeker's own Mac, with their own Claude Max account. Setup there: install the Claude Code CLI, run `claude` once and log in with that Max account, then install and start JobFinder. The app checks `claude --version` and the login state on startup, and onboarding guides through it if either is missing. Nothing in code or config may assume this development Mac (paths, user name, accounts).

---

## 4. Claude usage on a Max subscription

Max has rolling 5-hour windows and weekly caps. At 30+ applications a week plus hundreds of ads to score, quota is a real design constraint.

| Task | Model | Batching | Rough volume/week |
|---|---|---|---|
| Parse messy ad HTML → structured fields | Haiku | 1 ad per call (only when the source has no structured data) | ~100 |
| Score ads | Sonnet | 8–10 ads per call | ~60 calls |
| Profile reflection (learning) | Opus | 1 call nightly | 7 |
| Company research + letter + CV tailoring | Opus | 1 job per call | 30–40 |
| Fact-check pass | Sonnet | 1 per draft | 30–40 |
| Interview prep pack | Opus | on demand | few |

**Guards**

- Plain code runs first: deduplication, hard filters and the blocklist cost nothing and remove most ads before any Claude call.
- One Claude process at a time by default (configurable), so bursts don't burn the window.
- Every call is logged (`claude_runs`: model, duration, tokens if reported, outcome). On a rate-limit error the queue pauses until the window resets and shows a countdown in the sidebar.
- Queue priority: dream-job drafts > other drafts > scoring > research. Scoring yields to drafting when quota is low.
- Prompt caching for free: system prompt + profile + CV go first and stay identical across calls.

---

## 5. Sources

### 5.1 Arbeitsagentur API (primary, v1)

Public REST API of the Bundesagentur für Arbeit job board (documented at `jobsuche.api.bund.dev`; check the current endpoint and client-ID header when building). Search by keyword, place + radius, published-since, employment type, temp-agency flag. Ads come back structured (title, employer, place, dates, ref number); full text comes from the detail endpoint.

- Runs every 3 hours per search profile.
- Excludes temp agencies (Arbeitnehmerüberlassung) at the API level when the profile says so.

### 5.2 Company watchlist (v1)

You add companies. The app detects the applicant tracking system from the careers URL and uses its public feed:

| System | Feed |
|---|---|
| Personio | `{company}.jobs.personio.de/xml` |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` |
| Lever | `api.lever.co/v0/postings/{company}?mode=json` |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{id}/postings` |
| Recruitee | `{company}.recruitee.com/api/offers` |
| Softgarden, Workday, others | Chrome runner (5.3) on the careers page |

Runs daily. New ads from watchlist companies get a score boost and a "watchlist" badge.

### 5.3 Chrome search on portals (v1, rate-limited)

Covers StepStone, Indeed, LinkedIn, XING and careers pages without a feed.

- **Own Chrome profile** run by Playwright; you log in there yourself. The app never types passwords or creates accounts.
- **Human pace:** random 4–12 s between page loads, max ~40 pages per portal per day, runs at most twice a day, never in parallel on one portal.
- **Stops on friction:** on a CAPTCHA, login wall or "unusual traffic" page it stops that portal for the day, saves a screenshot, and notifies you. It never tries to get around them.
- **Extraction:** listing pages are parsed with per-portal selectors (fast, no quota). When selectors break, a Haiku call reads the page text instead, and the app shows a "selectors need update" warning.
- **Risk you accepted:** portal terms forbid scraping, and accounts can be restricted. Keep the pace low, and use LinkedIn search sparingly.

### 5.4 Manual ads (v1)

Ads found by hand: **Add job ad** (top bar, ⌘K, or key **N**) takes a link, or pasted text when the link needs a login or is a PDF/printed notice, plus an optional note (e.g. "referred by Jana").

- The link is fetched (plain HTTP first, Chrome runner if the page needs JavaScript), parsed by Haiku into the usual fields, deduplicated against existing jobs, and scored.
- Choice per ad: **Score it** (lands in Discover with a "Manual" badge) or **Apply right away** (straight to the Shortlist; Claude starts the draft).
- Adding an ad by hand is a strong positive signal for learning, like a dream-job mark at lower weight.
- If the domain is a careers page with a known ATS, JobFinder offers to add the company to the watchlist.

### 5.5 Later

- Gmail: job alert emails as a source + automatic stage changes from replies.
- Arbeitnow / other open APIs.

### 5.6 Deduplication

1. Exact: same source + source ID.
2. Strong: normalised company + normalised title + city.
3. Fuzzy: embedding similarity > 0.92 on title + first 500 chars, same company.

Merged ads keep all source links ("seen on StepStone, Indeed, Arbeitsagentur"). The best source for applying is chosen: the company's own careers page > Arbeitsagentur > portal. Reposted ads (same job, new date) get a "reposted ×3" badge, which is a negotiating signal.

---

## 6. Scoring and learning

### 6.1 Onboarding (first run, ~10 minutes)

1. Upload everything that exists on the **Unterlagen** (documents) screen: CV (Word + PDF), old cover letters, Zeugnisse, certificates, other files. Drag and drop or file picker, several at once; the category is guessed from the file name and can be changed. Documents can be added any time: a new cover letter refines the style guide, a new CV version is re-parsed and the fact changes are shown for review. Files stay in `data/files/`; only their text goes to Claude.
2. Claude parses the CV into `cv_master.json` (structured facts: roles, dates, skills, achievements with numbers). You check it once. **This is the only source of truth for any claim in a letter.**
3. Paste 5–10 ads you'd love and 5 you'd never take, each with a one-line reason (optional).
4. Set hard filters: places + commute radius, remote share, salary floor, languages, contract type, blocklist (companies, agencies, keywords).
5. Claude writes the first **preference profile**: a readable Markdown document ("Wants product-heavy roles in mid-size companies, dislikes agency work, values remote ≥ 2 days, …"). You edit it directly.

### 6.2 Scoring pipeline per ad

1. **Hard filters** (code): location/commute, salary if stated, language, contract type, blocklist, temp agency / recruiter detection (by keywords like "für unseren Kunden" and a list of known agencies). Fail → `excluded` with reason.
2. **Similarity prior** (local embeddings): distance to liked ads vs rejected ads → a 0–1 prior. Free; used for ordering before Claude scores.
3. **Claude score** (Sonnet, batched): input = profile + CV summary + 4 few-shot examples (2 recent dream/applied, 2 recent rejects with reasons) + the ads. Output per ad:

```json
{
  "score": 82,
  "dimensions": { "skills": 90, "seniority": 75, "domain": 80, "location": 95, "conditions": 70 },
  "reasons_for": ["Owns roadmap for B2B platform — matches 4 yrs at …"],
  "reasons_against": ["Asks for 5+ yrs Kubernetes; CV shows 2"],
  "red_flags": ["Salary not stated", "Reposted 3 times"],
  "language": "de",
  "apply_channel": "email | portal | ats_form",
  "summary": "one line"
}
```

4. **Final rank** = Claude score, adjusted slightly by watchlist boost, freshness (fresh ads first; ads over 30 days old drop) and the similarity prior.

### 6.3 Learning loop

- **Every action is a signal:** dream (+3), apply (+2), skip (0), reject with reason (−2), later stage outcomes (an interview invite is +, a fast rejection is a weak −).
- **Nightly reflection** (Opus): reads the last ~50 signals and the current profile, and proposes a new profile version with a short diff ("Learned: you reject consulting firms even at high scores"). Auto-applied, versioned, and revertible in Profile → History.
- **Few-shot examples** rotate so the newest preferences dominate.
- **Calibration chart** in Insights: score vs your decision. If you keep rejecting 80+ ads, the app says so and suggests profile edits.

---

## 7. Application drafting

### 7.1 Inputs

- The ad (full text + structured fields).
- **Company brief:** Claude reads the company website (about, news, careers pages via Playwright) and Kununu (rating, top pros/cons). Stored and reused for every job at that company.
- `cv_master.json` + Zeugnisse summary.
- **Style corpus:** your old letters → a style guide extracted once (sentence length, tone, typical openings, words you never use).
- Settings: salary expectation (range per role level), notice period, earliest start date, contact details.

### 7.2 Outputs

1. **Anschreiben / cover letter** in the ad's language, one page. No generic AI phrases; a banned-phrase list ("Hiermit bewerbe ich mich", "mit großem Interesse", "passionate", …) plus your style guide.
2. **Tailored CV:** same facts, reordered and re-emphasised for this ad (summary line, skill order, which achievements to show). Never adds facts.
3. **Answers** for portal fields: salary expectation, start date, "why us" (short), notice period.
4. **Bundle PDF:** letter + CV + selected Zeugnisse, file names like `Bewerbung_<Nachname>_<Firma>_<Stelle>.pdf`.

### 7.3 Fact-check (separate Sonnet call)

Every claim in the letter is checked against `cv_master.json`. In the Review screen each claim shows ✓ (backed by CV line X), ⚠ (rephrased or inferred), or ✗ (not in CV, blocks approval until edited).

### 7.4 Review UX for 30+/week

- A queue: the ad on the left with requirements highlighted where the letter covers them, the letter on the right, editable inline.
- **⌘↵** approve · **R** regenerate with a one-line instruction ("more about the data work", "shorter") · **E** edit · **J/K** next/previous.
- Target: under 90 seconds per application.

### 7.5 Sending

| Channel | v1 behaviour |
|---|---|
| Email | AppleScript creates an Apple Mail draft: recipient, subject, short body text, bundle attached. Opens it; you press send. |
| ATS form (Personio, Greenhouse…) | Chrome opens the apply page; Playwright fills known fields and uploads the files; stops before submit. You check and submit. |
| Portal with account (Workday, StepStone…) | The form opens; the answers panel lets you copy each field. Account creation and passwords stay with you. |

After submitting you click **Mark as sent** (or it's detected when the Mail draft leaves Outbox — later).

---

## 8. Beyond applying

- **Interview prep pack** (on move to Round 1): company brief, the people you'll meet (from the invitation, if you paste it), likely questions for this role, your matching examples from the CV in STAR form, questions to ask, salary range for role and city, travel time.
- **Follow-ups:** after 14 days in Applied with no movement, a short follow-up email is drafted for your review. After 21 more days → suggested "Ghosted".
- **Guards:** "already applied to this company in the last 6 months", "same job at a recruiter and directly — apply direct".
- **GDPR (DSGVO) cleanup:** on Closed, optionally draft a request to delete your data.
- **Insights:** funnel conversion, response rate by source / CV variant / letter length, time-to-response, score calibration.
- **Morning digest** at 08:00 (macOS notification + Today screen): new matches, drafts waiting, follow-ups due, interviews this week.

---

## 9. Data model (main tables)

| Table | Key fields |
|---|---|
| `search_profiles` | keywords, places, radius, filters, sources enabled |
| `companies` | name, normalised name, domain, ats_type, ats_token, watchlist, brief_md, kununu |
| `postings` | source, source_id, url, raw_html path, fetched_at, job_id (after merge) |
| `jobs` | company_id, title, location, remote, salary_min/max, language, text, published_at, stage, stage_changed_at, dream, apply_channel |
| `scores` | job_id, profile_version, score, dimensions json, reasons json, model |
| `signals` | job_id, kind (dream/apply/skip/reject/outcome), reason, created_at |
| `profile_versions` | version, markdown, diff_summary, created_by (you/claude) |
| `applications` | job_id, version, letter_md, cv_json, answers json, factcheck json, bundle_path, status, sent_at, channel |
| `events` | job_id, type, payload, at (timeline: stage moves, notes, emails) |
| `tasks` | type, payload, priority, status, attempts, locked_until, error |
| `claude_runs` | task_id, model, prompt_name, ms, ok, error, at |
| `documents` | kind (cv_word, cv_pdf, zeugnis, letter_sample), path, parsed json |

---

## 10. UI and design system

Goal: feels like a product a top agency shipped in 2026. Calm, fast, keyboard-first, dense where it matters, generous where it doesn't. See the prototype.

**Direction: "quiet power tool".** Warm graphite dark mode as the default, a warm paper light mode, one signal colour, serif display type for moments of emphasis, monospace numbers.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0B0B0C` | `#F6F5F1` | page |
| `--surface` | `#141416` | `#FFFFFF` | cards, panels |
| `--surface-2` | `#1B1B1E` | `#EFEEE9` | hover, inputs |
| `--border` | `rgba(255,255,255,.07)` | `rgba(20,20,10,.08)` | hairlines |
| `--text` | `#EDEDEF` | `#141416` | primary |
| `--text-2` | `#A3A3AB` | `#55555D` | secondary |
| `--accent` | `#D4FF3A` | `#D4FF3A` (fill) | primary actions, high scores |
| `--accent-fg` | `#D4FF3A` | `#4B6400` | accent used as text |
| `--dream` | `#FFB547` | `#B86E00` | dream job star |
| `--danger` / `--ok` / `--info` | coral / mint / periwinkle | darker tones | states, always with icon + label |

- **Type:** Geist (UI), Instrument Serif italic (display moments: greetings, empty states, big numbers' labels), Geist Mono with tabular figures (scores, dates, counts). Scale 12 / 13 / 14 / 16 / 20 / 28 / 44 / 64.
- **Shape and depth:** 14 px card radius, 10 px controls, pill tags. Hairline borders plus a 1 px inner top highlight instead of heavy shadows. Blur only behind overlays (command palette, drawers).
- **Texture:** a 3 % film-grain overlay and one soft accent glow on Today. Nothing else decorative.
- **Motion:** spring-based (Motion), 150–250 ms; triage cards fly out in the direction of the decision; kanban cards lift on drag; list entries stagger 30 ms. All disabled under `prefers-reduced-motion`.
- **Signature elements:** score ring (colour + number + label, never colour alone); company monogram tiles; keyboard hints as `kbd` chips on every primary action; live agent activity feed ("Scoring 12 ads from Arbeitsagentur…").
- **Navigation:** left sidebar (Today, Discover, Pipeline, Review, Insights, Unterlagen/Documents, Sources, Profile) with badges; ⌘K command palette for everything (jump to job, move stage, run source, switch theme). Every screen and job has a URL.
- **Accessibility:** WCAG AA contrast in both themes, visible focus rings in accent, full keyboard operation including kanban (move with `[` / `]`), screen-reader labels on icon buttons, respects reduced motion.
- **Responsive:** built for laptop/desktop; below 860 px the sidebar becomes a bottom bar and the board columns stack.

**Implementation:** shadcn/ui components restyled with these tokens (Tailwind v4 `@theme`), Motion for animation, `cmdk`, `@dnd-kit`, Lucide icons at 1.5 px stroke. The tokens live in one `app/globals.css`; no raw hex in components.

---

## 11. Project layout

```
kompass/
├─ app/                    Next.js routes: today, discover, pipeline, review, insights, sources, profile, jobs/[id]
├─ components/             ui/ (restyled shadcn), score-ring, kanban, triage-card, letter-editor, command-menu
├─ lib/db/                 drizzle schema, migrations
├─ lib/claude/             runner (spawn `claude -p`), schemas (zod), quota tracker
├─ lib/sources/            arbeitsagentur.ts, ats/{personio,greenhouse,lever,smartrecruiters,recruitee}.ts, chrome/{stepstone,indeed,linkedin,xing}.ts
├─ lib/pipeline/           dedupe, filters, scoring, drafting, factcheck, pdf, send
├─ worker/                 index.ts (task loop), schedules.ts
├─ prompts/                score.md, draft-letter.md, tailor-cv.md, factcheck.md, reflect-profile.md, company-brief.md, prep-pack.md
├─ templates/              letter.html, cv.html (print CSS)
├─ data/                   kompass.db, files/ (gitignored, holds your CV and personal data)
└─ design/prototype.html   visual reference
```

`data/` and anything personal stays out of git.

---

## 12. Build phases

| Phase | Scope | Usable result |
|---|---|---|
| **0 · Setup** (½ day) | Install Claude Code CLI + log in; scaffold Next.js, Tailwind tokens, DB schema, worker skeleton, Claude runner with a smoke test | App starts; `claude -p` works from the worker |
| **1 · Find** (2–3 days) | Arbeitsagentur source, watchlist + ATS feeds, dedupe, hard filters, Discover triage UI, job detail, Sources screen | Daily stream of real, de-duplicated ads you can triage by keyboard |
| **2 · Rank & learn** (2 days) | Unterlagen screen (upload, categories, parsing), onboarding (CV parse, example ads, filters), profile, batched Sonnet scoring, signals, nightly reflection, profile history | Ads arrive sorted by fit with reasons; it improves as you triage |
| **3 · Apply** (3–4 days) | Company brief, style guide, letter + CV tailoring, fact-check, PDF bundle, Review screen, Mail draft + ATS pre-fill | 30+/week applications at < 90 s review each |
| **4 · Chrome sources** (2 days) | Playwright profile, StepStone/Indeed/XING/LinkedIn runners, friction detection, notifications | Portal ads in the same stream |
| **5 · Track** (2 days) | Pipeline kanban with drag + keys, timeline, follow-up drafts, ghosting, interview prep pack, Today digest, Insights | Full funnel to Final with analytics |
| **Later** | Gmail: alert emails as a source, automatic stage changes, sending without Apple Mail; salary research; DSGVO requests | |

---

## 13. Open questions

- Commute: home location and maximum travel time?
- Salary floor and expectation range to state in applications?
- Notice period / earliest start date?
- Photo on the CV (still common in Germany, optional)?
- Which 10–20 companies go on the watchlist first?

---

## 14. As built (where the implementation differs from this plan)

| Plan | Built | Why |
|---|---|---|
| Drizzle + better-sqlite3 | Node's built-in `node:sqlite` with a small typed helper (`lib/db.ts`) | No native module to compile on the target Mac |
| Tailwind + shadcn/ui + Motion + cmdk + dnd-kit | The prototype's CSS design system ported 1:1 (`app/globals.css`), own command palette, native drag & drop | Matches the approved design exactly with far fewer dependencies |
| Local embeddings (transformers.js) | TF-IDF cosine similarity (`lib/text.ts`) for dedupe and the like/dislike prior | No 100 MB model download; good enough at this volume. Embeddings can replace `similarity()` later |
| Server-sent events for live updates | The UI refreshes every 6 s while visible | Simpler; no long-lived connections |
| Separate review of "sent" | Approve opens Mail draft / pre-filled form; the job moves to Applied when you press "Mark as sent" | You stay in control of the actual send |

Not built yet (still "Later"): Gmail alerts as a source and automatic stage changes from replies, salary research, GDPR deletion requests.
