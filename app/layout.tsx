import type { Metadata } from "next";
import { Shell } from "./_components/Shell";
import { shellStatus } from "@/lib/status";
import "./globals.css";

export const metadata: Metadata = { title: "Kompass", description: "Your local job search funnel" };
export const dynamic = "force-dynamic";

// light by default; the toggle in the top bar remembers dark
const THEME_BOOT = `var t="light";try{t=localStorage.getItem("kompass-theme")||t}catch(e){}document.documentElement.dataset.theme=t`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Shell status={shellStatus()}>{children}</Shell>
      </body>
    </html>
  );
}
