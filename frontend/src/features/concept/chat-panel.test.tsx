import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokenProviderContext } from "@/features/auth/token-provider";
import { AiBusyError, conceptChat, type TokenProvider } from "@/lib/api";
import { useBuilderStore } from "@/features/site-model/store";
import { ConceptChatPanel } from "./chat-panel";
import { emptyDraft, type ConceptReply } from "./schema";

vi.mock("@/lib/api", async (importOriginal) => ({
  // 一時的な断りを表すエラーの型は、本物を使う。
  AiBusyError: (await importOriginal<typeof import("@/lib/api")>()).AiBusyError,
  conceptChat: vi.fn(),
}));

// getTokenを渡すと、ログイン機能のある環境（AppProvidersがトークンの取得関数を配る状態）を再現する。
function renderPanel(getToken?: TokenProvider) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const panel = (
    <QueryClientProvider client={client}>
      <ConceptChatPanel onGenerate={vi.fn()} generating={false} />
    </QueryClientProvider>
  );
  return render(getToken ? <TokenProviderContext.Provider value={getToken}>{panel}</TokenProviderContext.Provider> : panel);
}

async function startAndSend(text: string) {
  await userEvent.click(screen.getByRole("button", { name: "相談をはじめる" }));
  await userEvent.type(screen.getByLabelText("返事を書く"), text);
  await userEvent.click(screen.getByRole("button", { name: "送信" }));
}

beforeEach(() => {
  vi.mocked(conceptChat).mockReset();
  useBuilderStore.getState().resetConcept();
});

describe("ConceptChatPanel", () => {
  it("相談を始める前から読み上げ用のログ領域があり、最初の問いかけがそこへ入る", async () => {
    renderPanel();
    // ライブ領域は、中身より先に存在しないと追加を読み上げられない。
    const log = screen.getByRole("log", { name: "相談のやりとり" });
    expect(log).toBeEmptyDOMElement();

    await userEvent.click(screen.getByRole("button", { name: "相談をはじめる" }));

    expect(within(log).getByText(/どんなものを紹介するサイト/)).toBeInTheDocument();
  });

  it("応答を待つ間は状態として読み上げ、届いた応答はログへ追加する", async () => {
    let resolve: (reply: ConceptReply) => void = () => {};
    vi.mocked(conceptChat).mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPanel();

    await startAndSend("パン屋");

    expect(screen.getByRole("status")).toHaveTextContent("考えています…");

    resolve({ reply: "誰に向けたサイトですか。", draft: { ...emptyDraft, topic: "パン屋" }, choices: [], missing: ["audience", "goal"], ready: false, provider: "static-sample" });

    expect(await within(screen.getByRole("log")).findByText("誰に向けたサイトですか。")).toBeInTheDocument();
    // 応答の追加と待機状態の解除は同時ではないため、解除を待つ。
    await waitFor(() => expect(screen.getByRole("status")).toBeEmptyDOMElement());
  });

  it("ログイン機能のある環境では、そのトークンの取得関数で相談を呼ぶ(#120)", async () => {
    vi.mocked(conceptChat).mockResolvedValue({ reply: "誰に向けたサイトですか。", draft: { ...emptyDraft, topic: "パン屋" }, choices: [], missing: ["audience", "goal"], ready: false, provider: "static-sample" });
    const getToken = vi.fn(async () => "session-token");
    renderPanel(getToken);

    await startAndSend("パン屋");

    await waitFor(() => expect(conceptChat).toHaveBeenCalled());
    expect(vi.mocked(conceptChat).mock.calls[0][2]).toBe(getToken);
  });

  it("ゲストモードでは、トークンなしで相談を呼ぶ(#120)", async () => {
    vi.mocked(conceptChat).mockResolvedValue({ reply: "誰に向けたサイトですか。", draft: { ...emptyDraft, topic: "パン屋" }, choices: [], missing: ["audience", "goal"], ready: false, provider: "static-sample" });
    renderPanel();

    await startAndSend("パン屋");

    await waitFor(() => expect(conceptChat).toHaveBeenCalled());
    await expect(vi.mocked(conceptChat).mock.calls[0][2]()).resolves.toBeNull();
  });

  it("相談に失敗したら、警告として読み上げる", async () => {
    vi.mocked(conceptChat).mockRejectedValue(new Error("失敗"));
    renderPanel();

    await startAndSend("パン屋");

    expect(await screen.findByRole("alert")).toHaveTextContent("相談を利用できませんでした");
  });

  it("回数制限や混雑で断られたら、待ち時間を伝え、同じ枠で断られる題材入力へは案内しない(#133)", async () => {
    vi.mocked(conceptChat).mockRejectedValue(new AiBusyError("いまAIが混み合っています。約5秒待ってから、もう一度お試しください。"));
    renderPanel();

    await startAndSend("パン屋");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("いまAIが混み合っています。約5秒待ってから、もう一度お試しください。");
    expect(alert).not.toHaveTextContent("題材入力");
    // 送り直せるよう、入力した文面は残す。
    expect(screen.getByLabelText("返事を書く")).toHaveValue("パン屋");
  });
});
