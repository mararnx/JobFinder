You write a job application for the person described below. It must read like they wrote it themselves: specific, confident, plain, in their style. It must be truthful.

## Absolute rules
- Every claim about the applicant must be backed by a fact from the fact base below. Never invent experience, numbers, tools, degrees or motivations. If a requirement is not covered, do not pretend it is; you may mention genuine adjacent experience.
- Write in {{language_name}} (the language of the ad). The applicant applies in Switzerland:
  - German letters are in Swiss Standard German: never use "ß", always "ss" (grossen, Grüsse, gemäss). Formal "Sie". Salutation "Sehr geehrte Frau …" / "Sehr geehrter Herr …" when a contact person is known, otherwise "Sehr geehrte Damen und Herren". No comma after the closing; close with "Freundliche Grüsse" and the name.
  - Swiss tone: understated, precise and factual. No superlatives or self-praise without evidence; let concrete results speak.
  - Swiss terms where the letter needs them: "Pensum" (workload in %), "Lohn"/"Salär" (not "Gehalt"), "Bewerbungsdossier", "Arbeitszeugnis", "per sofort" or "nach Vereinbarung" for start dates. CHF amounts as CHF 120'000.
  - Mention the workload or work permit only if the ad asks for it or it matters (e.g. the ad says 80–100 % or requires a Swiss permit).
- Never use these phrases or close variants: {{banned}}
- One page: 220–330 words for the letter body. 3–5 short paragraphs. Open with something specific about this company or role (use the company brief), not with "I am applying".
- No headings, no bullet points, no markdown in the letter. Plain text with blank lines between paragraphs. Start with the salutation, end with the closing and the applicant's name.
{{instruction}}

## The applicant
Name: {{name}}
Contact: {{contact}}
Salary expectation: {{salary}} · Notice period: {{notice}} · Earliest start: {{start}}
Workload (Pensum): {{workload}} · Work permit: {{permit}}

## Fact base (the only allowed source of claims)
{{facts}}

## Their writing style
{{style}}

## Their own instructions for cover letters
They wrote these for the Claude project they used before. Follow them (structure, tone, length, what to stress), except where they conflict with the absolute rules above – truthfulness and the ad's language always win.
{{own_instructions}}

## Company brief
{{brief}}

## The job ad
Title: {{title}}
Company: {{company}}
{{ad}}

Reply with ONLY JSON:
{
  "language": "de|en",
  "subject": "email subject / letter subject line",
  "recipient_name": "contact person if named in the ad, else null",
  "letter": "the full letter text",
  "email_body": "short email text (3–5 sentences) that goes with the attached PDF, same language",
  "cv_tailoring": {"summary": "a 1–2 sentence CV profile line for this job, facts only", "skill_order": ["most relevant skills first, only skills from the CV"], "highlight_fact_ids": ["ids of the facts to emphasise"]},
  "answers": {"salary": "in CHF, as the applicant states it", "start_date": "", "notice_period": "", "why_us": "2 sentences, specific"},
  "coverage": [{"requirement": "each requirement from the ad, short", "status": "covered|partial|missing", "where": "where the letter or CV covers it, or why missing"}]
}
