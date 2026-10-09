import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/select";
import type { ChangeTracking } from "@/features/change-tracking/use-change-tracking";
import type { ShowNotice } from "@/features/notice/notice";
import type { SiteSection } from "@/features/site-model/schema";
import {
  addSectionBlockReason,
  maxSections,
  removeSectionBlockReason,
  sectionKindLabels,
  sectionKinds,
  type SectionKind,
} from "@/features/site-model/sections";
import { useBuilderStore } from "@/features/site-model/store";

// セクション一覧の行にある操作要素のid。行が消えたり確認を閉じたりしたあと、
// フォーカスを移す先をセクションのidから引けるようにする。
const sectionToggleId = (sectionId: string) => `section-visible-${sectionId}`;
const sectionRemoveButtonId = (sectionId: string) => `section-remove-${sectionId}`;

type SectionListProps = {
  tracking: Pick<ChangeTracking, "toggleSection" | "addSection" | "removeSection" | "revision">;
  // 一覧から編集を始める。編集欄は別の領域にあるため、表示の切り替えとフォーカス移動は呼び出し側で行う。
  onEdit: (sectionId: string) => void;
  // 見出し。行がすべて消えたときや、ほかの領域から一覧へ案内したときのフォーカスの受け皿。
  headingRef: RefObject<HTMLHeadingElement | null>;
  showNotice: ShowNotice;
};

// セクションの一覧。表示の切り替え、編集対象の選択、追加と削除を受け持つ。
export function SectionList({ tracking, onEdit, headingRef, showNotice }: SectionListProps) {
  const { site, selectedElementId } = useBuilderStore();
  // 削除の確認を出している行。取り消せない操作なので、押した行の中で一度確かめる。
  const [removalTargetId, setRemovalTargetId] = useState<string | null>(null);
  // サイトが差し替わったら（生成・リセット・読み込み）、開いていた確認を閉じる。
  // 効果（effect）で閉じると、差し替え後のサイトに古い確認が一瞬残るため、描画中に比べて直す。
  const [seenRevision, setSeenRevision] = useState(tracking.revision);
  if (seenRevision !== tracking.revision) {
    setSeenRevision(tracking.revision);
    setRemovalTargetId(null);
  }
  // 確認を開いたらフォーカスを入れる先。取り消せない操作なので、引き返す側のボタンに置く。
  const removalCancelRef = useRef<HTMLButtonElement>(null);
  // 追加するセクションの種類。生成結果には入りにくく、かつ足す判断をしやすい
  // 「写真・作品」を初期値にする。ヒーローを初期値にすると、h1が2つある構造を
  // 何気なく作ってしまいやすい（品質チェックには出るが、最初の一歩としては遠回り）。
  const [newSectionKind, setNewSectionKind] = useState<SectionKind>("gallery");

  // 上限・下限に達したら押せなくする。押せない理由は文言でも示す。
  const addBlockReason = addSectionBlockReason(site.sections.length);
  const removeBlockReason = removeSectionBlockReason(site.sections.length);

  // 削除せずに確認を閉じる。押したボタンは確認ごと消えるため、確認を開いた削除ボタンへ戻す。
  const closeRemovalConfirm = (sectionId: string) => {
    setRemovalTargetId(null);
    document.getElementById(sectionRemoveButtonId(sectionId))?.focus();
  };

  // セクションの削除。確認を通ってから呼ぶ。
  const handleRemoveSection = (section: SiteSection) => {
    if (removeBlockReason) return;
    // 押した「削除する」は行ごと消えるため、隣の行（末尾なら前の行）へフォーカスを移す。
    // 移す先は表示切り替えのチェックボックス。削除ボタンは下限に達すると無効になり、受け取れない。
    const index = site.sections.findIndex((item) => item.id === section.id);
    const neighbor = site.sections[index + 1] ?? site.sections[index - 1];
    // 行が消えた後の画面へフォーカスを移すため、ここでの更新は先に描画まで済ませる。
    flushSync(() => {
      tracking.removeSection(section);
      setRemovalTargetId(null);
    });
    const focusTarget = (neighbor && document.getElementById(sectionToggleId(neighbor.id))) ?? headingRef.current;
    focusTarget?.focus();
    // 通知を閉じたときの戻り先も、消えた「削除する」ではなく移した先にする。
    showNotice(`「${section.title}」を削除しました。なぜ削るのかを書いて記録してください。`, "status", focusTarget);
  };

  return (
    <>
      <h2 ref={headingRef} tabIndex={-1} className="mb-1 text-sm font-black">
        セクション <span className="font-normal text-slate-600">{site.sections.length} / {maxSections}</span>
      </h2>
      <p className="mb-2 text-[11px] leading-4 text-slate-500">
        チェックを外すと非表示になります。使わないと決めたものは削除できます。
      </p>
      <ul className="space-y-2">
        {site.sections.map((section) => (
          <li
            key={section.id}
            data-selected={section.id === selectedElementId}
            // 左の線が3px太くなる分、左の余白を詰めて、タイトルの位置を他の行とそろえる。
            className={`rounded-xl border py-2 pr-3 text-sm ${section.id === selectedElementId ? "border-blue-300 border-l-4 border-l-blue-600 bg-blue-50 pl-[9px]" : "border-slate-200 pl-3"}`}
          >
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2">
                {/* 選んでいる行は、色を見分けにくい人にも分かるよう、太字と左の太い線でも示す。
                    一覧は幅が狭く、文字の目印を足すとタイトルが読めなくなるため、幅を使わない形にする。 */}
                <span className={`truncate ${section.id === selectedElementId ? "font-bold" : ""}`}>{section.title}</span>
                <input id={sectionToggleId(section.id)} type="checkbox" checked={section.visible} onChange={(event) => tracking.toggleSection(section.id, event.target.checked)} />
              </label>
              {/* プレビュー内のクリックに代わる選び方。どれを選んでいるかはaria-currentで伝える。 */}
              <Button
                type="button"
                variant="quiet"
                size="icon"
                onClick={() => onEdit(section.id)}
                aria-label={`${section.title}を編集`}
                aria-current={section.id === selectedElementId ? "true" : undefined}
                title={`${section.title}を編集`}
                // 行の上下の余白へ重ねて、行の高さを変えない。選んでいる行は青で示す。
                className="-my-2 rounded-lg enabled:hover:bg-blue-50 enabled:hover:text-blue-700 aria-[current=true]:text-blue-700"
                icon={<Pencil className="size-4" />}
              />
              <Button
                type="button"
                variant="quiet-danger"
                size="icon"
                id={sectionRemoveButtonId(section.id)}
                onClick={() => {
                  // 確認は押したボタンの下に出るだけなので、そのままでは読み上げもTabの位置も
                  // 確認を素通りする。描画を済ませてから確認の中へフォーカスを入れる。
                  flushSync(() => setRemovalTargetId(section.id));
                  removalCancelRef.current?.focus();
                }}
                disabled={removeBlockReason !== null}
                aria-label={`${section.title}を削除`}
                title={removeBlockReason ?? `${section.title}を削除`}
                // 行の上下と右の余白へ重ねて、行の高さとアイコンの位置をほぼ変えない。
                className="-my-2 -mr-2 rounded-lg"
                icon={<Trash2 className="size-4" />}
              />
            </div>

            {/* 削除は取り消せないため、押した行の中でもう一度確かめる。
                ブラウザのconfirmだと操作が止まるうえ、「まず非表示にする」という
                引き返し方を示せない。消す前に、消さずに済む道を出しておく。 */}
            {removalTargetId === section.id && (
              <Callout tone="danger" className="mt-2 p-2">
                <p>削除すると元に戻せません。迷うなら、まず非表示にして様子を見てください。</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => { tracking.toggleSection(section.id, false); closeRemovalConfirm(section.id); }}
                  >
                    まず非表示にする
                  </Button>
                  <Button ref={removalCancelRef} type="button" variant="ghost" size="sm" onClick={() => closeRemovalConfirm(section.id)}>やめる</Button>
                  <Button type="button" variant="danger" size="sm" onClick={() => handleRemoveSection(section)}>削除する</Button>
                </div>
              </Callout>
            )}
          </li>
        ))}
      </ul>

      {/* 追加は末尾へ入る。種類によって出力されるHTML・CSSが変わるため、種類は自分で選ぶ。 */}
      <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-3">
        <label className="block text-xs font-bold text-slate-600" htmlFor="new-section-kind">追加するセクション</label>
        <div className="mt-1 flex gap-2">
          <Select
            id="new-section-kind"
            className="min-w-0 flex-1"
            value={newSectionKind}
            onChange={(event) => setNewSectionKind(event.target.value as SectionKind)}
          >
            {sectionKinds.map((kind) => <option key={kind} value={kind}>{sectionKindLabels[kind]}</option>)}
          </Select>
          <Button type="button" variant="secondary" className="shrink-0 gap-1 px-3" disabled={addBlockReason !== null} onClick={() => tracking.addSection(newSectionKind)} icon={<Plus className="size-4" />}>
            追加
          </Button>
        </div>
        {addBlockReason && <p className="mt-2 text-[11px] leading-4 text-warning">{addBlockReason}</p>}
      </div>
    </>
  );
}
