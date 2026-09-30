import { useCallback, useState } from "react";
import { useBuilderStore } from "@/features/site-model/store";

// いま開いている作品と、アカウントに保存したプロジェクトとの対応。
// 対応を付けた時点の作業の世代と一緒に持ち、作業が切り替わったら（生成・読み込み・リセット・
// 別タブでの差し替え）自動的に外す。外し忘れると、切り替え後の作品で前のプロジェクトを上書きしてしまう(#115)。
export function useProjectLink() {
  const siteGeneration = useBuilderStore((state) => state.siteGeneration);
  const [link, setLink] = useState<{ projectId: string | null; generation: number }>(() => ({
    projectId: null,
    generation: siteGeneration,
  }));
  const currentProjectId = link.generation === siteGeneration ? link.projectId : null;
  // 対応を付けるのは、いまの作業に対して。読み込みでは、作品を差し替えたあとに呼ぶ。
  const setCurrentProjectId = useCallback((projectId: string | null) => {
    setLink({ projectId, generation: useBuilderStore.getState().siteGeneration });
  }, []);
  return { currentProjectId, setCurrentProjectId };
}
