import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { all, FILES_DIR, get, getSettings, json, run } from "@/lib/db";
import type { CvFacts } from "@/lib/claude/schemas";
import { cvFacts } from "@/lib/profile";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BASE_CSS = `
  @page { size: A4; margin: 22mm 22mm 20mm 25mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; }
  h1 { font-size: 20pt; font-weight: 600; margin: 0 0 2mm; letter-spacing: -.01em; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: .08em; color: #555; margin: 7mm 0 2mm; border-bottom: .3mm solid #ddd; padding-bottom: 1mm; }
  .muted { color: #666; }
`;

export function letterHtml(o: { name: string; contact: string[]; recipient: string[]; place: string; date: string; subject: string; body: string }) {
  const paras = o.body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .sender { text-align: right; font-size: 9.5pt; line-height: 1.45; }
    .sender b { font-size: 11pt; }
    .recipient { margin-top: 14mm; min-height: 28mm; }
    .date { text-align: right; margin: 6mm 0 8mm; }
    .subject { font-weight: 600; margin-bottom: 6mm; }
    p { margin: 0 0 3.2mm; }
  </style></head><body>
    <div class="sender"><b>${esc(o.name)}</b><br>${o.contact.map(esc).join("<br>")}</div>
    <div class="recipient">${o.recipient.map(esc).join("<br>")}</div>
    <div class="date">${esc(o.place ? `${o.place}, ${o.date}` : o.date)}</div>
    <div class="subject">${esc(o.subject)}</div>
    ${paras}
  </body></html>`;
}

export function cvHtml(cv: CvFacts, t: { summary: string; skill_order: string[]; highlight_fact_ids: string[] }, s: { name: string; contact: string[] }, de: boolean) {
  const highlighted = new Set(t.highlight_fact_ids);
  const highlights = cv.facts.filter((f) => highlighted.has(f.id));
  const skills = [...t.skill_order.filter((x) => cv.skills.includes(x)), ...cv.skills.filter((x) => !t.skill_order.includes(x))];
  const L = de ? { profile: "Profil", focus: "Schwerpunkte für diese Stelle", exp: "Berufserfahrung", edu: "Ausbildung", skills: "Kenntnisse", lang: "Sprachen", certs: "Zertifikate", cv: "Lebenslauf" }
    : { profile: "Profile", focus: "Highlights for this role", exp: "Experience", edu: "Education", skills: "Skills", lang: "Languages", certs: "Certificates", cv: "CV" };
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: .6mm solid #1a1a1a; padding-bottom: 3mm; }
    .contact { text-align: right; font-size: 9pt; color: #444; line-height: 1.45; }
    .pos { display: grid; grid-template-columns: 30mm 1fr; gap: 4mm; margin-bottom: 3.5mm; break-inside: avoid; }
    .pos .when { color: #666; font-size: 9.5pt; }
    .pos b { display: block; }
    ul { margin: 1mm 0 0; padding-left: 4.5mm; } li { margin-bottom: .6mm; }
    .chips { line-height: 1.9; } .chips span { display: inline-block; border: .25mm solid #ccc; border-radius: 1.2mm; padding: 0 2mm; margin: 0 1.2mm 1.2mm 0; font-size: 9pt; }
  </style></head><body>
    <div class="head"><div><div class="muted" style="font-size:9pt;letter-spacing:.08em;text-transform:uppercase">${L.cv}</div><h1>${esc(s.name || cv.name)}</h1><div>${esc(cv.headline)}</div></div>
      <div class="contact">${s.contact.map(esc).join("<br>")}</div></div>
    ${t.summary ? `<h2>${L.profile}</h2><p>${esc(t.summary)}</p>` : ""}
    ${highlights.length ? `<h2>${L.focus}</h2><ul>${highlights.map((f) => `<li>${esc(f.text)}</li>`).join("")}</ul>` : ""}
    <h2>${L.exp}</h2>
    ${cv.positions.map((p) => `<div class="pos"><div class="when">${esc(p.start)} – ${esc(p.end)}</div><div><b>${esc(p.title)}</b><span class="muted">${esc(p.company)}${p.location ? `, ${esc(p.location)}` : ""}</span>${p.bullets.length ? `<ul>${p.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}</div></div>`).join("")}
    ${cv.education.length ? `<h2>${L.edu}</h2>${cv.education.map((e) => `<div class="pos"><div class="when">${esc(e.start ?? "")}${e.end ? ` – ${esc(e.end)}` : ""}</div><div><b>${esc(e.degree)}</b><span class="muted">${esc(e.institution)}</span></div></div>`).join("")}` : ""}
    ${skills.length ? `<h2>${L.skills}</h2><div class="chips">${skills.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
    ${cv.languages.length ? `<h2>${L.lang}</h2><p>${cv.languages.map(esc).join(" · ")}</p>` : ""}
    ${cv.certifications.length ? `<h2>${L.certs}</h2><ul>${cv.certifications.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
  </body></html>`;
}

let browserPromise: Promise<import("playwright").Browser> | null = null;

async function pdfBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright");
      try {
        return await chromium.launch({ headless: true });
      } catch {
        return await chromium.launch({ headless: true, channel: "chrome" });
      }
    })();
  }
  return browserPromise;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const b = await pdfBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true }));
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser() {
  const p = browserPromise;
  browserPromise = null;
  if (p) await (await p).close().catch(() => {});
}

const fileSafe = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

/** Renders letter + tailored CV, appends attachments, writes the bundle and the single files. */
export async function buildBundle(appId: number): Promise<string> {
  const a = get<{ id: number; job_id: number; language: string; subject: string; letter: string; cv_json: string; answers_json: string }>("SELECT * FROM applications WHERE id = ?", [appId]);
  if (!a) throw new Error("application not found");
  const job = get<{ title: string; company: string; location: string | null }>("SELECT j.title, c.name AS company, j.location FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = ?", [a.job_id])!;
  const s = getSettings();
  const cv = cvFacts();
  const de = a.language !== "en";
  const contact = [s.address, s.phone, s.email].filter(Boolean);
  const answers = json<{ recipient?: string | null }>(a.answers_json, {});
  const date = new Date().toLocaleDateString(de ? "de-DE" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const place = s.home.split(",")[0]?.trim() ?? "";
  const letterPdf = await htmlToPdf(letterHtml({ name: s.name, contact, recipient: [job.company, answers.recipient ?? "", job.location ?? ""].filter(Boolean), place, date, subject: a.subject, body: a.letter }));
  const cvPdf = cv ? await htmlToPdf(cvHtml(cv, json(a.cv_json, { summary: "", skill_order: [], highlight_fact_ids: [] }), { name: s.name, contact }, de)) : null;

  const out = await PDFDocument.create();
  const append = async (bytes: Uint8Array | Buffer) => {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  };
  await append(letterPdf);
  if (cvPdf) await append(cvPdf);
  const attachments = all<{ path: string; name: string }>("SELECT path, name FROM documents WHERE attach = 1 AND status = 'done' ORDER BY CASE kind WHEN 'ref' THEN 0 WHEN 'cert' THEN 1 ELSE 2 END, id DESC");
  for (const d of attachments) if (/\.pdf$/i.test(d.name) && fs.existsSync(d.path)) await append(fs.readFileSync(d.path)).catch(() => {});
  out.setTitle(a.subject);
  out.setAuthor(s.name);

  const dir = path.join(FILES_DIR, "applications", String(appId));
  fs.mkdirSync(dir, { recursive: true });
  const last = fileSafe(s.name.split(" ").slice(-1)[0] || "Bewerbung");
  const base = `${de ? "Bewerbung" : "Application"}_${last}_${fileSafe(job.company)}_${fileSafe(job.title)}`;
  const bundle = path.join(dir, `${base}.pdf`);
  fs.writeFileSync(bundle, await out.save());
  fs.writeFileSync(path.join(dir, de ? "Anschreiben.pdf" : "Cover_letter.pdf"), letterPdf);
  if (cvPdf) fs.writeFileSync(path.join(dir, de ? "Lebenslauf.pdf" : "CV.pdf"), cvPdf);
  run("UPDATE applications SET bundle_path = ? WHERE id = ?", [bundle, appId]);
  return bundle;
}
