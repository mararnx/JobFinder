/**
 * jobs.ch (JobCloud), Switzerland's largest job portal, through the search API its own website uses.
 * Not an official, documented API: no key, at most 20 results per page. JobFinder reads it gently
 * (a pause between requests, only new ads get their detail fetched) and stops at the first error.
 * About half of its ads (mostly the paid ones) also reach Job-Room; the rest, mostly free basic ads, only exist here.
 */
import type { RawJob } from "@/lib/jobs";
import { stripHtml } from "@/lib/text";
import { workload } from "./jobroom";
import { fetchJson, sleep } from "./http";

const BASE = "https://www.jobs.ch/api/v1/public/search";
const HEADERS = { "Accept-Language": "de-CH,de;q=0.9" };

export type JobschHit = { job_id: string; title: string; company_name?: string; place?: string; publication_date?: string; initial_publication_date?: string; employment_grades?: number[] };
export type JobschDetail = JobschHit & {
  zipcode?: string;
  locations?: { city?: string; cantonCode?: string }[];
  application_method?: string;
  application_url?: string;
  external_url?: string;
  template_text?: string;
  template_lead_text?: string;
  _links?: { detail_de?: { href: string } };
};

export type JobschQuery = { keyword: string; location: string; days: number; isKnown: (id: string) => boolean };

/** Same id scheme as the Chrome search and the alert emails, so an ad from any of them is one job. */
export const jobschId = (uuid: string) => `jobsch:${uuid}`;

export const detailUrl = (uuid: string) => `https://www.jobs.ch/de/stellenangebote/detail/${uuid}/`;

export function searchUrl(q: { keyword: string; location: string }, page: number): string {
  const p = new URLSearchParams({ query: q.keyword, rows: "20", page: String(page), sort: "date" });
  if (q.location) p.set("location", q.location.replace(/\b\d{4}\b/g, "").split(",")[0].trim());
  return `${BASE}?${p}`;
}

export function jobschToRaw(d: JobschDetail): RawJob {
  const loc = d.locations?.[0];
  const city = loc?.city || d.place || null;
  const grades = d.employment_grades ?? [];
  const pensum = grades.length ? workload(Math.min(...grades), Math.max(...grades)) : null;
  const full = !grades.length || Math.max(...grades) >= 100;
  const apply = d.application_url || d.external_url || "";
  const text = stripHtml([d.template_lead_text ?? "", d.template_text ?? ""].join("\n"));
  return {
    source: "jobsch",
    sourceId: jobschId(d.job_id),
    url: d._links?.detail_de?.href ?? detailUrl(d.job_id),
    title: d.title.trim(),
    company: d.company_name?.trim() || "Unknown company",
    location: city ? `${city}${loc?.cantonCode && !city.endsWith(loc.cantonCode) ? ` ${loc.cantonCode}` : ""}` : null,
    description: [text, apply && /^https?:/i.test(apply) ? `Online-Bewerbung: ${apply}` : ""].filter(Boolean).join("\n\n"),
    publishedAt: (d.initial_publication_date ?? d.publication_date)?.slice(0, 10) ?? null,
    employmentType: [full ? "full-time" : "part-time", pensum].filter(Boolean).join(", ") || null,
  };
}

/** Newest first; stops at ads older than `days`, at known ads after the first page, or after `maxPages`. */
export async function fetchJobsch(q: JobschQuery, maxPages = 2): Promise<RawJob[]> {
  const out: RawJob[] = [];
  const since = Date.now() - q.days * 86_400_000;
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchJson<{ documents?: JobschHit[] }>(searchUrl(q, page), HEADERS);
    const hits = r.documents ?? [];
    let knownInRow = 0;
    for (const h of hits) {
      if (h.publication_date && Date.parse(h.publication_date) < since) return out;
      if (q.isKnown(jobschId(h.job_id))) {
        knownInRow++;
        continue;
      }
      knownInRow = 0;
      await sleep(1000 + Math.random() * 800);
      try {
        out.push(jobschToRaw(await fetchJson<JobschDetail>(`${BASE}/job/${h.job_id}`, HEADERS)));
      } catch {
        out.push(jobschToRaw(h)); // detail failed: keep the listing; scoring still works on title and company
      }
    }
    if (hits.length < 20 || knownInRow >= 10) break; // a full run of known ads: the rest is older
    await sleep(1500);
  }
  return out;
}
