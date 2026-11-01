/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["playwright", "unpdf", "mammoth", "pdf-lib"],
  devIndicators: false,
};
export default nextConfig;
