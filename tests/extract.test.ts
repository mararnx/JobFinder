import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { careerPageLinks, frictionReason, jobPostingFromHtml, listingLinks } from "@/lib/sources/extract";
import { detectAts, parsePersonioXml } from "@/lib/sources/ats";
import { toRaw } from "@/lib/sources/arbeitsagentur";

const LD = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"JobPosting","title":"Product Owner (m/w/d)","identifier":{"@type":"PropertyValue","value":"12345"},
"hiringOrganization":{"@type":"Organization","name":"Contoro GmbH"},"jobLocation":{"@type":"Place","address":{"addressLocality":"Hamburg"}},
"baseSalary":{"@type":"MonetaryAmount","currency":"EUR","value":{"minValue":70000,"maxValue":85000,"unitText":"YEAR"}},"datePosted":"2026-10-20","description":"&lt;p&gt;Du verantwortest &lt;b&gt;die Roadmap&lt;/b&gt;.&lt;/p&gt;","employmentType":["FULL_TIME"]}]}</script></head></html>`;

test("JSON-LD JobPosting extraction", () => {
  const j = jobPostingFromHtml(LD, "https://x.de/job", "stepstone")!;
  assert.equal(j.title, "Product Owner (m/w/d)");
  assert.equal(j.company, "Contoro GmbH");
  assert.equal(j.location, "Hamburg");
  assert.equal(j.sourceId, "12345");
  assert.match(j.salaryText!, /70000 – 85000 EUR/);
  assert.match(j.description, /Du verantwortest die Roadmap/);
  assert.equal(jobPostingFromHtml("<html>no data</html>", "u", "x"), null);
});

test("portal listing links", () => {
  const ss = `<a href="/stellenangebote--Product-Owner-Hamburg-Contoro--1234567-inline.html">a</a><a href="/stellenangebote--Product-Owner-Hamburg-Contoro--1234567-inline.html?x=1">dup</a><a href="/other">x</a>`;
  assert.deepEqual(listingLinks(ss, "https://www.stepstone.de/jobs/x", "stepstone").map((l) => l.id), ["1234567"]);
  const indeed = `<a href="/rc/clk?jk=abcdef0123456789&amp;from=serp">a</a><a href="/viewjob?jk=1111222233334444">b</a>`;
  assert.deepEqual(listingLinks(indeed, "https://de.indeed.com/jobs", "indeed").map((l) => l.url), ["https://de.indeed.com/viewjob?jk=abcdef0123456789", "https://de.indeed.com/viewjob?jk=1111222233334444"]);
  const li = `<a href="https://de.linkedin.com/jobs/view/product-owner-at-contoro-4012345678?trk=x">a</a>`;
  assert.equal(listingLinks(li, "https://www.linkedin.com/jobs/search", "linkedin")[0].id, "4012345678");
  const xing = `<a href="/jobs/hamburg-product-owner-123456789">a</a>`;
  assert.equal(listingLinks(xing, "https://www.xing.com/jobs/search", "xing")[0].id, "123456789");
});

test("friction detection stops on CAPTCHAs and logins", () => {
  assert.match(frictionReason('<div class="g-recaptcha"></div>', "https://www.stepstone.de/x")!, /CAPTCHA/);
  assert.match(frictionReason("<p>We detected unusual traffic</p>", "https://de.indeed.com/jobs")!, /Bot check/);
  assert.match(frictionReason("<html></html>", "https://www.linkedin.com/authwall?x")!, /Login/);
  assert.equal(frictionReason("<html><body>Jobs</body></html>", "https://www.stepstone.de/jobs/po"), null);
  // seen live: LinkedIn sends logged-out searches to its home page, which loads captcha scripts
  assert.match(frictionReason('<script src="https://www.google.com/recaptcha/api.js"></script>', "https://www.linkedin.com/")!, /Login required/);
  assert.match(frictionReason('<a>Mitglied werden</a><a>Einloggen</a><script src="/recaptcha.js"></script>', "https://www.linkedin.com/jobs/search/?keywords=po")!, /Login required/);
  assert.equal(frictionReason('<ul class="jobs-search__results-list"><li class="base-search-card">PO</li></ul><a>Einloggen</a>', "https://www.linkedin.com/jobs/search/?keywords=po"), null);
  // seen live: a normal LinkedIn results page carries recaptcha config flags – not a challenge
  assert.equal(frictionReason('<body data-recaptcha-v3-integration-lix-value="enabled"><ul class="jobs-search__results-list"><li class="base-search-card">PM</li></ul><a>Einloggen</a></body>', "https://www.linkedin.com/jobs/search/?keywords=pm"), null);
  // seen live: Indeed's Cloudflare block page
  assert.match(frictionReason("<h1>Anfrage blockiert</h1><p>Sie wurden gesperrt.</p>", "https://de.indeed.com/jobs?q=po")!, /Blocked by the site/);
});

test("public feeds: RSS items, Berlin Startup Jobs titles, service.bund.de employer and place", async () => {
  const { parseRss, bundMeta } = await import("@/lib/sources/feeds");
  const xml = `<rss><channel><item><title>Senior Product Manager (all genders) // GeneralMind</title><link>https://berlinstartupjobs.com/x/</link><description><![CDATA[<p>About</p>]]></description><pubDate>Thu, 29 Oct 2026 15:11:46 +0000</pubDate><guid>g1</guid></item>
<item><title>Referent*in f&#252;r Digitales (m/w/d)</title><link>https://www.service.bund.de/IMPORTE/1.html#track=feed-jobs</link><description><![CDATA[Arbeitgeber: <strong>Bundesministerium f&#252;r Gesundheit</strong><br /> Ort: <strong>10117 Berlin</strong>]]></description><guid>https://www.service.bund.de/IMPORTE/1.html</guid></item></channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Senior Product Manager (all genders) // GeneralMind");
  assert.equal(items[1].title, "Referent*in für Digitales (m/w/d)");
  assert.equal(items[1].link, "https://www.service.bund.de/IMPORTE/1.html", "tracking suffix removed");
  assert.deepEqual(bundMeta(items[1].description), { employer: "Bundesministerium für Gesundheit", place: "Berlin" });
});

test("careers page links follow keywords", () => {
  const html = `<a href="/jobs/1">Senior Product Owner (m/w/d)</a><a href="/jobs/2">Werkstudent Marketing</a><a href="https://evil.example.com/po">Product Owner</a><a href="https://boards.greenhouse.io/x/jobs/9">Product Owner Data</a>`;
  assert.deepEqual(careerPageLinks(html, "https://karriere.firma.de/", ["product owner"]), ["https://karriere.firma.de/jobs/1", "https://boards.greenhouse.io/x/jobs/9"]);
});

test("ATS detection from careers URLs", () => {
  assert.deepEqual(detectAts("https://boards.greenhouse.io/celonis"), { type: "greenhouse", token: "celonis" });
  assert.deepEqual(detectAts("https://job-boards.greenhouse.io/celonis/jobs/1"), { type: "greenhouse", token: "celonis" });
  assert.deepEqual(detectAts("jobs.lever.co/acme"), { type: "lever", token: "acme" });
  assert.deepEqual(detectAts("https://contoro.jobs.personio.de/"), { type: "personio", token: "contoro.jobs.personio.de" });
  assert.deepEqual(detectAts("https://careers.smartrecruiters.com/BoschGroup"), { type: "smartrecruiters", token: "BoschGroup" });
  assert.deepEqual(detectAts("https://acme.recruitee.com/o/po"), { type: "recruitee", token: "acme" });
  assert.equal(detectAts("https://www.firma.de/karriere").type, "page");
  assert.throws(() => detectAts("not a url at all ::"));
});

test("Personio XML parsing filters by keyword and Germany", () => {
  const xml = `<workzag-jobs><position><id>11</id><office>Hamburg</office><name>Product Owner (m/w/d)</name><schedule>full-time</schedule><createdAt>2026-10-01</createdAt>
  <jobDescriptions><jobDescription><name>Deine Aufgaben</name><value><![CDATA[<ul><li>Roadmap</li></ul>]]></value></jobDescription></jobDescriptions></position>
  <position><id>12</id><office>London</office><name>Product Owner</name></position><position><id>13</id><office>Berlin</office><name>Sales Manager</name></position></workzag-jobs>`;
  const jobs = parsePersonioXml(xml, "contoro.jobs.personio.de", { company: "Contoro", keywords: ["Product Owner"] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, "https://contoro.jobs.personio.de/job/11");
  assert.match(jobs[0].description, /Roadmap/);
});

test("Arbeitsagentur detail maps to a raw job (real API sample)", () => {
  const detail = JSON.parse(fs.readFileSync("tests/fixtures/ba-detail.json", "utf8"));
  const raw = toRaw(detail, "Hamburg");
  assert.equal(raw.source, "arbeitsagentur");
  assert.equal(raw.sourceId, detail.referenznummer);
  assert.equal(raw.location, "Hamburg");
  assert.match(raw.salaryText!, /60000 – 80000/);
  assert.ok(raw.description.length > 100);
});
