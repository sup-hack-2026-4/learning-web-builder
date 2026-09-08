import { useEffect, useState } from "react";
import { summarizeAxeFindings, type AxeFinding } from "./axe-audit";
import { runAxeAudit } from "./run-axe-audit";
import type { QualityCheck, SiteModel } from "../site-model/schema";

// 色や文字を触るたびに検査すると重いため、操作が落ち着いてから1回だけ走らせる。
const AUDIT_DEBOUNCE_MS = 700;

export type AxeAuditState =
  | { status: "loading" }
  | { status: "ready"; findings: AxeFinding[]; check: QualityCheck }
  | { status: "error"; message: string };

// 実行中は毎回同じ値を返す。レンダーのたびに新しいオブジェクトを作ると、
// これを見ている側のuseMemoが無駄に作り直されるため。
const LOADING: AxeAuditState = { status: "loading" };

const ERROR: AxeAuditState = {
  status: "error",
  message: "自動チェックを実行できませんでした。しばらくしてからもう一度開いてください。",
};

/** 生成中のサイトに対してaxeの自動チェックを走らせ、実行中・結果・失敗を返す。 */
export function useAxeAudit(site: SiteModel): AxeAuditState {
  // どのサイトを検査した結果かを一緒に持つ。
  // 検査には時間がかかるため、古い結果を今のサイトの結果として出さないようにする。
  const [audited, setAudited] = useState<{ site: SiteModel; state: AxeAuditState } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      runAxeAudit(site)
        .then((findings) => {
          if (cancelled) return;
          setAudited({ site, state: { status: "ready", findings, check: summarizeAxeFindings(findings) } });
        })
        .catch(() => {
          if (cancelled) return;
          setAudited({ site, state: ERROR });
        });
    }, AUDIT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [site]);

  return audited?.site === site ? audited.state : LOADING;
}
