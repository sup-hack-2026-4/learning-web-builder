import { z } from "zod";

// OpenAPIのmaxLength(JSON Schema)はUnicodeコードポイント数を数える仕様のため、
// JavaScriptのstring.length(UTF-16コード単位)ではなく[...value].lengthで揃える。
function codePointLength(value: string): number {
  return [...value].length;
}

function maxCodePoints(max: number) {
  return (value: string) => codePointLength(value) <= max;
}

const maxCodePointsMessage = (max: number) => `${max}文字以内で入力してください`;

// 画像の上限。サーバー側(backend/internal/site/validate.go)と同じ値を持つ。
// 保存APIのボディ上限は1MiBで、本文や学習メモも同じリクエストに乗るため、
// 画像だけで使い切らないよう合計でも縛る。
export const MAX_IMAGE_COUNT = 4;
export const MAX_IMAGE_BASE64_BYTES = 200 * 1024;
export const MAX_TOTAL_IMAGE_BASE64_BYTES = 600 * 1024;

const imageDataUriPattern = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const imageFileNamePattern = /^[a-z0-9-]{1,40}\.jpg$/;

// データURIのうち、実際に容量を食うbase64部分の長さ。
// 上限の判定はサーバーと揃えるため、この長さで行う。
export function imageBase64Length(dataUri: string): number {
  const separatorIndex = dataUri.indexOf(",");
  return separatorIndex === -1 ? dataUri.length : dataUri.length - separatorIndex - 1;
}

export const sectionImageSchema = z.object({
  dataUri: z
    .string()
    .regex(imageDataUriPattern, "JPEG画像のデータURIを指定してください")
    .refine(
      (value) => imageBase64Length(value) <= MAX_IMAGE_BASE64_BYTES,
      `画像1枚は${Math.floor(MAX_IMAGE_BASE64_BYTES / 1024)}KBまでです`,
    ),
  // 提出物ZIPの中でのファイル名。HTMLはこの名前を相対パスで参照する。
  fileName: z.string().regex(imageFileNamePattern, "画像のファイル名が不正です"),
});

export const sectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["hero", "about", "features", "gallery", "contact"]),
  title: z
    .string()
    .min(1)
    .refine(maxCodePoints(80), maxCodePointsMessage(80)),
  body: z.string().refine(maxCodePoints(800), maxCodePointsMessage(800)),
  imageAlt: z.string().refine(maxCodePoints(160), maxCodePointsMessage(160)),
  // 利用者が選んだ画像。任意項目で、未指定なら従来どおりプレースホルダーを表示する。
  // 保存済みの古いプロジェクトはこの項目を持たないため、必須にすると復元できなくなる。
  image: sectionImageSchema.optional(),
  visible: z.boolean(),
});

export const siteModelSchema = z.object({
  id: z.string().min(1),
  topic: z
    .string()
    .min(1)
    .refine(maxCodePoints(100), maxCodePointsMessage(100)),
  siteTitle: z
    .string()
    .min(1)
    .refine(maxCodePoints(80), maxCodePointsMessage(80)),
  tagline: z.string().refine(maxCodePoints(160), maxCodePointsMessage(160)),
  theme: z.object({
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    // 見出し(h2)の色。未指定ならメインカラーを使う。
    // バックエンド/Geminiは現状この項目を返さないため、契約を壊さないよう任意にしている。
    heading: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    fontFamily: z.enum(["sans", "serif", "rounded"]),
    spacing: z.number().int().min(2).max(10),
  }),
  sections: z
    .array(sectionSchema)
    .min(2)
    .max(8)
    // 枚数と合計容量はセクション単体では判定できないため、配列全体で確かめる。
    .superRefine((sections, context) => {
      const images = sections.flatMap((section) => (section.image ? [section.image] : []));
      if (images.length > MAX_IMAGE_COUNT) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `画像は全体で${MAX_IMAGE_COUNT}枚までです`,
        });
      }

      const totalBytes = images.reduce((total, image) => total + imageBase64Length(image.dataUri), 0);
      if (totalBytes > MAX_TOTAL_IMAGE_BASE64_BYTES) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `画像の合計は${Math.floor(MAX_TOTAL_IMAGE_BASE64_BYTES / 1024)}KBまでです`,
        });
      }

      const fileNames = new Set<string>();
      for (const image of images) {
        if (fileNames.has(image.fileName)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "画像のファイル名が重複しています",
          });
        }
        fileNames.add(image.fileName);
      }
    }),
});

export type SiteModel = z.infer<typeof siteModelSchema>;
export type SiteSection = z.infer<typeof sectionSchema>;
export type SectionImage = z.infer<typeof sectionImageSchema>;

export type LearningNote = {
  id: string;
  target: string;
  reason: string;
  createdAt: string;
  /**
   * 記録した時点で実際に変わったコードの行。
   * 「理由を書けた＝理解できている」とは限らないため、書いた理由と実際の変更を対で残し、
   * あとから見返して突き合わせられるようにする。以前の保存データには無いため任意。
   */
  codeChanges?: string[];
};

export type QualityCheck = {
  id: "headings" | "alt" | "mobile" | "axe";
  label: string;
  passed: boolean;
  detail: string;
};

export type AiUsage = {
  provider: "gemini" | "static-sample";
  purpose: string;
  generatedAt: string;
};

