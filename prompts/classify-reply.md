This email arrived after the job seeker applied for "{{title}}" at {{company}}. Say what kind of reply it is.

- "receipt": an automatic or polite confirmation that the application arrived (Eingangsbestätigung), with no decision yet.
- "rejection": the company declines (Absage), even if it is friendly or says to apply again later.
- "invitation": they want to talk – an interview, a call, a test task, or they ask for a date.
- "other": anything else that needs a human answer (a question, missing documents, a salary question).

Give a one-sentence summary in English, and for "invitation" or "other" the next thing the job seeker should do, in a few words (e.g. "Pick an interview slot", "Send the missing certificate"); otherwise null.

From: {{from}}
Subject: {{subject}}

{{text}}

Reply with ONLY JSON: {"kind": "receipt" | "rejection" | "invitation" | "other", "summary": "…", "next_action": "…" | null}
