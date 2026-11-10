import { all, get, getSettings, logEvent, run } from "@/lib/db";
import { claude, renderPrompt } from "@/lib/claude/runner";
import { AlertJobs, ParsedAd } from "@/lib/claude/schemas";
import { addSignal, ingest, type RawJob, setStage } from "@/lib/jobs";
import { notify } from "@/lib/notify";
import { searchKeywords, searchProfiles } from "@/lib/profile";
import { enqueue, meta, PRIORITY, setMeta } from "@/lib/queue";
import { normCompany, stripHtml, truncate } from "@/lib/text";
import { fetchJobroom } from "@/lib/sources/jobroom";
import { detectAts, fetchAts } from "@/lib/sources/ats";
import { FrictionError, readPage, runCareersPage, runPortal } from "@/lib/sources/chrome";
import { jobPostingFromHtml, PORTALS, type Portal } from "@/lib/sources/extract";
import { alertJobId, mailBody, mailLinks, portalOf, readAlertLabel, type AlertMail } from "@/lib/sources/alerts";
import { fetchAdzuna, fetchJooble } from "@/lib/sources/apis";
import { FEED_FETCHERS, FEEDS, type Feed } from "@/lib/sources/feeds";
import { fetchText } from "@/lib/sources/http";

const known = (source: string) => (id: string) => !!get("SELECT 1 FROM postings WHERE source = ? AND source_id = ?", [source, id]);

function startRun(source: string) {
  return run("INSERT INTO source_runs(source) VALUES (?)", [source]).lastInsertRowid;
}

function endRun(id: number, status: "ok" | "error" | "blocked", found: number, added: number, message?: string) {
  run("UPDATE source_runs SET finished_at = datetime('now'), status = ?, found = ?, added = ?, message = ? WHERE id = ?", [status, found, added, message ?? null, id]);
}

function ingestAll(raws: RawJob[]) {
  let added = 0;
  for (const r of raws) {
    try {
      if (ingest(r).created) added++;
    } catch (e) {
      console.error("ingest failed", r.source, r.sourceId, e);
    }
  }
  if (added) enqueue("score_batch", {}, { priority: PRIORITY.score, dedupeKey: "score_batch" });
  return added;
}

/** Claude reads a page that has no structured JobPosting data. */
export async function parsePageWithClaude(html: string, url: string, source: string): Promise<RawJob | null> {
  const text = truncate(stripHtml(html), 14000);
  if (text.length < 200) return null;
  const p = await claude({ name: "parse-ad", model: "haiku", schema: ParsedAd, prompt: renderPrompt("parse-ad", { url, text }), mockInput: { url, text } });
  return { source, sourceId: url, url: p.apply_url || url, title: p.title, company: p.company, location: p.location, remote: p.remote, salaryText: p.salary_text, description: p.description, language: p.language, applyEmail: p.apply_email, employmentType: p.employment_type };
}

/** Job-Room, the Swiss employment service's job portal (RAV ads plus a large jobs.ch feed). */
export async function runJobroom(): Promise<string> {
  const profiles = searchProfiles().filter((p) => p.enabled);
  if (!profiles.length) return "No search profile yet";
  const id = startRun("jobroom");
  const firstRun = !get("SELECT 1 FROM source_runs WHERE source = 'jobroom' AND status = 'ok'");
  let found = 0, added = 0;
  try {
    for (const p of profiles) {
      for (const kw of p.keywords) {
        const raws = await fetchJobroom({ keyword: kw, location: p.location, radiusKm: p.radius_km, days: firstRun ? 28 : 7 }, known("jobroom"), firstRun ? 2 : 1);
        found += raws.length;
        added += ingestAll(raws);
      }
    }
    endRun(id, "ok", found, added);
    return `Job-Room: ${added} new of ${found}`;
  } catch (e) {
    endRun(id, "error", found, added, String(e instanceof Error ? e.message : e));
    throw e;
  }
}

/** Adzuna and Jooble, when the job seeker has added their free keys. */
export async function runApis(): Promise<string> {
  const s = getSettings();
  const profiles = searchProfiles().filter((p) => p.enabled);
  if (!profiles.length) return "No search profile yet";
  const apis = [
    s.adzunaAppId && s.adzunaAppKey ? (["adzuna", (q: Parameters<typeof fetchAdzuna>[2]) => fetchAdzuna(s.adzunaAppId, s.adzunaAppKey, q)] as const) : null,
    s.joobleKey ? (["jooble", (q: Parameters<typeof fetchJooble>[1]) => fetchJooble(s.joobleKey, q)] as const) : null,
  ].filter((x) => x !== null);
  if (!apis.length) return "No API keys";
  const firstRun = (src: string) => !get("SELECT 1 FROM source_runs WHERE source = ? AND status = 'ok'", [src]);
  const parts: string[] = [];
  for (const [src, fetchFn] of apis) {
    const id = startRun(src);
    let found = 0, added = 0;
    try {
      for (const p of profiles) for (const kw of p.keywords) {
        const raws = await fetchFn({ keyword: kw, location: p.location, radiusKm: p.radius_km, days: firstRun(src) ? 28 : 7, isKnown: known(src) });
        found += raws.length;
        added += ingestAll(raws);
      }
      endRun(id, "ok", found, added);
      parts.push(`${src} ${added}/${found}`);
    } catch (e) {
      endRun(id, "error", found, added, e instanceof Error ? e.message : String(e));
      parts.push(`${src} failed`);
    }
  }
  return `APIs: ${parts.join(" · ")}`;
}

/** Jobs from portal alert emails under the Gmail label chosen in Sources. */
export async function runAlerts(readFn: (label: string, days: number) => Promise<AlertMail[]> = readAlertLabel): Promise<string> {
  const { alertsLabel, gmailAddress } = getSettings();
  const box = alertsLabel.trim();
  if (!box || !gmailAddress || (process.env.KOMPASS_DRY_SEND && readFn === readAlertLabel)) return "Job alerts off";
  const id = startRun("alerts");
  const seen = new Set<string>(JSON.parse(meta("alertsSeen") ?? "[]") as string[]);
  let found = 0, added = 0, mails = 0;
  try {
    for (const m of await readFn(box, seen.size ? 3 : 7)) {
      if (seen.has(m.id)) continue;
      mails++;
      const { html, text } = mailBody(m.source);
      const links = html ? mailLinks(html) : [];
      const r = await claude({
        name: "parse-alert", model: "haiku", schema: AlertJobs,
        prompt: renderPrompt("parse-alert", { sender: m.sender, subject: m.subject, links: links.slice(0, 200).map((l) => `${l.text} → ${l.url}`).join("\n") || "(none)", text: truncate(text, 12000) }),
        mockInput: { html: html ?? "", sender: m.sender },
      });
      const raws: RawJob[] = r.jobs.filter((j) => j.title && /^https?:/.test(j.url)).map((j) => {
        const portal = portalOf(m.sender, j.url);
        return {
          source: `alert-${portal}`, sourceId: alertJobId(j.url, portal), url: j.url, title: j.title, company: j.company || "Unknown company", location: j.location,
          description: [j.snippet, `From a ${portal === "other" ? "" : `${PORTALS[portal].name} `}job alert: ${m.subject}`].filter(Boolean).join("\n\n"),
        };
      }); // no keyword filter: the alerts are searches she set up herself
      found += raws.length;
      added += ingestAll(raws);
      seen.add(m.id);
    }
    setMeta("alertsSeen", JSON.stringify([...seen].slice(-1000)));
    endRun(id, "ok", found, added, `${mails} new email${mails === 1 ? "" : "s"}`);
    return `Job alerts: ${added} new of ${found} from ${mails} email${mails === 1 ? "" : "s"}`;
  } catch (e) {
    setMeta("alertsSeen", JSON.stringify([...seen].slice(-1000)));
    endRun(id, "error", found, added, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** The public job feeds (SwissDevJobs), filtered by every enabled search profile. */
export async function runFeeds(): Promise<string> {
  const profiles = searchProfiles().filter((p) => p.enabled);
  if (!profiles.length) return "No search profile yet";
  const parts: string[] = [];
  for (const feed of Object.keys(FEEDS) as Feed[]) {
    const id = startRun(feed);
    let found = 0, added = 0;
    try {
      for (const p of profiles) {
        const raws = await FEED_FETCHERS[feed]({ keywords: p.keywords, location: p.location, isKnown: (src, sid) => known(src)(sid) });
        found += raws.length;
        added += ingestAll(raws);
      }
      endRun(id, "ok", found, added);
      parts.push(`${FEEDS[feed]} ${added}/${found}`);
    } catch (e) {
      endRun(id, "error", found, added, e instanceof Error ? e.message : String(e));
      parts.push(`${FEEDS[feed]} failed`);
    }
  }
  return `Feeds: ${parts.join(" · ")}`;
}

export async function runWatchlist(): Promise<string> {
  const companies = all<{ id: number; name: string; ats_type: string | null; ats_token: string | null; careers_url: string | null }>("SELECT id, name, ats_type, ats_token, careers_url FROM companies WHERE watchlist = 1");
  if (!companies.length) return "Watchlist empty";
  const kws = searchKeywords();
  const id = startRun("watchlist");
  let found = 0, added = 0;
  const errors: string[] = [];
  for (const c of companies) {
    try {
      let raws: RawJob[];
      if (c.ats_type && c.ats_type !== "page") raws = await fetchAts(c.ats_type as never, c.ats_token!, { company: c.name, keywords: kws });
      else if (c.careers_url && getSettings().chromeEnabled) raws = await runCareersPage(c.careers_url, c.name, kws, known("page"), (h, u) => parsePageWithClaude(h, u, "page"));
      else continue;
      raws = raws.map((r) => ({ ...r, company: c.name }));
      found += raws.length;
      added += ingestAll(raws);
    } catch (e) {
      errors.push(`${c.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  endRun(id, errors.length && !found ? "error" : "ok", found, added, errors.join(" · ") || undefined);
  return `Watchlist: ${added} new of ${found}${errors.length ? ` (${errors.length} error)` : ""}`;
}

export async function runChromePortal(portal: Portal): Promise<string> {
  const s = getSettings();
  if (!s.chromeEnabled) return "Chrome search is off";
  // LinkedIn rate-limits quickly: one gentle run a day
  if (portal === "linkedin" && get("SELECT 1 FROM source_runs WHERE source = 'linkedin' AND started_at > datetime('now', 'start of day')")) return "LinkedIn: already searched today";
  const id = startRun(portal);
  let found = 0, added = 0;
  try {
    for (const p of searchProfiles().filter((x) => x.enabled)) {
      for (const kw of p.keywords) {
        const raws = await runPortal({ portal, keyword: kw, location: p.location, radiusKm: p.radius_km, budget: s.chromeDailyPages, isKnown: known(portal), maxDetails: portal === "linkedin" ? 5 : 10 }, (h, u) => parsePageWithClaude(h, u, portal));
        found += raws.length;
        added += ingestAll(raws);
      }
    }
    endRun(id, "ok", found, added);
    return `${PORTALS[portal].name}: ${added} new of ${found}`;
  } catch (e) {
    if (e instanceof FrictionError) {
      endRun(id, "blocked", found, added, e.reason);
      logEvent(null, "source", `${PORTALS[portal].name}: ${e.reason} – paused for today`);
      notify(`${PORTALS[portal].name} needs you`, `${e.reason}. Search paused for today.`);
      return `${PORTALS[portal].name}: ${e.reason}`;
    }
    endRun(id, "error", found, added, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** A job ad the job seeker found themselves: link and/or pasted text. */
export async function addManualAd(o: { url?: string; text?: string; html?: string; note?: string; applyNow?: boolean }): Promise<number> {
  let raw: RawJob | null = null;
  const url = o.url?.trim() || null;
  // the page as the job seeker saw it in their own browser ("Add to JobFinder" button): no fetching, nothing to block
  if (url && o.html) raw = jobPostingFromHtml(o.html, url, "manual") ?? (await parsePageWithClaude(o.html, url, "manual"));
  if (url && !raw) {
    try {
      const r = await fetchText(url, { timeoutMs: 20_000 });
      if (r.status === 200) raw = jobPostingFromHtml(r.text, r.finalUrl, "manual") ?? (stripHtml(r.text).length > 600 ? await parsePageWithClaude(r.text, r.finalUrl, "manual") : null);
    } catch { /* try the browser below */ }
    if (!raw && getSettings().chromeEnabled) {
      try {
        const p = await readPage(url);
        raw = jobPostingFromHtml(p.html, p.finalUrl, "manual") ?? (await parsePageWithClaude(p.html, p.finalUrl, "manual"));
      } catch { /* fall back to pasted text */ }
    }
  }
  if (!raw && o.text?.trim()) {
    const p = await claude({ name: "parse-ad", model: "haiku", schema: ParsedAd, prompt: renderPrompt("parse-ad", { url: url ?? "(pasted text)", text: truncate(o.text, 14000) }), mockInput: { url: url ?? "", text: o.text } });
    raw = { source: "manual", sourceId: url ?? `text:${Date.now()}`, url, title: p.title, company: p.company, location: p.location, remote: p.remote, salaryText: p.salary_text, description: p.description, language: p.language, applyEmail: p.apply_email, employmentType: p.employment_type };
  }
  if (!raw) throw new Error(url ? "Could not read that page. Paste the ad text instead." : "Paste a link or the ad text.");
  const res = ingest({ ...raw, source: "manual", sourceId: url ?? raw.sourceId, url: url ?? raw.url }, { manual: true, note: o.note ?? null });
  if (o.applyNow) {
    addSignal(res.jobId, "apply", null);
    setStage(res.jobId, "shortlist");
    run("UPDATE jobs SET prep_sub = 'queued' WHERE id = ?", [res.jobId]);
    enqueue("draft", { jobId: res.jobId }, { priority: PRIORITY.draft, dedupeKey: `draft:${res.jobId}` });
  } else if (res.created) {
    enqueue("score_batch", {}, { priority: PRIORITY.manual, dedupeKey: "score_batch" });
  }
  return res.jobId;
}

/** Portals the Chrome search visits (Settings → chromePortals). */
export function chromePortals(): Portal[] {
  const on = getSettings().chromePortals;
  return (Object.keys(PORTALS) as Portal[]).filter((p) => on.includes(p));
}

export function watchlistAdd(name: string, careersUrl: string) {
  const { type, token } = detectAts(careersUrl);
  const host = (() => {
    try {
      return new URL(careersUrl.startsWith("http") ? careersUrl : `https://${careersUrl}`).hostname;
    } catch {
      return null;
    }
  })();
  const domain = host && !/greenhouse|lever|personio|smartrecruiters|recruitee/.test(host) ? host.replace(/^(karriere|jobs|careers|career)\./, "") : null;
  const norm = name.toLowerCase();
  const existing = get<{ id: number }>("SELECT id FROM companies WHERE lower(name) = ?", [norm]);
  if (existing) run("UPDATE companies SET watchlist = 1, ats_type = ?, ats_token = ?, careers_url = ?, domain = COALESCE(domain, ?) WHERE id = ?", [type, token, careersUrl, domain, existing.id]);
  else {
    run("INSERT INTO companies(name, norm, domain, ats_type, ats_token, careers_url, watchlist) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(norm) DO UPDATE SET watchlist = 1, ats_type = excluded.ats_type, ats_token = excluded.ats_token, careers_url = excluded.careers_url", [
      name, normCompany(name) || norm, domain, type, token, careersUrl,
    ]);
  }
  enqueue("fetch_source", { source: "watchlist" }, { priority: PRIORITY.userAction, dedupeKey: "fetch:watchlist" });
  return type;
}
