/**
 * Job-Room (job-room.ch), the public job portal of the Swiss employment service (RAV / SECO).
 * It carries the ads employers must report to the RAV plus a large feed from jobs.ch and other portals.
 * The search API the website uses is public and needs no key.
 */
import type { RawJob } from "@/lib/jobs";
import { fetchJson, fetchText, sleep } from "./http";

const BASE = "https://www.job-room.ch";

export type JobroomAd = {
  id: string;
  createdTime?: string;
  stellennummerEgov?: string | null;
  jobContent: {
    externalUrl?: string | null;
    jobDescriptions?: { languageIsoCode?: string; title?: string; description?: string }[];
    company?: { name?: string; city?: string | null };
    employment?: { permanent?: boolean | null; workloadPercentageMin?: string | number | null; workloadPercentageMax?: string | number | null; immediately?: boolean; startDate?: string | null; workForms?: string[] };
    location?: { city?: string | null; postalCode?: string | null; cantonCode?: string | null };
    applyChannel?: { emailAddress?: string | null; formUrl?: string | null } | null;
  };
  publication?: { startDate?: string | null };
};

export type JobroomQuery = { keyword: string; location: string; radiusKm: number; days: number };

/** Job-Room URLs often come without a scheme ("www.jobs.ch/…"). */
const absUrl = (u: string | null | undefined) => (!u ? null : /^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`);

export function publicUrl(id: string): string {
  return `${BASE}/job-search/${id}`;
}

/** Job-Room descriptions are Markdown converted from the original page, sometimes with a front-matter block. Makes them plain text. */
export function cleanDescription(md: string): string {
  return md
    .replace(/^---[\s\S]*?\n---\s*/, "")
    .replace(/<\/?em>/g, "")
    .replace(/\\([\\`*_{}\[\]()#+\-.!&])/g, "$1")
    .replace(/^\s*=+\s*$/gm, "")
    .replace(/^\s*-{3,}\s*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** "80 – 100 %" from the workload range, null when it's plain 100 %. */
export function workload(min: unknown, max: unknown): string | null {
  const lo = Number(min ?? 0), hi = Number(max ?? 0);
  if (!hi && !lo) return null;
  if (lo && hi && lo !== hi) return `${lo} – ${hi} %`;
  return `${hi || lo} %`;
}

export function jobroomToRaw(a: JobroomAd): RawJob {
  const c = a.jobContent;
  const descs = c.jobDescriptions ?? [];
  const d = descs.find((x) => x.languageIsoCode === "de") ?? descs.find((x) => x.languageIsoCode === "en") ?? descs[0] ?? {};
  const e = c.employment ?? {};
  const pensum = workload(e.workloadPercentageMin, e.workloadPercentageMax);
  const full = Number(e.workloadPercentageMax ?? 100) >= 100;
  const type = [full ? "full-time" : "part-time", pensum, e.permanent === false ? "temporary" : null].filter(Boolean).join(", ");
  const place = c.location?.city ? `${c.location.city}${c.location.cantonCode ? ` ${c.location.cantonCode}` : ""}`.replace(/\b(\w{2}) \1$/, "$1") : c.company?.city ?? null;
  const remote = e.workForms?.includes("HOME_WORK") ? "Home office possible" : null;
  return {
    source: "jobroom",
    sourceId: a.id,
    url: absUrl(c.externalUrl) ?? publicUrl(a.id),
    title: (d.title ?? "").replace(/<\/?em>/g, "").trim(),
    company: c.company?.name?.trim() || "Unknown company",
    location: place,
    remote,
    salaryText: null,
    description: cleanDescription(d.description ?? ""),
    publishedAt: a.publication?.startDate ?? a.createdTime?.slice(0, 10) ?? null,
    employmentType: type || null,
    applyEmail: c.applyChannel?.emailAddress || null,
    language: d.languageIsoCode === "en" ? "en" : d.languageIsoCode === "de" ? "de" : undefined,
  };
}

type Locality = { city: string; zipCode?: string; cantonCode?: string; geoPoint?: { lat: number; lon: number } };

const geoCache = new Map<string, Locality["geoPoint"] | null>();

/** Coordinates of a Swiss town for the radius search ("Zürich", "8001 Zürich", "Bern"). */
export async function geocode(place: string): Promise<{ lat: number; lon: number } | null> {
  const key = place.trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  const city = place.replace(/\b\d{4}\b/g, "").split(",")[0].trim();
  const r = await fetchJson<{ localities?: Locality[] }>(`${BASE}/referenceservice/api/_search/localities?prefix=${encodeURIComponent(city)}&resultSize=10&distinctByLocalityCity=true`);
  const list = r.localities ?? [];
  const hit = list.find((l) => l.city.toLowerCase() === city.toLowerCase()) ?? list.find((l) => l.city.toLowerCase().startsWith(city.toLowerCase())) ?? list[0];
  const gp = hit?.geoPoint ?? null;
  geoCache.set(key, gp);
  return gp;
}

export function searchBody(q: JobroomQuery, geo: { lat: number; lon: number } | null) {
  return {
    workloadPercentageMin: 0,
    workloadPercentageMax: 100,
    permanent: null,
    companyName: null,
    onlineSince: q.days,
    displayRestricted: false,
    professionCodes: [],
    keywords: [q.keyword.trim()], // one phrase; split words would match any of them (249 vs 36 hits for "Product Owner")
    communalCodes: [],
    cantonCodes: [],
    ...(geo ? { radiusSearchRequest: { geoPoint: geo, distance: q.radiusKm } } : {}),
  };
}

/** Searches, then fetches the full text for ads not seen before. */
export async function fetchJobroom(q: JobroomQuery, isKnown: (id: string) => boolean, maxPages = 2): Promise<RawJob[]> {
  const geo = q.location ? await geocode(q.location).catch(() => null) : null;
  const body = JSON.stringify(searchBody(q, geo));
  const out: RawJob[] = [];
  for (let page = 0; page < maxPages; page++) {
    const r = await fetchText(`${BASE}/jobadservice/api/jobAdvertisements/_search?page=${page}&size=50&sort=date_desc`, { method: "POST", body, headers: { "Content-Type": "application/json", Accept: "application/json" } });
    if (r.status !== 200) throw new Error(`job-room.ch answered ${r.status}`);
    const hits = (JSON.parse(r.text) as { jobAdvertisement: JobroomAd }[]).map((h) => h.jobAdvertisement);
    for (const h of hits) {
      if (isKnown(h.id)) continue;
      try {
        out.push(jobroomToRaw(await fetchJson<JobroomAd>(`${BASE}/jobadservice/api/jobAdvertisements/${h.id}`)));
      } catch {
        out.push(jobroomToRaw(h)); // details failed: keep the (shortened) search text
      }
      await sleep(250);
    }
    if (hits.length < 50) break;
    await sleep(500);
  }
  return out;
}
