import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/api";
import { AuthControls } from "./auth-controls";

// ログイン済みの状態を固定する。Clerkの画面そのものはこのテストの対象ではない。
vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "test-token", userId: "user_1" }),
  SignedIn: ({ children }: { children: ReactNode }) => children,
  SignedOut: () => null,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  SignUpButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () => null,
}));

vi.mock("@/lib/api", () => ({
  getSession: vi.fn(),
}));

function renderControls() {
  // 失敗を再試行すると、失敗したときの表示を確かめる前に待ちが入るため止める。
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthControls enabled />
    </QueryClientProvider>,
  );
}

describe("AuthControls", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
  });

  it("ログイン機能が無い環境では、ゲストモードと表示する", () => {
    render(<AuthControls enabled={false} />);

    expect(screen.getByText("ゲストモード")).toBeInTheDocument();
  });

  it("確認が終わるまでは、確認中と表示する", () => {
    vi.mocked(getSession).mockReturnValue(new Promise(() => {}));
    renderControls();

    expect(screen.getByText("認証確認中…")).toBeInTheDocument();
  });

  it("サーバーでもログインを確認できたら、ログイン中と表示する", async () => {
    vi.mocked(getSession).mockResolvedValue({ authenticated: true, mode: "clerk", userId: "user_1" });
    renderControls();

    expect(await screen.findByText("ログイン中")).toBeInTheDocument();
  });

  it("通信に失敗したら、状況と次にすることを日本語で伝える", async () => {
    vi.mocked(getSession).mockRejectedValue(new Error("ログイン状態を確認できません。"));
    renderControls();

    expect(await screen.findByText("ログインを確認できません。再読み込みしてください")).toBeInTheDocument();
    expect(screen.queryByText(/API/)).not.toBeInTheDocument();
  });

  it("サーバーがログインを認めなかったときも、同じ案内を出す", async () => {
    vi.mocked(getSession).mockResolvedValue({ authenticated: false, mode: "guest" });
    renderControls();

    expect(await screen.findByText("ログインを確認できません。再読み込みしてください")).toBeInTheDocument();
  });
});
