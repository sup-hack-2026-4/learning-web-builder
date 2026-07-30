import { afterEach, describe, expect, it, vi } from "vitest";
import { getSession, requestApi } from "./api";

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
