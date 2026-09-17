import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SectionImage, SiteSection } from "@/features/site-model/schema";
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
  const inputId = useId();
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
    try {
      const takenFileNames = sections.flatMap((other) =>
        other.id !== section.id && other.image ? [other.image.fileName] : [],
      );
      const image = await prepareSectionImage(file, section.id, takenFileNames);
      // 1枚ずつが上限内でも、合計では超えることがある。入れる直前にもう一度確かめる。
      const totalBlockReason = imageTotalBlockReason(sections, section.id, image);
      if (totalBlockReason) {
        setErrorMessage(totalBlockReason);
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
        {/* ファイル選択はinputでしか開けないため、見た目はボタンに寄せてlabelで結ぶ。 */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={acceptedImageTypes.join(",")}
          className="sr-only"
          disabled={processing || blockReason !== null}
          onChange={handleChange}
        />
        <Button
          type="button"
          variant="secondary"
          className="min-h-9 px-2 text-xs"
          disabled={processing || blockReason !== null}
          title={blockReason ?? undefined}
          onClick={() => inputRef.current?.click()}
        >
          {processing ? (
            <>
              <LoaderCircle className="mr-1 size-4 animate-spin" />
              処理中
            </>
          ) : (
            <>
              <ImagePlus className="mr-1 size-4" />
              {section.image ? "画像を変える" : "画像を選ぶ"}
            </>
          )}
        </Button>
        {section.image && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-2 text-xs text-red-700 hover:bg-red-50"
            disabled={processing}
            onClick={() => {
              setErrorMessage(null);
              onRemove();
            }}
          >
            <Trash2 className="mr-1 size-4" />
            画像を削除
          </Button>
        )}
      </div>

      {blockReason && <p className="mt-2 text-[11px] leading-4 text-amber-700">{blockReason}</p>}
      {errorMessage && (
        <p role="alert" className="mt-2 text-[11px] leading-4 text-red-700">
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
