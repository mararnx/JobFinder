import { NextResponse } from "next/server";
import { dispatch } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Local app: only accept same-origin requests from the UI.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const body = (await req.json()) as { action: string; args?: Record<string, unknown> };
    const result = await dispatch(body.action, body.args ?? {});
    return NextResponse.json({ ok: true, result: result ?? null });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
