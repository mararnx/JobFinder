import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTitle, detectLanguage, extractEmail, looksLikeAgency, normCompany, normTitle, parseSalary, similarity, stripHtml } from "@/lib/text";

test("titles lose gender markers and normalise", () => {
  assert.equal(cleanTitle("Product Owner (m/w/d)"), "Product Owner");
  assert.equal(cleanTitle("Produktmanager*in (all genders)"), "Produktmanager");
  assert.equal(normTitle("Senior Product Manager (m/f/d) – Energy"), normTitle("senior product manager - energy"));
});

test("company names drop legal forms", () => {
  assert.equal(normCompany("Brandt AG"), "brandt");
  assert.equal(normCompany("Contoro GmbH & Co. KG"), normCompany("Contoro"));
});

test("salary parsing", () => {
  assert.deepEqual(parseSalary("60000 – 80000 € pro Jahr"), { min: 60000, max: 80000 });
  assert.deepEqual(parseSalary("Gehalt: 65.000 - 75.000 EUR"), { min: 65000, max: 75000 });
  assert.deepEqual(parseSalary("70k – 85k €"), { min: 70000, max: 85000 });
  assert.deepEqual(parseSalary("ab 72.000 € brutto"), { min: 72000, max: 72000 });
  assert.equal(parseSalary("attraktives Gehalt"), null);
  assert.equal(parseSalary("2 – 3 Tage remote, 30 Urlaubstage"), null);
});

test("agency detection", () => {
  assert.ok(looksLikeAgency("Hays AG", ""));
  assert.ok(looksLikeAgency("Talent Partners", "Für unseren Kunden, ein Mittelständler, suchen wir"));
  assert.ok(!looksLikeAgency("Contoro GmbH", "Wir suchen dich für unser Produktteam"));
});

test("language, email, html, similarity", () => {
  assert.equal(detectLanguage("Wir suchen dich für unser Team und die Plattform"), "de");
  assert.equal(detectLanguage("We are looking for you to join our team and the platform"), "en");
  assert.equal(extractEmail("Bewerbung an jobs@firma.de."), "jobs@firma.de");
  assert.equal(extractEmail("noreply@firma.de"), null);
  assert.equal(stripHtml("<p>A &amp; B</p><ul><li>x</li></ul>").replace(/\s+/g, " ").trim(), "A & B • x");
  assert.ok(similarity("product owner b2b platform roadmap", "b2b platform product owner") > similarity("product owner b2b", "forklift driver warehouse"));
});
