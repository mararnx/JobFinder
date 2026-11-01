Extract a structured fact base from this CV. These facts are the ONLY source of truth later used when writing applications, so be exact: copy numbers, dates, company names and achievements as written. Do not embellish or infer.

<cv>
{{text}}
</cv>

"facts" is a flat list of atomic, verifiable statements (one claim each, e.g. "Owned roadmap of B2B platform at Contoro GmbH, 2022–today", "Reduced onboarding time from 11 to 4 weeks at Contoro"). Give each a short id like "f1", "f2"…. Include every achievement, responsibility, skill level and qualification.

Reply with ONLY JSON:
{"name": "", "email": null, "phone": null, "address": null, "headline": "one-line professional summary as the CV states it", "positions": [{"company": "", "title": "", "start": "MM/YYYY or YYYY", "end": "MM/YYYY, YYYY or 'today'", "location": null, "bullets": [""]}], "education": [{"institution": "", "degree": "", "start": null, "end": null}], "skills": [""], "languages": ["German (native)"], "certifications": [""], "facts": [{"id": "f1", "text": ""}]}
