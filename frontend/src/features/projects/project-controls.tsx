import { SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { SiteModel } from "@/features/site-model/schema";
import { getProject, listProjects, saveProject } from "@/lib/api";

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

  const handleProjectSelection = (projectId: string) => {
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
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="saved-project">保存済みプロジェクト</label>
          <select
            id="saved-project"
            className="min-h-10 max-w-52 rounded-xl border border-slate-300 bg-white px-3 text-xs"
            value={currentProjectId ?? ""}
            onChange={(event) => handleProjectSelection(event.target.value)}
            disabled={projects.isPending || load.isPending}
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
            disabled={save.isPending || load.isPending || projects.isError}
            onClick={() => save.mutate()}
          >
            {save.isPending || load.isPending
              ? <LoaderCircle className="mr-2 size-4 animate-spin" />
              : <Cloud className="mr-2 size-4" />}
            {currentProjectId ? "上書き保存" : "保存"}
          </Button>
          {projects.isError && <span className="text-xs font-bold text-red-600">保存一覧エラー</span>}
        </div>
      </SignedIn>
    </>
  );
}
