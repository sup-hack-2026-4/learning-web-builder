import type { SiteSection } from "./schema";

/**
 * セクションの構成（追加・削除）を扱う。
 *
 * 生成結果の顔ぶれをそのまま受け取るのではなく、「何を足すか・何を削るか」を
 * 自分で決められるようにするための土台。判断そのものが学習の対象なので、
 * 採番や上限の扱いは画面から切り離し、ここだけを見ればルールが分かる形にしている。
 */

// schema.ts の sections は 2〜8 件。器はあるので、その範囲をそのまま構成の上限・下限に使う。
// サーバー側の site.Validate も同じ範囲で弾くため、片方だけ緩めると保存できない状態を作れてしまう。
export const minSections = 2;
export const maxSections = 8;

export type SectionKind = SiteSection["kind"];

export const sectionKinds: SectionKind[] = ["hero", "about", "features", "gallery", "contact"];

/** 画面と学習メモに出る、種類の日本語ラベル。 */
export const sectionKindLabels: Record<SectionKind, string> = {
  hero: "ヒーロー（ページの主題）",
  about: "私たちについて",
  features: "特徴・魅力",
  gallery: "写真・作品",
  contact: "基本情報",
};

// 追加した直後の中身。空欄のまま置くと何を書く場所か分からないため、
// 「ここに何を書くか」を示す仮テキストを入れる。ただし事実は書かない。
// altは空のままにする。代替テキストを書くこと自体が品質チェックの対象で、
// もっともらしい説明を先に埋めてしまうと、その学習の機会が消えるため。
const sectionPresets: Record<SectionKind, Pick<SiteSection, "title" | "body" | "imageAlt">> = {
  hero: {
    title: "ページの主題",
    body: "このページで一番伝えたいことを1〜2文で書きます。読み手が最初に目にする場所です。",
    imageAlt: "",
  },
  about: {
    title: "私たちについて",
    body: "誰に何を伝えるのかを説明します。自分で調べた活動内容や背景に書き換えてください。",
    imageAlt: "",
  },
  features: {
    title: "特徴・魅力",
    body: "伝えたい魅力を短い言葉で整理します。数を絞るほど、読み手に伝わりやすくなります。",
    imageAlt: "",
  },
  gallery: {
    title: "写真・作品",
    body: "見せたいものを並べて紹介する場所です。何をどの順で見せるかを自分で決めてください。",
    imageAlt: "",
  },
  contact: {
    title: "基本情報",
    body: "所在地や営業時間など、確認済みの情報を入力してください。フォーム機能はMVP対象外です。",
    imageAlt: "",
  },
};

/**
 * 重複しないセクションidを決める。
 *
 * idは出力HTMLの data-builder-id にそのまま出るため、UUIDではなく読める文字列にする。
 * サーバー側の site.Validate がid重複を弾くので、ここで確実に避けておく。
 */
export function nextSectionId(kind: SectionKind, existingIds: readonly string[]): string {
  const taken = new Set(existingIds);
  if (!taken.has(kind)) return kind;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${kind}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** 追加する1件を組み立てる。表示状態で入れる（追加したのに見えないのは分かりにくいため）。 */
export function createSection(kind: SectionKind, existingIds: readonly string[]): SiteSection {
  return {
    id: nextSectionId(kind, existingIds),
    kind,
    ...sectionPresets[kind],
    visible: true,
  };
}

/**
 * 追加できない理由。できるときは null。
 * ボタンを押せなくするだけだと理由が分からないため、文言として返す。
 */
export function addSectionBlockReason(sectionCount: number): string | null {
  if (sectionCount >= maxSections) {
    return `セクションは${maxSections}件までです。増やすには、どれかを削除してください。`;
  }
  return null;
}

/** 削除できない理由。できるときは null。 */
export function removeSectionBlockReason(sectionCount: number): string | null {
  if (sectionCount <= minSections) {
    return `セクションは${minSections}件以上必要です。削除するには、先に追加してください。`;
  }
  return null;
}
