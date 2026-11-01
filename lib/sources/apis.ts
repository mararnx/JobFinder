/**
 * Job-search APIs with a free personal key. Both aggregate ads from many German portals and company sites,
 * so they cover much of what Indeed and StepStone list without scraping them.
 * - Adzuna: developer.adzuna.com (app id + app key)
 * - Jooble: jooble.org/api/about (one key)
 * Their texts are snippets; the full ad is linked.
 */
import type { RawJob } from "@/lib/jobs";
import { stripHtml } from "@/lib/text";
import { fetchJson, fetchText, sleep } from "./http";

export type ApiQuery = { keyword: string; location: string; radiusKm: number; days: number; isKnown: (id: string) => boolean };

export type AdzunaJob = {
  id: string; title: string; description: string; created: string; redirect_url: string;
  company?: { display_name?: string }; location?: { display_name?: string }; salary_min?: number; salary_max?: number;
  salary_is_predicted?: string | number; contract_time?: string;
};

export function adzunaToRaw(j: AdzunaJob): RawJob {
  const predicted = String(j.salary_is_predicted ?? "0") === "1"; // Adzuna estimates some salaries – not from the ad
  return {
    source: "adzuna", sourceId: String(j.id), url: j.redirect_url, title: stripHtml(j.title), company: j.company?.display_name?.trim() || "Unknown company",
    location: j.location?.display_name ?? null, description: stripHtml(j.description),
    salaryText: !predicted && j.salary_min ? `${Math.round(j.salary_min)} – ${Math.round(j.salary_max ?? j.salary_min)} € pro Jahr` : null,
    publishedAt: j.created?.slice(0, 10) ?? null, employmentType: j.contract_time === "part_time" ? "part-time" : j.contract_time === "full_time" ? "full-time" : null,
  };
}

export async function fetchAdzuna(appId: string, appKey: string, q: ApiQuery, pages = 2): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let page = 1; page <= pages; page++) {
    const p = new URLSearchParams({ app_id: appId, app_key: appKey, what: q.keyword, results_per_page: "50", max_days_old: String(q.days), sort_by: "date", "content-type": "application/json" });
    if (q.location) {
      p.set("where", q.location);
      p.set("distance", String(q.radiusKm));
    }
    const r = await fetchJson<{ results: AdzunaJob[]; count: number }>(`https://api.adzuna.com/v1/api/jobs/de/search/${page}?${p}`);
    for (const j of r.results) if (!q.isKnown(String(j.id))) out.push(adzunaToRaw(j));
    if (r.results.length < 50) break;
    await sleep(800);
  }
  return out;
}

export type JoobleJob = { id: string | number; title: string; location?: string; snippet?: string; salary?: string; source?: string; type?: string; link: string; company?: string; updated?: string };

export function joobleToRaw(j: JoobleJob): RawJob {
  return {
    source: "jooble", sourceId: String(j.id), url: j.link, title: stripHtml(j.title), company: j.company?.trim() || "Unknown company",
    location: j.location || null, description: stripHtml(j.snippet ?? ""), salaryText: j.salary || null,
    publishedAt: j.updated?.slice(0, 10) ?? null, employmentType: j.type || null,
  };
}

export async function fetchJooble(key: string, q: ApiQuery, pages = 2): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let page = 1; page <= pages; page++) {
    const body = JSON.stringify({ keywords: q.keyword, location: q.location, radius: String(q.radiusKm), page: String(page) });
    const r = await fetchText(`https://jooble.org/api/${encodeURIComponent(key)}`, { headers: { "Content-Type": "application/json" }, method: "POST", body });
    if (r.status !== 200) throw new Error(`jooble.org answered ${r.status}${r.status === 403 ? " – check the API key" : ""}`);
    const jobs = (JSON.parse(r.text) as { jobs?: JoobleJob[] }).jobs ?? [];
    for (const j of jobs) if (!q.isKnown(String(j.id))) out.push(joobleToRaw(j));
    if (jobs.length < 20) break;
    await sleep(800);
  }
  return out;
}
