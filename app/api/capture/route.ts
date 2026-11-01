import { addManualAd } from "@/lib/pipeline/sources";
import { getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function page(title: string, body: string, ok: boolean) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#F6F5F1;color:#141416}
main{max-width:420px;padding:28px 32px;border-radius:16px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{font-size:18px;margin:0 0 6px}p{margin:0;color:#55554f}
.mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;margin-bottom:14px;font-weight:700;background:${ok ? "#D4FF3A" : "#FFE1DE"}}a{color:inherit}</style></head>
<body><main><div class="mark">${ok ? "✓" : "!"}</div>${body}</main>${ok ? "<script>setTimeout(()=>window.close(),2500)</script>" : ""}</body></html>`,
    { status: ok ? 200 : 422, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Target of the "Add to JobFinder" bookmark: the browser posts the page the job seeker is looking at.
 * Cross-origin on purpose (the post comes from the job portal's page); all it can do is add a job ad.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const url = String(form?.get("url") ?? "").slice(0, 2000);
  const html = String(form?.get("html") ?? "").slice(0, 3_000_000);
  if (!/^https?:\/\//.test(url) || html.length < 200) return page("Not added", "<h1>Nothing to add</h1><p>Open a job ad first, then click the button.</p>", false);
  try {
    const jobId = await addManualAd({ url, html });
    const j = getJob(jobId);
    return page("Added to JobFinder", `<h1>Added to JobFinder</h1><p><b>${esc(j?.title ?? "Job ad")}</b>${j?.company ? ` · ${esc(j.company)}` : ""}</p><p style="margin-top:8px">It appears in Discover once it&rsquo;s scored. <a href="/discover">Open JobFinder</a></p>`, true);
  } catch (e) {
    return page("Not added", `<h1>Couldn&rsquo;t read this page</h1><p>${esc(e instanceof Error ? e.message : String(e))}</p><p style="margin-top:8px">Use <b>Add job ad</b> in JobFinder and paste the text instead.</p>`, false);
  }
}
