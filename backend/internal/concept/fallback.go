package concept

// Fallback は、Gemini を利用できないときに返す静的な応答を組み立てる。
//
// 生成APIが site.Sample を返すのと同じ考え方で、AIが落ちていても
// 「誰に・何を・どんな雰囲気で」を順に決める対話の型だけは体験できるようにする。
// 題材に合わせた気の利いた質問はできないため、どの題材でも成り立つ聞き方に留める。
//
// 学習者の返事は、まだ空いている必須項目へ順に埋めていく。
// 受け取った下書きをそのまま返すと、答えても同じ質問が返り続けて対話が進まない。
func Fallback(messages []Message, draft Draft) Reply {
	normalized := Normalize(draft)
	if answer := lastUserText(messages); answer != "" {
		normalized = fillFirstEmptyField(normalized, answer)
	}
	missing := MissingFields(normalized)

	reply := Reply{
		Draft:   normalized,
		Missing: missing,
		Ready:   len(missing) == 0,
	}

	// 足りない項目を1つずつ聞く。まとめて聞くと答える側の負担が大きい。
	switch {
	case normalized.Topic == "":
		reply.Reply = "AIとの相談を今は利用できません。まず、どんな題材の紹介サイトを作るか教えてください。"
	case normalized.Audience == "":
		reply.Reply = "AIとの相談を今は利用できません。この題材を、どんな人に一番読んでほしいですか。"
		reply.Choices = []string{"近所の家族連れ", "同じ趣味を持つ大人", "同年代の学生", "はじめて知る人"}
	case normalized.Goal == "":
		reply.Reply = "AIとの相談を今は利用できません。読んだ人に、そのあとどうしてほしいですか。"
		reply.Choices = []string{"実際に足を運んでほしい", "活動の内容を知ってほしい", "興味を持って調べてほしい"}
	default:
		reply.Reply = "AIとの相談を今は利用できません。必要な項目はそろっているので、このまま生成へ進めます。"
	}

	return reply
}

// lastUserText は直近の学習者の発言を返す。
func lastUserText(messages []Message) string {
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Role == RoleUser {
			return Normalize(Draft{Topic: messages[index].Text}).Topic
		}
	}
	return ""
}

// fillFirstEmptyField は、まだ空いている必須項目のうち先頭のものへ答えを入れる。
// 静的な応答は1回に1項目しか聞かないため、答えも1項目ぶんとして扱える。
func fillFirstEmptyField(draft Draft, answer string) Draft {
	switch {
	case draft.Topic == "":
		draft.Topic = truncate(answer, MaxTopicLength)
	case draft.Audience == "":
		draft.Audience = truncate(answer, MaxAudienceLength)
	case draft.Goal == "":
		draft.Goal = truncate(answer, MaxGoalLength)
	}
	return draft
}

// truncate は上限を超えた分を切り捨てる。
// 学習者の自由記述をそのまま入れると、下書きの検証で弾かれることがある。
func truncate(value string, maxLength int) string {
	runes := []rune(value)
	if len(runes) <= maxLength {
		return value
	}
	return string(runes[:maxLength])
}
