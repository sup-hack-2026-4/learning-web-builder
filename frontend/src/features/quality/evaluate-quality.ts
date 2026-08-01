import { buildSiteArtifacts } from "../artifacts/build-site-artifacts";
import type { QualityCheck, SiteModel } from "../site-model/schema";

const VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
const MOBILE_BREAKPOINT_QUERY = "@media (max-width: 640px)";

// 375px幅のモバイル画面を実際にレンダリングして計測する代わりに、
// 「改行できない文字が長く連続していないか」で横溢れの可能性を判定する簡易ヒューリスティック。
// 日本語(ひらがな・カタカナ・漢字・全角記号)は文字単位で改行できるため対象外とし、
// 半角英数字や記号が連続するケース(長いURLなど)だけを検出する。
const MAX_NON_WRAPPING_RUN_LENGTH = 40;
const NON_WRAPPING_RUN = new RegExp(`[^\\s\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef]{${MAX_NON_WRAPPING_RUN_LENGTH + 1},}`, "gu");

function findOverflowingText(model: SiteModel): string[] {
  const texts = [
    model.siteTitle,
    model.tagline,
    ...model.sections.filter((section) => section.visible).flatMap((section) => [section.title, section.body]),
  ];

  const offenders = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(NON_WRAPPING_RUN)) {
      offenders.add(`${match[0].slice(0, 20)}…`);
    }
  }
  return [...offenders];
}

export function evaluateQuality(model: SiteModel): QualityCheck[] {
  const visibleSections = model.sections.filter((section) => section.visible);
  const heroCount = visibleSections.filter((section) => section.kind === "hero").length;
  const missingAlt = visibleSections.filter(
    (section) => section.kind !== "contact" && !section.imageAlt.trim(),
  );

  const artifacts = buildSiteArtifacts(model);
  const hasViewportMeta = artifacts.html.includes(VIEWPORT_META);
  const hasMobileBreakpoint = artifacts.css.includes(MOBILE_BREAKPOINT_QUERY);
  const overflowingText = findOverflowingText(model);
  const mobilePassed = hasViewportMeta && hasMobileBreakpoint && overflowingText.length === 0;

  const mobileDetail = (() => {
    if (!hasViewportMeta) return "viewportの指定が見つかりません。";
    if (!hasMobileBreakpoint) return "640px以下の画面向けのレイアウト調整が見つかりません。";
    if (overflowingText.length > 0) {
      return `空白を含まない長い文字列(例:「${overflowingText[0]}」)が、モバイル幅で横に溢れる可能性があります。`;
    }
    return "viewport設定と640px以下のレイアウト調整があり、横に溢れる長い文字列もありません。";
  })();

  return [
    {
      id: "headings",
      label: "見出し構造",
      passed: heroCount === 1 && visibleSections.length >= 2,
      detail:
        heroCount === 1 && visibleSections.length >= 2
          ? "h1が1つ、その後にh2が続く構造です。"
          : "ヒーローを1つ表示し、合計2つ以上のセクションを用意してください。",
    },
    {
      id: "alt",
      label: "画像のalt",
      passed: missingAlt.length === 0,
      detail:
        missingAlt.length === 0
          ? "表示中の画像に代替テキストがあります。"
          : `${missingAlt.map((section) => section.title).join("、")}の画像説明が空です。`,
    },
    {
      id: "mobile",
      label: "モバイル表示",
      passed: mobilePassed,
      detail: mobileDetail,
    },
  ];
}
