import { all, get, getSettings, logEvent, run, tx, type Settings } from "@/lib/db";
import { cleanTitle, detectLanguage, extractEmail, looksLikeAgency, normCompany, normTitle, parseSalary, similarity } from "@/lib/text";

export type RawJob = {
  source: string; // "jobroom" | "greenhouse" | "manual" | "jobsch" …
  sourceId: string;
  url?: string | null;
  title: string;
  company: string;
  location?: string | null;
  remote?: string | null;
  salaryText?: string | null;
  description: string;
  publishedAt?: string | null;
  language?: "de" | "en" | "fr" | "it" | null;
  applyEmail?: string | null;
  employmentType?: string | null;
  companyDomain?: string | null;
};

export const STAGES = ["new", "excluded", "discover", "later", "shortlist", "drafting", "review", "ready", "applied", "contact", "round1", "final", "closed"] as const;
export type Stage = (typeof STAGES)[number];

/** Board columns: the three machine prep stages collapse into one column. */
export const BOARD = [
  { key: "prep", name: "Preparing", stages: ["shortlist", "drafting", "review"] },
  { key: "ready", name: "Ready to send", stages: ["ready"] },
  { key: "applied", name: "Applied", stages: ["applied"] },
  { key: "contact", name: "In contact", stages: ["contact"] },
  { key: "round1", name: "Round 1", stages: ["round1"] },
  { key: "final", name: "Final", stages: ["final"] },
] as const;

export type JobRow = {
  id: number; company_id: number; company: string; title: string; location: string | null; remote: string | null;
  salary_min: number | null; salary_max: number | null; salary_text: string | null; language: string | null;
  description: string; url: string | null; apply_email: string | null; apply_channel: string | null;
  employment_type: string | null; is_agency: number; published_at: string | null; found_at: string;
  stage: Stage; stage_changed_at: string; prep_sub: string | null; closed_reason: string | null; excluded_reason: string | null;
  dream: number; manual: number; note: string | null; score: number | null; prior: number | null; score_json: string | null;
  repost_count: number; next_action: string | null; next_action_at: string | null; watchlist: number; sources: string | null;
};

export const JOB_SELECT = `
  SELECT j.*, c.name AS company, c.watchlist AS watchlist,
    (SELECT group_concat(DISTINCT p.source) FROM postings p WHERE p.job_id = j.id) AS sources
  FROM jobs j JOIN companies c ON c.id = j.company_id`;

export function getJob(id: number): JobRow | undefined {
  return get<JobRow>(`${JOB_SELECT} WHERE j.id = ?`, [id]);
}

export function ensureCompany(name: string, domain?: string | null): number {
  const norm = normCompany(name) || name.toLowerCase().trim();
  const existing = get<{ id: number; domain: string | null }>("SELECT id, domain FROM companies WHERE norm = ?", [norm]);
  if (existing) {
    if (domain && !existing.domain) run("UPDATE companies SET domain = ? WHERE id = ?", [domain, existing.id]);
    return existing.id;
  }
  return run("INSERT INTO companies(name, norm, domain) VALUES (?, ?, ?)", [name.trim(), norm, domain ?? null]).lastInsertRowid;
}

/** Applies hard filters. Returns a reason when the job should be excluded. */
export function hardFilter(job: { title: string; description: string; company: string; salary_max: number | null; language: string | null; is_agency: number; company_blocked?: number }, s: Settings = getSettings()): string | null {
  if (job.company_blocked) return "Company on your blocklist";
  if (s.excludeAgencies && job.is_agency) return "Recruiter / temp agency";
  const blob = `${job.title}\n${job.description}`.toLowerCase();
  const kw = s.blockKeywords.find((k) => k.trim() && blob.includes(k.toLowerCase().trim()));
  if (kw) return `Blocked keyword “${kw}”`;
  if (s.salaryFloor && job.salary_max && job.salary_max < s.salaryFloor) return `Salary below your floor (${job.salary_max.toLocaleString("de-CH")} CHF)`;
  if (job.language && s.languages.length && !s.languages.includes(job.language)) return `Ad language ${job.language.toUpperCase()} not in your languages`;
  return null;
}

/** Finds an existing job this raw posting duplicates. */
function findDuplicate(companyId: number, title: string, location: string | null, description: string): { id: number; found_at: string } | undefined {
  const nt = normTitle(title);
  const candidates = all<{ id: number; norm_title: string; location: string | null; description: string; found_at: string }>(
    "SELECT id, norm_title, location, description, found_at FROM jobs WHERE company_id = ? AND stage != 'closed' ORDER BY id DESC LIMIT 200",
    [companyId],
  );
  const city = (l: string | null) => (l ?? "").toLowerCase().split(/[,(]/)[0].trim();
  for (const c of candidates) {
    const sameCity = !location || !c.location || city(location) === city(c.location);
    if (c.norm_title === nt && sameCity) return c;
  }
  // same title at a company whose name is a variant of this one ("Signal Iduna" vs "Signal Iduna Krankenversicherung")
  const norm = get<{ norm: string }>("SELECT norm FROM companies WHERE id = ?", [companyId])!.norm;
  const first = norm.split(" ")[0];
  if (first.length > 3) {
    const variant = get<{ id: number; found_at: string }>(
      `SELECT j.id, j.found_at FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.norm_title = ? AND j.company_id != ? AND j.stage != 'closed' AND (c.norm LIKE ? || ' %' OR ? LIKE c.norm || ' %' OR c.norm = ?)
       AND (? IS NULL OR j.location IS NULL OR lower(j.location) LIKE lower(?) || '%') LIMIT 1`,
      [nt, companyId, norm, norm, norm, location, (location ?? "").split(/[,(]/)[0].trim()],
    );
    if (variant) return variant;
  }
  const head = `${title}\n${description.slice(0, 600)}`;
  for (const c of candidates) {
    if (similarity(head, `${c.norm_title}\n${c.description.slice(0, 600)}`) > 0.86) return c;
  }
  return undefined;
}

export type IngestResult = { jobId: number; created: boolean; merged: boolean; excluded: string | null };

export function ingest(raw: RawJob, opts: { manual?: boolean; note?: string | null; stage?: Stage } = {}): IngestResult {
  return tx(() => {
    const known = get<{ job_id: number }>("SELECT job_id FROM postings WHERE source = ? AND source_id = ?", [raw.source, raw.sourceId]);
    if (known) {
      run("UPDATE postings SET fetched_at = datetime('now') WHERE source = ? AND source_id = ?", [raw.source, raw.sourceId]);
      return { jobId: known.job_id, created: false, merged: false, excluded: null };
    }
    const title = cleanTitle(raw.title);
    const companyId = ensureCompany(raw.company, raw.companyDomain);
    const dup = findDuplicate(companyId, title, raw.location ?? null, raw.description);
    if (dup) {
      run("INSERT INTO postings(job_id, source, source_id, url, title) VALUES (?, ?, ?, ?, ?)", [dup.id, raw.source, raw.sourceId, raw.url ?? null, raw.title]);
      const ageDays = (Date.now() - Date.parse(dup.found_at + "Z")) / 86_400_000;
      if (ageDays > 21) {
        run("UPDATE jobs SET repost_count = repost_count + 1 WHERE id = ?", [dup.id]);
        logEvent(dup.id, "repost", `Reposted on ${raw.source}`);
      } else logEvent(dup.id, "merged", `Also found on ${raw.source}`);
      if (opts.manual) run("UPDATE jobs SET manual = 1, note = COALESCE(?, note) WHERE id = ?", [opts.note ?? null, dup.id]);
      // prefer the company's own page as apply URL
      if (raw.url && /greenhouse|lever|personio|smartrecruiters|recruitee|manual/.test(raw.source)) run("UPDATE jobs SET url = ? WHERE id = ?", [raw.url, dup.id]);
      return { jobId: dup.id, created: false, merged: true, excluded: null };
    }
    const salary = parseSalary(`${raw.salaryText ?? ""}\n${raw.description}`);
    const company = get<{ name: string; blocked: number }>("SELECT name, blocked FROM companies WHERE id = ?", [companyId])!;
    const isAgency = looksLikeAgency(company.name, raw.description) ? 1 : 0;
    const language = raw.language ?? detectLanguage(raw.description || raw.title);
    const applyEmail = raw.applyEmail ?? extractEmail(raw.description);
    const excluded = opts.manual ? null : hardFilter({ title, description: raw.description, company: company.name, salary_max: salary?.max ?? null, language, is_agency: isAgency, company_blocked: company.blocked });
    const stage: Stage = excluded ? "excluded" : opts.stage ?? "new";
    const jobId = run(
      `INSERT INTO jobs(company_id, title, norm_title, location, remote, salary_min, salary_max, salary_text, language, description, url,
        apply_email, apply_channel, employment_type, is_agency, published_at, stage, excluded_reason, manual, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, title, normTitle(title), raw.location ?? null, raw.remote ?? null, salary?.min ?? null, salary?.max ?? null, raw.salaryText ?? null,
        language, raw.description, raw.url ?? null, applyEmail, applyEmail ? "email" : null, raw.employmentType ?? null, isAgency,
        raw.publishedAt ?? null, stage, excluded, opts.manual ? 1 : 0, opts.note ?? null],
    ).lastInsertRowid;
    run("INSERT INTO postings(job_id, source, source_id, url, title) VALUES (?, ?, ?, ?, ?)", [jobId, raw.source, raw.sourceId, raw.url ?? null, raw.title]);
    logEvent(jobId, "found", opts.manual ? "Added by you" : `Found on ${raw.source}`);
    if (excluded) logEvent(jobId, "excluded", excluded);
    if (opts.manual) addSignal(jobId, "manual", null);
    return { jobId, created: true, merged: false, excluded };
  });
}

export const SIGNAL_WEIGHTS: Record<string, number> = {
  dream: 3, apply: 2, manual: 2, skip: 0, reject: -2, undream: -1,
  outcome_contact: 1.5, outcome_round1: 2, outcome_final: 2.5, outcome_rejected_fast: -0.5,
};

export function addSignal(jobId: number, kind: string, reason: string | null) {
  run("INSERT INTO signals(job_id, kind, reason, weight) VALUES (?, ?, ?, ?)", [jobId, kind, reason, SIGNAL_WEIGHTS[kind] ?? 0]);
}

const STAGE_LABEL: Record<string, string> = {
  discover: "Discover", later: "Saved for later", shortlist: "Shortlist", drafting: "Drafting", review: "Ready to review", ready: "Ready to send",
  applied: "Applied", contact: "In contact", round1: "Round 1", final: "Final", closed: "Closed", excluded: "Excluded", new: "New",
};

export function stageLabel(s: string) {
  return STAGE_LABEL[s] ?? s;
}

/** Moves a job to a new stage, records the event and outcome signals. */
export function setStage(jobId: number, stage: Stage, extra: { closedReason?: string; note?: string } = {}) {
  const job = getJob(jobId);
  if (!job || job.stage === stage) return;
  run("UPDATE jobs SET stage = ?, stage_changed_at = datetime('now'), closed_reason = ?, next_action = COALESCE(?, next_action) WHERE id = ?", [
    stage, stage === "closed" ? extra.closedReason ?? "closed" : null, extra.note ?? null, jobId,
  ]);
  logEvent(jobId, "stage", `${stageLabel(job.stage)} → ${stageLabel(stage)}${extra.closedReason ? ` (${extra.closedReason})` : ""}${extra.note ? ` · ${extra.note}` : ""}`);
  if (stage === "contact" || stage === "round1" || stage === "final") addSignal(jobId, `outcome_${stage}`, null);
  if (stage === "closed" && extra.closedReason === "rejected" && job.stage === "applied") {
    const days = (Date.now() - Date.parse(job.stage_changed_at + "Z")) / 86_400_000;
    if (days < 7) addSignal(jobId, "outcome_rejected_fast", null);
  }
}

export function jobsInStages(stages: readonly string[], order = "j.score DESC NULLS LAST, j.found_at DESC"): JobRow[] {
  return all<JobRow>(`${JOB_SELECT} WHERE j.stage IN (${stages.map(() => "?").join(",")}) ORDER BY ${order}`, [...stages]);
}
