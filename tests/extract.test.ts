import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { careerPageLinks, frictionReason, jobPostingFromHtml, listingLinks } from "@/lib/sources/extract";
import { detectAts, parsePersonioXml } from "@/lib/sources/ats";
import { cleanDescription, jobroomToRaw, searchBody, workload } from "@/lib/sources/jobroom";

const LD = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"JobPosting","title":"Product Owner (m/w/d)","identifier":{"@type":"PropertyValue","value":"12345"},
"hiringOrganization":{"@type":"Organization","name":"Contoro AG"},"jobLocation":{"@type":"Place","address":{"addressLocality":"Zürich"}},
"baseSalary":{"@type":"MonetaryAmount","currency":"CHF","value":{"minValue":110000,"maxValue":130000,"unitText":"YEAR"}},"datePosted":"2026-10-20","description":"&lt;p&gt;Du verantwortest &lt;b&gt;die Roadmap&lt;/b&gt;.&lt;/p&gt;","employmentType":["FULL_TIME"]}]}</script></head></html>`;

test("JSON-LD JobPosting extraction", () => {
  const j = jobPostingFromHtml(LD, "https://x.ch/job", "jobsch")!;
  assert.equal(j.title, "Product Owner (m/w/d)");
  assert.equal(j.company, "Contoro AG");
  assert.equal(j.location, "Zürich");
  assert.equal(j.sourceId, "12345");
  assert.match(j.salaryText!, /110000 – 130000 CHF/);
  assert.match(j.description, /Du verantwortest die Roadmap/);
  assert.equal(jobPostingFromHtml("<html>no data</html>", "u", "x"), null);
});

test("portal listing links", () => {
  // real jobs.ch markup (seen live)
  const jc = `<a href="/de/stellenangebote/detail/212d7fc2-70e1-499f-a261-bdec3b7eaf27/">a</a><a href="/de/stellenangebote/detail/212d7fc2-70e1-499f-a261-bdec3b7eaf27/?source=x">dup</a><a href="/de/stellenangebote/">x</a>`;
  assert.deepEqual(listingLinks(jc, "https://www.jobs.ch/de/stellenangebote/?term=po", "jobsch").map((l) => l.url), ["https://www.jobs.ch/de/stellenangebote/detail/212d7fc2-70e1-499f-a261-bdec3b7eaf27/"]);
  const indeed = `<a href="/rc/clk?jk=abcdef0123456789&amp;from=serp">a</a><a href="/viewjob?jk=1111222233334444">b</a>`;
  assert.deepEqual(listingLinks(indeed, "https://ch.indeed.com/jobs", "indeed").map((l) => l.url), ["https://ch.indeed.com/viewjob?jk=abcdef0123456789", "https://ch.indeed.com/viewjob?jk=1111222233334444"]);
  const li = `<a href="https://de.linkedin.com/jobs/view/product-owner-at-contoro-4012345678?trk=x">a</a>`;
  assert.equal(listingLinks(li, "https://www.linkedin.com/jobs/search", "linkedin")[0].id, "4012345678");
  const xing = `<a href="/jobs/hamburg-product-owner-123456789">a</a>`;
  assert.equal(listingLinks(xing, "https://www.xing.com/jobs/search", "xing")[0].id, "123456789");
});

test("friction detection stops on CAPTCHAs and logins", () => {
  assert.match(frictionReason('<div class="g-recaptcha"></div>', "https://www.jobs.ch/x")!, /CAPTCHA/);
  assert.match(frictionReason("<p>We detected unusual traffic</p>", "https://ch.indeed.com/jobs")!, /Bot check/);
  assert.match(frictionReason("<html></html>", "https://www.linkedin.com/authwall?x")!, /Login/);
  assert.equal(frictionReason("<html><body>Jobs</body></html>", "https://www.jobs.ch/de/stellenangebote/?term=po"), null);
  // seen live: LinkedIn sends logged-out searches to its home page, which loads captcha scripts
  assert.match(frictionReason('<script src="https://www.google.com/recaptcha/api.js"></script>', "https://www.linkedin.com/")!, /Login required/);
  assert.match(frictionReason('<a>Mitglied werden</a><a>Einloggen</a><script src="/recaptcha.js"></script>', "https://www.linkedin.com/jobs/search/?keywords=po")!, /Login required/);
  assert.equal(frictionReason('<ul class="jobs-search__results-list"><li class="base-search-card">PO</li></ul><a>Einloggen</a>', "https://www.linkedin.com/jobs/search/?keywords=po"), null);
  // seen live: a normal LinkedIn results page carries recaptcha config flags – not a challenge
  assert.equal(frictionReason('<body data-recaptcha-v3-integration-lix-value="enabled"><ul class="jobs-search__results-list"><li class="base-search-card">PM</li></ul><a>Einloggen</a></body>', "https://www.linkedin.com/jobs/search/?keywords=pm"), null);
  // seen live: Indeed's Cloudflare block page
  assert.match(frictionReason("<h1>Anfrage blockiert</h1><p>Sie wurden gesperrt.</p>", "https://ch.indeed.com/jobs?q=po")!, /Blocked by the site/);
});

test("public feeds: RSS items and SwissDevJobs entries", async () => {
  const { parseRss, swissDevJobToRaw } = await import("@/lib/sources/feeds");
  const xml = `<rss><channel><item><title>Referent*in f&#252;r Digitales (m/w/d)</title><link>https://example.ch/jobs/1.html#track=feed-jobs</link><description><![CDATA[<p>About</p>]]></description><guid>g1</guid></item></channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items[0].title, "Referent*in für Digitales (m/w/d)");
  assert.equal(items[0].link, "https://example.ch/jobs/1.html", "tracking suffix removed");
  const j = swissDevJobToRaw({ _id: "abc", jobUrl: "Bitshifter-GmbH-Software-Entwickler", name: "Software-Entwickler (m/w/d), 60-100%", company: "Bitshifter GmbH", actualCity: "Aarau", annualSalaryFrom: "85000", annualSalaryTo: "110000", workplace: "hybrid", language: "German", activeFrom: "2026-11-09T00:00:00.000+01:00" });
  assert.equal(j.url, "https://swissdevjobs.ch/jobs/Bitshifter-GmbH-Software-Entwickler");
  assert.equal(j.salaryText, "CHF 85000 – 110000 pro Jahr");
  assert.equal(j.location, "Aarau");
  assert.equal(j.remote, "hybrid");
  assert.equal(j.language, "de");
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
  const xml = `<workzag-jobs><position><id>11</id><office>Zürich</office><name>Product Owner (m/w/d)</name><schedule>full-time</schedule><createdAt>2026-10-01</createdAt>
  <jobDescriptions><jobDescription><name>Deine Aufgaben</name><value><![CDATA[<ul><li>Roadmap</li></ul>]]></value></jobDescription></jobDescriptions></position>
  <position><id>12</id><office>London</office><name>Product Owner</name></position><position><id>13</id><office>Berlin</office><name>Sales Manager</name></position></workzag-jobs>`;
  const jobs = parsePersonioXml(xml, "contoro.jobs.personio.de", { company: "Contoro", keywords: ["Product Owner"] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].url, "https://contoro.jobs.personio.de/job/11");
  assert.match(jobs[0].description, /Roadmap/);
});

test("Job-Room detail maps to a raw job (real API sample)", () => {
  const detail = JSON.parse(fs.readFileSync("tests/fixtures/jobroom-detail.json", "utf8"));
  const raw = jobroomToRaw(detail);
  assert.equal(raw.source, "jobroom");
  assert.equal(raw.sourceId, detail.id);
  assert.equal(raw.title, "Projektleiter Brandschutz");
  assert.equal(raw.company, "Hays (Schweiz) AG");
  assert.equal(raw.location, "Zürich ZH");
  assert.match(raw.url!, /^https:\/\/www\.jobs\.ch\//, "scheme added to the scheme-less portal link");
  assert.match(raw.employmentType!, /full-time, 100 %/);
  assert.doesNotMatch(raw.description, /meta-viewport|\\-|\*\*/, "front matter, escapes and bold markers removed");
  assert.match(raw.description, /• Selbständige Erarbeitung/);
  assert.equal(workload("80", "100"), "80 – 100 %");
  assert.equal(cleanDescription("<em>PO</em> \\& Team"), "PO & Team");
  const body = searchBody({ keyword: "Product Owner", location: "Zürich", radiusKm: 25, days: 7 }, { lat: 47.36, lon: 8.49 });
  assert.deepEqual(body.keywords, ["Product Owner"]);
  assert.deepEqual(body.radiusSearchRequest, { geoPoint: { lat: 47.36, lon: 8.49 }, distance: 25 });
});
