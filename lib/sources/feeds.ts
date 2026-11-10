/**
 * Public job feeds that are free to use without scraping:
 * - SwissDevJobs: JSON list of Swiss tech jobs with salary ranges (IT and product roles only)
 * Each feed is filtered by the search keywords and the search city (or remote).
 * (Job-Room covers the RAV and jobs.ch; public-sector jobs from jobs.admin.ch and the cantons also land there.)
 */
import type { RawJob } from "@/lib/jobs";
import { stripHtml } from "@/lib/text";
import { jobPostingFromHtml } from "./extract";
import { fetchJson, fetchText, sleep, titleMatches } from "./http";

export const FEEDS = {
  swissdevjobs: "SwissDevJobs",
} as const;
export type Feed = keyof typeof FEEDS;

export type FeedQuery = { keywords: string[]; location: string; isKnown: (source: Feed, id: string) => boolean; maxDetails?: number };

const near = (location: string | null | undefined, city: string, remote = false) =>
  !city || remote || (!!location && location.toLowerCase().includes(city.toLowerCase().split(/[ ,]/)[0]));

const decode = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

export function parseRss(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const tag = (t: string) => decode(m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "");
    return { title: tag("title"), link: tag("link").replace(/#track=.*$/, ""), description: tag("description"), pubDate: tag("pubDate"), guid: tag("guid") };
  });
}

/** Full text from the ad page: JobPosting data if present, else the readable page text. */
async function detail(url: string, source: string): Promise<RawJob | null> {
  try {
    const r = await fetchText(url);
    if (r.status !== 200) return null;
    return jobPostingFromHtml(r.text, url, source) ?? { source, sourceId: url, url, title: "", company: "", description: stripHtml(r.text).slice(0, 12000) };
  } catch {
    return null;
  }
}

export type SwissDevJob = {
  _id: string; jobUrl: string; name: string; company: string; actualCity?: string; cityCategory?: string; activeFrom?: string;
  annualSalaryFrom?: number | string; annualSalaryTo?: number | string; workplace?: string; jobType?: string; language?: string;
  technologies?: string[]; expLevel?: string; redirectJobUrl?: string;
};

export function swissDevJobToRaw(j: SwissDevJob, description = ""): RawJob {
  const from = Number(j.annualSalaryFrom ?? 0), to = Number(j.annualSalaryTo ?? 0);
  const url = `https://swissdevjobs.ch/jobs/${j.jobUrl}`;
  const facts = [j.expLevel && `Level: ${j.expLevel}`, j.technologies?.length && `Technologies: ${j.technologies.join(", ")}`, j.workplace && `Workplace: ${j.workplace}`].filter(Boolean).join("\n");
  return {
    source: "swissdevjobs", sourceId: j._id, url, title: j.name, company: j.company, location: j.actualCity || j.cityCategory || null,
    remote: j.workplace === "remote" ? "fully remote" : j.workplace === "hybrid" ? "hybrid" : null,
    salaryText: from ? `CHF ${from} – ${to || from} pro Jahr` : null,
    description: [description, facts].filter(Boolean).join("\n\n"),
    publishedAt: j.activeFrom?.slice(0, 10) ?? null, employmentType: j.jobType?.toLowerCase() || null,
    language: j.language === "English" ? "en" : j.language === "German" ? "de" : null,
  };
}

export async function fetchSwissDevJobs(q: FeedQuery): Promise<RawJob[]> {
  const list = await fetchJson<SwissDevJob[]>("https://swissdevjobs.ch/api/jobsLight");
  const out: RawJob[] = [];
  for (const j of list) {
    const place = j.actualCity || j.cityCategory || "";
    if (!titleMatches(j.name, q.keywords) || !near(place, q.location, j.workplace === "remote") || q.isKnown("swissdevjobs", j._id)) continue;
    if (out.length >= (q.maxDetails ?? 15)) break;
    const d = await detail(`https://swissdevjobs.ch/jobs/${j.jobUrl}`, "swissdevjobs");
    out.push(swissDevJobToRaw(j, d && d.description.length > 300 ? d.description : ""));
    await sleep(800);
  }
  return out;
}

export const FEED_FETCHERS: Record<Feed, (q: FeedQuery) => Promise<RawJob[]>> = { swissdevjobs: fetchSwissDevJobs };
