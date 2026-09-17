package concept

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

// 入力の上限。会話履歴はフロントが毎回まとめて送るため、
// 1件ずつではなく全体の量も抑える。
const (
	MaxMessages       = 24 // 12往復ぶん
	MaxMessageLength  = 500
	MaxTopicLength    = 100 // site.Validate の topic と揃える
	MaxAudienceLength = 80
	MaxGoalLength     = 120
	MaxToneLength     = 40
	MaxMustInclude    = 5
	MaxMustIncludeLen = 60
	MaxReplyLength    = 400
	MaxChoices        = 4
	MaxChoiceLength   = 40
)

// ValidateMessages は受け取った会話履歴を検証する。
func ValidateMessages(messages []Message) error {
	if len(messages) == 0 {
		return errors.New("messages must contain at least one item")
	}
	if len(messages) > MaxMessages {
		return fmt.Errorf("messages must contain at most %d items", MaxMessages)
	}

	var validationErrors []error
	for index, message := range messages {
		prefix := fmt.Sprintf("messages[%d]", index)
		switch message.Role {
		case RoleUser, RoleModel:
		default:
			validationErrors = append(validationErrors, fmt.Errorf("%s.role is invalid", prefix))
		}
		length := utf8.RuneCountInString(message.Text)
		if strings.TrimSpace(message.Text) == "" || length > MaxMessageLength {
			validationErrors = append(validationErrors, fmt.Errorf("%s.text must be between 1 and %d characters", prefix, MaxMessageLength))
		}
	}

	// 最後は必ず学習者の発言。モデルの発言で終わる履歴を送られると、
	// 何に答えればよいのかが決まらない。
	if len(messages) > 0 && messages[len(messages)-1].Role != RoleUser {
		validationErrors = append(validationErrors, errors.New("messages must end with a user message"))
	}
	if err := ValidateAlternating(messages); err != nil {
		validationErrors = append(validationErrors, err)
	}

	return errors.Join(validationErrors...)
}

// ValidateDraft は下書きを検証する。
// 未確定の項目は空で通す。空であること自体は不正ではない。
func ValidateDraft(draft Draft) error {
	var validationErrors []error

	validateMaxLength := func(field, value string, maxLength int) {
		if utf8.RuneCountInString(value) > maxLength {
			validationErrors = append(validationErrors, fmt.Errorf("%s must be at most %d characters", field, maxLength))
		}
	}

	validateMaxLength("draft.topic", draft.Topic, MaxTopicLength)
	validateMaxLength("draft.audience", draft.Audience, MaxAudienceLength)
	validateMaxLength("draft.goal", draft.Goal, MaxGoalLength)
	validateMaxLength("draft.tone", draft.Tone, MaxToneLength)

	if len(draft.MustInclude) > MaxMustInclude {
		validationErrors = append(validationErrors, fmt.Errorf("draft.mustInclude must contain at most %d items", MaxMustInclude))
	}
	for index, item := range draft.MustInclude {
		validateMaxLength(fmt.Sprintf("draft.mustInclude[%d]", index), item, MaxMustIncludeLen)
	}

	return errors.Join(validationErrors...)
}

// ValidateReply はモデルが返した1ターン分を検証する。
// responseJsonSchema で縛ってはいるが、長さや件数までは保証されないため、
// 画面へ出す前にここで最後の砦を張る。
func ValidateReply(reply Reply) error {
	var validationErrors []error

	length := utf8.RuneCountInString(reply.Reply)
	if strings.TrimSpace(reply.Reply) == "" || length > MaxReplyLength {
		validationErrors = append(validationErrors, fmt.Errorf("reply must be between 1 and %d characters", MaxReplyLength))
	}
	if len(reply.Choices) > MaxChoices {
		validationErrors = append(validationErrors, fmt.Errorf("choices must contain at most %d items", MaxChoices))
	}
	for index, choice := range reply.Choices {
		if strings.TrimSpace(choice) == "" || utf8.RuneCountInString(choice) > MaxChoiceLength {
			validationErrors = append(validationErrors, fmt.Errorf("choices[%d] must be between 1 and %d characters", index, MaxChoiceLength))
		}
	}
	if err := ValidateDraft(reply.Draft); err != nil {
		validationErrors = append(validationErrors, err)
	}

	return errors.Join(validationErrors...)
}

// Normalize は下書きの空白を整え、空要素を落とす。
// モデルは "" や " " を平気で返すため、Missing の判定前に通す。
func Normalize(draft Draft) Draft {
	normalized := Draft{
		Topic:    strings.TrimSpace(draft.Topic),
		Audience: strings.TrimSpace(draft.Audience),
		Goal:     strings.TrimSpace(draft.Goal),
		Tone:     strings.TrimSpace(draft.Tone),
	}
	for _, item := range draft.MustInclude {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			normalized.MustInclude = append(normalized.MustInclude, trimmed)
		}
	}
	return normalized
}

// MissingFields は、まだ埋まっていない必須項目を返す。
// モデルの ready 申告は信用せず、サーバー側で下書きから導出する。
func MissingFields(draft Draft) []string {
	normalized := Normalize(draft)
	missing := make([]string, 0, 3)
	if normalized.Topic == "" {
		missing = append(missing, FieldTopic)
	}
	if normalized.Audience == "" {
		missing = append(missing, FieldAudience)
	}
	if normalized.Goal == "" {
		missing = append(missing, FieldGoal)
	}
	return missing
}

// IsReady は必須項目がそろっているかを返す。
func IsReady(draft Draft) bool {
	return len(MissingFields(draft)) == 0
}

// MergeConfirmed は、確定済みの下書きへモデルの提案を重ねる。
//
// モデルの応答をそのまま採用すると、すでに学習者が答えた項目を
// 消したり書き換えたりできてしまう。「空欄だけ聞く」はプロンプト上の依頼にすぎず、
// 従う保証がないため、確定済みの値はサーバー側で守る。
//
// 空いている項目にだけ提案を入れ、任意項目も同じ扱いにする。
// 学習者が決め直したいときは、やり直しで下書きごと作り直す。
func MergeConfirmed(confirmed Draft, proposed Draft) Draft {
	merged := Normalize(confirmed)
	suggestion := Normalize(proposed)

	if merged.Topic == "" {
		merged.Topic = suggestion.Topic
	}
	if merged.Audience == "" {
		merged.Audience = suggestion.Audience
	}
	if merged.Goal == "" {
		merged.Goal = suggestion.Goal
	}
	if merged.Tone == "" {
		merged.Tone = suggestion.Tone
	}
	if len(merged.MustInclude) == 0 {
		merged.MustInclude = suggestion.MustInclude
	}

	return merged
}

// ValidateAlternating は、会話が学習者とモデルで交互に並んでいるかを確かめる。
//
// 履歴はクライアントから毎回送られてくるため、モデルの発言が本物である保証はない。
// 交互性まで検証しても偽装は防ぎきれないが、会話の体裁を借りた指示の流し込みは
// 通しにくくなる。下書きの値をサーバー側で守ること（MergeConfirmed）と合わせて使う。
func ValidateAlternating(messages []Message) error {
	for index := 1; index < len(messages); index++ {
		if messages[index].Role == messages[index-1].Role {
			return fmt.Errorf("messages[%d].role must alternate between user and model", index)
		}
	}
	return nil
}
