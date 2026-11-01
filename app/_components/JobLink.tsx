"use client";

import { openJob } from "@/lib/client";

export function JobLink({ id, className, children }: { id: number; className?: string; children: React.ReactNode }) {
  return (
    <a href={`#job-${id}`} className={className} onClick={(e) => { e.preventDefault(); openJob(id); }}>
      {children}
    </a>
  );
}
