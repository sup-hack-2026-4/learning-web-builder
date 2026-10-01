import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { deleteProject, GenerateInputError, generateSite, getProject, getSession, listProjects, requestApi, saveProject } from "./api";

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

const emptyRecord = { notes: [], aiUsage: [] };

const learningRecord = {
  notes: [{
    id: "note-1",
    target: "デザイン変更（メインカラーを #b91c1c に）",
    reason: "作品の写真が映える落ち着いた赤にした",
    createdAt: "2026-09-29T01:02:03.456Z",
    codeChanges: ["--primary: #b91c1c;"],
  }],
  aiUsage: [{ provider: "gemini" as const, purpose: "サイト構成と仮文章の生成", generatedAt: "2026-09-29T00:59:00.000Z" }],
};

describe("project API", () => {
  it("認証付きでプロジェクト一覧を取得する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ projects: [projectPayload] }));
    vi.stubGlobal("fetch", fetchMock);

    const projects = await listProjects(async () => "session-token");
    expect(projects).toHaveLength(1);
    // 一覧には学習の記録が含まれないため、空の記録として扱う。
    expect(projects[0]).toMatchObject({ notes: [], aiUsage: [] });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/projects");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("新規保存ではPOSTを使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(projectPayload, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveProject(projectPayload.site, emptyRecord, async () => "session-token")).resolves.toMatchObject({
      id: projectPayload.id,
      version: 1,
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/projects$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ site: projectPayload.site, notes: [], aiUsage: [] });
  });

  it("保存では学習メモとAI利用記録も一緒に送り、応答の記録を返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...projectPayload, ...learningRecord }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveProject(projectPayload.site, learningRecord, async () => "session-token"))
      .resolves.toMatchObject(learningRecord);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({ site: projectPayload.site, ...learningRecord });
  });

  it("学習の記録が上限を超えていたら、送らずに理由を伝える", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tooLong = { ...learningRecord.notes[0], reason: "あ".repeat(10001) };

    await expect(saveProject(projectPayload.site, { ...learningRecord, notes: [tooLong] }, async () => "session-token"))
      .rejects.toThrow("学習メモの1件目に保存できない内容があります");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("作品が文字数の上限を超えていたら、送らずにどこを直せばよいかを伝える(#117)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const site = createSampleSite();
    site.sections = site.sections.map((section) => (section.id === "hero" ? { ...section, title: "あ".repeat(81) } : section));

    await expect(saveProject(site, learningRecord, async () => "session-token"))
      .rejects.toThrow("見出しは80文字以内で入力してください（いま81文字）。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("学習の記録全体が大きすぎたら、送らずに理由を伝える", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // 1件ずつは上限内でも、合計で上限(300KiB)を超える組み合わせ。
    const bigNote = { ...learningRecord.notes[0], codeChanges: Array.from({ length: 200 }, () => "x".repeat(2000)) };

    await expect(saveProject(projectPayload.site, { ...learningRecord, notes: [bigNote] }, async () => "session-token"))
      .rejects.toThrow("学習メモが大きすぎて保存できません。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("取得したプロジェクトの学習の記録を返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...projectPayload, ...learningRecord })));

    await expect(getProject(projectPayload.id, async () => "session-token")).resolves.toMatchObject(learningRecord);
  });

  it("既存保存ではIDをURLエンコードしてPUTを使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...projectPayload, version: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveProject(projectPayload.site, emptyRecord, async () => "session-token", projectPayload.id);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/projects/${projectPayload.id}`);
    expect(options.method).toBe("PUT");
  });

  it("削除ではIDをURLエンコードしてDELETEを使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteProject(projectPayload.id, async () => "session-token")).resolves.toBeUndefined();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/projects/${projectPayload.id}`);
    expect(options.method).toBe("DELETE");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("他人のプロジェクトを削除しようとするとエラーにする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(deleteProject(projectPayload.id, async () => "session-token"))
      .rejects.toThrow("プロジェクトを削除できません。");
  });

  it("取得したSiteModelが不正なら拒否する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ...projectPayload,
      site: { ...projectPayload.site, topic: "" },
    })));

    await expect(getProject(projectPayload.id, async () => "session-token")).rejects.toThrow();
  });
});

describe("generateSite", () => {
  it("入力の誤り(400)は、通信の障害と区別できるエラーにする(#117)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "topic must be between 1 and 100 characters" }, { status: 400 })));

    await expect(generateSite("植物園")).rejects.toBeInstanceOf(GenerateInputError);
  });

  it("サーバーの障害は、入力の誤りとは別のエラーにする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const error = await generateSite("植物園").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GenerateInputError);
  });
});
