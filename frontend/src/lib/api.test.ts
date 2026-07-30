import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { getProject, getSession, listProjects, requestApi, saveProject } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestApi", () => {
  it("ClerkトークンをBearerヘッダーへ設定する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestApi("/session", {
      getToken: async () => "session-token",
      headers: { "X-Test": "value" },
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(options.headers);
    expect(headers.get("Authorization")).toBe("Bearer session-token");
    expect(headers.get("X-Test")).toBe("value");
  });

  it("トークンがない場合はAuthorizationヘッダーを付けない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestApi("/session", { getToken: async () => null });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(options.headers).has("Authorization")).toBe(false);
  });
});

describe("getSession", () => {
  it("認証済みセッションを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      authenticated: true,
      mode: "clerk",
      userId: "user_123",
    })));

    await expect(getSession(async () => "session-token")).resolves.toEqual({
      authenticated: true,
      mode: "clerk",
      userId: "user_123",
    });
  });

  it("不正なトークンではエラーにする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(getSession(async () => "invalid")).rejects.toThrow("ログイン状態を確認できません。");
  });
});

const projectPayload = {
  id: "11111111-1111-4111-8111-111111111111",
  site: createSampleSite("写真部"),
  version: 1,
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
};

describe("project API", () => {
  it("認証付きでプロジェクト一覧を取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ projects: [projectPayload] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listProjects(async () => "session-token")).resolves.toHaveLength(1);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/projects");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("新規保存ではPOSTを使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(projectPayload, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveProject(projectPayload.site, async () => "session-token")).resolves.toMatchObject({
      id: projectPayload.id,
      version: 1,
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/projects$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ site: projectPayload.site });
  });

  it("既存保存ではIDをURLエンコードしてPUTを使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...projectPayload, version: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveProject(projectPayload.site, async () => "session-token", projectPayload.id);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/projects/${projectPayload.id}`);
    expect(options.method).toBe("PUT");
  });

  it("取得したSiteModelが不正なら拒否する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ...projectPayload,
      site: { ...projectPayload.site, topic: "" },
    })));

    await expect(getProject(projectPayload.id, async () => "session-token")).rejects.toThrow();
  });
});
