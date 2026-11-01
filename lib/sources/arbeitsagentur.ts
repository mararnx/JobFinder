import type { RawJob } from "@/lib/jobs";
import { fetchJson, sleep } from "./http";

const BASE = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service";
const HEADERS = { "X-API-Key": "jobboerse-jobsuche" };

type SearchHit = {
  referenznummer: string; stellenangebotsTitel: string; firma: string; externeURL?: string;
  stellenlokationen?: { adresse?: { ort?: string; plz?: string } }[]; homeofficemoeglich?: boolean; homeofficetyp?: string;
  datumErsteVeroeffentlichung?: string; gehaltsspanneVon?: number; gehaltsspanneBis?: number;
};
type SearchResult = { ergebnisliste?: SearchHit[]; maxErgebnisse?: number };
type Detail = SearchHit & { stellenangebotsBeschreibung?: string; istArbeitnehmerUeberlassung?: boolean; istPrivateArbeitsvermittlung?: boolean; arbeitszeitVollzeit?: boolean };

export type BaQuery = { keyword: string; location: string; radiusKm: number; days: number; excludeAgencies: boolean };

export function searchUrl(q: BaQuery, page: number): string {
  const p = new URLSearchParams({ was: q.keyword, angebotsart: "1", page: String(page), size: "50", veroeffentlichtseit: String(q.days) });
  if (q.location) {
    p.set("wo", q.location);
    p.set("umkreis", String(q.radiusKm));
  }
  if (q.excludeAgencies) {
    p.set("zeitarbeit", "false");
    p.set("pav", "false");
  }
  return `${BASE}/pc/v6/jobs?${p}`;
}

export function detailUrl(refnr: string): string {
  return `${BASE}/pc/v4/jobdetails/${Buffer.from(refnr).toString("base64")}`;
}

export function publicUrl(refnr: string): string {
  return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(refnr)}`;
}

export function toRaw(d: Detail, preferred = ""): RawJob {
  const places = (d.stellenlokationen ?? []).map((l) => l.adresse?.ort).filter((x): x is string => !!x);
  const pick = places.find((p) => preferred && p.toLowerCase().includes(preferred.toLowerCase())) ?? places[0] ?? null;
  const loc = pick && places.length > 1 ? `${pick} (+${places.length - 1} more)` : pick;
  const salary = d.gehaltsspanneVon ? `${Math.round(d.gehaltsspanneVon)} – ${Math.round(d.gehaltsspanneBis ?? d.gehaltsspanneVon)} € pro Jahr` : null;
  const remote = d.homeofficemoeglich ? (d.homeofficetyp === "NACH_VEREINBARUNG" ? "Home office by arrangement" : "Home office possible") : null;
  const flags = [d.istArbeitnehmerUeberlassung ? "Arbeitnehmerüberlassung" : "", d.istPrivateArbeitsvermittlung ? "Personalvermittlung" : ""].filter(Boolean).join("\n");
  return {
    source: "arbeitsagentur",
    sourceId: d.referenznummer,
    url: d.externeURL || publicUrl(d.referenznummer),
    title: d.stellenangebotsTitel,
    company: d.firma,
    location: loc,
    remote,
    salaryText: salary,
    description: [d.stellenangebotsBeschreibung ?? "", flags].filter(Boolean).join("\n\n"),
    publishedAt: d.datumErsteVeroeffentlichung ?? null,
    employmentType: d.arbeitszeitVollzeit === false ? "part-time" : "full-time",
  };
}

/** Searches, then fetches details for postings not seen before. `isKnown` avoids refetching. */
export async function fetchArbeitsagentur(q: BaQuery, isKnown: (refnr: string) => boolean, maxPages = 3): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchJson<SearchResult>(searchUrl(q, page), HEADERS);
    const hits = res.ergebnisliste ?? [];
    for (const h of hits) {
      if (isKnown(h.referenznummer)) continue;
      try {
        const d = await fetchJson<Detail>(detailUrl(h.referenznummer), HEADERS);
        out.push(toRaw({ ...h, ...d }, q.location));
      } catch {
        out.push(toRaw(h, q.location)); // details failed: keep the listing data
      }
      await sleep(250);
    }
    if (hits.length < 50) break;
    await sleep(500);
  }
  return out;
}
