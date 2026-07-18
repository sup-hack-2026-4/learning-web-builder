import { siteModelSchema, type SiteModel } from "@/features/site-model/schema";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api/v1";

export async function generateSite(topic: string): Promise<{ site: SiteModel; provider: "gemini" | "static-sample" }> {
  const response = await fetch(`${apiBaseUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  });

  if (!response.ok) {
    throw new Error("サイト生成APIを利用できません。");
  }

  const payload: unknown = await response.json();
  const envelope = payload as { site?: unknown; provider?: unknown };
  return {
    site: siteModelSchema.parse(envelope.site),
    provider: envelope.provider === "gemini" ? "gemini" : "static-sample",
  };
}

