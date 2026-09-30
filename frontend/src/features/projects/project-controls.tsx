import { SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/select";
import { captureFocusOrigin, type NoticeTone } from "@/features/notice/notice";
import type { LearningRecord, SiteModel } from "@/features/site-model/schema";
import { captureSiteGeneration } from "@/features/site-model/store";
import { deleteProject, getProject, listProjects, saveProject, type Project } from "@/lib/api";

type ProjectControlsProps = {
  enabled: boolean;
  site: SiteModel;
  // 作品と一緒に保存する学習の記録。読み込んだときに学習メモやAI利用記録が消えないようにする。
  record: LearningRecord;
  currentProjectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  onLoad: (site: SiteModel, record: LearningRecord) => void;
  onNotice: (message: string, tone?: NoticeTone, returnFocusTo?: HTMLElement | null) => void;
};

export function ProjectControls(props: ProjectControlsProps) {
  if (!props.enabled) {
    // ログイン機能のない環境。作業中の内容はブラウザに残るが、アカウントへは保存できないため、持ち出す手段としてZIPを案内する。
    return <span className="text-xs text-slate-500">ゲストモードではアカウントに保存できません。作品は提出物ZIPで書き出せます</span>;
  }
  return <ClerkProjectControls {...props} />;
}

function ClerkProjectControls({
  site,
  record,
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
  // 保存と読み込みの間に、リセットや生成で作業が切り替わることがある。isCurrentで始めた時点の作業かを確かめ、
  // 古い結果をいまの作業へ反映しない(#115)。
  const save = useMutation<Project, Error, { returnFocusTo: HTMLElement | null; isCurrent: () => boolean }>({
    mutationFn: () => saveProject(site, record, getToken, currentProjectId),
    onSuccess: async (project, { returnFocusTo, isCurrent }) => {
      setConfirmingDelete(false);
      // 保存そのものは済んでいる。ただ、切り替え後の作品を保存したプロジェクトへ結び付けると、
      // 次の保存で切り替え前のプロジェクトを上書きしてしまうため、対応は付けない。
      const current = isCurrent();
      if (current) onProjectChange(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects", userId] });
      const message = currentProjectId ? "プロジェクトを更新しました。" : "プロジェクトを保存しました。";
      onNotice(
        current ? message : `${message}保存中に作業を切り替えたため、いま開いている作品は次に保存すると新しいプロジェクトになります。`,
        "status",
        returnFocusTo,
      );
    },
    onError: (error: Error, { returnFocusTo }) => onNotice(error.message, "error", returnFocusTo),
  });
  const load = useMutation({
    mutationFn: ({ projectId }: { projectId: string; returnFocusTo: HTMLElement | null; isCurrent: () => boolean }) =>
      getProject(projectId, getToken),
    onSuccess: (project, { returnFocusTo, isCurrent }) => {
      if (!isCurrent()) {
        onNotice("読み込み中に作業を切り替えたため、読み込んだプロジェクトは反映しませんでした。", "status", returnFocusTo);
        return;
      }
      // 作品を差し替えてから対応を付ける。差し替えで作業の世代が進み、先に付けた対応は外れてしまうため。
      onLoad(project.site, { notes: project.notes, aiUsage: project.aiUsage });
      onProjectChange(project.id);
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
  // 取得に失敗したときは、下の「保存一覧エラー」と再試行で伝えるため、ここでは出さない。
  const listStatus = projects.isPending
    ? "保存一覧を読み込み中…"
    : projects.isSuccess && projects.data.length === 0
      ? "保存済みのプロジェクトはまだありません"
      : null;

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
    load.mutate({ projectId, returnFocusTo: captureFocusOrigin(), isCurrent: captureSiteGeneration() });
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
            <Select
              ref={selectRef}
              id="saved-project"
              className="max-w-52"
              value={currentProjectId ?? ""}
              onChange={(event) => handleProjectSelection(event.target.value)}
              disabled={projects.isPending || busy}
              aria-describedby={listStatus ? "saved-project-status" : undefined}
            >
              <option value="">新しいプロジェクト</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.site.siteTitle}（v{project.version}）
                </option>
              ))}
            </Select>
            {/* 一覧が空のままだと、読み込み中なのか、保存したものが無いのかが区別できない。
                セレクトの横に状態を書き、読み上げでもセレクトの説明として伝える。 */}
            {/* 状態が変わったことは describedby だけでは伝わらない。ライブリージョンは中身が変わる前から
                DOMにあり、表示されていないと読み上げられないため、空のときも隠さずに置いておく。
                空のときに並びの隙間（gap-2）だけが残らないよう、左の余白で打ち消す。 */}
            <span id="saved-project-status" role="status" className="flex items-center gap-1 text-xs text-slate-500 empty:-ml-2">
              {projects.isPending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
              {listStatus}
            </span>
            <Button
              variant="secondary"
              disabled={busy || projects.isError}
              loading={save.isPending || load.isPending}
              icon={<Cloud className="size-4" />}
              onClick={() => save.mutate({ returnFocusTo: captureFocusOrigin(), isCurrent: captureSiteGeneration() })}
            >
              {currentProjectId ? "上書き保存" : "保存"}
            </Button>
            {/* 削除できるのは選択中のプロジェクトだけ。「新しいプロジェクト」には
                消す対象が無いため、選ぶまで押せないようにする。 */}
            <Button
              ref={deleteButtonRef}
              type="button"
              variant="quiet-danger"
              size="icon"
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
              loading={remove.isPending}
              icon={<Trash2 className="size-4" />}
            />
            {/* 一覧の取得はretry: falseなので、失敗すると古い内容が残り続ける。
                画面から取り直せる導線を置く。 */}
            {projects.isError && (
              <span className="flex items-center gap-1 text-xs font-bold text-danger-vivid">
                保存一覧エラー
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="px-2 underline"
                  onClick={() => void projects.refetch()}
                  disabled={busy}
                  loading={projects.isFetching}
                >
                  {projects.isFetching ? "再取得中…" : "再試行"}
                </Button>
              </span>
            )}
          </div>

          {/* 削除は取り消せないため、押した場所の近くでもう一度確かめる。
              セクション削除と同じくブラウザのconfirmは使わない。操作が止まるうえ、
              何が巻き添えで消えるのかを画面に書けない。 */}
          {confirmingDelete && currentProjectId && (
            <Callout tone="danger" className="max-w-full p-2">
              <p className="wrap-anywhere">
                「{selectedProject?.site.siteTitle ?? "選択中のプロジェクト"}」を削除しますか？<br />
                このプロジェクトと、関連する学習メモ・品質チェック結果も削除されます。元に戻せません。
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  ref={deleteCancelRef}
                  type="button"
                  variant="ghost"
                  size="sm"
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
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  loading={remove.isPending}
                  onClick={() => remove.mutate({ projectId: currentProjectId })}
                >
                  {remove.isPending ? "削除中…" : "削除する"}
                </Button>
              </div>
            </Callout>
          )}
        </div>
      </SignedIn>
    </>
  );
}
