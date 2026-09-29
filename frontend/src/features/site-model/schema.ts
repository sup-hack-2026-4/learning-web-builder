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

// 学習記録の上限。サーバー側(backend/internal/project/learning.go)と同じ値を持つ。
//
// 対象と変更行は、画面の入力をそのまま運ぶのではなく画面側で組み立てた文字列になる。
// 対象は構成変更のラベル(セクション名を含む)をつないだもの、変更行は生成HTMLの1行で、
// 本文(800文字)の & や " はエスケープされて数倍に伸びる。
// 通常の操作で作られた記録を保存できなくならないよう、1件ごとの上限は広めに取り、
// 実際の歯止めは記録全体の大きさ(MAX_LEARNING_RECORD_BYTES)に任せる。
export const MAX_LEARNING_NOTES = 200;
export const MAX_LEARNING_TARGET_LENGTH = 2000;
export const MAX_LEARNING_REASON_LENGTH = 10000;
export const MAX_LEARNING_CODE_CHANGES = 200;
export const MAX_LEARNING_CODE_LINE_LENGTH = 10000;
export const MAX_AI_USAGE_ENTRIES = 50;
export const MAX_AI_USAGE_PURPOSE_LENGTH = 200;
// notes と aiUsage をJSONにしたときの合計バイト数の上限。保存APIのボディ上限は1MiBで、
// 画像(合計600KiB)と作品本文も同じリクエストに乗るため、合計でも縛る。
// サーバーは受け取ったJSONそのもので数えるので、送るのと同じJSON.stringifyの結果で数える。
export const MAX_LEARNING_RECORD_BYTES = 300 * 1024;
// 理由の入力欄の上限。保存の上限(MAX_LEARNING_REASON_LENGTH)より小さくし、
// 入力した理由がそのまま保存できない、ということが起きないようにする。
export const MAX_REASON_INPUT_LENGTH = 2000;

const requiredText = (max: number) =>
  z.string().refine((value) => value.trim() !== "" && codePointLength(value) <= max, `1〜${max}文字で入力してください`);

// サーバー(backend/internal/project/learning.go)と同じ形の正規表現。
// 秒は必須、小数秒は任意、オフセットはZか±hh:mm。toISOString()の出力はこの形になる。
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

// 暦の上で実在するかも確かめる。Date.parseは2月30日を3月2日へ繰り上げて受け付け、
// Date.UTCは0〜99年を1900年代として扱うため、どちらも使わずに月の日数を数える。
export function isValidTimestamp(value: string): boolean {
  const match = timestampPattern.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

const timestampSchema = z.string().refine(isValidTimestamp, "日時の形式が正しくありません");

export const learningNoteSchema = z.object({
  id: requiredText(100),
  target: requiredText(MAX_LEARNING_TARGET_LENGTH),
  reason: requiredText(MAX_LEARNING_REASON_LENGTH),
  createdAt: timestampSchema,
  /**
   * 記録した時点で実際に変わったコードの行。
   * 「理由を書けた＝理解できている」とは限らないため、書いた理由と実際の変更を対で残し、
   * あとから見返して突き合わせられるようにする。以前の保存データには無いため任意。
   */
  codeChanges: z
    .array(z.string().refine(maxCodePoints(MAX_LEARNING_CODE_LINE_LENGTH), maxCodePointsMessage(MAX_LEARNING_CODE_LINE_LENGTH)))
    .max(MAX_LEARNING_CODE_CHANGES)
    .optional(),
});

export const aiUsageSchema = z.object({
  provider: z.enum(["gemini", "static-sample"]),
  purpose: requiredText(MAX_AI_USAGE_PURPOSE_LENGTH),
  generatedAt: timestampSchema,
});

export type LearningNote = z.infer<typeof learningNoteSchema>;
export type AiUsage = z.infer<typeof aiUsageSchema>;

export type LearningRecord = {
  notes: LearningNote[];
  aiUsage: AiUsage[];
};

// 保存リクエストに乗る notes と aiUsage の値のバイト数。サーバーはこの部分を受け取ったまま数える。
// 記録全体をまとめてJSONにした大きさとは、キー名や区切りの分だけ違う。
export function learningRecordBytes(record: LearningRecord): number {
  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(record.notes)).length + encoder.encode(JSON.stringify(record.aiUsage)).length;
}

// 保存前に確かめる。サーバーで弾かれてから汎用のエラーを見せるより、
// 何が多すぎるのかをその場で伝えるため。問題が無ければnullを返す。
export function learningRecordProblem(record: LearningRecord): string | null {
  if (record.notes.length > MAX_LEARNING_NOTES) {
    return `学習メモが${MAX_LEARNING_NOTES}件を超えているため保存できません。`;
  }
  if (record.aiUsage.length > MAX_AI_USAGE_ENTRIES) {
    return `AI利用記録が${MAX_AI_USAGE_ENTRIES}件を超えているため保存できません。`;
  }
  const invalidNote = record.notes.findIndex((note) => !learningNoteSchema.safeParse(note).success);
  if (invalidNote >= 0) {
    return `学習メモの${invalidNote + 1}件目に保存できない内容があります。`;
  }
  if (record.aiUsage.some((usage) => !aiUsageSchema.safeParse(usage).success)) {
    return "AI利用記録に保存できない内容があります。";
  }
  if (learningRecordBytes(record) > MAX_LEARNING_RECORD_BYTES) {
    return "学習メモが大きすぎて保存できません。提出物ZIPで書き出して手元に残してください。";
  }
  return null;
}

export type QualityCheck = {
  id: "headings" | "alt" | "mobile" | "axe";
  label: string;
  passed: boolean;
  detail: string;
};

