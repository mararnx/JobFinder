import type { RawJob } from "@/lib/jobs";
import { stripHtml } from "@/lib/text";

type Ld = Record<string, unknown>;

function* walk(node: unknown): Generator<Ld> {
  if (Array.isArray(node)) for (const n of node) yield* walk(n);
  else if (node && typeof node === "object") {
    const o = node as Ld;
    yield o;
    if (o["@graph"]) yield* walk(o["@graph"]);
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** Finds a schema.org JobPosting in the page's JSON-LD blocks. */
export function jobPostingFromHtml(html: string, url: string, source: string): RawJob | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ""));
    } catch {
      continue;
    }
    for (const o of walk(data)) {
      const type = o["@type"];
      if (!(type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))) continue;
      const org = o.hiringOrganization as Ld | string | undefined;
      const company = typeof org === "string" ? org : str(org?.name);
      const title = str(o.title);
      if (!title || !company) continue;
      const locs = ([] as Ld[]).concat((o.jobLocation as Ld | Ld[]) ?? []);
      const addr = (locs[0]?.address ?? {}) as Ld;
      const salary = o.baseSalary as Ld | undefined;
      const sv = (salary?.value ?? {}) as Ld;
      const salaryText = salary ? [str(sv.minValue) ?? str(sv.value), str(sv.maxValue)].filter(Boolean).join(" – ") + ` ${str(salary.currency) ?? "EUR"} ${str(sv.unitText) ?? ""}`.trimEnd() : null;
      const ident = o.identifier as Ld | string | undefined;
      const id = (typeof ident === "string" ? ident : str(ident?.value)) ?? url;
      return {
        source,
        sourceId: String(id),
        url,
        title,
        company,
        location: str(addr.addressLocality) ?? str(addr.addressRegion),
        remote: o.jobLocationType === "TELECOMMUTE" ? "Remote" : null,
        salaryText: salaryText && /\d/.test(salaryText) ? salaryText : null,
        description: stripHtml(stripHtml(str(o.description) ?? "")),
        publishedAt: str(o.datePosted),
        employmentType: Array.isArray(o.employmentType) ? o.employmentType.join(", ") : str(o.employmentType),
      };
    }
  }
  return null;
}

export type Portal = "stepstone" | "indeed" | "xing" | "linkedin";

export const PORTALS: Record<Portal, { name: string; search: (kw: string, loc: string, radius: number) => string; detail: RegExp; idOf: (href: string) => string | null }> = {
  stepstone: {
    name: "StepStone",
    search: (kw, loc, r) => `https://www.stepstone.de/jobs/${encodeURIComponent(kw.toLowerCase().replace(/\s+/g, "-"))}${loc ? `/in-${encodeURIComponent(loc.toLowerCase())}` : ""}?radius=${r}&sort=2&action=sort_publish`,
    detail: /\/stellenangebote--[^"'?#]+-(\d{6,})-inline\.html/,
    idOf: (h) => h.match(/-(\d{6,})-inline\.html/)?.[1] ?? null,
  },
  indeed: {
    name: "Indeed",
    search: (kw, loc, r) => `https://de.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=${encodeURIComponent(loc)}&radius=${r}&fromage=7&sort=date`,
    detail: /[?&]jk=([a-f0-9]{12,})/,
    idOf: (h) => h.match(/[?&]jk=([a-f0-9]{12,})/)?.[1] ?? null,
  },
  xing: {
    name: "XING",
    search: (kw, loc, r) => `https://www.xing.com/jobs/search?keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(loc)}&radius=${r}`,
    detail: /\/jobs\/[a-z0-9-]+-(\d{6,})/,
    idOf: (h) => h.match(/\/jobs\/[a-z0-9-]+-(\d{6,})/)?.[1] ?? null,
  },
  linkedin: {
    name: "LinkedIn",
    search: (kw, loc) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(loc || "Deutschland")}&f_TPR=r604800`,
    detail: /\/jobs\/view\/(?:[a-z0-9-]+-)?(\d{8,})/,
    idOf: (h) => h.match(/\/jobs\/view\/(?:[a-z0-9-]+-)?(\d{8,})/)?.[1] ?? null,
  },
};

/** Collects unique detail-page links from a listing page. */
export function listingLinks(html: string, baseUrl: string, portal: Portal): { id: string; url: string }[] {
  const p = PORTALS[portal];
  const seen = new Map<string, string>();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const raw = m[1].replace(/&amp;/g, "&");
    if (!p.detail.test(raw)) continue;
    const id = p.idOf(raw);
    if (!id || seen.has(id)) continue;
    let abs: string;
    try {
      abs = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }
    if (portal === "indeed") abs = `https://de.indeed.com/viewjob?jk=${id}`;
    seen.set(id, abs);
  }
  return [...seen].map(([id, url]) => ({ id, url }));
}

/** Detects pages that ask for human verification or a login. The runner stops on these and never tries to get around them. */
export function frictionReason(html: string, url: string): string | null {
  const t = html.slice(0, 200_000).toLowerCase();
  if (/captcha|hcaptcha|recaptcha|cf-challenge|challenge-platform|px-captcha|datadome/.test(t)) return "Human verification (CAPTCHA)";
  if (/unusual traffic|ungewöhnlichen datenverkehr|are you a robot|bist du ein mensch|sicherheitsüberprüfung|access denied|zugriff verweigert/.test(t)) return "Bot check / access denied";
  if (/linkedin\.com\/(authwall|login|checkpoint)/.test(url) || /\/login\b|signin|anmelden/.test(new URL(url).pathname)) return "Login required";
  return null;
}

/** Links on a company careers page that look like individual job postings for the given keywords. */
export function careerPageLinks(html: string, baseUrl: string, keywords: string[]): string[] {
  const out = new Set<string>();
  const host = new URL(baseUrl).hostname;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = stripHtml(m[2]).toLowerCase();
    if (!text || text.length > 160) continue;
    if (keywords.length && !keywords.some((k) => k.toLowerCase().split(/\s+/).every((w) => text.includes(w)))) continue;
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"), baseUrl);
      if (u.hostname.endsWith(host.split(".").slice(-2).join(".")) || /greenhouse|lever|personio|smartrecruiters|recruitee|workday|softgarden|join\.com/.test(u.hostname)) out.add(u.toString());
    } catch { /* skip */ }
  }
  return [...out].slice(0, 30);
}
