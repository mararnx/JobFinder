import type { RawJob } from "@/lib/jobs";
import { stripHtml } from "@/lib/text";
import { fetchJson, fetchText, inSwitzerlandOrRemote, sleep, titleMatches } from "../http";

export type AtsType = "greenhouse" | "lever" | "personio" | "smartrecruiters" | "recruitee" | "page";

/** Recognises the applicant tracking system from a careers URL. */
export function detectAts(url: string): { type: AtsType; token: string } {
  let u: URL;
  try {
    u = new URL(url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`);
  } catch {
    throw new Error("Not a valid URL");
  }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const t = host.startsWith("boards-api") ? seg[2] : seg[0] === "embed" ? u.searchParams.get("for") : seg[0];
    if (t) return { type: "greenhouse", token: t };
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") if (seg[0]) return { type: "lever", token: `${host.includes(".eu.") ? "eu:" : ""}${seg[0]}` };
  const personio = host.match(/^([a-z0-9-]+)\.jobs\.personio\.(de|com)$/);
  if (personio) return { type: "personio", token: `${personio[1]}.jobs.personio.${personio[2]}` };
  if (/^(careers|jobs)\.smartrecruiters\.com$/.test(host) && seg[0]) return { type: "smartrecruiters", token: seg[0] };
  const recruitee = host.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (recruitee) return { type: "recruitee", token: recruitee[1] };
  return { type: "page", token: u.toString() };
}

type Ctx = { company: string; keywords: string[] };

const keep = (title: string, location: string | null | undefined, ctx: Ctx) => titleMatches(title, ctx.keywords) && inSwitzerlandOrRemote(location);

async function greenhouse(token: string, ctx: Ctx): Promise<RawJob[]> {
  type G = { jobs: { id: number; title: string; absolute_url: string; location?: { name?: string }; content?: string; first_published?: string; updated_at?: string; company_name?: string }[] };
  const d = await fetchJson<G>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  return d.jobs.filter((j) => keep(j.title, j.location?.name, ctx)).map((j) => ({
    source: "greenhouse", sourceId: `${token}:${j.id}`, url: j.absolute_url, title: j.title, company: j.company_name || ctx.company,
    location: j.location?.name ?? null, description: stripHtml(stripHtml(j.content ?? "")), publishedAt: j.first_published ?? j.updated_at ?? null,
    remote: /remote/i.test(j.location?.name ?? "") ? "Remote" : null,
  }));
}

async function lever(token: string, ctx: Ctx): Promise<RawJob[]> {
  const eu = token.startsWith("eu:");
  const name = token.replace(/^eu:/, "");
  type L = { id: string; text: string; hostedUrl: string; createdAt: number; workplaceType?: string; categories?: { location?: string; commitment?: string }; descriptionPlain?: string; lists?: { text: string; content: string }[]; additionalPlain?: string };
  const d = await fetchJson<L[]>(`https://api.${eu ? "eu." : ""}lever.co/v0/postings/${name}?mode=json`);
  return d.filter((j) => keep(j.text, j.categories?.location, ctx)).map((j) => ({
    source: "lever", sourceId: `${name}:${j.id}`, url: j.hostedUrl, title: j.text, company: ctx.company, location: j.categories?.location ?? null,
    remote: j.workplaceType && j.workplaceType !== "onsite" ? j.workplaceType : null, employmentType: j.categories?.commitment ?? null,
    description: [j.descriptionPlain ?? "", ...(j.lists ?? []).map((l) => `${l.text}\n${stripHtml(l.content)}`), j.additionalPlain ?? ""].join("\n\n").trim(),
    publishedAt: new Date(j.createdAt).toISOString(),
  }));
}

function xmlTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : null;
}

export function parsePersonioXml(xml: string, host: string, ctx: Ctx): RawJob[] {
  const out: RawJob[] = [];
  for (const block of xml.match(/<position>[\s\S]*?<\/position>/g) ?? []) {
    const id = xmlTag(block, "id"), name = xmlTag(block, "name");
    if (!id || !name) continue;
    const office = xmlTag(block, "office");
    if (!keep(name, office, ctx)) continue;
    const descs = (block.match(/<jobDescription>[\s\S]*?<\/jobDescription>/g) ?? []).map((d) => `${xmlTag(d, "name") ?? ""}\n${stripHtml(xmlTag(d, "value") ?? "")}`);
    out.push({
      source: "personio", sourceId: `${host}:${id}`, url: `https://${host}/job/${id}`, title: name, company: ctx.company, location: office,
      employmentType: xmlTag(block, "schedule"), description: descs.join("\n\n").trim(), publishedAt: xmlTag(block, "createdAt"),
    });
  }
  return out;
}

async function personio(host: string, ctx: Ctx): Promise<RawJob[]> {
  const r = await fetchText(`https://${host}/xml`);
  if (r.status !== 200 || !r.text.includes("<workzag-jobs")) throw new Error(`Personio feed not found at ${host}`);
  return parsePersonioXml(r.text, host, ctx);
}

async function smartrecruiters(id: string, ctx: Ctx): Promise<RawJob[]> {
  type S = { content: { id: string; name: string; releasedDate?: string; location?: { city?: string; country?: string; remote?: boolean; hybrid?: boolean }; ref: string; company?: { name?: string }; typeOfEmployment?: { label?: string } }[] };
  type SD = { jobAd?: { sections?: Record<string, { title?: string; text?: string }> }; postingUrl?: string; applyUrl?: string };
  const out: RawJob[] = [];
  for (let offset = 0; offset < 300; offset += 100) {
    const d = await fetchJson<S>(`https://api.smartrecruiters.com/v1/companies/${id}/postings?country=de&limit=100&offset=${offset}`);
    for (const j of d.content.filter((x) => keep(x.name, x.location?.city ?? "Switzerland", ctx))) {
      const det = await fetchJson<SD>(j.ref).catch(() => ({}) as SD);
      await sleep(200);
      const sections = Object.values(det.jobAd?.sections ?? {}).map((s) => `${s.title ?? ""}\n${stripHtml(s.text ?? "")}`);
      out.push({
        source: "smartrecruiters", sourceId: `${id}:${j.id}`, url: det.postingUrl ?? `https://jobs.smartrecruiters.com/${id}/${j.id}`, title: j.name,
        company: j.company?.name ?? ctx.company, location: j.location?.city ?? null, remote: j.location?.remote ? "Remote" : j.location?.hybrid ? "Hybrid" : null,
        employmentType: j.typeOfEmployment?.label ?? null, description: sections.join("\n\n").trim(), publishedAt: j.releasedDate ?? null,
      });
    }
    if (d.content.length < 100) break;
  }
  return out;
}

async function recruitee(token: string, ctx: Ctx): Promise<RawJob[]> {
  type R = { offers: { id: number; title: string; careers_url: string; location?: string; city?: string; remote?: boolean; description?: string; requirements?: string; published_at?: string; employment_type_code?: string }[] };
  const d = await fetchJson<R>(`https://${token}.recruitee.com/api/offers/`);
  return d.offers.filter((j) => keep(j.title, j.location ?? j.city, ctx)).map((j) => ({
    source: "recruitee", sourceId: `${token}:${j.id}`, url: j.careers_url, title: j.title, company: ctx.company, location: j.city ?? j.location ?? null,
    remote: j.remote ? "Remote" : null, description: `${stripHtml(j.description ?? "")}\n\n${stripHtml(j.requirements ?? "")}`.trim(), publishedAt: j.published_at ?? null,
  }));
}

/** Fetches a watchlist company's open jobs from its ATS feed, filtered to the search keywords and Switzerland/remote. */
export async function fetchAts(type: AtsType, token: string, ctx: Ctx): Promise<RawJob[]> {
  switch (type) {
    case "greenhouse": return greenhouse(token, ctx);
    case "lever": return lever(token, ctx);
    case "personio": return personio(token, ctx);
    case "smartrecruiters": return smartrecruiters(token, ctx);
    case "recruitee": return recruitee(token, ctx);
    case "page": throw new Error("Careers page without a known feed; handled by the Chrome runner");
  }
}
