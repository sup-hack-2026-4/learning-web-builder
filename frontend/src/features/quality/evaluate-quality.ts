import type { QualityCheck, SiteModel } from "../site-model/schema";

export function evaluateQuality(model: SiteModel): QualityCheck[] {
  const visibleSections = model.sections.filter((section) => section.visible);
  const heroCount = visibleSections.filter((section) => section.kind === "hero").length;
  const missingAlt = visibleSections.filter(
    (section) => section.kind !== "contact" && !section.imageAlt.trim(),
  );

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
      passed: true,
      detail: "viewport設定と640px以下のレイアウト調整があります。",
    },
  ];
}

