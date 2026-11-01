/** New sources: Adzuna/Jooble mapping and job-alert emails (MIME decoding, link extraction, ids). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { adzunaToRaw, joobleToRaw } from "@/lib/sources/apis";
import { alertJobId, guessAlertJobs, mailBody, mailLinks, portalOf } from "@/lib/sources/alerts";
import { ALERT } from "./fixtures/alert-email";

test("Adzuna results map to jobs; estimated salaries are dropped", () => {
  const j = adzunaToRaw({ id: "4711", title: "<strong>Product</strong> Manager (m/w/d)", description: "Wir suchen…", created: "2026-10-30T08:00:00Z", redirect_url: "https://www.adzuna.de/land/ad/4711", company: { display_name: "Cosuno GmbH" }, location: { display_name: "Berlin, Deutschland" }, salary_min: 70000, salary_max: 85000, salary_is_predicted: "0", contract_time: "full_time" });
  assert.equal(j.title, "Product Manager (m/w/d)");
  assert.equal(j.company, "Cosuno GmbH");
  assert.equal(j.salaryText, "70000 – 85000 € pro Jahr");
  assert.equal(j.publishedAt, "2026-10-30");
  assert.equal(adzunaToRaw({ id: "1", title: "PM", description: "", created: "", redirect_url: "x", salary_min: 60000, salary_is_predicted: "1" }).salaryText, null);
});

test("Jooble results map to jobs", () => {
  const j = joobleToRaw({ id: -123, title: "Senior Product Owner", location: "Berlin", snippet: "&nbsp;Du verantwortest <b>Roadmap</b>&nbsp;...", salary: "", link: "https://jooble.org/desc/-123", company: "Mister Spex", updated: "2026-10-31T10:00:00.000" });
  assert.equal(j.sourceId, "-123");
  assert.equal(j.company, "Mister Spex");
  assert.match(j.description, /Du verantwortest\s+Roadmap/);
  assert.equal(j.salaryText, null);
});

test("alert emails: MIME decoding, links, job guesses, stable ids", () => {
  const { html, text } = mailBody(ALERT);
  assert.ok(html?.includes("Müller GmbH"), "quoted-printable UTF-8 decoded");
  assert.match(text, /Superchat/);
  const links = mailLinks(html!);
  assert.equal(links[1].text, "Senior Product Owner – Payments", "soft line break joined");
  const jobs = guessAlertJobs(html!, "jobalerts-noreply@linkedin.com");
  assert.deepEqual(jobs.map((j) => j.title), ["Product Manager", "Senior Product Owner – Payments"], "settings, search and unsubscribe links skipped");
  assert.equal(portalOf("jobalerts-noreply@linkedin.com"), "linkedin");
  assert.equal(alertJobId(jobs[0].url, "linkedin"), "linkedin:4012345678");
  assert.equal(alertJobId("https://www.stepstone.de/stellenangebote--PO-Berlin-Firma--12345678-inline.html?utm_source=mail", "stepstone"), "stepstone:12345678");
  assert.equal(alertJobId("https://jobs.example.com/x?id=9&utm_source=a&trk=b", "other"), "https://jobs.example.com/x?id=9");
});

test("base64 parts decode", () => {
  const raw = ['Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", Buffer.from('<a href="https://de.indeed.com/rc/clk?jk=abcdef1234567890">Produktmanager (m/w/d)</a>').toString("base64")].join("\n");
  assert.equal(guessAlertJobs(mailBody(raw).html!, "alert@indeed.com")[0].title, "Produktmanager (m/w/d)");
});
