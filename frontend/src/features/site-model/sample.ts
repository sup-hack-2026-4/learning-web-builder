import { MAX_SECTION_TITLE_LENGTH, MAX_TOPIC_LENGTH, type SiteModel } from "./schema";

// 文字数の上限はコードポイントで数えるため、切るときもコードポイント単位で切る。
// UTF-16の単位で切ると、絵文字などを途中で割ってしまう。
function truncateCodePoints(value: string, max: number): string {
  return [...value].slice(0, max).join("");
}

// 生成を使えないときの見本。題材が長くても、スキーマの上限を守る(#117)。
// サーバー側の見本(backend/internal/site/sample.go)と同じく、サイト名と最初の見出しは見出しの上限で切る。
export function createSampleSite(topic = "地域の小さな植物園"): SiteModel {
  const cleanTopic = truncateCodePoints(topic.trim(), MAX_TOPIC_LENGTH) || "地域の小さな植物園";
  const title = truncateCodePoints(cleanTopic, MAX_SECTION_TITLE_LENGTH);

  return {
    id: crypto.randomUUID(),
    topic: cleanTopic,
    siteTitle: title,
    tagline: `${cleanTopic}の魅力を、初めての方にも分かりやすく紹介します。`,
    theme: {
      primary: "#2563eb",
      background: "#f8fafc",
      text: "#172033",
      fontFamily: "sans",
      spacing: 6,
    },
    sections: [
      {
        id: "hero",
        kind: "hero",
        title,
        body: "ここはAIが生成した仮の紹介文です。公開前に、根拠のある事実情報へ自分で書き換えてください。",
        imageAlt: "",
        visible: true,
      },
      {
        id: "about",
        kind: "about",
        title: "私たちについて",
        body: "誰に何を伝えるサイトなのかを説明するセクションです。具体的な活動内容や背景を追記しましょう。",
        imageAlt: "活動内容を紹介するイメージ",
        visible: true,
      },
      {
        id: "features",
        kind: "features",
        title: "3つの魅力",
        body: "魅力を短い言葉で整理すると、読み手が内容を素早く理解できます。自分で調べた情報に置き換えましょう。",
        imageAlt: "3つの魅力を表すイメージ",
        visible: true,
      },
      {
        id: "contact",
        kind: "contact",
        title: "基本情報",
        body: "所在地や営業時間など、確認済みの情報をここへ入力してください。フォーム機能はMVP対象外です。",
        imageAlt: "",
        visible: true,
      },
    ],
  };
}

