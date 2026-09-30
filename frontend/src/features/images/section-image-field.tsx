import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SectionImage, SiteSection } from "@/features/site-model/schema";
import { captureSiteGeneration, useBuilderStore } from "@/features/site-model/store";
import {
  acceptedImageTypes,
  imageAddBlockReason,
  imageTotalBlockReason,
  prepareSectionImage,
} from "./prepare-image";

type SectionImageFieldProps = {
  section: SiteSection;
  /** 上限は1枚ずつではなく全体で見るため、モデルのセクションをすべて受け取る。 */
  sections: readonly SiteSection[];
  onSelect: (image: SectionImage) => void;
  onRemove: () => void;
};

/**
 * セクションの画像を選ぶ・差し替える・削除する。
 *
 * 画像は選んだ時点では入れ替わらない。縮小と再圧縮に時間がかかるため、
 * 処理中・失敗・未選択の3つを画面に出し分け、何が起きているかが分かるようにする。
 */
export function SectionImageField({ section, sections, onSelect, onRemove }: SectionImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const blockReason = imageAddBlockReason(sections, section.id);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 同じファイルを選び直したときにも変更として扱えるよう、値を空へ戻す。
    event.target.value = "";
    if (!file) return;

    setErrorMessage(null);
    setProcessing(true);
    // 縮小と再圧縮の間に、リセットや読み込みで作業が切り替わることがある。
    // 切り替わっていたら、同じidを持つ新しい作品のセクションへ画像を入れないよう、反映しない(#115)。
    const isCurrent = captureSiteGeneration();
    // 削除したセクションのidは、次の追加で使い回される。処理中に削除があったら、同じidでも
    // 選んだときのセクションとは限らないため反映しない。
    const removalsAtStart = useBuilderStore.getState().sectionRemovals;
    try {
      const takenFileNamesIn = (current: readonly SiteSection[]) =>
        current.flatMap((other) => (other.id !== section.id && other.image ? [other.image.fileName] : []));
      const image = await prepareSectionImage(file, section.id, takenFileNamesIn(sections));
      if (!isCurrent()) return;
      if (useBuilderStore.getState().sectionRemovals !== removalsAtStart) {
        setErrorMessage("画像の処理中にセクションが削除されたため、反映しませんでした。もう一度選んでください。");
        return;
      }
      // 処理の間に別のセクションへ画像が入ることもあるため、判定は反映の直前の状態で行う。
      // 1枚ずつが上限内でも、合計では超えることがある。
      const latestSections = useBuilderStore.getState().site.sections;
      const blockReason =
        imageAddBlockReason(latestSections, section.id) ??
        imageTotalBlockReason(latestSections, section.id, image) ??
        (takenFileNamesIn(latestSections).includes(image.fileName)
          ? "処理の間に同じ名前の画像が追加されました。もう一度選んでください。"
          : null);
      if (blockReason) {
        setErrorMessage(blockReason);
        return;
      }
      onSelect(image);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "画像を読み込めませんでした。");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div data-testid="section-image-field">
      <span className="block text-xs font-bold">画像</span>

      {section.image ? (
        <img
          data-testid="section-image-preview"
          src={section.image.dataUri}
          alt=""
          className="mt-1 aspect-video w-full rounded-xl border border-slate-200 object-cover"
        />
      ) : (
        <p className="mt-1 rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-xs leading-4 text-slate-500">
          画像は未設定です。選ぶまでは仮の枠が表示されます。
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {/* ファイル選択はinputでしか開けないため、隣のボタンから開く。inputは見た目だけでなく
            Tab順からも外し、ボタンと二重にフォーカスが当たらないようにする。
            それでも読み上げの一覧には出るため、名前は付けておく。 */}
        <input
          ref={inputRef}
          type="file"
          accept={acceptedImageTypes.join(",")}
          aria-label="画像ファイル"
          tabIndex={-1}
          className="sr-only"
          disabled={processing || blockReason !== null}
          onChange={handleChange}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={blockReason !== null}
          loading={processing}
          icon={<ImagePlus className="size-4" />}
          title={blockReason ?? undefined}
          onClick={() => inputRef.current?.click()}
        >
          {processing ? "処理中" : section.image ? "画像を変える" : "画像を選ぶ"}
        </Button>
        {section.image && (
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={processing}
            icon={<Trash2 className="size-4" />}
            onClick={() => {
              setErrorMessage(null);
              onRemove();
            }}
          >
            画像を削除
          </Button>
        )}
      </div>

      {blockReason && <p className="mt-2 text-[11px] leading-4 text-warning">{blockReason}</p>}
      {errorMessage && (
        <p role="alert" className="mt-2 text-[11px] leading-4 text-danger">
          {errorMessage}
        </p>
      )}
      {!blockReason && !errorMessage && (
        <p className="mt-2 text-[11px] leading-4 text-slate-500">
          選んだ画像は自動で縮小します。写真を入れたら、下の説明（alt）も書き直してください。
        </p>
      )}
    </div>
  );
}
