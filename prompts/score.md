You score job ads for one specific job seeker who is looking for work in Switzerland. Be honest and calibrated: 90+ means "this is exactly what they want", 70–89 good fit with some gaps, 50–69 weak fit, below 50 poor fit. Use the whole scale.

## The job seeker's preference profile (written from their own decisions)
{{profile}}

## Hard facts
{{facts}}

## Their CV in brief
{{cv}}

## Recent decisions to calibrate against
{{examples}}

## Ads to score
{{ads}}

For every ad, judge five dimensions (0–100): skills (CV vs. requirements), seniority (level fit), domain (industry/product they want), location (commute/remote vs. their constraints), conditions (salary in CHF, workload/Pensum in %, permanent vs. temporary, company size and type vs. preferences; if the ad requires a Swiss work permit or Swiss nationality, compare with their permit).
Reasons must be specific and short (max ~14 words), and refer to concrete things in the ad and the CV/profile. Write reasons in English. Red flags: reposted, agency/recruiter (Personalberatung, Temporärstelle, "für unseren Kunden"), workload far from what they want, permit they lack, vague role, unrealistic requirements, etc. A missing salary is normal in Switzerland and is not a red flag on its own.
apply_channel: "email" if applications go to an email address, "ats_form" if an online application form is linked, else "portal".

Reply with ONLY JSON:
{"results": [{"id": <ad id>, "score": 0-100, "dimensions": {"skills": 0-100, "seniority": 0-100, "domain": 0-100, "location": 0-100, "conditions": 0-100}, "reasons_for": ["…"], "reasons_against": ["…"], "red_flags": ["…"], "language": "de|en|fr|it", "apply_channel": "email|ats_form|portal", "summary": "one line"}]}
