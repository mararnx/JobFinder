/**
 * Job-alert emails from StepStone, Indeed, LinkedIn, XING (or any portal), read from a Gmail label.
 * The job seeker sets up alerts on the portals and a Gmail filter that labels them.
 */
import { stripHtml } from "@/lib/text";
import { readLabel } from "@/lib/gmail";
import { PORTALS, type Portal } from "./extract";

export type AlertMail = { id: string; sender: string; subject: string; source: string };
export type AlertJob = { title: string; company: string; location: string | null; url: string; snippet: string };

/** Raw alert emails received in the last `days` days under this Gmail label. */
export async function readAlertLabel(label: string, days: number): Promise<AlertMail[]> {
  return (await readLabel(label, Math.max(1, Math.round(days)))).map((m) => ({ id: m.id, sender: m.from, subject: m.subject, source: m.source }));
}

/* ── MIME: just enough to get the HTML (or text) body of an alert email ── */

function decodeBody(body: string, headers: string): string {
  const enc = headers.match(/content-transfer-encoding:\s*([\w-]+)/i)?.[1]?.toLowerCase();
  const charset = headers.match(/charset="?([\w-]+)"?/i)?.[1]?.toLowerCase() ?? "utf-8";
  let buf: Buffer;
  if (enc === "base64") buf = Buffer.from(body.replace(/\s+/g, ""), "base64");
  else if (enc === "quoted-printable") {
    const bytes = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    buf = Buffer.from(bytes, "latin1");
  } else buf = Buffer.from(body, "latin1");
  return /iso-8859|latin|windows-1252/.test(charset) ? buf.toString("latin1") : buf.toString("utf8");
}

function parts(raw: string): { type: string; text: string }[] {
  const split = raw.search(/\r?\n\r?\n/);
  const headers = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? "" : raw.slice(split).replace(/^\r?\n\r?\n/, "");
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const type = unfolded.match(/content-type:\s*([\w/.+-]+)/i)?.[1]?.toLowerCase() ?? "text/plain";
  const boundary = unfolded.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  if (type.startsWith("multipart/") && boundary) {
    return body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--")).flatMap((p) => parts(p.replace(/^\r?\n/, "")));
  }
  return [{ type, text: decodeBody(body, unfolded) }];
}

/** The best readable body: HTML if there is one, else plain text. */
export function mailBody(source: string): { html: string | null; text: string } {
  const ps = parts(source);
  const html = ps.find((p) => p.type === "text/html")?.text ?? null;
  const text = ps.find((p) => p.type === "text/plain")?.text ?? (html ? stripHtml(html) : "");
  return { html, text };
}

/** Links with their visible text, for Claude to read and as the fallback parser's input. */
export function mailLinks(html: string): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    const url = m[1].replace(/&amp;/g, "&");
    if (text && /^https?:/i.test(url)) out.push({ text, url });
  }
  return out;
}

export function portalOf(sender: string, url = ""): Portal | "other" {
  const s = `${sender} ${url}`.toLowerCase();
  return s.includes("stepstone") ? "stepstone" : s.includes("indeed") ? "indeed" : s.includes("linkedin") ? "linkedin" : s.includes("xing") ? "xing" : "other";
}

/** Stable id for a job link: the portal's job id if the URL carries one, else the URL without tracking parameters. */
export function alertJobId(url: string, portal: Portal | "other"): string {
  if (portal !== "other") {
    const id = PORTALS[portal].idOf(url);
    if (id) return `${portal}:${id}`;
  }
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|trk|tracking|ref|src|cid|mc_|refid|trackingid)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

/** Fallback without Claude: links that look like job ads, title from the link text. */
export function guessAlertJobs(html: string, sender: string): AlertJob[] {
  const seen = new Set<string>();
  const out: AlertJob[] = [];
  for (const l of mailLinks(html)) {
    const looksLikeJob = /jobs\/view|viewjob|rc\/clk|pagead\/clk|stellenangebote|\/jobs\/[a-z0-9-]+-\d{5,}|job[_-]?id|jk=/i.test(l.url);
    if (!looksLikeJob || l.text.length < 6 || l.text.length > 140 || /alle|all jobs|mehr|more|ansehen|view|abmelden|unsubscribe|einstellungen|settings/i.test(l.text)) continue;
    const id = alertJobId(l.url, portalOf(sender, l.url));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ title: l.text, company: "", location: null, url: l.url, snippet: "" });
  }
  return out;
}
