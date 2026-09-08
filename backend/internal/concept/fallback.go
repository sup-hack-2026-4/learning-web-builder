package concept

// Fallback は、Gemini を利用できないときに返す静的な応答を組み立てる。
//
// 生成APIが static.Sample を返すのと同じ考え方で、AIが落ちていても
// 「誰に・何を・どんな雰囲気で」を順に決める対話の型だけは体験できるようにする。
// 題材に合わせた気の利いた質問はできないため、どの題材でも成り立つ聞き方に留める。
func Fallback(draft Draft) Reply {
	normalized := Normalize(draft)
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
