import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { deleteProject, getProject, listProjects, saveProject, type Project } from "@/lib/api";
import { ProjectControls } from "./project-controls";

// ログイン済みの状態を固定する。Clerkの画面や通信はこのテストの対象ではない。
vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "test-token", isSignedIn: true, userId: "user_1" }),
  SignedIn: ({ children }: { children: ReactNode }) => children,
  SignedOut: () => null,
}));

vi.mock("@/lib/api", () => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
  saveProject: vi.fn(),
  deleteProject: vi.fn(),
}));

const project: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  site: createSampleSite("スミレ即売会"),
  version: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

// 選択中のプロジェクトは親が持つため、同じ受け渡しをする親を用意する。
function Harness() {
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  return (
    <ProjectControls
      enabled
      site={project.site}
      currentProjectId={currentProjectId}
      onProjectChange={setCurrentProjectId}
      onLoad={() => {}}
      onNotice={() => {}}
    />
  );
}

function renderControls() {
  // 失敗を再試行すると、失敗したときの表示を確かめる前に待ちが入るため止める。
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

// 保存済みの一覧からプロジェクトを選び、削除の確認を開くところまで進める。
async function openDeleteConfirmation(user: ReturnType<typeof userEvent.setup>) {
  const select = screen.getByLabelText("保存済みプロジェクト");
  await within(select).findByRole("option", { name: /スミレ即売会/ });
  await user.selectOptions(select, project.id);
  await user.click(await screen.findByRole("button", { name: "スミレ即売会を削除" }));
  return screen.findByRole("button", { name: "削除する" });
}

describe("ProjectControls", () => {
  beforeEach(() => {
    vi.mocked(listProjects).mockReset().mockResolvedValue([project]);
    vi.mocked(getProject).mockReset().mockResolvedValue(project);
    vi.mocked(saveProject).mockReset();
    vi.mocked(deleteProject).mockReset();
  });

  it("一覧の取得中は読み込み中であることを、セレクトの説明と読み上げの両方で伝える", async () => {
    vi.mocked(listProjects).mockReturnValue(new Promise(() => {}));
    renderControls();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("保存一覧を読み込み中…");
    expect(screen.getByLabelText("保存済みプロジェクト")).toHaveAccessibleDescription("保存一覧を読み込み中…");
  });

  it("保存済みのプロジェクトが0件なら、そのことを伝える", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    renderControls();

    // 状態の変化が読み上げられるよう、取得の前からある同じライブリージョンの中身が変わる。
    const status = screen.getByRole("status");
    expect(await within(status).findByText("保存済みのプロジェクトはまだありません")).toBeInTheDocument();
    expect(screen.getByLabelText("保存済みプロジェクト")).toHaveAccessibleDescription("保存済みのプロジェクトはまだありません");
  });

  it("保存済みのプロジェクトがあれば、状態の文言は出さない", async () => {
    renderControls();

    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(select).not.toHaveAttribute("aria-describedby");
  });

  it("削除の確認中に保存を始めると、保存が終わるまで削除できない", async () => {
    // 保存の応答を止めておき、保存中の状態を作る。
    vi.mocked(saveProject).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderControls();

    const confirmDelete = await openDeleteConfirmation(user);
    await user.click(screen.getByRole("button", { name: "上書き保存" }));

    // 保存と削除が並行すると、あとから届く保存の成功処理が削除済みのIDを選び直してしまう。
    expect(confirmDelete).toBeDisabled();
    await user.click(confirmDelete);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("削除に成功したあと一覧の再取得に失敗しても、削除したプロジェクトを選択肢に残さない", async () => {
    vi.mocked(deleteProject).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderControls();

    const confirmDelete = await openDeleteConfirmation(user);
    // 削除のあとの再取得だけを失敗させる。
    vi.mocked(listProjects).mockRejectedValue(new Error("一覧を取得できませんでした。"));
    await user.click(confirmDelete);

    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith(project.id, expect.any(Function)));
    // 再取得の失敗が画面に出るまで待ってから、選択肢を確かめる。
    expect(await screen.findByText("保存一覧エラー")).toBeInTheDocument();
    const select = screen.getByLabelText("保存済みプロジェクト");
    expect(within(select).queryByRole("option", { name: /スミレ即売会/ })).not.toBeInTheDocument();
    expect(select).toHaveValue("");
  });
});
