import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { explanationDictionary } from "@/features/explanations/dictionary";
import { useBuilderStore } from "@/features/site-model/store";

// 解説パネル。プレビューで選んだ要素について、HTML・CSSとその理由を示す。
export function ExplanationPanel() {
  const { site, selectedElementId } = useBuilderStore();
  const selectedSection = site.sections.find((section) => section.id === selectedElementId);
  // 追加したセクションのidは「gallery-2」のように採番されるため、idだけでは引けない。
  // 種類ごとの解説へ落として、別のセクションの説明が出てしまうのを避ける。
  const explanation =
    explanationDictionary[selectedElementId] ??
    (selectedSection ? explanationDictionary[selectedSection.kind] : undefined) ??
    explanationDictionary.about;

  return (
    <Card className="mt-4 p-4">
      <h3 className="text-sm font-black">なぜこのコード？</h3>
      {/* プレビュー上に置くと画面を圧迫するため、操作案内はこのタブ内に置く。 */}
      <Callout tone="info" className="mt-2 px-3 py-2">
        プレビュー内の要素を<strong>クリック</strong>すると、その部分の解説に切り替わります。
      </Callout>
      <p className="mt-3 text-sm font-bold text-blue-700">{explanation.title}</p>
      <p className="mt-2 text-xs leading-5"><strong>HTML:</strong> {explanation.html}</p>
      <p className="mt-1 text-xs leading-5"><strong>CSS:</strong> {explanation.css}</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">{explanation.why}</p>
    </Card>
  );
}
