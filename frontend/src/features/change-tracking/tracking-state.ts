import { z } from "zod";
import { siteModelSchema, type SiteModel, type SiteSection } from "@/features/site-model/schema";
import type { ThemeKey } from "./theme-change";

// まだ説明を書いていない構成の変更1件。
// 「セクション追加（〜）」のように同じ文言が並ぶことがあるため、
// 打ち消し（追加してすぐ削除）を扱えるようidを持たせる。
export type StructureChange = { id: string; label: string };

// 「まだ理由を書いていない変更」を示すための基準値と、未記録の変更。
// 再読み込みで消えると、理由を書く前に変更の記録が失われるため、サイトと一緒に保存する(#116)。
// サイトと別に保存すると片方だけ古いまま残りうるため、同じ保存先へまとめて書く。
export type TrackingState = {
  // 書いている途中の理由。
  reason: string;
  // 記録ボタンを押すまでに変更したテーマ項目。
  touchedThemeKeys: ThemeKey[];
  // デザインと内容は別々に記録するため、基準も分けて持つ。
  themeBaseline: SiteModel["theme"];
  // 内容の基準はセクションごとに持つ。ひとまとめにすると、あるセクションを
  // 未記録のまま別のセクションを記録したときに、変更コードが別の理由へ混ざってしまう。
  sectionBaselines: Record<string, SiteSection>;
  // 構成（どのセクションが何番目にあるか）の基準。内容の基準とは別に持つ。
  // 内容の基準はid単位なので、セクションが増えた・減ったこと自体は表せない。
  structureBaseline: SiteSection[];
  // まだ説明を書いていない構成の変更。押した順に並べ、まとめて1件として記録する。
  pendingStructure: StructureChange[];
};

// サイトをそのまま基準にした、未記録の変更が無い状態。
export function trackingFromSite(site: SiteModel): TrackingState {
  return {
    reason: "",
    touchedThemeKeys: [],
    themeBaseline: site.theme,
    sectionBaselines: Object.fromEntries(site.sections.map((section) => [section.id, section])),
    structureBaseline: site.sections,
    pendingStructure: [],
  };
}

// 基準は編集途中のサイトの写しなので、文字数などの保存時の制約は満たさないことがある。
// ここでは描画で例外にならない形かどうかだけを確かめる。
const baselineSectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["hero", "about", "features", "gallery", "contact"]),
  title: z.string(),
  body: z.string(),
  imageAlt: z.string(),
  image: z.object({ dataUri: z.string(), fileName: z.string() }).optional(),
  visible: z.boolean(),
});

const themeKeys = ["primary", "background", "text", "heading", "fontFamily", "spacing"] as const satisfies readonly ThemeKey[];

const trackingStateSchema = z.object({
  reason: z.string(),
  touchedThemeKeys: z.array(z.enum(themeKeys)),
  themeBaseline: siteModelSchema.shape.theme,
  sectionBaselines: z.record(z.string(), baselineSectionSchema),
  structureBaseline: z.array(baselineSectionSchema),
  pendingStructure: z.array(z.object({ id: z.string().min(1), label: z.string() })),
});

// 保存されていた記録を読み戻す。古い形式や壊れた値のまま使うと描画中に例外になるため、
// 形が合わなければ、いまのサイトを基準にした状態から始め直す。
// 項目ごとに直さないのは、基準と未記録の変更が互いに依存していて、一部だけ戻すと食い違うため。
export function restoreTracking(value: unknown, site: SiteModel): TrackingState {
  const parsed = trackingStateSchema.safeParse(value);
  return parsed.success ? parsed.data : trackingFromSite(site);
}
