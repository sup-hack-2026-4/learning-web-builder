package site

type Model struct {
	ID        string    `json:"id"`
	Topic     string    `json:"topic"`
	SiteTitle string    `json:"siteTitle"`
	Tagline   string    `json:"tagline"`
	Theme     Theme     `json:"theme"`
	Sections  []Section `json:"sections"`
}

type Theme struct {
	Primary    string `json:"primary"`
	Background string `json:"background"`
	Text       string `json:"text"`
	// 見出し(h2)の色。任意項目で、未指定ならフロントエンドがPrimaryを使う。
	// 保存リクエストは未知フィールドを拒否するため、この項目が無いと
	// 見出しの色を変えたプロジェクトを保存できなくなる。
	Heading    string `json:"heading,omitempty"`
	FontFamily string `json:"fontFamily"`
	Spacing    int    `json:"spacing"`
}

type Section struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	ImageAlt string `json:"imageAlt"`
	// 利用者が選んだ画像。任意項目で、未指定なら従来どおりプレースホルダーを表示する。
	// 保存済みの古いプロジェクトはこの項目を持たないため、必須にすると復元できなくなる。
	Image   *SectionImage `json:"image,omitempty"`
	Visible bool          `json:"visible"`
}

// SectionImage はセクションに差し込む画像を表す。
// 画像はブラウザ側でJPEGへ圧縮したうえでデータURIとして持ち回る。
// 外部ストレージを持たない構成のため、保存も提出物への同梱もこの1か所から行える。
type SectionImage struct {
	// data:image/jpeg;base64, で始まるデータURI。プレビューにそのまま渡す。
	DataURI string `json:"dataUri"`
	// 提出物ZIPの中でのファイル名。HTMLはこの名前を相対パスで参照する。
	FileName string `json:"fileName"`
}
