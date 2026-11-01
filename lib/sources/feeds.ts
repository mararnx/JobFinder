/**
 * Public job feeds that are free to use without scraping:
 * - Arbeitnow: JSON API (Germany, many English-speaking and startup jobs, ATS-sourced)
 * - Berlin Startup Jobs: RSS (Berlin only)
 * - service.bund.de: RSS of public-sector jobs (federal, state and municipal)
 * Each feed is filtered by the search keywords and the search city (or remote).
 */
import type { RawJob } from "@/lib/jobs";
import { stripHtml } from "@/lib/text";
import { jobPostingFromHtml } from "./extract";
import { fetchJson, fetchText, sleep, titleMatches } from "./http";

export const FEEDS = {
  arbeitnow: "Arbeitnow",
  berlinstartupjobs: "Berlin Startup Jobs",
  bund: "service.bund.de",
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

export async function fetchArbeitnow(q: FeedQuery, pages = 3): Promise<RawJob[]> {
  type Item = { slug: string; company_name: string; title: string; description: string; remote: boolean; url: string; tags: string[]; job_types: string[]; location: string; created_at: number };
  const out: RawJob[] = [];
  for (let page = 1; page <= pages; page++) {
    const r = await fetchJson<{ data: Item[]; links: { next: string | null } }>(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
    for (const j of r.data) {
      if (!titleMatches(j.title, q.keywords) || !near(j.location, q.location, j.remote) || q.isKnown("arbeitnow", j.slug)) continue;
      out.push({
        source: "arbeitnow", sourceId: j.slug, url: j.url, title: j.title, company: j.company_name, location: j.location,
        remote: j.remote ? "remote possible" : null, description: stripHtml(j.description), publishedAt: new Date(j.created_at * 1000).toISOString().slice(0, 10),
        employmentType: j.job_types.join(", ") || null,
      });
    }
    if (!r.links.next) break;
    await sleep(1000);
  }
  return out;
}

export async function fetchBerlinStartupJobs(q: FeedQuery): Promise<RawJob[]> {
  if (q.location && !/berlin/i.test(q.location)) return [];
  const r = await fetchText("https://berlinstartupjobs.com/feed/");
  if (r.status !== 200) throw new Error(`berlinstartupjobs.com answered ${r.status}`);
  const out: RawJob[] = [];
  for (const it of parseRss(r.text)) {
    // "Senior Product Manager // Company"
    const [title, company = "Berlin startup"] = it.title.split(/\s+\/\/\s+/);
    if (!titleMatches(title, q.keywords) || q.isKnown("berlinstartupjobs", it.link)) continue;
    if (out.length >= (q.maxDetails ?? 15)) break;
    const d = await detail(it.link, "berlinstartupjobs");
    out.push({
      ...(d ?? {}), source: "berlinstartupjobs", sourceId: it.link, url: it.link, title, company: d?.company || company, location: d?.location || "Berlin",
      description: d?.description || stripHtml(it.description), publishedAt: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : null,
    });
    await sleep(800);
  }
  return out;
}

/** "Arbeitgeber: <strong>…</strong> Ort: <strong>10117 Berlin</strong>" from a service.bund.de item. */
export function bundMeta(description: string) {
  return {
    employer: decode(description.match(/Arbeitgeber:\s*<strong>([^<]+)<\/strong>/)?.[1] ?? ""),
    place: decode(description.match(/Ort:\s*<strong>([^<]+)<\/strong>/)?.[1] ?? "").replace(/^\d{5}\s*/, ""),
  };
}

export async function fetchBund(q: FeedQuery): Promise<RawJob[]> {
  const r = await fetchText("https://www.service.bund.de/Content/Globals/Functions/RSSFeed/RSSGenerator_Stellen.xml");
  if (r.status !== 200) throw new Error(`service.bund.de answered ${r.status}`);
  const out: RawJob[] = [];
  for (const it of parseRss(r.text)) {
    const { employer, place } = bundMeta(it.description);
    if (!titleMatches(it.title, q.keywords) || !near(place, q.location) || q.isKnown("bund", it.guid || it.link)) continue;
    if (out.length >= (q.maxDetails ?? 15)) break;
    const d = await detail(it.link, "bund");
    out.push({
      source: "bund", sourceId: it.guid || it.link, url: it.link, title: it.title, company: employer || "Öffentlicher Dienst", location: place || null,
      description: d?.description || stripHtml(it.description), publishedAt: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : null, language: "de",
    });
    await sleep(800);
  }
  return out;
}

export const FEED_FETCHERS: Record<Feed, (q: FeedQuery) => Promise<RawJob[]>> = { arbeitnow: fetchArbeitnow, berlinstartupjobs: fetchBerlinStartupJobs, bund: fetchBund };
