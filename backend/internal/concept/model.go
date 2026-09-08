// Package concept は、サイトを生成する前に「誰に・何を・どんな雰囲気で」を
// 対話で固めるための型と検証を提供する。
//
// ここで扱うのは生成前の下書き(Draft)だけで、site.Model には一切触れない。
// 生成後の編集に対話を持ち込むと、学習メモのリセットやパッチ契約が必要になり、
// 「変更理由は学習者自身が書く」という製品の狙いとも衝突するため、
// 対話の役割を生成前に限定している。
package concept

// Role は会話の話者。Gemini の contents[].role にそのまま渡すため、
// 値は "user" と "model" の2つに固定する。
type Role string

const (
	RoleUser  Role = "user"
	RoleModel Role = "model"
)

// Message は会話1件分。
type Message struct {
	Role Role   `json:"role"`
	Text string `json:"text"`
}

// Draft は対話で固まったコンセプト。
// 学習者がまだ決めていない項目は空のままにし、AIが勝手に埋めない。
type Draft struct {
	Topic       string   `json:"topic"`
	Audience    string   `json:"audience"`
	Goal        string   `json:"goal"`
	Tone        string   `json:"tone,omitempty"`
	MustInclude []string `json:"mustInclude,omitempty"`
}

// Reply は1ターン分の応答。
//
// Choices は「選ぶだけで前に進める」ための選択肢で、自由記述も許す。
// Missing と Ready はサーバー側で Draft から導出する。モデルの自己申告を信じると、
// 空欄が残ったまま Ready を返されてしまうため。
type Reply struct {
	Reply   string   `json:"reply"`
	Choices []string `json:"choices"`
	Draft   Draft    `json:"draft"`
	Missing []string `json:"missing"`
	Ready   bool     `json:"ready"`
}

// 必須項目。この3つが埋まるまで生成へ進ませない。
const (
	FieldAudience = "audience"
	FieldGoal     = "goal"
	FieldTopic    = "topic"
)
