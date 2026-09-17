import {
  imageBase64Length,
  MAX_IMAGE_BASE64_BYTES,
  MAX_IMAGE_COUNT,
  MAX_TOTAL_IMAGE_BASE64_BYTES,
  type SectionImage,
  type SiteSection,
} from "../site-model/schema";

/**
 * 選んだ画像を、保存と提出に耐える形へそろえる。
 *
 * 外部ストレージを持たない構成のため、画像はデータURIとしてSiteModelに載せる。
 * 保存APIのボディ上限は1MiBで、本文や学習メモも同じリクエストに乗るため、
 * 元のファイルをそのまま持つことはできない。ここで縮小と再圧縮を済ませる。
 */

/** 受け付ける形式。いずれもブラウザがcanvasへ描けるものに限る。 */
export const acceptedImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

/** 選べる元ファイルの上限。これを超えるものは縮小する前に断る。 */
export const maxSourceBytes = 20 * 1024 * 1024;

/** 縮小後の長辺の候補。上から順に試し、上限に収まった時点で採用する。 */
const maxEdgeCandidates = [1280, 1024, 800, 640];

/** JPEGの品質の候補。同じ長辺のまま、上から順に落としていく。 */
const qualityCandidates = [0.8, 0.7, 0.6, 0.5, 0.4];

/**
 * 選べない理由。選べるときは null。
 * 拒否するだけだと何を直せばよいか分からないため、文言として返す。
 */
export function imageSourceBlockReason(file: File): string | null {
  if (!acceptedImageTypes.includes(file.type as (typeof acceptedImageTypes)[number])) {
    return "JPEG・PNG・WebPの画像を選んでください。";
  }
  if (file.size > maxSourceBytes) {
    return `画像は${Math.floor(maxSourceBytes / 1024 / 1024)}MBまでのファイルを選んでください。`;
  }
  return null;
}

/**
 * 提出物ZIPの中でのファイル名を決める。
 *
 * セクションidはGeminiの生成結果に由来することもあり、日本語や記号が混ざりうる。
 * ファイル名はZIPの中でそのままパスになるため、安全な文字だけに絞る。
 * サーバー側の検証(site.Validate)も同じ形とファイル名の重複を弾く。
 */
export function sectionImageFileName(sectionId: string, takenFileNames: readonly string[]): string {
  const base = sectionId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  const stem = base === "" ? "image" : base;
  const taken = new Set(takenFileNames);

  if (!taken.has(`${stem}.jpg`)) return `${stem}.jpg`;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}.jpg`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * 画像を縮小・再圧縮してデータURIにする。
 *
 * 透けている部分は白で塗る。JPEGは透過を扱えないため、塗らないと黒く潰れる。
 * 写真の向き(EXIF)はブラウザに解釈させる。指定しないと、縦の写真が横倒しで入る。
 */
export async function prepareSectionImage(
  file: File,
  sectionId: string,
  takenFileNames: readonly string[],
): Promise<SectionImage> {
  const blockReason = imageSourceBlockReason(file);
  if (blockReason) throw new Error(blockReason);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("画像を読み込めませんでした。別のファイルを選んでください。");
  }

  try {
    for (const maxEdge of maxEdgeCandidates) {
      const canvas = drawToCanvas(bitmap, maxEdge);
      for (const quality of qualityCandidates) {
        const dataUri = canvas.toDataURL("image/jpeg", quality);
        if (imageBase64Length(dataUri) <= MAX_IMAGE_BASE64_BYTES) {
          return { dataUri, fileName: sectionImageFileName(sectionId, takenFileNames) };
        }
      }
    }
  } finally {
    bitmap.close();
  }

  throw new Error(
    `この画像は${Math.floor(MAX_IMAGE_BASE64_BYTES / 1024)}KBまで小さくできませんでした。別の画像を選んでください。`,
  );
}

function drawToCanvas(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("画像を処理できませんでした。ページを再読み込みしてください。");
  // JPEGは透過を持てない。塗らずに描くと、透けている部分が黒くなる。
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 表示・非表示によらず、モデルが持っている画像をすべて集める。保存されるのはこの全部のため。 */
export function collectSectionImages(sections: readonly SiteSection[]): SectionImage[] {
  return sections.flatMap((section) => (section.image ? [section.image] : []));
}

/**
 * 画像を選べない理由。選べるときは null。ファイルを開く前に判定できるものだけを見る。
 * 差し替えのときは枚数が増えないため、上限には数えない。
 */
export function imageAddBlockReason(
  sections: readonly SiteSection[],
  sectionId: string,
): string | null {
  const target = sections.find((section) => section.id === sectionId);
  if (!target) return "セクションが見つかりません。";
  if (target.kind === "contact") {
    return "基本情報のセクションには画像を置けません。写真は別のセクションへ追加してください。";
  }
  if (target.image) return null;

  if (collectSectionImages(sections).length >= MAX_IMAGE_COUNT) {
    return `画像は全体で${MAX_IMAGE_COUNT}枚までです。増やすには、どれかを削除してください。`;
  }
  return null;
}

/**
 * 圧縮した画像を入れると合計の上限を超える場合の理由。超えないときは null。
 * 1枚ずつが上限内でも、合計では超えることがあるため、反映の直前にもう一度確かめる。
 */
export function imageTotalBlockReason(
  sections: readonly SiteSection[],
  sectionId: string,
  nextImage: SectionImage,
): string | null {
  const totalBytes = sections.reduce((total, section) => {
    if (!section.image) return total;
    // 差し替えるセクションの分は、入れ替わる新しい画像で数える。
    if (section.id === sectionId) return total;
    return total + imageBase64Length(section.image.dataUri);
  }, imageBase64Length(nextImage.dataUri));

  if (totalBytes > MAX_TOTAL_IMAGE_BASE64_BYTES) {
    return `画像の合計は${Math.floor(MAX_TOTAL_IMAGE_BASE64_BYTES / 1024)}KBまでです。ほかの画像を削除してから追加してください。`;
  }
  return null;
}
