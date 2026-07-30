import { z } from "zod";
import { siteModelSchema, type SiteModel } from "@/features/site-model/schema";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api/v1";

export type TokenProvider = () => Promise<string | null>;

type ApiRequestOptions = RequestInit & {
  getToken?: TokenProvider;
};

export async function requestApi(path: string, options: ApiRequestOptions = {}): Promise<Response> {
  const { getToken, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  const token = await getToken?.();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${apiBaseUrl}${path}`, {
    ...requestOptions,
    headers,
  });
}

export type SessionStatus =
  | { authenticated: false; mode: "guest" }
  | { authenticated: true; mode: "clerk"; userId: string };

const projectSchema = z.object({
  id: z.uuid(),
  site: siteModelSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const projectListSchema = z.object({
  projects: z.array(projectSchema),
});

export type Project = z.infer<typeof projectSchema>;

export async function getSession(getToken: TokenProvider): Promise<SessionStatus> {
  const response = await requestApi("/session", { getToken });
  if (!response.ok) {
    throw new Error("ログイン状態を確認できません。");
  }
  const payload = await response.json() as Partial<SessionStatus>;
  if (payload.authenticated === true && payload.mode === "clerk" && typeof payload.userId === "string") {
    return { authenticated: true, mode: "clerk", userId: payload.userId };
  }
  return { authenticated: false, mode: "guest" };
}

export async function generateSite(topic: string): Promise<{ site: SiteModel; provider: "gemini" | "static-sample" }> {
  const response = await requestApi("/generate", {
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

export async function listProjects(getToken: TokenProvider): Promise<Project[]> {
  const response = await requestApi("/projects", { getToken });
  if (!response.ok) {
    throw new Error("保存済みプロジェクトを取得できません。");
  }
  return projectListSchema.parse(await response.json()).projects;
}

export async function getProject(projectId: string, getToken: TokenProvider): Promise<Project> {
  const response = await requestApi(`/projects/${encodeURIComponent(projectId)}`, { getToken });
  if (!response.ok) {
    throw new Error("プロジェクトを読み込めません。");
  }
  return projectSchema.parse(await response.json());
}

export async function saveProject(
  site: SiteModel,
  getToken: TokenProvider,
  projectId?: string | null,
): Promise<Project> {
  const response = await requestApi(
    projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects",
    {
      getToken,
      method: projectId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site }),
    },
  );
  if (!response.ok) {
    throw new Error(projectId ? "プロジェクトを更新できません。" : "プロジェクトを保存できません。");
  }
  return projectSchema.parse(await response.json());
}
