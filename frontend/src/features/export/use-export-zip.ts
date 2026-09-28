import { useMutation } from "@tanstack/react-query";
import type { ShowNotice } from "@/features/notice/notice";
import type { AiUsage, LearningNote, QualityCheck, SiteModel } from "@/features/site-model/schema";
import { exportProject } from "./export-project";

// 画像を含むZIPは作るのに時間がかかる。処理中はボタンを止めて連打による重複出力を防ぎ、
// 開始と成否は他の操作と同じ通知で伝える（読み上げにも届く）。失敗してもボタンは戻るため、そのまま再試行できる。
export function useExportZip(showNotice: ShowNotice) {
  return useMutation({
    // ZIPはブラウザの中だけで作るため、オフラインでも止めない。
    // 既定のままだと、オフライン時に処理が一時停止し「ZIP作成中…」から戻らなくなる。
    networkMode: "always",
    // 出力する内容はクリックした時点の値を引数で受け取る。関数の外の値を読むと、
    // 実行までの間に編集された内容が混ざるおそれがある。
    mutationFn: (input: {
      site: SiteModel;
      notes: LearningNote[];
      aiUsage: AiUsage[];
      extraChecks: QualityCheck[];
      returnFocusTo: HTMLElement | null;
    }) => exportProject(input.site, input.notes, input.aiUsage, input.extraChecks),
    onMutate: ({ returnFocusTo }) => {
      showNotice("提出物ZIPを作成しています…", "status", returnFocusTo);
    },
    // 分かるのはZIPを作ってダウンロードを始めたところまで。保存できたかはブラウザ側でしか分からない。
    onSuccess: (_, { returnFocusTo }) => {
      showNotice("提出物ZIPを作成しました。ブラウザのダウンロード状況を確認してください。", "status", returnFocusTo);
    },
    // 手元の処理なので、待てば直る失敗ではない。起きやすい原因と、自分でできる対処を示す。
    onError: (_, { returnFocusTo }) => {
      showNotice(
        "提出物ZIPを作成できませんでした。画像が大きい・多いとブラウザで処理しきれないことがあります。画像を減らすか、ページを再読み込みしてから、もう一度「提出物ZIP」を押してください。",
        "error",
        returnFocusTo,
      );
    },
  });
}
