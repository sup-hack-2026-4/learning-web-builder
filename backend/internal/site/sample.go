package site

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

func Sample(topic string) Model {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		topic = "地域の小さな植物園"
	}

	return Model{
		ID:        uuid.NewString(),
		Topic:     topic,
		SiteTitle: topic,
		Tagline:   fmt.Sprintf("%sの魅力を、初めての方にも分かりやすく紹介します。", topic),
		Theme: Theme{
			Primary: "#2563eb", Background: "#f8fafc", Text: "#172033", FontFamily: "sans", Spacing: 6,
		},
		Sections: []Section{
			{ID: "hero", Kind: "hero", Title: topic, Body: "ここはAIが生成した仮の紹介文です。公開前に、根拠のある事実情報へ自分で書き換えてください。", ImageAlt: "", Visible: true},
			{ID: "about", Kind: "about", Title: "私たちについて", Body: "誰に何を伝えるサイトなのかを説明するセクションです。具体的な活動内容や背景を追記しましょう。", ImageAlt: "活動内容を紹介するイメージ", Visible: true},
			{ID: "features", Kind: "features", Title: "3つの魅力", Body: "魅力を短い言葉で整理すると、読み手が内容を素早く理解できます。自分で調べた情報に置き換えましょう。", ImageAlt: "3つの魅力を表すイメージ", Visible: true},
			{ID: "contact", Kind: "contact", Title: "基本情報", Body: "所在地や営業時間など、確認済みの情報をここへ入力してください。フォーム機能はMVP対象外です。", ImageAlt: "", Visible: true},
		},
	}
}
