import { Check, Circle } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ChangeTracking } from "@/features/change-tracking/use-change-tracking";
import { SectionImageField } from "@/features/images/section-image-field";
import { MAX_REASON_INPUT_LENGTH, sectionFieldProblem } from "@/features/site-model/schema";
import { useBuilderStore } from "@/features/site-model/store";

type DesignPanelProps = {
  tracking: ChangeTracking;
  // 一覧から編集を始めたときのフォーカス先。選んだ結果が読み上げで伝わるよう、編集欄の見出しに置く。
  selectedSectionHeadingRef: RefObject<HTMLHeadingElement | null>;
};

// 調整パネル。変更の理由を書き、デザイン・構成・内容の変更と一緒に記録する。
export function DesignPanel({ tracking, selectedSectionHeadingRef }: DesignPanelProps) {
  const { site, selectedElementId, updateSection, setSectionImage, removeSectionImage } = useBuilderStore();
  const { reason, setReason, reasonChecks, passedAspects, changeTheme, pendingStructure } = tracking;
  const selectedSection = site.sections.find((section) => section.id === selectedElementId);
  // 上限を超えても入力は止めない。貼り付けた文章を、見ながら削って直せるようにするため。
  // 代わりに欄の下へ理由を出し、保存の前にも同じ判定で止める(#117)。
  const titleError = selectedSection ? sectionFieldProblem("title", selectedSection.title) : null;
  const bodyError = selectedSection ? sectionFieldProblem("body", selectedSection.body) : null;
  const imageAltError = selectedSection ? sectionFieldProblem("imageAlt", selectedSection.imageAlt) : null;

  return (
    <>
      <label className="mt-4 block text-xs font-bold" htmlFor="reason">なぜこの変更をしますか？</label>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">何を・どう変えて・なぜかを具体的に書くと、あとで見返したときに理解が深まります。</p>
      <Textarea id="reason" rows={2} maxLength={MAX_REASON_INPUT_LENGTH} className={`mt-1 ${reason.trim() ? "" : "ring-2 ring-warning-vivid focus-visible:ring-warning-vivid"}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例：見出しを赤にした。植物園の元気な雰囲気を伝えたいから" />

      {/* 書けている観点をその場で返す。記録は止めず、足りない観点の書き足しかたを示す。 */}
      <ul className="mt-2 space-y-1" aria-label="理由の書けている観点">
        {reasonChecks.map((check) => (
          <li key={check.id} className="flex gap-1.5 text-[11px] leading-4">
            {check.passed
              ? <Check className="mt-px size-3.5 shrink-0 text-success-vivid" aria-hidden />
              : <Circle className="mt-px size-3.5 shrink-0 text-slate-300" aria-hidden />}
            <span className={check.passed ? "text-success" : "text-slate-500"}>
              <strong className="font-bold">{check.label}</strong>
              {check.passed ? <span className="sr-only">：書けています</span> : `：${check.hint}`}
            </span>
          </li>
        ))}
      </ul>
      {passedAspects === reasonChecks.length && (
        <p className="mt-1 text-[11px] font-bold text-success">3つそろいました。記録すると、変わったコードも一緒に残ります。</p>
      )}

      <Card className="relative mt-4 space-y-4 p-4">
        <h3 className="text-sm font-black">デザイン</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-bold">メインカラー<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.primary} onChange={(event) => changeTheme("primary", event.target.value)} /></label>
          <label className="block text-xs font-bold">背景色<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.background} onChange={(event) => changeTheme("background", event.target.value)} /></label>
          <label className="block text-xs font-bold">テキストカラー<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.text} onChange={(event) => changeTheme("text", event.target.value)} /></label>
          {/* 見出しの色は未指定ならメインカラーを引き継ぐ。ピッカーにはその実効値を表示する。 */}
          <label className="block text-xs font-bold">見出しの色<input className="mt-1 h-10 w-full cursor-pointer" type="color" value={site.theme.heading ?? site.theme.primary} onChange={(event) => changeTheme("heading", event.target.value)} /></label>
        </div>
        <label className="block text-xs font-bold">余白: {site.theme.spacing}<input className="mt-2 w-full" type="range" min="2" max="10" value={site.theme.spacing} onChange={(event) => changeTheme("spacing", Number(event.target.value))} /></label>
        <label className="block text-xs font-bold">フォント<Select className="mt-1 w-full" value={site.theme.fontFamily} onChange={(event) => changeTheme("fontFamily", event.target.value)}><option value="sans">ゴシック</option><option value="serif">明朝</option><option value="rounded">丸ゴシック</option></Select></label>
        <Button className="w-full whitespace-nowrap px-2 text-xs" variant="secondary" disabled={!reason.trim()} onClick={tracking.recordThemeReason}>デザイン変更の理由を記録</Button>
      </Card>

      {/* 構成の変更は、色や文章の書き換えより判断の粒度が大きい。
          何を足して何を削ったのかを並べ、まとめて1件の説明として残す。 */}
      {pendingStructure.length > 0 && <Card className="mt-4 space-y-3 p-4">
        <h3 className="text-sm font-black">セクション構成の変更</h3>
        <ul className="space-y-1 text-xs text-slate-600">
          {pendingStructure.map((change) => <li key={change.id}>・{change.label}</li>)}
        </ul>
        <Button type="button" className="w-full whitespace-nowrap px-2 text-xs" variant="secondary" disabled={!reason.trim()} onClick={tracking.recordStructureReason}>セクション構成の理由を記録</Button>
      </Card>}

      {selectedSection && <Card className="mt-4 space-y-3 p-4">
        <h3 ref={selectedSectionHeadingRef} tabIndex={-1} className="text-sm font-black wrap-anywhere">選択中: {selectedSection.title}</h3>
        {/* エラー文はlabelの外に置く。中に置くと、欄の名前（読み上げで読む名前）にまで含まれてしまう。 */}
        <div>
          <label className="block text-xs font-bold">見出し<Input className="mt-1" value={selectedSection.title} onChange={(event) => updateSection(selectedSection.id, { title: event.target.value })} aria-invalid={titleError ? true : undefined} aria-describedby={titleError ? "section-title-error" : undefined} /></label>
          <FieldError id="section-title-error" message={titleError} />
        </div>
        <div>
          <label className="block text-xs font-bold">本文<Textarea className="mt-1" rows={4} value={selectedSection.body} onChange={(event) => updateSection(selectedSection.id, { body: event.target.value })} aria-invalid={bodyError ? true : undefined} aria-describedby={bodyError ? "section-body-error" : undefined} /></label>
          <FieldError id="section-body-error" message={bodyError} />
        </div>
        {selectedSection.kind !== "contact" && (
          <SectionImageField
            section={selectedSection}
            sections={site.sections}
            onSelect={(image) => setSectionImage(selectedSection.id, image)}
            onRemove={() => removeSectionImage(selectedSection.id)}
          />
        )}
        {selectedSection.kind !== "contact" && <div>
          <label className="block text-xs font-bold">画像の説明（alt）<Input className="mt-1" value={selectedSection.imageAlt} onChange={(event) => updateSection(selectedSection.id, { imageAlt: event.target.value })} placeholder="画像が見えない人にも伝わる説明" aria-invalid={imageAltError ? true : undefined} aria-describedby={imageAltError ? "section-image-alt-error" : undefined} /></label>
          <FieldError id="section-image-alt-error" message={imageAltError} />
        </div>}
        <Button className="w-full whitespace-nowrap px-2 text-xs" variant="secondary" disabled={!reason.trim()} onClick={() => tracking.recordContentReason(selectedSection)}>内容変更の理由を記録</Button>
      </Card>}
    </>
  );
}
