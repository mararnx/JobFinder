const LEGAL_FORMS = /\b(gmbh|ag|se|kg|kgaa|ohg|ug|e\.?\s?v|mbh|co|inc|ltd|llc|plc|bv|nv|sa|sarl|holding|group|gruppe|deutschland|germany|schweiz|switzerland|suisse|svizzera)\b/g;

export function normCompany(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&|\bund\b/g, " ")
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TITLE_NOISE = /\(?\b(m|w|d|f|x|div|all genders?|gn)\s*(\/\s*(m|w|d|f|x|div))+\)?|\(\s*(m|w|d|f|x|all genders?|gn)\s*\)|\*in\b|:in\b|\bin\b(?=\s*$)/gi;

export function normTitle(title: string): string {
  return title
    .replace(TITLE_NOISE, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\b(senior|sr|junior|jr|lead|head|principal|staff)\b/g, (m) => m.replace(/^sr$/, "senior").replace(/^jr$/, "junior"))
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTitle(title: string): string {
  return title.replace(TITLE_NOISE, " ").replace(/\s{2,}/g, " ").replace(/\s+([,–-])\s*$/, "").trim();
}

const STOP = new Set(
  "und oder der die das ein eine einer eines einem einen mit fur für von zu zur zum im in an auf als bei aus wir sie du ihr ihre unser unsere unseren dich dein deine ist sind wird werden hast hat haben the and or of to in for with on at by an a is are you your we our as be will this that from".split(" "),
);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export type Vec = Map<string, number>;

export function vectorize(s: string): Vec {
  const v: Vec = new Map();
  for (const t of tokens(s)) v.set(t, (v.get(t) ?? 0) + 1);
  // sublinear tf
  for (const [k, n] of v) v.set(k, 1 + Math.log(n));
  return v;
}

export function cosine(a: Vec, b: Vec): number {
  let dot = 0, na = 0, nb = 0;
  for (const [, x] of a) na += x * x;
  for (const [, y] of b) nb += y * y;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, x] of small) {
    const y = big.get(k);
    if (y) dot += x * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function similarity(a: string, b: string): number {
  return cosine(vectorize(a), vectorize(b));
}

export type AdLanguage = "de" | "en" | "fr" | "it";

/** Rough DE/EN/FR/IT guess from function words (Swiss ads come in all four). */
export function detectLanguage(s: string): AdLanguage {
  const t = ` ${s.toLowerCase().slice(0, 4000)} `;
  const n = (re: RegExp) => (t.match(re) ?? []).length;
  const scores: [AdLanguage, number][] = [
    ["de", n(/ (und|der|die|das|wir|sie|für|mit|ihre|deine|bei|eine|ist) /g)],
    ["en", n(/ (and|the|we|you|for|with|our|your|are|is|will|to) /g)],
    ["fr", n(/ (et|le|la|les|des|nous|vous|pour|avec|une|est|du|au) /g)],
    ["it", n(/ (e|il|la|gli|delle|noi|per|con|una|è|del|della|sono) /g)],
  ];
  // German wins ties: it's the default market
  return scores.reduce((best, x) => (x[1] > best[1] ? x : best))[0];
}

/** Extracts an annual salary range (CHF; EUR is read the same way) from free text. Returns null if none found. */
export function parseSalary(s: string): { min: number; max: number } | null {
  const t = s.replace(/[\u00a0\u202f]/g, " ");
  const N = String.raw`\d{2,3}(?:['’.,\s]\d{3})?|\d{5,6}|\d{2,3}\s?k`;
  const CUR = String.raw`(?:chf|sfr\.?|fr\.|€|eur|euro)`;
  const DASH = String.raw`(?:\.[–-]+)?\s*(?:-|–|bis|to)\s*`;
  const num = (x: string) => {
    const k = /k/i.test(x);
    const n = Number(x.replace(/k/i, "").replace(/['’.,\s]/g, ""));
    return k || n < 1000 ? n * 1000 : n;
  };
  const ok = (min: number, max: number) => min >= 15000 && max <= 500000 && max >= min;
  // "90'000 – 110'000 CHF" or "CHF 90'000 – 110'000"
  const after = t.match(new RegExp(`(${N})\\s*${CUR}?${DASH}(${N})(?:\\.[–-]+)?\\s*(?:${CUR}|k€)`, "i"));
  const before = t.match(new RegExp(`${CUR}\\s*(${N})${DASH}(?:${CUR}\\s*)?(${N})(?![\\d'’])`, "i"));
  for (const m of [after, before]) {
    if (!m) continue;
    const min = num(m[1]), max = num(m[2]);
    if (ok(min, max)) return { min, max };
  }
  const single = t.match(new RegExp(`(?:${CUR}\\s*(\\d{2,3}['’.,]\\d{3})|(\\d{2,3}['’.,]\\d{3})\\s*${CUR})(?:\\.[–-]+)?\\s*(?:brutto|gross|p\\.?\\s?a\\.?|jährlich|pro jahr|per year|/\\s?jahr)`, "i"));
  if (single) {
    const n = num(single[1] ?? single[2]);
    if (n >= 15000 && n <= 500000) return { min: n, max: n };
  }
  return null;
}

const AGENCY_PATTERNS = [
  /für unseren (kunden|mandanten|klienten)/i,
  /im auftrag (unseres|unserer) (kunden|mandanten)/i,
  /\bon behalf of (our|a) client\b/i,
  /\bour client\b/i,
  /arbeitnehmerüberlassung/i,
  /\bpersonalvermittlung\b/i,
  /\bpersonaldienstleist/i,
  /\bzeitarbeit\b/i,
  /\bin festanstellung bei unserem kunden\b/i,
  /\bpersonalberatung\b/i,
  /\bstellenvermittlung\b/i,
  /\btemporärstelle\b|\btemporäreinsatz\b/i,
];
const KNOWN_AGENCIES = /\b(hays|randstad|adecco|manpower|orizon|dis ag|amadeus fire|robert half|michael page|page personnel|brunel|gulp|etengo|solcom|computer futures|harvey nash|experis|persona service|tempton|piening|avanti|westhouse|darwin recruitment|frank recruitment|jobot|kelly services|careerplus|universal-job|interiman|gi group|coople|yellowshark|valjob|mooser & partner|sago personal|personal sigma|jobfactory|pro personal|persigo|rocken|myitjob|it-people|swisselect|workselection|kennedy executive|consult & pepper|avec compétence)\b/i;

export function looksLikeAgency(company: string, text: string): boolean {
  return KNOWN_AGENCIES.test(company) || AGENCY_PATTERNS.some((p) => p.test(text));
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function extractEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!m) return null;
  const e = m[0].replace(/[.,;]+$/, "");
  return /noreply|no-reply|datenschutz|privacy/i.test(e) ? null : e;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}
