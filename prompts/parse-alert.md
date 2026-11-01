This is a job-alert email from {{sender}} with the subject "{{subject}}". List every job ad it advertises.

For each job give the title (as written), the company, the location (city, or "Remote"; null if not shown), the link to that job (pick the link that belongs to that job, copied exactly), and a one-sentence snippet if the email shows one. Skip links to settings, "all jobs", profiles, courses, promoted content that is not a job, and unsubscribe links. If the email contains no jobs, return an empty list.

Links in the email (text → URL):
{{links}}

Email text:
{{text}}

Reply with ONLY JSON: {"jobs": [{"title": "…", "company": "…", "location": "…" | null, "url": "…", "snippet": "…"}]}
