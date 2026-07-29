export type Explanation = {
  title: string;
  html: string;
  css: string;
  why: string;
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
    html: "ページ全体の主題なのでh1を1つだけ使います。画像プレースホルダーも表示されます。",
    css: ".section-heroだけ背景にグラデーションと文字色の反転を指定し、他のセクションと視覚的に分けています。",
    why: "検索エンジンや支援技術にも、ページの中心テーマを正しく伝えるためです。h1は1ページに1つだけ使うのが構造上のルールです。",
  },
  about: {
    title: "about（私たちについてセクション）",
    html: "h2の見出しと本文、画像の代わりのプレースホルダーを.sectionでまとめています。",
    css: "about専用のCSSは無く、他の内容セクションと同じ.sectionの余白ルール(padding)と.section-innerの横幅制限(最大980px)に従っています。",
    why: "「誰に」「何を」伝えるサイトなのかを最初の内容セクションとして端的に説明する役割なので、装飾より文章の分かりやすさを優先しています。",
  },
  features: {
    title: "features（3つの魅力セクション）",
    html: "aboutと同じsection構造ですが、複数の魅力を短い文章で伝える内容が入ります。",
    css: ".section-featuresだけ背景色を白(#fff)に指定しており、前後のセクションと視覚的に区切られます。",
    why: "読み手が内容を素早く比較・理解できるよう、他のセクションと背景色を変えて目立たせているためです。",
  },
  contact: {
    title: "contact（基本情報セクション）",
    html: "他のセクションと異なり、画像プレースホルダーを出力していません(section.kindがcontactの場合だけ画像用のdivを空文字にしています)。",
    css: "about/featuresと同じ.sectionの余白ルールを使っており、contact専用のCSSはありません。",
    why: "所在地や営業時間などの事実情報を扱うセクションなので、装飾的な画像より情報の正確さを優先しています。フォーム機能自体はMVPの対象外です。",
  },
  "site-footer": {
    title: "footer（補足情報）",
    html: "ページ末尾の補足をfooterに置いています。",
    css: "本文より控えめな色と文字サイズにしています。",
    why: "主要内容と補足情報の優先順位を視覚的にも示すためです。",
  },
};
