/**
 * Watches Gmail for what happens after approval: an application leaving from Gmail moves the job to Applied,
 * and a company's reply is read by Claude (receipt, rejection, invitation, other) and moves the job on the board.
 */
import { all, getSettings, logEvent, run } from "@/lib/db";
import { claude, renderPrompt } from "@/lib/claude/runner";
import { MailReply } from "@/lib/claude/schemas";
import { dryRun, readConversations, type RawMail } from "@/lib/gmail";
import { setStage, type Stage } from "@/lib/jobs";
import { notify } from "@/lib/notify";
import { meta, setMeta } from "@/lib/queue";
import { truncate } from "@/lib/text";
import { mailBody } from "@/lib/sources/alerts";
import { markSent } from "./drafting";

// a reply from one of these says nothing about the company, so only the exact address counts
const FREEMAIL = new Set(["gmail.com", "googlemail.com", "web.de", "gmx.de", "gmx.net", "t-online.de", "outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "yahoo.com", "yahoo.de", "icloud.com", "me.com", "posteo.de", "mail.de", "freenet.de", "aol.com"]);

type Watched = { id: number; title: string; company: string; stage: Stage; apply_email: string; since: string };

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
/** What to search Gmail for: the company's domain, or the exact address for free-mail senders. */
const termOf = (email: string) => (FREEMAIL.has(domainOf(email)) ? email.toLowerCase() : domainOf(email));
const matches = (email: string, address: string) => address === email.toLowerCase() || (!FREEMAIL.has(domainOf(email)) && domainOf(address) === domainOf(email));
const after = (mailDate: string, since: string) => Date.parse(mailDate) >= Date.parse(`${since.replace(" ", "T")}Z`) - 5 * 60_000;

export async function syncGmail(read: (terms: string[], days: number) => Promise<RawMail[]> = readConversations): Promise<string> {
  const me = getSettings().gmailAddress.toLowerCase();
  if (!me || (dryRun() && read === readConversations)) return "Gmail not connected";
  // approved and waiting to be sent, or sent in the last two months
  const ready = all<Watched>(`SELECT j.id, j.title, c.name AS company, j.stage, j.apply_email, COALESCE(a.approved_at, j.stage_changed_at) AS since
    FROM jobs j JOIN companies c ON c.id = j.company_id JOIN applications a ON a.id = (SELECT MAX(id) FROM applications WHERE job_id = j.id)
    WHERE j.stage = 'ready' AND j.apply_email IS NOT NULL`);
  const sent = all<Watched>(`SELECT j.id, j.title, c.name AS company, j.stage, j.apply_email, COALESCE(a.sent_at, j.stage_changed_at) AS since
    FROM jobs j JOIN companies c ON c.id = j.company_id JOIN applications a ON a.id = (SELECT MAX(id) FROM applications WHERE job_id = j.id)
    WHERE j.stage IN ('applied','contact','round1','final') AND j.apply_email IS NOT NULL AND COALESCE(a.sent_at, j.stage_changed_at) > datetime('now','-60 days')`);
  if (!ready.length && !sent.length) return "Gmail: nothing to watch";

  const terms = [...new Set([...ready.map((j) => j.apply_email.toLowerCase()), ...sent.map((j) => termOf(j.apply_email))])];
  const seen = new Set<string>(JSON.parse(meta("gmailSeen") ?? "[]") as string[]);
  const mails = (await read(terms, 60)).filter((m) => !seen.has(m.id)).sort((a, b) => a.date.localeCompare(b.date));
  let moved = 0, replies = 0;

  try {
    for (const m of mails) {
      if (m.fromAddress === me) {
        seen.add(m.id);
        // the application went out from Gmail
        const job = ready.find((j) => m.to.includes(j.apply_email.toLowerCase()) && after(m.date, j.since));
        if (!job) continue;
        markSent(job.id, "email");
        logEvent(job.id, "mail", `Sent from Gmail to ${job.apply_email} – moved to Applied`);
        ready.splice(ready.indexOf(job), 1);
        moved++;
        continue;
      }
      const candidates = sent.filter((j) => matches(j.apply_email, m.fromAddress) && after(m.date, j.since));
      if (!candidates.length) {
        seen.add(m.id);
        continue;
      }
      // several applications to one company: the one the subject names, else the latest
      const job = candidates.find((j) => m.subject.toLowerCase().includes(j.title.toLowerCase())) ?? candidates.sort((a, b) => b.since.localeCompare(a.since))[0];
      const text = mailBody(m.source).text;
      const r = await claude({
        name: "classify-reply", model: "haiku", schema: MailReply,
        prompt: renderPrompt("classify-reply", { title: job.title, company: job.company, from: m.from, subject: m.subject, text: truncate(text, 6000) }),
        mockInput: { subject: m.subject, text },
      });
      seen.add(m.id);
      replies++;
      const note = r.next_action ?? undefined;
      if (r.kind === "receipt") {
        logEvent(job.id, "mail", `${job.company} confirmed your application arrived`);
        continue;
      }
      if (r.kind === "rejection") {
        setStage(job.id, "closed", { closedReason: "rejected" });
        logEvent(job.id, "mail", `${job.company} declined: ${r.summary}`);
        notify(`${job.company} declined`, r.summary || job.title);
      } else {
        if (job.stage === "applied") setStage(job.id, "contact", { note });
        else if (note) run("UPDATE jobs SET next_action = ?, next_action_at = datetime('now') WHERE id = ?", [note, job.id]);
        logEvent(job.id, "mail", `${job.company} replied: ${r.summary}`);
        notify(r.kind === "invitation" ? `Interview invitation from ${job.company}` : `Reply from ${job.company}`, note ?? r.summary);
      }
      moved++;
      // a declined application is done; one in contact can still get more replies
      if (r.kind === "rejection") sent.splice(sent.indexOf(job), 1);
      else if (job.stage === "applied") job.stage = "contact";
    }
  } finally {
    // also on a quota pause halfway: what was handled stays handled
    setMeta("gmailSeen", JSON.stringify([...seen].slice(-2000)));
  }
  return `Gmail: ${mails.length} new email${mails.length === 1 ? "" : "s"}, ${replies} repl${replies === 1 ? "y" : "ies"}, ${moved} job${moved === 1 ? "" : "s"} moved`;
}
