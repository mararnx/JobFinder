import { all, get, getSettings, logEvent, run } from "@/lib/db";
import { claude, renderPrompt } from "@/lib/claude/runner";
import { ProfileDoc, ScoreBatch } from "@/lib/claude/schemas";
import { JOB_SELECT, type JobRow } from "@/lib/jobs";
import { currentProfile, cvSummary, saveProfile, searchKeywords } from "@/lib/profile";
import { enqueue, PRIORITY } from "@/lib/queue";
import { similarity, truncate } from "@/lib/text";

const BATCH = 8;

function hardFacts(): string {
  const s = getSettings();
  return [
    s.home && `Lives in ${s.home}; max commute about ${s.commuteKm} km`,
    s.remoteMin ? `Wants at least ${s.remoteMin} remote days per week` : "",
    s.salaryFloor ? `Salary floor ${s.salaryFloor} € gross/year; expectation ${s.salaryExpectation || "n/a"}` : "",
    `Works in: ${s.languages.join(", ").toUpperCase()}`,
    s.excludeAgencies ? "Does not want recruiter/temp-agency positions" : "",
    `Search keywords: ${searchKeywords().join(", ") || "none set"}`,
  ].filter(Boolean).join("\n");
}

function signalTexts(kinds: string[], limit = 30): string {
  return all<{ title: string; description: string }>(
    `SELECT j.title, j.description FROM signals s JOIN jobs j ON j.id = s.job_id WHERE s.kind IN (${kinds.map(() => "?").join(",")}) ORDER BY s.id DESC LIMIT ${limit}`,
    kinds,
  ).map((r) => `${r.title}\n${r.description.slice(0, 800)}`).join("\n\n");
}

function examples(): string {
  const rows = all<{ kind: string; reason: string | null; title: string; company: string; score: number | null }>(
    `SELECT s.kind, s.reason, j.title, c.name AS company, j.score FROM signals s JOIN jobs j ON j.id = s.job_id JOIN companies c ON c.id = j.company_id
     WHERE s.kind IN ('dream','apply','reject','manual') ORDER BY s.id DESC LIMIT 40`,
  );
  const pick = [...rows.filter((r) => r.kind !== "reject").slice(0, 2), ...rows.filter((r) => r.kind === "reject").slice(0, 2)];
  if (!pick.length) return "(no decisions yet)";
  return pick.map((r) => `- ${r.kind.toUpperCase()}: “${r.title}” at ${r.company}${r.score != null ? ` (scored ${r.score})` : ""}${r.reason ? ` — reason: ${r.reason}` : ""}`).join("\n");
}

/** Scores up to BATCH new jobs in one Claude call; queues another batch if more are waiting. */
export async function scoreBatch(): Promise<number> {
  const jobs = all<JobRow>(`${JOB_SELECT} WHERE j.stage = 'new' ORDER BY j.manual DESC, j.found_at ASC LIMIT ${BATCH}`);
  if (!jobs.length) return 0;
  const liked = signalTexts(["dream", "apply", "manual"]);
  const disliked = signalTexts(["reject"]);
  const profile = currentProfile();
  const ads = jobs.map((j) => ({
    id: j.id, title: j.title, company: j.company, location: j.location, remote: j.remote, salary_min: j.salary_min, is_agency: j.is_agency,
    repost_count: j.repost_count, description: truncate(j.description, 3500),
  }));
  const adsText = ads.map((a) => `<ad id="${a.id}">\nTitle: ${a.title}\nCompany: ${a.company}\nLocation: ${a.location ?? "?"} · Remote: ${a.remote ?? "not stated"}\n${a.is_agency ? "Posted by a recruiter/agency\n" : ""}${a.repost_count ? `Reposted ${a.repost_count}×\n` : ""}\n${a.description}\n</ad>`).join("\n\n");
  const res = await claude({
    name: "score",
    model: "sonnet",
    schema: ScoreBatch,
    prompt: renderPrompt("score", {
      profile: profile?.markdown ?? "(no profile yet — rely on the search keywords and CV)",
      facts: hardFacts(),
      cv: cvSummary(),
      examples: examples(),
      ads: adsText,
    }),
    mockInput: { ads: ads.map((a) => ({ ...a, company: a.company })), keywords: searchKeywords(), liked, disliked },
  });
  const byId = new Map(res.results.map((r) => [r.id, r]));
  for (const j of jobs) {
    const r = byId.get(j.id);
    if (!r) continue; // left 'new'; picked up by the next batch
    const prior = liked || disliked ? similarity(j.description, liked) - similarity(j.description, disliked) : 0;
    const ageDays = j.published_at ? (Date.now() - Date.parse(j.published_at)) / 86_400_000 : 0;
    const adjusted = Math.max(0, Math.min(100, Math.round(r.score + (j.watchlist ? 3 : 0) + (ageDays > 30 ? -5 : 0) + prior * 5)));
    run("UPDATE jobs SET stage = 'discover', stage_changed_at = datetime('now'), score = ?, prior = ?, score_json = ?, scored_version = ?, apply_channel = COALESCE(apply_channel, ?), language = ? WHERE id = ? AND stage = 'new'", [
      adjusted, prior, JSON.stringify(r), profile?.version ?? 0, r.apply_channel, r.language, j.id,
    ]);
    logEvent(j.id, "scored", `Scored ${adjusted}`);
  }
  if (get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'new'")!.n > 0) enqueue("score_batch", {}, { priority: PRIORITY.score, dedupeKey: "score_batch" });
  return byId.size;
}

/** Nightly: rewrite the preference profile from recent decisions. Skips when there is too little new evidence. */
export async function reflectProfile(force = false): Promise<string | null> {
  const profile = currentProfile();
  if (!profile) return null;
  const rows = all<{ kind: string; reason: string | null; title: string; company: string; score: number | null; at: string }>(
    `SELECT s.kind, s.reason, j.title, c.name AS company, j.score, s.created_at AS at FROM signals s JOIN jobs j ON j.id = s.job_id JOIN companies c ON c.id = j.company_id
     ORDER BY s.id DESC LIMIT 50`,
  );
  const fresh = rows.filter((r) => r.at > profile.created_at).length;
  if (!force && fresh < 5) return null;
  const signals = rows.map((r) => `- ${r.at.slice(0, 10)} ${r.kind.toUpperCase()} “${r.title}” at ${r.company}${r.score != null ? ` (score ${r.score})` : ""}${r.reason ? ` — ${r.reason}` : ""}`).join("\n");
  const res = await claude({
    name: "reflect-profile",
    model: "opus",
    schema: ProfileDoc,
    prompt: renderPrompt("reflect-profile", { version: profile.version, profile: profile.markdown, signals }),
    mockInput: { profile: profile.markdown, reasons: rows.filter((r) => r.kind === "reject").map((r) => r.reason) },
  });
  if (res.markdown.trim() === profile.markdown.trim()) return null;
  const v = saveProfile(res.markdown, "claude", res.diff_summary);
  logEvent(null, "profile", `Profile v${v}: ${res.diff_summary}`);
  return res.diff_summary;
}

export async function initialProfile(liked: { text: string; reason: string }[], disliked: { text: string; reason: string }[]) {
  const s = getSettings();
  const fmt = (xs: { text: string; reason: string }[]) => xs.map((x, i) => `<ad n="${i + 1}" reason="${x.reason.replace(/"/g, "'")}">\n${truncate(x.text, 2500)}\n</ad>`).join("\n") || "(none given)";
  const filters = `Home: ${s.home || "?"}, commute ${s.commuteKm} km, remote min ${s.remoteMin} days, salary floor ${s.salaryFloor || "none"}, agencies ${s.excludeAgencies ? "excluded" : "ok"}, blocked keywords: ${s.blockKeywords.join(", ") || "none"}`;
  const firstLine = (t: string) => t.split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? "";
  const res = await claude({
    name: "initial-profile",
    model: "opus",
    schema: ProfileDoc,
    prompt: renderPrompt("initial-profile", { cv: cvSummary(), liked: fmt(liked), disliked: fmt(disliked), filters }),
    mockInput: { likedTitles: liked.map((l) => firstLine(l.text)), dislikedTitles: disliked.map((d) => firstLine(d.text)), filters: `- ${filters}` },
  });
  return saveProfile(res.markdown, "claude", res.diff_summary || "First version");
}
