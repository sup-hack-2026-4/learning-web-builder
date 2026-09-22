import { SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SiteModel } from "@/features/site-model/schema";
import { deleteProject, getProject, listProjects, saveProject, type Project } from "@/lib/api";

type ProjectControlsProps = {
  enabled: boolean;
  site: SiteModel;
  currentProjectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  onLoad: (site: SiteModel) => void;
  onNotice: (notice: string) => void;
};

export function ProjectControls(props: ProjectControlsProps) {
  if (!props.enabled) {
    return <span className="text-xs text-slate-500">保存にはClerk設定が必要です</span>;
  }
  return <ClerkProjectControls {...props} />;
}

function ClerkProjectControls({
  site,
  currentProjectId,
  onProjectChange,
  onLoad,
  onNotice,
}: Omit<ProjectControlsProps, "enabled">) {
  const { getToken, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  // 削除の確認中かどうか。対象は選択中のプロジェクトに限るため、真偽値で足りる。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    onProjectChange(null);
  }, [onProjectChange, userId]);

  const projects = useQuery({
    queryKey: ["projects", userId],
    queryFn: () => listProjects(getToken),
    enabled: isSignedIn === true,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => saveProject(site, getToken, currentProjectId),
    onSuccess: async (project) => {
      setConfirmingDelete(false);
      onProjectChange(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects", userId] });
      onNotice(currentProjectId ? "プロジェクトを更新しました。" : "プロジェクトを保存しました。");
    },
    onError: (error: Error) => onNotice(error.message),
  });
  const load = useMutation({
    mutationFn: (projectId: string) => getProject(projectId, getToken),
    onSuccess: (project) => {
      onProjectChange(project.id);
      onLoad(project.site);
      onNotice("保存済みプロジェクトを読み込みました。");
    },
    onError: (error: Error) => onNotice(error.message),
  });

  const remove = useMutation({
    mutationFn: (projectId: string) => deleteProject(projectId, getToken),
    onSuccess: async (_deleted, projectId) => {
      setConfirmingDelete(false);
      onProjectChange(null);
      // 再取得を待つ前に、消したものを手元の一覧から除く。invalidateQueriesだけだと
      // 再取得に失敗したとき削除済みが選択肢に残り、選ぶと読み込みが404になる。
      queryClient.setQueryData<Project[]>(
        ["projects", userId],
        (previous) => previous?.filter((project) => project.id !== projectId),
      );
      await queryClient.invalidateQueries({ queryKey: ["projects", userId] });
      onNotice("プロジェクトを削除しました。次回の保存は新しいプロジェクトとして作成します。");
    },
    onError: (error: Error) => {
      setConfirmingDelete(false);
      onNotice(error.message);
    },
  });

  const selectedProject = projects.data?.find((project) => project.id === currentProjectId);
  const busy = save.isPending || load.isPending || remove.isPending;

  const handleProjectSelection = (projectId: string) => {
    setConfirmingDelete(false);
    if (!projectId) {
      onProjectChange(null);
      onNotice("次回の保存は新しいプロジェクトとして作成します。");
      return;
    }
    load.mutate(projectId);
  };

  return (
    <>
      <SignedOut>
        <span className="text-xs text-slate-500">ログインすると保存できます</span>
      </SignedOut>
      <SignedIn>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="saved-project">保存済みプロジェクト</label>
            <select
              id="saved-project"
              className="min-h-10 max-w-52 rounded-xl border border-slate-300 bg-white px-3 text-xs"
              value={currentProjectId ?? ""}
              onChange={(event) => handleProjectSelection(event.target.value)}
              disabled={projects.isPending || busy}
            >
              <option value="">新しいプロジェクト</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.site.siteTitle}（v{project.version}）
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={busy || projects.isError}
              onClick={() => save.mutate()}
            >
              {save.isPending || load.isPending
                ? <LoaderCircle className="mr-2 size-4 animate-spin" />
                : <Cloud className="mr-2 size-4" />}
              {currentProjectId ? "上書き保存" : "保存"}
            </Button>
            {/* 削除できるのは選択中のプロジェクトだけ。「新しいプロジェクト」には
                消す対象が無いため、選ぶまで押せないようにする。 */}
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={!currentProjectId || busy || confirmingDelete}
              aria-label={selectedProject
                ? `${selectedProject.site.siteTitle}を削除`
                : "選択中のプロジェクトを削除"}
              title={currentProjectId
                ? "選択中のプロジェクトを削除"
                : "削除するプロジェクトを選んでください"}
              className="inline-flex min-h-10 shrink-0 items-center rounded-xl p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
            >
              {remove.isPending
                ? <LoaderCircle className="size-4 animate-spin" />
                : <Trash2 className="size-4" />}
            </button>
            {/* 一覧の取得はretry: falseなので、失敗すると古い内容が残り続ける。
                画面から取り直せる導線を置く。 */}
            {projects.isError && (
              <span className="flex items-center gap-1 text-xs font-bold text-red-600">
                保存一覧エラー
                <button
                  type="button"
                  onClick={() => void projects.refetch()}
                  disabled={projects.isFetching || busy}
                  className="min-h-10 rounded-xl px-2 font-bold text-red-700 underline transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {projects.isFetching ? "再取得中…" : "再試行"}
                </button>
              </span>
            )}
          </div>

          {/* 削除は取り消せないため、押した場所の近くでもう一度確かめる。
              セクション削除と同じくブラウザのconfirmは使わない。操作が止まるうえ、
              何が巻き添えで消えるのかを画面に書けない。 */}
          {confirmingDelete && currentProjectId && (
            <div className="rounded-xl bg-red-50 p-2 text-xs text-red-900">
              <p className="leading-4">
                「{selectedProject?.site.siteTitle ?? "選択中のプロジェクト"}」を削除しますか？<br />
                このプロジェクトと、関連する学習メモ・品質チェック結果も削除されます。元に戻せません。
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-2 text-xs"
                  disabled={remove.isPending}
                  onClick={() => setConfirmingDelete(false)}
                >
                  やめる
                </Button>
                {/* 保存中も押せると、同じプロジェクトへの保存と削除が並行する。削除の応答が
                    先に返ると、あとから届く保存の成功処理が削除済みIDを選び直してしまい、
                    次の上書き保存が404になる。保存ボタンと同じくbusyでそろえる。 */}
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-2 text-xs text-red-700 hover:bg-red-100"
                  disabled={busy}
                  onClick={() => remove.mutate(currentProjectId)}
                >
                  {remove.isPending ? "削除中…" : "削除する"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SignedIn>
    </>
  );
}
