import { SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { captureFocusOrigin, type NoticeTone } from "@/features/notice/notice";
import type { SiteModel } from "@/features/site-model/schema";
import { deleteProject, getProject, listProjects, saveProject, type Project } from "@/lib/api";

type ProjectControlsProps = {
  enabled: boolean;
  site: SiteModel;
  currentProjectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  onLoad: (site: SiteModel) => void;
  onNotice: (message: string, tone?: NoticeTone, returnFocusTo?: HTMLElement | null) => void;
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
  const selectRef = useRef<HTMLSelectElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  // 削除の結果が届いたあとに移すフォーカス先。移す先は処理中は無効になっていて
  // フォーカスを受け取れないため、処理が終わってから移す。
  const focusAfterRemoveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onProjectChange(null);
  }, [onProjectChange, userId]);

  const projects = useQuery({
    queryKey: ["projects", userId],
    queryFn: () => listProjects(getToken),
    enabled: isSignedIn === true,
    retry: false,
  });
  // 結果は遅れて届くため、通知を閉じたときの戻り先は操作を始めた時点の要素を渡す。
  const save = useMutation<Project, Error, HTMLElement | null>({
    mutationFn: () => saveProject(site, getToken, currentProjectId),
    onSuccess: async (project, returnFocusTo) => {
      setConfirmingDelete(false);
      onProjectChange(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects", userId] });
      onNotice(currentProjectId ? "プロジェクトを更新しました。" : "プロジェクトを保存しました。", "status", returnFocusTo);
    },
    onError: (error: Error, returnFocusTo) => onNotice(error.message, "error", returnFocusTo),
  });
  const load = useMutation({
    mutationFn: ({ projectId }: { projectId: string; returnFocusTo: HTMLElement | null }) => getProject(projectId, getToken),
    onSuccess: (project, { returnFocusTo }) => {
      onProjectChange(project.id);
      onLoad(project.site);
      onNotice("保存済みプロジェクトを読み込みました。", "status", returnFocusTo);
    },
    onError: (error: Error, { returnFocusTo }) => onNotice(error.message, "error", returnFocusTo),
  });

  const remove = useMutation({
    mutationFn: ({ projectId }: { projectId: string }) => deleteProject(projectId, getToken),
    // 押した「削除する」は確認ごと消える。成功したら選択中のものが無くなり削除ボタンも
    // 押せなくなるため選択欄へ、失敗したら同じものをまた消せるよう削除ボタンへ移す。
    // 通知を閉じたときの戻り先もそろえる。
    onSuccess: async (_deleted, { projectId }) => {
      focusAfterRemoveRef.current = selectRef.current;
      setConfirmingDelete(false);
      onProjectChange(null);
      // 再取得を待つ前に、消したものを手元の一覧から除く。invalidateQueriesだけだと
      // 再取得に失敗したとき削除済みが選択肢に残り、選ぶと読み込みが404になる。
      queryClient.setQueryData<Project[]>(
        ["projects", userId],
        (previous) => previous?.filter((project) => project.id !== projectId),
      );
      await queryClient.invalidateQueries({ queryKey: ["projects", userId] });
      onNotice("プロジェクトを削除しました。次回の保存は新しいプロジェクトとして作成します。", "status", selectRef.current);
    },
    onError: (error: Error) => {
      focusAfterRemoveRef.current = deleteButtonRef.current;
      setConfirmingDelete(false);
      onNotice(error.message, "error", deleteButtonRef.current);
    },
  });

  const selectedProject = projects.data?.find((project) => project.id === currentProjectId);
  const busy = save.isPending || load.isPending || remove.isPending;

  useEffect(() => {
    if (busy || !focusAfterRemoveRef.current) return;
    const target = focusAfterRemoveRef.current;
    focusAfterRemoveRef.current = null;
    // 待っている間に利用者が別の場所へ移っていたら、そこから引き戻さない。
    // 確認が消えてフォーカスの行き場が無くなったときだけ移す。
    const active = document.activeElement;
    if (active && active !== document.body) return;
    target.focus();
  }, [busy]);

  // 確認を閉じる。削除ボタンは確認中は無効なので、描画を済ませて押せる状態に戻してから移す。
  const cancelDelete = () => {
    flushSync(() => setConfirmingDelete(false));
    deleteButtonRef.current?.focus();
  };

  const handleProjectSelection = (projectId: string) => {
    setConfirmingDelete(false);
    if (!projectId) {
      onProjectChange(null);
      onNotice("次回の保存は新しいプロジェクトとして作成します。");
      return;
    }
    load.mutate({ projectId, returnFocusTo: captureFocusOrigin() });
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
              ref={selectRef}
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
              onClick={() => save.mutate(captureFocusOrigin())}
            >
              {save.isPending || load.isPending
                ? <LoaderCircle className="mr-2 size-4 animate-spin" />
                : <Cloud className="mr-2 size-4" />}
              {currentProjectId ? "上書き保存" : "保存"}
            </Button>
            {/* 削除できるのは選択中のプロジェクトだけ。「新しいプロジェクト」には
                消す対象が無いため、選ぶまで押せないようにする。 */}
            <button
              ref={deleteButtonRef}
              type="button"
              onClick={() => {
                // 押すとこのボタンは無効になり、フォーカスが外れる。確認の中の引き返す側へ移す。
                flushSync(() => setConfirmingDelete(true));
                deleteCancelRef.current?.focus();
              }}
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
                  ref={deleteCancelRef}
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-2 text-xs"
                  disabled={remove.isPending}
                  onClick={cancelDelete}
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
                  onClick={() => remove.mutate({ projectId: currentProjectId })}
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
