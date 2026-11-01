import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {(phase: string) => import('next').NextConfig} */
export default (phase) => ({
  // dev and the UI test get their own folders so they never clobber the production build `npm start` serves
  distDir: process.env.KOMPASS_DIST_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next"),
  serverExternalPackages: ["playwright", "unpdf", "mammoth", "pdf-lib"],
  devIndicators: false,
});
