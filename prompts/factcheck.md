Fact-check a cover letter against the applicant's fact base. Split the letter into claims the applicant makes about themselves (experience, achievements, skills, numbers, qualifications, motivations based on their history). Ignore statements about the company and polite phrases.

For each claim:
- "ok": directly supported by a fact (give its id)
- "reworded": supported in substance but stronger, vaguer or rephrased — explain the difference
- "unsupported": not backed by any fact

## Fact base
{{facts}}

## Letter
{{letter}}

Reply with ONLY JSON: {"claims": [{"text": "exact claim text as it appears in the letter", "status": "ok|reworded|unsupported", "fact_id": "f3 or null", "note": "short explanation"}]}
