export type Explanation = {
  title: string;
  html: string;
  css: string;
  why: string;
};

const sectionExplanation: Explanation = {
  title: "section（内容のまとまり）",
  html: "関連する見出しと文章をsectionでまとめています。",
  css: "余白は.section、横幅は.section-innerで役割を分けています。",
  why: "構造と見た目を分けると、内容を増やしても同じ規則で整えられます。",
};

export const explanationDictionary: Record<string, Explanation> = {
  "site-header": {
    title: "header（サイト上部）",
    html: "サイト名と短い説明をheaderにまとめています。",
    css: "flexで左右に並べ、狭い画面では縦並びへ変更します。",
    why: "最初にサイトの目的を伝え、どの画面幅でも読みやすくするためです。",
  },
  hero: {
    title: "h1（ページの主題）",
    html: "ページ全体の主題なのでh1を1つだけ使います。",
    css: "clampで画面幅に合わせて文字サイズを変えています。",
    why: "検索エンジンや支援技術にも、ページの中心テーマを正しく伝えるためです。",
  },
  about: sectionExplanation,
  features: sectionExplanation,
  contact: sectionExplanation,
  "site-footer": {
    title: "footer（補足情報）",
    html: "ページ末尾の補足をfooterに置いています。",
    css: "本文より控えめな色と文字サイズにしています。",
    why: "主要内容と補足情報の優先順位を視覚的にも示すためです。",
  },
};

