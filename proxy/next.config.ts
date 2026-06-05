import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  // Build a self-contained server bundle for the container image (Cloud Run).
  output: "standalone",
  // @google-cloud/bigquery is a native Node dependency — keep it external to the
  // server bundle so its dynamic requires resolve at runtime.
  serverExternalPackages: ["@google-cloud/bigquery"],
  // Pin the tracing root to this app so a parent-dir lockfile doesn't mislead
  // Vercel's dependency tracing.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
};

export default nextConfig;
