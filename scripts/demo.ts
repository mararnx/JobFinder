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
  name: "Alex Neumann", email: "alex.neumann@example.com", phone: "+49 151 0000000", address: "Musterstraße 1, 20095 Hamburg",
  home: "Hamburg", commuteKm: 40, remoteMin: 1, salaryFloor: 65000, salaryExpectation: "€85,000", noticePeriod: "3 months",
  earliestStart: "Feb 1, 2027", blockKeywords: ["Werkstudent", "Praktikum"], excludeAgencies: true, weeklyGoal: 30,
});
// disabled so the demo never pulls real ads
run("INSERT INTO search_profiles(name, keywords, location, radius_km, enabled) VALUES ('Product roles Hamburg', ?, 'Hamburg', 40, 0)", [JSON.stringify(["Product Owner", "Produktmanager", "Product Manager"])]);
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

Wir bieten: ${a.remote ?? "Hybrides Arbeiten"}, 30 Urlaubstage, Weiterbildungsbudget.
${a.salary ? `Gehalt: ${a.salary}\n` : ""}Bewerbung an jobs@${a.domain}`;

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

${a.remote ?? "Hybrid, 2 days in the office"}. ${a.salary ? `Salary: ${a.salary}. ` : ""}Apply via careers@${a.domain}`;

const ads: Ad[] = [
  { company: "Hafenwerk Software GmbH", title: "Senior Product Owner (m/w/d)", city: "Hamburg", salary: "80.000 – 95.000 € pro Jahr", domain: "hafenwerk.example", extra: "Hafenlogistik" },
  { company: "Nordlicht Energy", title: "Product Manager Platform", city: "Hamburg", salary: "€85,000 – €100,000", en: true, domain: "nordlicht-energy.example", extra: "energy retailers" },
  { company: "Kranich Health AG", title: "Product Owner Patientenportal (m/w/d)", city: "Hamburg", remote: "Bis zu 3 Tage Homeoffice", domain: "kranich-health.example", extra: "Kliniken und Praxen" },
  { company: "Elbtal Payments", title: "Product Owner Payments", city: "Hamburg", salary: "75.000 – 90.000 €", domain: "elbtal-payments.example", extra: "Zahlungsabwicklung im E-Commerce" },
  { company: "Fjord Analytics", title: "Senior Product Manager – Data Products", city: "Remote (Germany)", remote: "Fully remote within Germany", en: true, salary: "€90,000 – €110,000", domain: "fjord-analytics.example", extra: "retail analytics teams" },
  { company: "Lotsenhaus Mobility", title: "Produktmanager:in Sharing-Plattform", city: "Hamburg", domain: "lotsenhaus.example", extra: "Carsharing-Anbieter" },
  { company: "Brückner & Söhne Maschinenbau", title: "Product Owner IoT (m/w/d)", city: "Lüneburg", salary: "70.000 – 82.000 €", domain: "brueckner-soehne.example", extra: "vernetzte Maschinen" },
  { company: "Wattwurm Labs", title: "Product Owner Mobile App", city: "Hamburg", domain: "wattwurm.example", extra: "Fitness-Apps", remote: "Remote-first" },
  { company: "Alster Insurance Tech", title: "Product Owner Claims (m/w/d)", city: "Hamburg", salary: "78.000 – 92.000 €", domain: "alster-instech.example", extra: "Versicherer" },
  { company: "Seeblick Commerce", title: "Product Manager Checkout", city: "Berlin", en: true, salary: "€80,000 – €95,000", remote: "Remote with monthly team days", domain: "seeblick.example", extra: "online fashion stores" },
  { company: "Kompassrose Logistics", title: "Product Owner Transport Management", city: "Bremen", domain: "kompassrose.example", extra: "Speditionen" },
  { company: "Möwe Learning", title: "Product Owner EdTech (m/w/d)", city: "Hamburg", salary: "68.000 – 78.000 €", domain: "moewe-learning.example", extra: "Schulen und Hochschulen" },
  { company: "Deichgraf Bank", title: "Product Owner Digital Banking", city: "Hamburg", salary: "85.000 – 98.000 €", domain: "deichgraf-bank.example", extra: "Privatkunden im Online-Banking", remote: "2 Tage Homeoffice" },
  { company: "Polarstern SaaS", title: "Lead Product Owner (m/w/d)", city: "Kiel", salary: "90.000 – 105.000 €", domain: "polarstern-saas.example", extra: "HR-Abteilungen" },
  { company: "Tidewater Robotics", title: "Technical Product Manager", city: "Hamburg", en: true, domain: "tidewater.example", extra: "warehouse automation" },
  { company: "Sandbank Media", title: "Product Owner Streaming", city: "Köln", domain: "sandbank-media.example", extra: "Verlage und Sender" },
  { company: "Reeperbahn Ticketing", title: "Product Owner Ticketing (m/w/d)", city: "Hamburg", salary: "65.000 – 75.000 €", domain: "rb-ticketing.example", extra: "Veranstalter" },
  { company: "Hanse Cloud Services", title: "Product Manager Developer Experience", city: "Hamburg", en: true, salary: "€88,000 – €102,000", domain: "hanse-cloud.example", extra: "platform engineering teams" },
  { company: "Kutter Foods", title: "Product Owner E-Commerce", city: "Hamburg", domain: "kutter-foods.example", extra: "Lebensmittel-Onlinehandel" },
  { company: "Leuchtturm Legal", title: "Product Owner LegalTech (m/w/d)", city: "Hamburg", remote: "Bis zu 4 Tage Homeoffice", domain: "leuchtturm-legal.example", extra: "Kanzleien" },
  { company: "Gezeiten Energie", title: "Produktmanager Smart Home", city: "Hannover", salary: "72.000 – 84.000 €", domain: "gezeiten-energie.example", extra: "Stadtwerke" },
  { company: "Ankerplatz Travel", title: "Product Owner Booking", city: "Hamburg", domain: "ankerplatz-travel.example", extra: "Reiseveranstalter" },
  { company: "Speicherstadt Data", title: "Product Owner Data Platform", city: "Hamburg", salary: "82.000 – 96.000 €", domain: "speicherstadt-data.example", extra: "Datenteams" },
  { company: "Watt & Wellen GmbH", title: "Product Owner Customer Portal", city: "Hamburg", domain: "watt-wellen.example", extra: "Energieversorger" },
  // below the user's fit: they score low or get filtered
  { company: "Containerhafen Logistik", title: "Disponent:in Nahverkehr", city: "Hamburg", domain: "ch-logistik.example", extra: "Spedition" },
  { company: "Elbe Retail", title: "Filialleitung (m/w/d)", city: "Hamburg", domain: "elbe-retail.example", extra: "Einzelhandel" },
  { company: "Brise Digital", title: "Werkstudent Product Management", city: "Hamburg", domain: "brise.example", extra: "Startups" },
  { company: "Talentlotsen Personalberatung", title: "Product Owner (m/w/d)", city: "Hamburg", domain: "talentlotsen.example", extra: "Für unseren Kunden suchen wir" },
  { company: "Kleinkram GmbH", title: "Junior Product Owner", city: "Hamburg", salary: "38.000 – 44.000 €", domain: "kleinkram.example", extra: "Bürobedarf" },
];

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
ads.forEach((a, i) => {
  const isAgency = a.company.startsWith("Talentlotsen");
  ingest({
    source: i % 5 === 3 ? "greenhouse" : i % 7 === 2 ? "stepstone" : "arbeitsagentur", sourceId: `demo-${i}`,
    url: `https://${a.domain}/jobs/${i}`, title: a.title, company: a.company, location: a.city, remote: a.remote ?? null,
    salaryText: a.salary ?? null, companyDomain: a.domain, publishedAt: ago(i % 12),
    description: isAgency ? `Für unseren Kunden, ein Softwarehaus in Hamburg, suchen wir einen Product Owner. ${de(a)}` : a.en ? en(a) : de(a),
  });
});
const manual = (await dispatch("addManual", {
  text: "Senior Product Owner Fleet (m/w/d)\nMarlin Mobility GmbH, Hamburg\nWir digitalisieren Flottenmanagement. Du verantwortest Roadmap und Backlog, arbeitest mit Kunden und Engineering. Erfahrung als Product Owner, Scrum, SQL. Gehalt 85.000 – 95.000 €. Bewerbung an people@marlin-mobility.example",
  note: "Tip from a former colleague",
})) as { jobId: number };
for (const c of ["Hafenwerk Software GmbH", "Fjord Analytics", "Deichgraf Bank"]) run("UPDATE companies SET watchlist = 1 WHERE name = ?", [c]);
step("scoring ads");
await drain(120_000);

/* ── decisions and stages ───────────────────────────── */

const id = (company: string) => get<{ id: number }>("SELECT j.id FROM jobs j JOIN companies c ON c.id = j.company_id WHERE c.name LIKE ?", [`${company}%`])!.id;
const decide = (company: string, kind: string, reason?: string) => dispatch("decide", { jobId: id(company), kind, reason });

await decide("Hafenwerk", "dream");
await decide("Deichgraf", "dream");
for (const c of ["Hafenwerk", "Nordlicht", "Kranich", "Elbtal", "Fjord", "Alster", "Deichgraf", "Polarstern", "Speicherstadt", "Hanse Cloud", "Seeblick", "Wattwurm"]) await decide(c, "apply");
await dispatch("decide", { jobId: manual.jobId, kind: "apply" });
await decide("Containerhafen", "reject", "Wrong field");
await decide("Elbe Retail", "reject", "Wrong field");
await decide("Sandbank", "reject", "Too far away");
await decide("Gezeiten", "skip");
await decide("Kompassrose", "skip");
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
const flow: [string, number, string[], string?][] = [
  // company, days ago sent, later stages, note
  ["Nordlicht", 24, ["contact", "round1", "final"], "Final round with the CPO – Thu 14:00"],
  ["Hafenwerk", 17, ["contact", "round1"], "On-site at the office, Tue 10:30"],
  ["Kranich", 15, ["contact", "round1"], "Video call with the team lead, Wed 11:00"],
  ["Elbtal", 12, ["contact"], "Recruiter call booked for Friday"],
  ["Alster", 9, ["contact"]],
  ["Fjord", 19, []],
  ["Polarstern", 6, []],
  ["Speicherstadt", 3, []],
  ["Hanse Cloud", 2, []],
  ["Seeblick", 1, []],
  ["Wattwurm", 27, ["closed:rejected"]],
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
run("UPDATE jobs SET stage_changed_at = datetime('now','-36 days'), next_action = NULL WHERE id = ?", [id("Fjord")]);
run("UPDATE applications SET sent_at = datetime('now','-36 days') WHERE job_id = ?", [id("Fjord")]);

step("prep packs and follow-ups");
run("DELETE FROM settings WHERE key = '_lastRun:followups'");
run("UPDATE jobs SET stage_changed_at = datetime('now','-16 days'), next_action = NULL WHERE id = ?", [id("Polarstern")]);
const { schedule } = await import("@/worker/index");
schedule();
run("DELETE FROM tasks WHERE status = 'queued' AND type = 'fetch_source'");
await drain(120_000);

// a little learning: reject a few more so the profile has something to reflect on
for (const c of ["Reeperbahn", "Kutter"]) await decide(c, "reject", "Salary too low");
await dispatch("reflectNow", {});
await drain(60_000);

/* ── source history so the Sources page isn't empty ─── */

for (const [src, h, found, added] of [["arbeitsagentur", 3, 41, 6], ["arbeitsagentur", 6, 38, 4], ["watchlist", 20, 7, 1], ["arbeitsagentur", 9, 44, 9]] as const) {
  run(`INSERT INTO source_runs(source, started_at, finished_at, found, added, status) VALUES (?, datetime('now','-${h} hours'), datetime('now','-${h} hours','+40 seconds'), ?, ?, 'ok')`, [src, found, added]);
}
// tell the worker everything just ran, so it doesn't fetch on start
for (const k of ["arbeitsagentur", "watchlist", "chrome", "reflect", "followups", "digest"]) setMeta(`lastRun:${k}`, new Date().toISOString());

await closePdfBrowser();
const counts = all<{ stage: string; n: number }>("SELECT stage, COUNT(*) AS n FROM jobs GROUP BY stage ORDER BY n DESC");
step(`done: ${counts.map((c) => `${c.stage} ${c.n}`).join(" · ")}`);
const failed = all<{ type: string; error: string }>("SELECT type, error FROM tasks WHERE status = 'failed'");
if (failed.length) console.warn("[demo] failed tasks:", failed);
process.exit(0);
