import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { emptyDraft } from "@/features/concept/schema";
import { AiBusyError, conceptChat, deleteProject, GenerateInputError, generateSite, getProject, getSession, listProjects, OPTIONAL_TOKEN_TIMEOUT_MS, requestApi, saveProject, type TokenProvider } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ログインしていないときのトークン取得。Clerkはログアウト中にnullを返す。
const guest: TokenProvider = async () => null;

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

    await expect(generateSite("植物園", guest)).rejects.toBeInstanceOf(GenerateInputError);
  });

  it("サーバーの障害は、入力の誤りとは別のエラーにする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const error = await generateSite("植物園", guest).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GenerateInputError);
  });
});

// 回数制限や混雑は少し待てば使える。障害と同じ扱いにすると、待てばよいことが利用者に伝わらない(#133)。
describe("AIを呼ぶAPIが一時的に断られたとき(#133)", () => {
  const run = {
    generate: () => generateSite("植物園", guest),
    chat: () => conceptChat([{ role: "user", text: "植物園" }], emptyDraft, guest),
  };
  const refused = (status: number, retryAfter?: string) =>
    new Response(null, { status, headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter } });

  it.each([
    ["生成", run.generate],
    ["相談", run.chat],
  ])("回数制限(429)で%sを断られたら、待ち時間を伝えるエラーにする", async (_label, call) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refused(429, "40")));

    const error = await call().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiBusyError);
    expect((error as Error).message).toBe("短い時間に続けて利用したため、いまは受け付けられません。約40秒待ってから、もう一度お試しください。");
  });

  it.each([
    ["生成", run.generate],
    ["相談", run.chat],
  ])("混雑(503)で%sを断られたら、待ち時間を伝えるエラーにする", async (_label, call) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refused(503, "5")));

    const error = await call().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiBusyError);
    expect((error as Error).message).toBe("いまAIが混み合っています。約5秒待ってから、もう一度お試しください。");
  });

  it.each([
    ["無い", undefined],
    ["秒数でない", "Wed, 07 Oct 2026 07:28:00 GMT"],
  ])("429でRetry-Afterが%sときは、秒数を出さずに待つよう伝える", async (_label, retryAfter) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refused(429, retryAfter)));

    const error = await run.generate().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiBusyError);
    expect((error as Error).message).toBe("短い時間に続けて利用したため、いまは受け付けられません。しばらく待ってから、もう一度お試しください。");
  });

  // Retry-Afterの無い503は、手前の基盤の障害や起動待ち。いつ使えるか分からないため、障害として扱う。
  it.each([
    ["生成", run.generate],
    ["相談", run.chat],
  ])("Retry-Afterの無い503で%sに失敗したら、一時的な断りとは扱わない", async (_label, call) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refused(503)));

    const error = await call().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AiBusyError);
  });
});

// ログイン中にトークンを付けないと、回数制限がIP単位になり、同じ回線の全員で分け合うことになる(#120)。
describe("AIを呼ぶAPIの認証(#120)", () => {
  const generated = { site: createSampleSite("植物園"), provider: "gemini" };
  const reply = { reply: "誰に向けたサイトですか。", draft: { ...emptyDraft, topic: "植物園" }, choices: [], missing: ["audience", "goal"], ready: false, provider: "gemini" };

  const calls = {
    generate: { path: "/generate", payload: generated, run: (getToken: TokenProvider) => generateSite("植物園", getToken) },
    chat: { path: "/concept/chat", payload: reply, run: (getToken: TokenProvider) => conceptChat([{ role: "user", text: "植物園" }], emptyDraft, getToken) },
  };

  it.each([
    ["生成", calls.generate],
    ["相談", calls.chat],
  ])("ログイン中は、%sにトークンを付ける", async (_label, { path, payload, run }) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    await run(async () => "session-token");

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(path);
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it.each([
    ["生成", calls.generate],
    ["相談", calls.chat],
  ])("ゲストでは、%sにトークンを付けない", async (_label, { payload, run }) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    await run(guest);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(options.headers).has("Authorization")).toBe(false);
  });

  // ClerkのgetTokenは、Clerkの読み込みが終わるまで返らない。通信の遮断や障害で読み込めないときに、
  // 生成や相談まで止めない。
  it.each([
    ["生成", calls.generate],
    ["相談", calls.chat],
  ])("トークンをいつまでも取れないときは、待ち続けずにトークンなしで%sを呼ぶ", async (_label, { payload, run }) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    const result = run(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(OPTIONAL_TOKEN_TIMEOUT_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(options.headers).has("Authorization")).toBe(false);
  });

  it.each([
    ["生成", calls.generate],
    ["相談", calls.chat],
  ])("トークンの取得に失敗したときも、トークンなしで%sを呼ぶ", async (_label, { payload, run }) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    await run(async () => {
      throw new Error("Clerkへ接続できません");
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(options.headers).has("Authorization")).toBe(false);
  });
});
