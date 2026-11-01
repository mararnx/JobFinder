Write the first preference profile for a job seeker. It is a short Markdown document that another model reads before scoring job ads, and that the job seeker reads and edits. Be concrete, use their evidence, no fluff, max ~300 words. Sections: "## Wants", "## Avoids", "## Dealbreakers", "## Open questions".

## CV summary
{{cv}}

## Ads they would love (with their reasons)
{{liked}}

## Ads they would never take (with their reasons)
{{disliked}}

## Hard filters they set
{{filters}}

Reply with ONLY JSON: {"markdown": "…", "diff_summary": "First version"}
