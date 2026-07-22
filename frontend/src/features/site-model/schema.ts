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

export const sectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["hero", "about", "features", "gallery", "contact"]),
  title: z
    .string()
    .min(1)
    .refine(maxCodePoints(80), maxCodePointsMessage(80)),
  body: z.string().refine(maxCodePoints(800), maxCodePointsMessage(800)),
  imageAlt: z.string().refine(maxCodePoints(160), maxCodePointsMessage(160)),
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
    fontFamily: z.enum(["sans", "serif", "rounded"]),
    spacing: z.number().int().min(2).max(10),
  }),
  sections: z.array(sectionSchema).min(2).max(8),
});

export type SiteModel = z.infer<typeof siteModelSchema>;
export type SiteSection = z.infer<typeof sectionSchema>;

export type LearningNote = {
  id: string;
  target: string;
  reason: string;
  createdAt: string;
};

export type QualityCheck = {
  id: "headings" | "alt" | "mobile";
  label: string;
  passed: boolean;
  detail: string;
};

export type AiUsage = {
  provider: "gemini" | "static-sample";
  purpose: string;
  generatedAt: string;
};

