import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent runs happen in long-lived server processes; keep the SDK server-only.
  serverExternalPackages: ["@anthropic-ai/sdk", "@anthropic-ai/claude-agent-sdk", "pg", "@huggingface/transformers"],
};

export default nextConfig;
