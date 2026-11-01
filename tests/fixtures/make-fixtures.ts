// Generates fictional sample documents for tests and demos (no real person).
import fs from "node:fs";
import { closePdfBrowser, htmlToPdf } from "@/lib/pipeline/pdf";

const cv = `<h1>Alex Neumann</h1><p>Senior Product Manager · B2B SaaS · alex.neumann@example.com · +49 151 0000000 · Hamburg</p>
<h2>Berufserfahrung</h2>
<p><b>Senior Product Manager, Contoro GmbH, Hamburg</b> 03/2022 – heute</p>
<ul><li>Verantwortung für die Roadmap der B2B-Plattform für 140 Industriekunden</li><li>Discovery-Interviews eingeführt; Zeit bis zum ersten Mehrwert von 11 auf 4 Wochen gesenkt</li><li>Team aus 9 Entwicklern und 2 Designern geführt (fachlich)</li><li>SQL-Auswertungen und Dashboards in Metabase selbst erstellt</li></ul>
<p><b>Product Owner, Brandt AG, Hamburg</b> 01/2019 – 02/2022</p>
<ul><li>Self-Service-Portal für 60.000 Geschäftskunden verantwortet</li><li>Conversion im Onboarding um 23 % gesteigert</li><li>Scrum mit zwei Teams eingeführt</li></ul>
<p><b>Business Analyst, Nordwind Logistik GmbH, Bremen</b> 08/2016 – 12/2018</p>
<ul><li>Anforderungen für das Transportmanagementsystem aufgenommen</li></ul>
<h2>Ausbildung</h2><p>M.Sc. Wirtschaftsinformatik, Universität Hamburg, 2014 – 2016</p>
<h2>Kenntnisse</h2><p>Product Discovery, Roadmapping, SQL, Metabase, Jira, Scrum, Kanban, Stakeholder-Management</p>
<h2>Sprachen</h2><p>Deutsch (Muttersprache), Englisch (verhandlungssicher)</p>`;

const letter = `Sehr geehrte Frau Krüger,

als ich las, dass Brandt das Geschäftskundenportal neu aufsetzt, wusste ich, dass ich dabei sein möchte. Seit drei Jahren analysiere ich bei Nordwind, wo Kunden im Prozess hängen bleiben – und genau das ist der Kern Ihrer Ausschreibung.

Bei Nordwind habe ich die Anforderungen für unser Transportmanagementsystem aufgenommen und mit den Entwicklern priorisiert. Zahlen sind mir dabei wichtiger als Bauchgefühl.

Ich freue mich auf ein Gespräch.

Viele Grüße
Alex Neumann`;

const zeugnis = `<h1>Arbeitszeugnis</h1><p>Brandt AG, Hamburg</p><p>Herr Alex Neumann war vom 01/2019 bis 02/2022 als Product Owner in unserem Unternehmen tätig.</p>
<p>Er verantwortete das Self-Service-Portal für unsere Geschäftskunden und steigerte die Conversion im Onboarding deutlich. Herr Neumann erledigte seine Aufgaben stets zu unserer vollsten Zufriedenheit. Sein Verhalten gegenüber Vorgesetzten und Kollegen war stets einwandfrei.</p>
<p>Wir bedauern sein Ausscheiden und wünschen ihm für die Zukunft alles Gute.</p>`;

const css = `<style>body{font:11pt Helvetica,Arial,sans-serif;margin:20mm}h1{font-size:20pt}h2{font-size:12pt;margin-top:8mm}</style>`;
const dir = "tests/fixtures/docs";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/Lebenslauf_Alex_Neumann.pdf`, await htmlToPdf(`<meta charset="utf-8">${css}${cv}`));
fs.writeFileSync(`${dir}/Anschreiben_Brandt_2019.txt`, letter);
fs.writeFileSync(`${dir}/Zeugnis_Brandt_AG.pdf`, await htmlToPdf(`<meta charset="utf-8">${css}${zeugnis}`));
await closePdfBrowser();
console.log("fixtures written");
