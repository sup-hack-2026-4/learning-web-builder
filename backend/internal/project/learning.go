package project

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// 学習記録の上限。フロントエンド(frontend/src/features/site-model/schema.ts)と同じ値を持つ。
//
// 対象と変更行は、画面の入力をそのまま運ぶのではなく画面側で組み立てた文字列になる。
// 対象は構成変更のラベル(セクション名を含む)をつないだもの、変更行は生成HTMLの1行で、
// 本文(800文字)の & や " はエスケープされて数倍に伸びる。
// 通常の操作で作られた記録を保存できなくならないよう、1件ごとの上限は広めに取り、
// 実際の歯止めは記録全体の大きさ(MaxLearningRecordBytes)に任せる。
const (
	MaxLearningNotes          = 200
	MaxLearningNoteIDLength   = 100
	MaxLearningTargetLength   = 2000
	MaxLearningReasonLength   = 10000
	MaxLearningCodeChanges    = 200
	MaxLearningCodeLineLength = 10000
	MaxAIUsageEntries         = 50
	MaxAIUsagePurposeLength   = 200
	// MaxLearningRecordBytes は、保存リクエストのうち notes と aiUsage の値(JSON)の合計バイト数の上限。
	// 保存APIのボディ上限は1MiBで、画像(合計600KiB)と作品本文も同じリクエストに乗るため、
	// 項目ごとの上限だけでは収まらない組み合わせをここで止める。
	// 数えるのは受け取ったJSONそのもの。サーバーでエンコードし直した大きさで数えると、
	// エスケープの流儀(U+2028や制御文字の書き方)の違いで画面側の計算とずれるため。
	MaxLearningRecordBytes = 300 * 1024
)

// LearningNote は、変更の理由とそのとき変わったコードの行を対にした記録。
// 日時は画面が付けた文字列をそのまま返す。時刻型へ通すと表記(小数秒の桁など)が変わり、
// 保存前と読み込み後で提出物の中身がずれるため。
// CodeChanges は、省略(nil)と空の一覧([])を区別して往復させるためにポインタで持つ。
type LearningNote struct {
	ID          string    `json:"id"`
	Target      string    `json:"target"`
	Reason      string    `json:"reason"`
	CreatedAt   string    `json:"createdAt"`
	CodeChanges *[]string `json:"codeChanges,omitempty"`
}

type AIUsage struct {
	Provider    string `json:"provider"`
	Purpose     string `json:"purpose"`
	GeneratedAt string `json:"generatedAt"`
}

// LearningRecord は作品と同じ単位で保存する学習の記録。
// 作品と別々に保存すると、片方だけ古いまま残ってずれるため、同じ行に持たせる。
type LearningRecord struct {
	Notes   []LearningNote `json:"notes"`
	AIUsage []AIUsage      `json:"aiUsage"`
}

// Normalize は、省略やnullで届いた一覧を空の一覧にそろえる。
// レスポンスで null と [] が混ざると、画面側で毎回分岐が要るため。
func (record LearningRecord) Normalize() LearningRecord {
	if record.Notes == nil {
		record.Notes = []LearningNote{}
	}
	if record.AIUsage == nil {
		record.AIUsage = []AIUsage{}
	}
	return record
}

// MarshalLearningRecord は保存用のJSONを作る。
// HTMLの記号(<, >, &)をエスケープしない。保存先の大きさを無駄に膨らませないため。
func MarshalLearningRecord(record LearningRecord) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(record.Normalize()); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

// timestampPattern は、画面(frontend/src/features/site-model/schema.ts)と同じ形の正規表現。
// time.Parseだけでは +24:00 のような範囲外のオフセットや小数秒の区切りの , も通るため、
// 形は正規表現でそろえ、暦の上で実在するか(2月30日など)はtime.Parseで確かめる。
var timestampPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$`)

// ValidTimestamp は、画面と同じ範囲の日時だけを受け付ける。
// RFC 3339の日時(秒は必須。小数秒は任意。Zか±hh:mmのオフセット)で、暦の上で実在するもの。
func ValidTimestamp(value string) bool {
	if !timestampPattern.MatchString(value) {
		return false
	}
	_, err := time.Parse(time.RFC3339, value)
	return err == nil
}

// ValidateLearningRecord は保存APIの入口で学習記録の中身を検証する。
// 全体の大きさは受け取ったJSONで数えるため、呼び出し側(保存API)で確かめる。
func ValidateLearningRecord(record LearningRecord) error {
	var validationErrors []error

	validateRequiredLength := func(field, value string, maxLength int) {
		if strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > maxLength {
			validationErrors = append(validationErrors, fmt.Errorf("%s must be between 1 and %d characters", field, maxLength))
		}
	}
	validateTimestamp := func(field, value string) {
		if !ValidTimestamp(value) {
			validationErrors = append(validationErrors, fmt.Errorf("%s must be an RFC 3339 timestamp", field))
		}
	}

	if len(record.Notes) > MaxLearningNotes {
		validationErrors = append(validationErrors, fmt.Errorf("notes must contain at most %d items", MaxLearningNotes))
	}
	for index, note := range record.Notes {
		prefix := fmt.Sprintf("notes[%d]", index)
		validateRequiredLength(prefix+".id", note.ID, MaxLearningNoteIDLength)
		validateRequiredLength(prefix+".target", note.Target, MaxLearningTargetLength)
		validateRequiredLength(prefix+".reason", note.Reason, MaxLearningReasonLength)
		validateTimestamp(prefix+".createdAt", note.CreatedAt)
		if note.CodeChanges == nil {
			continue
		}
		if len(*note.CodeChanges) > MaxLearningCodeChanges {
			validationErrors = append(validationErrors, fmt.Errorf("%s.codeChanges must contain at most %d lines", prefix, MaxLearningCodeChanges))
		}
		for _, line := range *note.CodeChanges {
			if utf8.RuneCountInString(line) > MaxLearningCodeLineLength {
				validationErrors = append(validationErrors, fmt.Errorf("%s.codeChanges lines must be at most %d characters", prefix, MaxLearningCodeLineLength))
				break
			}
		}
	}

	if len(record.AIUsage) > MaxAIUsageEntries {
		validationErrors = append(validationErrors, fmt.Errorf("aiUsage must contain at most %d items", MaxAIUsageEntries))
	}
	for index, usage := range record.AIUsage {
		prefix := fmt.Sprintf("aiUsage[%d]", index)
		switch usage.Provider {
		case "gemini", "static-sample":
		default:
			validationErrors = append(validationErrors, fmt.Errorf("%s.provider is invalid", prefix))
		}
		validateRequiredLength(prefix+".purpose", usage.Purpose, MaxAIUsagePurposeLength)
		validateTimestamp(prefix+".generatedAt", usage.GeneratedAt)
	}

	return errors.Join(validationErrors...)
}
