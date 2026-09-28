import type { SiteModel } from "@/features/site-model/schema";

export type ThemeKey = "primary" | "background" | "text" | "heading" | "fontFamily" | "spacing";

// 学習メモ・ZIP出力に載る、テーマ項目の日本語ラベル。
const themeKeyLabels: Record<ThemeKey, string> = {
  primary: "メインカラー",
  background: "背景色",
  text: "テキストカラー",
  heading: "見出しの色",
  fontFamily: "フォント",
  spacing: "余白",
};

// フォントの内部値を、画面のセレクトと同じ日本語表記へ変換する。
const fontLabels: Record<string, string> = {
  sans: "ゴシック",
  serif: "明朝",
  rounded: "丸ゴシック",
};

// テーマ項目の現在値を「メインカラーを #e11d48 に」のような読める文へ整形する。
export function describeThemeChange(key: ThemeKey, theme: SiteModel["theme"]): string {
  const label = themeKeyLabels[key];
  if (key === "fontFamily") return `${label}を ${fontLabels[theme.fontFamily] ?? theme.fontFamily} に`;
  if (key === "spacing") return `${label}を ${theme.spacing} に`;
  // 見出しの色は未指定ならメインカラーを引き継ぐため、その場合は実際に適用される色を書く。
  if (key === "heading") return `${label}を ${theme.heading ?? theme.primary} に`;
  return `${label}を ${theme[key]} に`;
}

// 実際にCSSへ出る値。見出しの色は未指定ならメインカラーを引き継ぐため、
// 単純に theme.heading と比べると「未指定」と「メインカラーと同じ色」を
// 別物と見なしてしまい、元の色へ戻したのに変更が残ってしまう。
export function effectiveThemeValue(theme: SiteModel["theme"], key: ThemeKey): string | number {
  if (key === "heading") return theme.heading ?? theme.primary;
  return theme[key];
}
