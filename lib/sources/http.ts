const UA = "JobFinder/0.1 (personal job search tool; local)";

export async function fetchText(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ status: number; text: string; finalUrl: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*", ...opts.headers }, signal: ctl.signal, redirect: "follow" });
    return { status: r.status, text: await r.text(), finalUrl: r.url };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const r = await fetchText(url, { headers: { Accept: "application/json", ...headers } });
  if (r.status !== 200) throw new Error(`${new URL(url).hostname} answered ${r.status}`);
  return JSON.parse(r.text) as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DE_PLACES = /germany|deutschland|\bde\b|remote|berlin|hamburg|münchen|munich|köln|cologne|frankfurt|stuttgart|düsseldorf|dusseldorf|leipzig|hannover|bremen|dresden|nürnberg|nuremberg|essen|dortmund|bonn|mannheim|karlsruhe|münster|aachen|kiel|freiburg|potsdam|mainz|wiesbaden|heidelberg|augsburg|regensburg|bochum|ulm|erlangen|darmstadt|braunschweig|lübeck|rostock|jena|ingolstadt|wolfsburg|walldorf|dach|emea|europe/i;

/** Rough check that a location string is in Germany or remote. Empty counts as yes. */
export function inGermanyOrRemote(location: string | null | undefined): boolean {
  return !location || DE_PLACES.test(location);
}

/** True if any search keyword's significant words all appear in the title. */
export function titleMatches(title: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const t = title.toLowerCase();
  return keywords.some((k) => k.toLowerCase().split(/\s+/).filter((w) => w.length > 1).every((w) => t.includes(w)));
}
