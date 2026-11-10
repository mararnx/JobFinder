const UA = "JobFinder/0.1 (personal job search tool; local)";

export async function fetchText(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number; method?: string; body?: string } = {}): Promise<{ status: number; text: string; finalUrl: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const r = await fetch(url, { method: opts.method ?? "GET", body: opts.body, headers: { "User-Agent": UA, Accept: "*/*", ...opts.headers }, signal: ctl.signal, redirect: "follow" });
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

const CH_PLACES = /switzerland|schweiz|suisse|svizzera|\bch\b|remote|zürich|zurich|bern|basel|luzern|lucerne|zug|winterthur|st\. ?gallen|aarau|baden|olten|solothurn|biel|bienne|thun|schaffhausen|frauenfeld|chur|rapperswil|wil\b|uster|dübendorf|kloten|wallisellen|opfikon|glattbrugg|schlieren|dietikon|pfäffikon|freienbach|baar|cham|rotkreuz|risch|allschwil|liestal|muttenz|pratteln|burgdorf|langenthal|köniz|lausanne|genève|geneva|genf|fribourg|freiburg i\. ?üe|neuchâtel|sion|lugano|bellinzona|locarno|vaduz|dach|emea|europe/i;

/** Rough check that a location string is in Switzerland (or Liechtenstein) or remote. Empty counts as yes. */
export function inSwitzerlandOrRemote(location: string | null | undefined): boolean {
  return !location || CH_PLACES.test(location);
}

/** True if any search keyword's significant words all appear in the title. */
export function titleMatches(title: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const t = title.toLowerCase();
  return keywords.some((k) => k.toLowerCase().split(/\s+/).filter((w) => w.length > 1).every((w) => t.includes(w)));
}
