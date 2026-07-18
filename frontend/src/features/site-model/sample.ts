import type { SiteModel } from "./schema";

export function createSampleSite(topic = "地域の小さな植物園"): SiteModel {
  const cleanTopic = topic.trim() || "地域の小さな植物園";

  return {
    id: crypto.randomUUID(),
    topic: cleanTopic,
    siteTitle: cleanTopic,
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
        title: cleanTopic,
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

