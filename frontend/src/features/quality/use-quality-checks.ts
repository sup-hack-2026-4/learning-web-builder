import { useEffect, useMemo, useRef } from "react";
import type { ShowNotice } from "@/features/notice/notice";
import type { SiteModel } from "@/features/site-model/schema";
import { evaluateQuality } from "./evaluate-quality";
import { useAxeAudit } from "./use-axe-audit";

// 品質チェック。静的な3項目と、axeによるアクセシビリティの自動チェックをまとめて扱う。
export function useQualityChecks(site: SiteModel, showNotice: ShowNotice) {
  const quality = useMemo(() => evaluateQuality(site), [site]);
  // axeの自動チェックはiframeでの実測が要るため非同期。終わるまでは静的な3項目だけで判断する。
  const { state: axeAudit, retry } = useAxeAudit(site);
  // やり直しの結果を伝えたあとの戻り先。押した「もう一度チェックする」は消えるため、見出しへ戻す。
  const axeHeadingRef = useRef<HTMLHeadingElement>(null);
  // 再検査を押したあとは、開始と結果を通知で伝える。押したボタンは消え、結果は離れた場所に出るため。
  // 編集のたびに走る通常の検査では通知しない。毎回読み上げられると操作の邪魔になる。
  const retryAnnouncementRef = useRef<HTMLElement | null | undefined>(undefined);
  const retryWithNotice = () => {
    const returnFocusTo = axeHeadingRef.current;
    retryAnnouncementRef.current = returnFocusTo;
    retry();
    showNotice("アクセシビリティの自動チェックをやり直しています…", "status", returnFocusTo);
  };
  useEffect(() => {
    const returnFocusTo = retryAnnouncementRef.current;
    if (returnFocusTo === undefined || axeAudit.status === "loading") return;
    retryAnnouncementRef.current = undefined;
    if (axeAudit.status === "error") {
      showNotice("アクセシビリティの自動チェックを、もう一度実行できませんでした。時間をおいて「もう一度チェックする」を押してください。", "error", returnFocusTo);
      return;
    }
    const count = axeAudit.findings.length;
    showNotice(
      count === 0
        ? "アクセシビリティの自動チェックが終わりました。見つかる問題はありませんでした。"
        : `アクセシビリティの自動チェックが終わりました。指摘が${count}件あります。「品質」タブで確認してください。`,
      "status",
      returnFocusTo,
    );
  }, [axeAudit, showNotice]);

  const hasQualityIssue = useMemo(
    () => quality.some((item) => !item.passed) || (axeAudit.status === "ready" && !axeAudit.check.passed),
    [quality, axeAudit],
  );

  return { quality, axeAudit, axeHeadingRef, retryWithNotice, hasQualityIssue };
}

export type QualityChecks = ReturnType<typeof useQualityChecks>;
