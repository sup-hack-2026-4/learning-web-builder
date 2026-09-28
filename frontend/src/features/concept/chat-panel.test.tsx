import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conceptChat } from "@/lib/api";
import { useBuilderStore } from "@/features/site-model/store";
import { ConceptChatPanel } from "./chat-panel";
import { emptyDraft, type ConceptReply } from "./schema";

vi.mock("@/lib/api", () => ({ conceptChat: vi.fn() }));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConceptChatPanel onGenerate={vi.fn()} generating={false} />
    </QueryClientProvider>,
  );
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

  it("相談に失敗したら、警告として読み上げる", async () => {
    vi.mocked(conceptChat).mockRejectedValue(new Error("失敗"));
    renderPanel();

    await startAndSend("パン屋");

    expect(await screen.findByRole("alert")).toHaveTextContent("相談を利用できませんでした");
  });
});
