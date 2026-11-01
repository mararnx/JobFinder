"use client";

export async function act<T = unknown>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) });
  const body = (await r.json()) as { ok: boolean; result?: T; error?: string };
  if (!body.ok) throw new Error(body.error ?? "Something went wrong");
  return body.result as T;
}

export type ToastMsg = { text: string; undo?: () => void; tone?: "ok" | "error" };

export function toast(text: string, undo?: () => void, tone: "ok" | "error" = "ok") {
  window.dispatchEvent(new CustomEvent<ToastMsg>("kompass:toast", { detail: { text, undo, tone } }));
}

export function openJob(id: number) {
  window.dispatchEvent(new CustomEvent<number>("kompass:job", { detail: id }));
}

export function openAddAd() {
  window.dispatchEvent(new Event("kompass:add-ad"));
}
