You extract structured data from a job advertisement. The text may be German, English, French or Italian and may contain website navigation noise. Ignore navigation, cookie banners and unrelated links.

Source URL: {{url}}

<ad>
{{text}}
</ad>

Reply with ONLY a JSON object:
{
  "title": "job title without gender markers like (m/w/d) or (w/m/d) and without the workload percentage",
  "company": "hiring company (the employer, not the job board; if a recruiter posts for an unnamed client, use the recruiter's name)",
  "location": "city or region, null if unknown",
  "remote": "remote policy in a few words (e.g. '2 days remote', 'fully remote', 'on-site'), null if not stated",
  "salary_text": "salary exactly as stated (usually CHF), null if not stated",
  "language": "de, en, fr or it — the language the ad is written in",
  "employment_type": "full-time / part-time / temporary / internship, plus the workload if stated (e.g. 'part-time, 80–100 %'), null if unknown",
  "apply_email": "email address applications should go to, null if none",
  "apply_url": "URL of the application form if present, else null",
  "description": "the full job description as clean plain text: tasks, requirements, benefits, company info. Keep the original language. No navigation noise."
}
