import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { useBuilderStore } from "@/features/site-model/store";
import { deleteProject, getProject, listProjects, ProjectConflictError, saveProject, type Project } from "@/lib/api";
import { ProjectControls } from "./project-controls";
import { useProjectLink } from "./use-project-link";

// ログイン済みの状態を固定する。Clerkの画面や通信はこのテストの対象ではない。
// ユーザーの切り替えを確かめるテストだけ、途中でuserIdを変える。
const auth = vi.hoisted(() => ({ userId: "user_1" }));
vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => ({ getToken: async () => "test-token", isSignedIn: true, userId: auth.userId }),
  SignedIn: ({ children }: { children: ReactNode }) => children,
  SignedOut: () => null,
}));

vi.mock("@/lib/api", () => ({
  // 競合かどうかは instanceof で見分けるため、エラーの型だけは本物と同じ形で用意する。
  ProjectConflictError: class ProjectConflictError extends Error {},
  listProjects: vi.fn(),
  getProject: vi.fn(),
  saveProject: vi.fn(),
  deleteProject: vi.fn(),
}));

const project: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  site: createSampleSite("スミレ即売会"),
  notes: [{ id: "note-1", target: "コンセプト", reason: "新入生に雰囲気を伝える", createdAt: "2026-09-01T00:00:00.000Z" }],
  aiUsage: [{ provider: "gemini", purpose: "サイト構成と仮文章の生成", generatedAt: "2026-09-01T00:00:00.000Z" }],
  version: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

const onLoad = vi.fn();
const onNotice = vi.fn();

// 選択中のプロジェクトは親が持つため、画面と同じ受け渡しをする親を用意する。
function Harness() {
  const { currentProjectId, currentProjectVersion, setCurrentProjectId } = useProjectLink();
  return (
    <ProjectControls
      enabled
      site={project.site}
      record={{ notes: project.notes, aiUsage: project.aiUsage }}
      currentProjectId={currentProjectId}
      currentProjectVersion={currentProjectVersion}
      onProjectChange={setCurrentProjectId}
      onLoad={onLoad}
      onNotice={onNotice}
    />
  );
}

function renderControls() {
  // 失敗を再試行すると、失敗したときの表示を確かめる前に待ちが入るため止める。
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  );
  const view = render(tree());
  // 同じ部品を描き直す。ログインし直したあとの画面を作るのに使う。
  return { rerender: () => view.rerender(tree()) };
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
    onLoad.mockReset();
    onNotice.mockReset();
  });

  it("保存では作品と一緒に学習の記録も送る", async () => {
    vi.mocked(saveProject).mockResolvedValue(project);
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledWith(
      project.site,
      { notes: project.notes, aiUsage: project.aiUsage },
      expect.any(Function),
      null,
      null,
    ));
  });

  it("読み込むと、作品と一緒に学習の記録も画面へ渡す", async () => {
    const user = userEvent.setup();
    renderControls();

    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    await user.selectOptions(select, project.id);

    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(
      project.site,
      { notes: project.notes, aiUsage: project.aiUsage },
    ));
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

// 結果が届くのを、テストの中で好きな時点まで止めておく。
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

// saveProjectの最後の呼び出しで渡した、更新先のプロジェクトのid。
const lastSavedProjectId = () => vi.mocked(saveProject).mock.calls.at(-1)?.[3];

describe("処理の途中で作業が切り替わったとき(#115)", () => {
  beforeEach(() => {
    auth.userId = "user_1";
    vi.mocked(listProjects).mockReset().mockResolvedValue([project]);
    vi.mocked(getProject).mockReset().mockResolvedValue(project);
    vi.mocked(saveProject).mockReset().mockResolvedValue(project);
    onLoad.mockReset();
    onNotice.mockReset();
  });

  it("切り替えなければ、保存したプロジェクトを次の保存の更新先にする", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("プロジェクトを保存しました。", "status", expect.anything()));
    await user.click(await screen.findByRole("button", { name: "上書き保存" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(2));
    expect(lastSavedProjectId()).toBe(project.id);
  });

  it("保存中にリセットしたら、保存したプロジェクトをいまの作品の更新先にしない", async () => {
    // 更新先が残ると、リセット後の作品で保存したプロジェクトを上書きしてしまう。
    const pendingSave = deferred<Project>();
    vi.mocked(saveProject).mockReturnValueOnce(pendingSave.promise);
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole("button", { name: "保存" }));
    act(() => useBuilderStore.getState().reset());
    await act(async () => pendingSave.resolve(project));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(
      expect.stringContaining("次に保存すると新しいプロジェクトになります"),
      "status",
      expect.anything(),
    ));
    // 更新先が無いので、ボタンも「上書き保存」にならない。
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(2));
    expect(lastSavedProjectId()).toBeNull();
  });

  it("読み込み中にリセットしたら、届いたプロジェクトで作品を上書きしない", async () => {
    const pendingLoad = deferred<Project>();
    vi.mocked(getProject).mockReturnValueOnce(pendingLoad.promise);
    const user = userEvent.setup();
    renderControls();

    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    await user.selectOptions(select, project.id);
    act(() => useBuilderStore.getState().reset());
    await act(async () => pendingLoad.resolve(project));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(
      "読み込み中に作業を切り替えたため、読み込んだプロジェクトは反映しませんでした。",
      "status",
      expect.anything(),
    ));
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("読み込み中に編集したら、届いたプロジェクトで編集を置き換えない(#118)", async () => {
    // 編集では作業の世代が進まない。世代だけを見ていると、待っている間の編集を知らせずに消してしまう。
    const pendingLoad = deferred<Project>();
    vi.mocked(getProject).mockReturnValueOnce(pendingLoad.promise);
    const user = userEvent.setup();
    renderControls();

    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    await user.selectOptions(select, project.id);
    act(() => useBuilderStore.getState().previewTheme("primary", "#e11d48"));
    await act(async () => pendingLoad.resolve(project));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(
      expect.stringContaining("読み込み中に編集したため、読み込んだプロジェクトは反映しませんでした。"),
      "status",
      expect.anything(),
    ));
    expect(onLoad).not.toHaveBeenCalled();
    // 読み込んでいないので、更新先にもしない。
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("読み込むと作品を差し替えたあとも、読み込んだプロジェクトを更新先として残す", async () => {
    // 差し替えで作業の世代が進むため、更新先を先に付けると外れてしまう。
    onLoad.mockImplementation((site, record) => useBuilderStore.getState().loadSite(site, record));
    const user = userEvent.setup();
    renderControls();

    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    await user.selectOptions(select, project.id);

    await user.click(await screen.findByRole("button", { name: "上書き保存" }));
    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
    expect(lastSavedProjectId()).toBe(project.id);
  });

  it("保存中に別のユーザーでログインし直したら、前のユーザーの保存結果を反映しない", async () => {
    const pendingSave = deferred<Project>();
    vi.mocked(saveProject).mockReturnValueOnce(pendingSave.promise);
    const user = userEvent.setup();
    const { rerender } = renderControls();

    await user.click(screen.getByRole("button", { name: "保存" }));
    auth.userId = "user_2";
    rerender();
    await act(async () => pendingSave.resolve(project));

    // 前のユーザーのプロジェクトを、いまのユーザーの更新先にしない。通知も出さない。
    expect(await screen.findByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上書き保存" })).not.toBeInTheDocument();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it("読み込み中に別のユーザーでログインし直したら、前のユーザーのプロジェクトを反映しない", async () => {
    const pendingLoad = deferred<Project>();
    vi.mocked(getProject).mockReturnValueOnce(pendingLoad.promise);
    const user = userEvent.setup();
    const { rerender } = renderControls();

    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    await user.selectOptions(select, project.id);
    auth.userId = "user_2";
    rerender();
    await act(async () => pendingLoad.resolve(project));

    expect(onLoad).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });
});

// saveProjectの最後の呼び出しで渡した、読み込んだ時点のバージョン。
const lastBaseVersion = () => vi.mocked(saveProject).mock.calls.at(-1)?.[4];

describe("別のタブや端末で更新されていたとき(#118)", () => {
  const loaded: Project = { ...project, version: 2 };

  beforeEach(() => {
    auth.userId = "user_1";
    vi.mocked(listProjects).mockReset().mockResolvedValue([loaded]);
    vi.mocked(getProject).mockReset().mockResolvedValue(loaded);
    vi.mocked(saveProject).mockReset();
    onLoad.mockReset();
    onNotice.mockReset();
  });

  // 保存済みのプロジェクトを読み込み、上書き保存を競合で断られるところまで進める。
  async function saveIntoConflict(user: ReturnType<typeof userEvent.setup>) {
    vi.mocked(saveProject).mockRejectedValueOnce(new ProjectConflictError("別のタブや端末で更新されています。"));
    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    await user.selectOptions(select, project.id);
    await user.click(await screen.findByRole("button", { name: "上書き保存" }));
    return screen.findByRole("alert");
  }

  it("上書き保存では、読み込んだ時点のバージョンを送る", async () => {
    vi.mocked(saveProject).mockResolvedValue({ ...loaded, version: 3 });
    const user = userEvent.setup();
    renderControls();

    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    await user.selectOptions(select, project.id);
    await user.click(await screen.findByRole("button", { name: "上書き保存" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
    expect(lastSavedProjectId()).toBe(project.id);
    expect(lastBaseVersion()).toBe(2);
  });

  it("続けて上書き保存するときは、前回の保存後のバージョンを送る", async () => {
    // 自分の保存でバージョンが進む。読み込んだ時点のまま送ると、自分の保存と競合してしまう。
    vi.mocked(saveProject).mockResolvedValue({ ...loaded, version: 3 });
    const user = userEvent.setup();
    renderControls();

    const select = screen.getByLabelText("保存済みプロジェクト");
    await within(select).findByRole("option", { name: /スミレ即売会/ });
    await user.selectOptions(select, project.id);
    await user.click(await screen.findByRole("button", { name: "上書き保存" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("プロジェクトを更新しました。", "status", expect.anything()));
    await user.click(screen.getByRole("button", { name: "上書き保存" }));

    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(2));
    expect(lastBaseVersion()).toBe(3);
  });

  it("競合で断られたら、保存していないことと選択肢を伝える", async () => {
    const user = userEvent.setup();
    renderControls();

    const alert = await saveIntoConflict(user);

    expect(alert).toHaveTextContent("別のタブや端末で更新されています。上書き保存はしていません。");
    expect(screen.getByRole("button", { name: "別のプロジェクトとして保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /最新の内容を読み込む/ })).toBeInTheDocument();
    // 選択肢で伝えるため、同じ内容の通知は重ねない。
    expect(onNotice).not.toHaveBeenCalledWith(expect.anything(), "error", expect.anything());
  });

  it("別のプロジェクトとして保存すると、新規保存し、以後はそちらを更新先にする", async () => {
    const copy: Project = { ...loaded, id: "22222222-2222-4222-8222-222222222222", version: 1 };
    const user = userEvent.setup();
    renderControls();
    await saveIntoConflict(user);

    vi.mocked(saveProject).mockResolvedValue(copy);
    await user.click(screen.getByRole("button", { name: "別のプロジェクトとして保存" }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("プロジェクトを保存しました。", "status", expect.anything()));
    // 新規保存なので、更新先もバージョンも付けない。
    expect(lastSavedProjectId()).toBeNull();
    expect(lastBaseVersion()).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上書き保存" }));
    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(3));
    expect(lastSavedProjectId()).toBe(copy.id);
    expect(lastBaseVersion()).toBe(1);
  });

  it("最新の内容を読み込むと、作品を差し替え、読み込んだバージョンから上書きできる", async () => {
    const latest: Project = { ...loaded, version: 5 };
    const user = userEvent.setup();
    renderControls();
    await saveIntoConflict(user);

    vi.mocked(getProject).mockResolvedValue(latest);
    vi.mocked(saveProject).mockResolvedValue({ ...latest, version: 6 });
    await user.click(screen.getByRole("button", { name: /最新の内容を読み込む/ }));

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上書き保存" }));
    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(2));
    expect(lastSavedProjectId()).toBe(project.id);
    expect(lastBaseVersion()).toBe(5);
  });

  it("最新の内容の読み込み中に編集したら、置き換えずに選択肢を残す", async () => {
    const pendingLoad = deferred<Project>();
    const user = userEvent.setup();
    renderControls();
    await saveIntoConflict(user);

    vi.mocked(getProject).mockReturnValueOnce(pendingLoad.promise);
    await user.click(screen.getByRole("button", { name: /最新の内容を読み込む/ }));
    act(() => useBuilderStore.getState().previewTheme("primary", "#e11d48"));
    await act(async () => pendingLoad.resolve({ ...loaded, version: 5 }));

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(
      expect.stringContaining("読み込み中に編集したため"),
      "status",
      expect.anything(),
    ));
    // 最初に選んだときの1回だけ。待っている間の編集は残る。
    expect(onLoad).toHaveBeenCalledTimes(1);
    // まだ解消していないので、もう一度選べる。
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /最新の内容を読み込む/ })).toBeEnabled();
  });

  it("閉じると選択肢を片付け、保存ボタンへフォーカスを戻す", async () => {
    const user = userEvent.setup();
    renderControls();
    await saveIntoConflict(user);

    await user.click(screen.getByRole("button", { name: "閉じる" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上書き保存" })).toHaveFocus();
  });

  it("競合のあとで作業を切り替えたら、選択肢を出したままにしない", async () => {
    // 切り替え後の作品は、競合したプロジェクトとは関係がない。
    const user = userEvent.setup();
    renderControls();
    await saveIntoConflict(user);

    act(() => useBuilderStore.getState().reset());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
