import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {(phase: string) => import('next').NextConfig} */
export default (phase) => ({
  // dev gets its own folder so `npm run dev` never clobbers the production build `npm start` serves
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  serverExternalPackages: ["playwright", "unpdf", "mammoth", "pdf-lib"],
  devIndicators: false,
});
