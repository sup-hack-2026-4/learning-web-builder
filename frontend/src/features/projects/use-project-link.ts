import { useCallback, useState } from "react";
import { useBuilderStore } from "@/features/site-model/store";

// いま開いている作品と、アカウントに保存したプロジェクトとの対応。
// 対応を付けた時点の作業の世代と一緒に持ち、作業が切り替わったら（生成・読み込み・リセット・
// 別タブでの差し替え）自動的に外す。外し忘れると、切り替え後の作品で前のプロジェクトを上書きしてしまう(#115)。
//
// 読み込んだ時点（または前回の保存後）のバージョンも一緒に持つ。上書き保存で送り、
// その後に別のタブや端末で更新されていたら、サーバーに断ってもらうため(#118)。
export function useProjectLink() {
  const siteGeneration = useBuilderStore((state) => state.siteGeneration);
  const [link, setLink] = useState<{ projectId: string | null; version: number | null; generation: number }>(() => ({
    projectId: null,
    version: null,
    generation: siteGeneration,
  }));
  const linked = link.generation === siteGeneration;
  const currentProjectId = linked ? link.projectId : null;
  const currentProjectVersion = linked ? link.version : null;
  // 対応を付けるのは、いまの作業に対して。読み込みでは、作品を差し替えたあとに呼ぶ。
  const setCurrentProjectId = useCallback((projectId: string | null, version: number | null = null) => {
    setLink({ projectId, version: projectId ? version : null, generation: useBuilderStore.getState().siteGeneration });
  }, []);
  return { currentProjectId, currentProjectVersion, setCurrentProjectId };
}
