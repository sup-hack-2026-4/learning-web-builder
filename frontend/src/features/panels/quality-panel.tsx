import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { impactLabels } from "@/features/quality/axe-audit";
import type { QualityChecks } from "@/features/quality/use-quality-checks";

// 品質パネル。静的な3項目と、アクセシビリティの自動チェックの結果を示す。
export function QualityPanel({ checks }: { checks: QualityChecks }) {
  const { quality, axeAudit, axeHeadingRef, retryWithNotice } = checks;
  return (
    <Card className="mt-4 p-4">
      <h3 className="text-sm font-black">品質チェック</h3>
      <div className="mt-3 space-y-3">{quality.map((item) => <div key={item.id} className="flex gap-2 text-xs">{item.passed ? <Check className="size-5 shrink-0 text-success-vivid" /> : <X className="size-5 shrink-0 text-danger-vivid" />}<div className="min-w-0 wrap-anywhere"><strong>{item.label}</strong><p className="mt-0.5 leading-5 text-slate-600">{item.detail}</p></div></div>)}</div>

      {/* アクセシビリティの自動チェック（axe）。実測に時間がかかるため、実行中・結果・失敗を分けて出す。 */}
      <section aria-labelledby="axe-heading" className="mt-4 border-t border-slate-200 pt-3">
        <h4 ref={axeHeadingRef} id="axe-heading" tabIndex={-1} className="text-xs font-black">アクセシビリティの自動チェック</h4>

        {axeAudit.status === "loading" && (
          <p className="mt-2 text-xs text-slate-500" data-testid="axe-loading">自動チェックを実行しています…</p>
        )}

        {axeAudit.status === "error" && (
          <div className="mt-2 text-xs text-danger" data-testid="axe-error">
            <p className="flex gap-2">
              <X className="size-5 shrink-0" />
              <span className="leading-5">{axeAudit.message}</span>
            </p>
            {/* 検査はサイトが変わったときにしか走らないため、同じサイトのまま再実行できる導線を置く。
                押すとこのボタンは消えるため、実行中の表示が続く見出しへフォーカスを移す。 */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => {
                retryWithNotice();
                axeHeadingRef.current?.focus();
              }}
            >
              もう一度チェックする
            </Button>
          </div>
        )}

        {axeAudit.status === "ready" && axeAudit.findings.length === 0 && (
          <p className="mt-2 flex gap-2 text-xs text-slate-600" data-testid="axe-empty">
            <Check className="size-5 shrink-0 text-success-vivid" />
            <span className="leading-5">自動チェックで見つかる問題はありませんでした。</span>
          </p>
        )}

        {axeAudit.status === "ready" && axeAudit.findings.length > 0 && (
          <ul className="mt-2 space-y-3" data-testid="axe-findings">
            {axeAudit.findings.map((finding) => (
              <li key={finding.ruleId} className="flex gap-2 text-xs">
                <X className="size-5 shrink-0 text-danger-vivid" />
                <div className="min-w-0">
                  <strong className="leading-5">{finding.summary}</strong>
                  <p className="mt-0.5 leading-5 text-slate-600">{finding.why}</p>
                  <p className="mt-0.5 leading-5 text-slate-500">
                    影響: {impactLabels[finding.impact]} ／ 対象: <code className="break-all">{finding.target}</code>
                    {finding.count > 1 && ` ほか${finding.count - 1}件`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* 自動チェックが万能だと思わせないための一文。
            axeは機械的に判定できる範囲しか見ないため、通っても内容の分かりやすさは別途確認が要る。 */}
        <p className="mt-3 text-[11px] leading-4 text-slate-500">
          提出物と同じHTML・CSSを読み込んで自動判定しています。ここで問題が無くても、文章の分かりやすさは自分の目で確認してください。
        </p>
      </section>
    </Card>
  );
}
