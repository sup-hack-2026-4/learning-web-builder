import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import type { SiteModel } from "@/features/site-model/schema";
import { useBuilderStore } from "@/features/site-model/store";
import { TokenProviderContext } from "@/features/auth/token-provider";
import { AiBusyError, GenerateInputError, generateSite, type TokenProvider } from "@/lib/api";
import { useSiteGeneration } from "./use-site-generation";

vi.mock("@/lib/api", async (importOriginal) => {
  // エラーの型は、本物を使う。
  const { AiBusyError, GenerateInputError } = await importOriginal<typeof import("@/lib/api")>();
  return { AiBusyError, GenerateInputError, generateSite: vi.fn() };
});

type Generated = { site: SiteModel; provider: "gemini" | "static-sample" };

// getTokenを渡すと、ログイン機能のある環境（AppProvidersがトークンの取得関数を配る状態）を再現する。
function setup(getToken?: TokenProvider) {
  const showNotice = vi.fn();
  const onSiteReplaced = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => {
    const content = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return getToken ? <TokenProviderContext.Provider value={getToken}>{content}</TokenProviderContext.Provider> : content;
  };
  const hook = renderHook(() => useSiteGeneration({ showNotice, onSiteReplaced }), { wrapper });
  return { ...hook, showNotice, onSiteReplaced };
}

// 題材を入れて生成を始める。
function submit(result: { current: ReturnType<typeof useSiteGeneration> }, topic: string) {
  act(() => result.current.setTopic(topic));
  act(() => result.current.submitTopic({ preventDefault: () => {} } as FormEvent));
}

beforeEach(() => {
  vi.mocked(generateSite).mockReset();
  useBuilderStore.getState().reset();
});

describe("useSiteGeneration", () => {
  it("生成が終わると、たたき台へ差し替える", async () => {
    const generated = createSampleSite("植物園");
    vi.mocked(generateSite).mockResolvedValue({ site: generated, provider: "gemini" });
    const { result, onSiteReplaced } = setup();

    submit(result, "植物園");

    await waitFor(() => expect(useBuilderStore.getState().site.id).toBe(generated.id));
    expect(onSiteReplaced).toHaveBeenCalledTimes(1);
  });

  it("生成中に作業を切り替えたら、届いたたたき台で作品を上書きしない(#115)", async () => {
    let resolve!: (value: Generated) => void;
    vi.mocked(generateSite).mockReturnValue(new Promise((settle) => {
      resolve = settle;
    }));
    const { result, showNotice, onSiteReplaced } = setup();

    submit(result, "植物園");
    // 生成を待つ間に、保存済みのプロジェクトを読み込んだ。
    const loaded = createSampleSite("読み込んだ作品");
    act(() => useBuilderStore.getState().loadSite(loaded, { notes: [], aiUsage: [] }));
    await act(async () => resolve({ site: createSampleSite("植物園"), provider: "gemini" }));

    // 3つ目の引数は、通知を閉じたときのフォーカスの戻り先。このテストでは無い(null)ため、文言だけを確かめる。
    await waitFor(() => expect(showNotice.mock.calls.map(([message]) => message)).toContain(
      "生成中に作業を切り替えたため、生成したたたき台は反映しませんでした。",
    ));
    expect(useBuilderStore.getState().site.id).toBe(loaded.id);
    expect(onSiteReplaced).not.toHaveBeenCalled();
  });

  it("入力の誤りで断られたら、見本で隠さずにエラーを伝える(#117)", async () => {
    vi.mocked(generateSite).mockRejectedValue(new GenerateInputError("題材またはコンセプトの内容を確認してください。"));
    const before = useBuilderStore.getState().site.id;
    const { result, showNotice, onSiteReplaced } = setup();

    submit(result, "植物園");

    await waitFor(() => expect(showNotice.mock.calls.map(([message, tone]) => [message, tone])).toContainEqual(
      ["題材またはコンセプトの内容を確認してください。", "error"],
    ));
    expect(useBuilderStore.getState().site.id).toBe(before);
    expect(onSiteReplaced).not.toHaveBeenCalled();
  });

  it("回数制限や混雑で断られたら、見本に置き換えずに待ち時間を伝える(#133)", async () => {
    const message = "短い時間に続けて利用したため、いまは受け付けられません。約40秒待ってから、もう一度お試しください。";
    vi.mocked(generateSite).mockRejectedValue(new AiBusyError(message));
    const before = useBuilderStore.getState().site.id;
    const { result, showNotice, onSiteReplaced } = setup();

    submit(result, "植物園");

    await waitFor(() => expect(showNotice.mock.calls.map(([text, tone]) => [text, tone])).toContainEqual([message, "error"]));
    expect(useBuilderStore.getState().site.id).toBe(before);
    expect(onSiteReplaced).not.toHaveBeenCalled();
  });

  it("通信やサーバーの障害なら、これまでどおり見本で作業を続ける", async () => {
    vi.mocked(generateSite).mockRejectedValue(new Error("サイト生成APIを利用できません。"));
    const { result, onSiteReplaced } = setup();

    submit(result, "植物園");

    await waitFor(() => expect(useBuilderStore.getState().site.topic).toBe("植物園"));
    expect(onSiteReplaced).toHaveBeenCalledTimes(1);
  });

  it("ログイン機能のある環境では、そのトークンの取得関数で生成を呼ぶ(#120)", async () => {
    vi.mocked(generateSite).mockResolvedValue({ site: createSampleSite("植物園"), provider: "gemini" });
    const getToken = vi.fn(async () => "session-token");
    const { result } = setup(getToken);

    submit(result, "植物園");

    await waitFor(() => expect(generateSite).toHaveBeenCalledWith("植物園", getToken, undefined));
  });

  it("ゲストモードでは、トークンなしで生成を呼ぶ(#120)", async () => {
    vi.mocked(generateSite).mockResolvedValue({ site: createSampleSite("植物園"), provider: "gemini" });
    const { result } = setup();

    submit(result, "植物園");

    await waitFor(() => expect(generateSite).toHaveBeenCalled());
    const getToken = vi.mocked(generateSite).mock.calls[0][1];
    await expect(getToken()).resolves.toBeNull();
  });

  it("題材が上限を超えていたら、送らずに入力欄のエラーを返す", () => {
    const { result } = setup();

    submit(result, "あ".repeat(101));

    expect(result.current.topicError).toBe("題材は100文字以内で入力してください（いま101文字）。");
    expect(generateSite).not.toHaveBeenCalled();
  });
});
