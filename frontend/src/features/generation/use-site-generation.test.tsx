import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import type { SiteModel } from "@/features/site-model/schema";
import { useBuilderStore } from "@/features/site-model/store";
import { generateSite } from "@/lib/api";
import { useSiteGeneration } from "./use-site-generation";

vi.mock("@/lib/api", () => ({ generateSite: vi.fn() }));

type Generated = { site: SiteModel; provider: "gemini" | "static-sample" };

function setup() {
  const showNotice = vi.fn();
  const onSiteReplaced = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
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
});
