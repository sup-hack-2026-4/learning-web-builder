import { Check } from "lucide-react";
import type { StepView } from "@/features/learning-flow/steps";

/**
 * 学習の工程を1行で示す。
 *
 * タブではなく現在地の表示なので、role="tablist" ではなく順序リストで組む。
 * 押して切り替えるものではないため、ボタンにもしない。
 */
export function StepNav({ steps }: { steps: StepView[] }) {
  const currentIndex = steps.findIndex((step) => step.current);
  const current = steps[currentIndex];

  return (
    <nav aria-label="学習の進みかた" className="min-w-0">
      {/* 狭い画面では5つ並べきれず、末尾が画面外へ出て気づけない。
          現在地だけを「3/5 調整」の形に圧縮して出す。 */}
      {current && (
        <p className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-black text-white sm:hidden">
          {currentIndex + 1}/{steps.length} {current.label}
          <span className="sr-only">（いまここ）</span>
        </p>
      )}

      <ol className="hidden items-center gap-1 sm:flex">
        {steps.map((step, index) => (
          <li key={step.key} className="flex shrink-0 items-center gap-1">
            {index > 0 && <span className="h-px w-3 bg-slate-300 lg:w-5" aria-hidden />}
            <span
              // 現在地は支援技術にも伝える。色や太さだけで示すと読み上げでは分からない。
              aria-current={step.current ? "step" : undefined}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition ${
                step.current
                  ? "bg-blue-600 font-black text-white"
                  : step.done
                    ? "font-bold text-emerald-700"
                    : "text-slate-400"
              }`}
            >
              {step.done && !step.current && <Check className="size-3.5" aria-hidden />}
              {step.label}
              {step.current && <span className="sr-only">（いまここ）</span>}
              {step.done && !step.current && <span className="sr-only">（済み）</span>}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
