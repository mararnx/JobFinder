/**
 * Builds a demo data folder (data-demo/) with a fictional job seeker and ~30 fictional ads spread over
 * every stage, run through the real pipeline with mock Claude. No network.
 *   npm run demo           seeds once, then starts the app on the demo data
 *   npm run demo -- --reset  wipes data-demo/ and seeds again
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve("data-demo");
if (process.argv.includes("--reset")) fs.rmSync(DIR, { recursive: true, force: true });
if (fs.existsSync(path.join(DIR, "kompass.db"))) {
  console.log("[demo] data-demo/ already seeded (use --reset to rebuild)");
  process.exit(0);
}
Object.assign(process.env, { KOMPASS_DATA: DIR, KOMPASS_CLAUDE: "mock", KOMPASS_MOCK_DELAY: "0", KOMPASS_NO_NOTIFY: "1", KOMPASS_DRY_SEND: "1" });

const { all, get, run, setSettings } = await import("@/lib/db");
const { ingest } = await import("@/lib/jobs");
const { dispatch } = await import("@/lib/actions");
const { saveUpload } = await import("@/lib/pipeline/documents");
const { setMeta } = await import("@/lib/queue");
const { drain } = await import("@/worker/index");
const { closePdfBrowser } = await import("@/lib/pipeline/pdf");

const step = (s: string) => console.log(`[demo] ${s}`);

/* ── person + documents ─────────────────────────────── */

setSettings({
  name: "Alex Neumann", email: "alex.neumann@example.com", phone: "+41 79 000 00 00", address: "Musterstrasse 1, 8004 Zürich",
  home: "Zürich", commuteKm: 40, remoteMin: 1, salaryFloor: 100000, salaryExpectation: "CHF 125'000", noticePeriod: "3 months",
  workload: "80–100 %", workPermit: "EU citizen, needs a B permit",
  earliestStart: "Feb 1, 2027", blockKeywords: ["Werkstudent", "Praktikum"], excludeAgencies: true, weeklyGoal: 30,
});
// disabled so the demo never pulls real ads
run("INSERT INTO search_profiles(name, keywords, location, radius_km, enabled) VALUES ('Product roles Zürich', ?, 'Zürich', 40, 0)", [JSON.stringify(["Product Owner", "Produktmanager", "Product Manager"])]);
for (const f of fs.readdirSync("tests/fixtures/docs")) saveUpload(f, fs.readFileSync(path.join("tests/fixtures/docs", f)));
step("reading documents");
await drain(120_000);
await dispatch("finishOnboarding", {
  liked: [{ text: "Senior Product Owner B2B SaaS\nRoadmap, Discovery, Stakeholder", reason: "product ownership in B2B software" }],
  disliked: [{ text: "Werkstudent Vertrieb\nKaltakquise", reason: "too junior, sales" }],
});
await drain(60_000);

/* ── ads ────────────────────────────────────────────── */

type Ad = { company: string; title: string; city: string; salary?: string; remote?: string; en?: boolean; domain: string; extra?: string; source?: string };

const de = (a: Ad) => `${a.company} entwickelt Software für ${a.extra ?? "den Mittelstand"}. Für unser Team in ${a.city} suchen wir dich als ${a.title}.

Deine Aufgaben:
• Du verantwortest Vision, Roadmap und Backlog deines Produkts
• Du führst Discovery-Interviews mit Kunden und validierst Hypothesen
• Du arbeitest eng mit Engineering, Design und Vertrieb zusammen
• Du definierst KPIs und triffst Entscheidungen auf Basis von Daten

Dein Profil:
• Mehrjährige Erfahrung als Product Owner oder Produktmanager:in
• Erfahrung mit Scrum oder Kanban
• SQL- oder Analytics-Kenntnisse sind ein Plus
• Sehr gutes Deutsch und gutes Englisch

Pensum: 80–100 %. Wir bieten: ${a.remote ?? "Hybrides Arbeiten"}, 5 Wochen Ferien, Weiterbildungsbudget.
${a.salary ? `Lohn: ${a.salary}\n` : ""}Bewerbung an jobs@${a.domain}`;

const en = (a: Ad) => `${a.company} builds software for ${a.extra ?? "European logistics teams"}. We're hiring a ${a.title} in ${a.city}.

What you'll do:
• Own the product vision, roadmap and backlog for one of our core products
• Run customer discovery and turn insights into clear problem statements
• Work with engineering and design in a cross-functional squad
• Define success metrics and report on outcomes

What you bring:
• 4+ years as a Product Owner or Product Manager in B2B software
• Experience with agile delivery (Scrum/Kanban)
• Comfortable with data – SQL is a plus
• Fluent English; German is nice to have
• EU/EFTA citizenship or a Swiss work permit

${a.remote ?? "Hybrid, 2 days in the office"}. ${a.salary ? `Salary: ${a.salary}. ` : ""}Apply via careers@${a.domain}`;

const ads: Ad[] = [
  { company: "Limmatwerk Software AG", title: "Senior Product Owner (m/w/d)", city: "Zürich", salary: "CHF 120'000 – 140'000 pro Jahr", domain: "limmatwerk.example", extra: "Logistikunternehmen" },
  { company: "Firnlicht Energy", title: "Product Manager Platform", city: "Zürich", salary: "CHF 130,000 – 150,000", en: true, domain: "firnlicht-energy.example", extra: "energy utilities" },
  { company: "Steinbock Health AG", title: "Product Owner Patientenportal 80–100 % (m/w/d)", city: "Bern", remote: "Bis zu 3 Tage Homeoffice", domain: "steinbock-health.example", extra: "Spitäler und Praxen" },
  { company: "Aaretal Payments", title: "Product Owner Payments", city: "Zürich", salary: "CHF 115'000 – 135'000", domain: "aaretal-payments.example", extra: "Zahlungsabwicklung im E-Commerce" },
  { company: "Gletscher Analytics", title: "Senior Product Manager – Data Products", city: "Remote (Schweiz)", remote: "Fully remote within Switzerland", en: true, salary: "CHF 135,000 – 160,000", domain: "gletscher-analytics.example", extra: "retail analytics teams" },
  { company: "Seilbahn Mobility", title: "Produktmanager:in Sharing-Plattform", city: "Zürich", domain: "seilbahn-mobility.example", extra: "Carsharing-Anbieter" },
  { company: "Brunner & Söhne Maschinenbau AG", title: "Product Owner IoT (m/w/d)", city: "Winterthur", salary: "CHF 105'000 – 120'000", domain: "brunner-soehne.example", extra: "vernetzte Maschinen" },
  { company: "Murmeltier Labs", title: "Product Owner Mobile App", city: "Zürich", domain: "murmeltier.example", extra: "Fitness-Apps", remote: "Remote-first" },
  { company: "Reuss Insurance Tech", title: "Product Owner Claims (m/w/d)", city: "Luzern", salary: "CHF 118'000 – 135'000", domain: "reuss-instech.example", extra: "Versicherungen" },
  { company: "Seeblick Commerce", title: "Product Manager Checkout", city: "Basel", en: true, salary: "CHF 120,000 – 140,000", remote: "Remote with monthly team days", domain: "seeblick.example", extra: "online fashion stores" },
  { company: "Rheinhafen Logistics", title: "Product Owner Transport Management", city: "Basel", domain: "rheinhafen.example", extra: "Speditionen" },
  { company: "Edelweiss Learning", title: "Product Owner EdTech (m/w/d)", city: "Bern", salary: "CHF 100'000 – 115'000", domain: "edelweiss-learning.example", extra: "Schulen und Hochschulen" },
  { company: "Zunfthaus Bank", title: "Product Owner Digital Banking", city: "Zürich", salary: "CHF 130'000 – 150'000", domain: "zunfthaus-bank.example", extra: "Privatkunden im Online-Banking", remote: "2 Tage Homeoffice" },
  { company: "Polarstern SaaS", title: "Lead Product Owner (m/w/d)", city: "Zug", salary: "CHF 140'000 – 160'000", domain: "polarstern-saas.example", extra: "HR-Abteilungen" },
  { company: "Föhn Robotics", title: "Technical Product Manager", city: "Zürich", en: true, domain: "foehn-robotics.example", extra: "warehouse automation" },
  { company: "Léman Media", title: "Product Owner Streaming", city: "Genf", domain: "leman-media.example", extra: "Verlage und Sender" },
  { company: "Bühnenlicht Ticketing", title: "Product Owner Ticketing (m/w/d)", city: "Zürich", salary: "CHF 95'000 – 105'000", domain: "buehnenlicht.example", extra: "Veranstalter" },
  { company: "Säntis Cloud Services", title: "Product Manager Developer Experience", city: "St. Gallen", en: true, salary: "CHF 130,000 – 148,000", domain: "saentis-cloud.example", extra: "platform engineering teams" },
  { company: "Rösti Foods", title: "Product Owner E-Commerce", city: "Zürich", domain: "roesti-foods.example", extra: "Lebensmittel-Onlinehandel" },
  { company: "Lindenhof Legal", title: "Product Owner LegalTech (m/w/d)", city: "Zürich", remote: "Bis zu 4 Tage Homeoffice", domain: "lindenhof-legal.example", extra: "Kanzleien" },
  { company: "Bergbach Energie", title: "Produktmanager Smart Home", city: "Luzern", salary: "CHF 105'000 – 118'000", domain: "bergbach-energie.example", extra: "Elektrizitätswerke" },
  { company: "Bergpass Travel", title: "Product Owner Booking", city: "Zürich", domain: "bergpass-travel.example", extra: "Reiseveranstalter" },
  { company: "Kornhaus Data", title: "Product Owner Data Platform", city: "Zürich", salary: "CHF 125'000 – 142'000", domain: "kornhaus-data.example", extra: "Datenteams" },
  { company: "Wasser & Wind AG", title: "Product Owner Customer Portal", city: "Aarau", domain: "wasser-wind.example", extra: "Energieversorger" },
  // below the user's fit: they score low or get filtered
  { company: "Güterbahnhof Logistik", title: "Disponent:in Nahverkehr", city: "Zürich", domain: "gueterbahnhof.example", extra: "Spedition" },
  { company: "Sihl Retail", title: "Filialleitung (m/w/d)", city: "Zürich", domain: "sihl-retail.example", extra: "Detailhandel" },
  { company: "Bise Digital", title: "Werkstudent Product Management", city: "Zürich", domain: "bise.example", extra: "Startups" },
  { company: "Talentbrücke Personalberatung", title: "Product Owner (m/w/d)", city: "Zürich", domain: "talentbruecke.example", extra: "Für unseren Kunden suchen wir" },
  { company: "Kleinkram GmbH", title: "Junior Product Owner", city: "Zürich", salary: "CHF 60'000 – 70'000", domain: "kleinkram.example", extra: "Bürobedarf" },
];

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
ads.forEach((a, i) => {
  const isAgency = a.company.startsWith("Talentbrücke");
  ingest({
    source: i % 5 === 3 ? "greenhouse" : i % 7 === 2 ? "jobsch" : "jobroom", sourceId: `demo-${i}`,
    url: `https://${a.domain}/jobs/${i}`, title: a.title, company: a.company, location: a.city, remote: a.remote ?? null,
    salaryText: a.salary ?? null, companyDomain: a.domain, publishedAt: ago(i % 12),
    description: isAgency ? `Für unseren Kunden, ein Softwarehaus in Zürich, suchen wir einen Product Owner. ${de(a)}` : a.en ? en(a) : de(a),
  });
});
const manual = (await dispatch("addManual", {
  text: "Senior Product Owner Fleet (m/w/d)\nMarlin Mobility AG, Zürich\nWir digitalisieren Flottenmanagement. Du verantwortest Roadmap und Backlog, arbeitest mit Kunden und Engineering. Erfahrung als Product Owner, Scrum, SQL. Lohn CHF 125'000 – 140'000. Bewerbung an people@marlin-mobility.example",
  note: "Tip from a former colleague",
})) as { jobId: number };
for (const c of ["Limmatwerk Software AG", "Gletscher Analytics", "Zunfthaus Bank"]) run("UPDATE companies SET watchlist = 1 WHERE name = ?", [c]);
step("scoring ads");
await drain(120_000);

/* ── decisions and stages ───────────────────────────── */

const id = (company: string) => get<{ id: number }>("SELECT j.id FROM jobs j JOIN companies c ON c.id = j.company_id WHERE c.name LIKE ?", [`${company}%`])!.id;
const decide = (company: string, kind: string, reason?: string) => dispatch("decide", { jobId: id(company), kind, reason });

await decide("Limmatwerk", "dream");
await decide("Zunfthaus", "dream");
for (const c of ["Limmatwerk", "Firnlicht", "Steinbock", "Aaretal", "Gletscher", "Reuss", "Zunfthaus", "Polarstern", "Kornhaus", "Säntis Cloud", "Seeblick", "Murmeltier", "Lindenhof", "Seilbahn"]) await decide(c, "apply");
await dispatch("decide", { jobId: manual.jobId, kind: "apply" });
await decide("Güterbahnhof", "reject", "Wrong field");
await decide("Sihl Retail", "reject", "Wrong field");
await decide("Léman", "reject", "Too far away");
await decide("Bergbach", "skip");
await decide("Rheinhafen", "skip");
step("drafting applications (letters, fact-checks, PDFs)");
await drain(300_000);

// sent ones: approve + mark sent, then walk some further down the funnel
const send = async (company: string) => {
  const jobId = id(company);
  const app = get<{ id: number }>("SELECT id FROM applications WHERE job_id = ? ORDER BY version DESC", [jobId])!;
  await dispatch("approve", { appId: app.id, seconds: 30 + (jobId % 5) * 17 });
  await dispatch("markSent", { jobId });
  return jobId;
};
// two approved and waiting in Ready to send: one by email, one through a form
for (const c of ["Marlin", "Lindenhof"]) {
  const app = get<{ id: number }>("SELECT id FROM applications WHERE job_id = ? ORDER BY version DESC", [id(c)]);
  if (app) await dispatch("approve", { appId: app.id, seconds: 70 });
}
run("UPDATE jobs SET apply_email = NULL, apply_channel = 'form' WHERE id = ?", [id("Lindenhof")]);

const flow: [string, number, string[], string?][] = [
  // company, days ago sent, later stages, note
  ["Firnlicht", 24, ["contact", "round1", "final"], "Final round with the CPO – Thu 14:00"],
  ["Limmatwerk", 17, ["contact", "round1"], "On-site at the office, Tue 10:30"],
  ["Steinbock", 15, ["contact", "round1"], "Video call with the team lead, Wed 11:00"],
  ["Aaretal", 12, ["contact"], "Recruiter call booked for Friday"],
  ["Reuss", 9, ["contact"]],
  ["Gletscher", 19, []],
  ["Polarstern", 6, []],
  ["Kornhaus", 3, []],
  ["Säntis Cloud", 2, []],
  ["Seeblick", 1, []],
  ["Murmeltier", 27, ["closed:rejected"]],
];
for (const [company, days, stages, note] of flow) {
  const jobId = await send(company);
  for (const s of stages) {
    const [to, reason] = s.split(":");
    await dispatch("move", { jobId, to, closedReason: reason, note: to === stages.at(-1) ? note : undefined });
  }
  // spread the timeline back in time so the charts and "days since" look real
  const sent = `datetime('now','-${days} days','-${(jobId * 37) % 600} minutes')`;
  run(`UPDATE applications SET sent_at = ${sent}, approved_at = ${sent}, created_at = datetime(${sent}, '-1 day') WHERE job_id = ?`, [jobId]);
  run(`UPDATE jobs SET found_at = datetime(${sent}, '-3 days'), stage_changed_at = datetime(${sent}, '+${Math.max(stages.length * 3, 0)} days') WHERE id = ?`, [jobId]);
  const evs = all<{ id: number }>("SELECT id FROM events WHERE job_id = ? AND type = 'stage' ORDER BY id", [jobId]);
  evs.forEach((e, i) => run(`UPDATE events SET at = datetime(${sent}, '+${i * Math.max(1, Math.floor(days / (evs.length + 1)))} days') WHERE id = ?`, [e.id]));
}
run("UPDATE jobs SET stage_changed_at = datetime('now','-36 days'), next_action = NULL WHERE id = ?", [id("Gletscher")]);
run("UPDATE applications SET sent_at = datetime('now','-36 days') WHERE job_id = ?", [id("Gletscher")]);

step("prep packs and follow-ups");
run("DELETE FROM settings WHERE key = '_lastRun:followups'");
run("UPDATE jobs SET stage_changed_at = datetime('now','-16 days'), next_action = NULL WHERE id = ?", [id("Polarstern")]);
const { schedule } = await import("@/worker/index");
schedule();
run("DELETE FROM tasks WHERE status = 'queued' AND type = 'fetch_source'");
await drain(120_000);

// a little learning: reject a few more so the profile has something to reflect on
for (const c of ["Bühnenlicht", "Rösti"]) await decide(c, "reject", "Salary too low");
await dispatch("reflectNow", {});
await drain(60_000);

/* ── source history so the Sources page isn't empty ─── */

for (const [src, h, found, added] of [["jobroom", 3, 41, 6], ["jobroom", 6, 38, 4], ["watchlist", 20, 7, 1], ["jobroom", 9, 44, 9]] as const) {
  run(`INSERT INTO source_runs(source, started_at, finished_at, found, added, status) VALUES (?, datetime('now','-${h} hours'), datetime('now','-${h} hours','+40 seconds'), ?, ?, 'ok')`, [src, found, added]);
}
// tell the worker everything just ran, so it doesn't fetch on start
for (const k of ["jobroom", "watchlist", "chrome", "reflect", "followups", "digest"]) setMeta(`lastRun:${k}`, new Date().toISOString());

await closePdfBrowser();
const counts = all<{ stage: string; n: number }>("SELECT stage, COUNT(*) AS n FROM jobs GROUP BY stage ORDER BY n DESC");
step(`done: ${counts.map((c) => `${c.stage} ${c.n}`).join(" · ")}`);
const failed = all<{ type: string; error: string }>("SELECT type, error FROM tasks WHERE status = 'failed'");
if (failed.length) console.warn("[demo] failed tasks:", failed);
process.exit(0);
