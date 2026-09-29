package project

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// 学習記録の上限。フロントエンド(frontend/src/features/site-model/schema.ts)と同じ値を持つ。
const (
	MaxLearningNotes          = 200
	MaxLearningNoteIDLength   = 100
	MaxLearningTargetLength   = 200
	MaxLearningReasonLength   = 2000
	MaxLearningCodeChanges    = 200
	MaxLearningCodeLineLength = 2000
	MaxAIUsageEntries         = 50
	MaxAIUsagePurposeLength   = 200
	// MaxLearningRecordBytes は学習記録全体をJSONにしたときの上限。
	// 保存APIのボディ上限は1MiBで、画像(合計600KiB)と作品本文も同じリクエストに乗るため、
	// 項目ごとの上限だけでは収まらない組み合わせをここで止める。
	MaxLearningRecordBytes = 300 * 1024
)

// LearningNote は、変更の理由とそのとき変わったコードの行を対にした記録。
// 日時は画面が付けた文字列をそのまま返す。時刻型へ通すと表記(小数秒の桁など)が変わり、
// 保存前と読み込み後で提出物の中身がずれるため。
type LearningNote struct {
	ID          string   `json:"id"`
	Target      string   `json:"target"`
	Reason      string   `json:"reason"`
	CreatedAt   string   `json:"createdAt"`
	CodeChanges []string `json:"codeChanges,omitempty"`
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
// HTMLの記号(<, >, &)をエスケープしない。エスケープするとコードの行が数倍に膨らみ、
// 画面側(JSON.stringify)で数えた大きさと合わなくなるため。
func MarshalLearningRecord(record LearningRecord) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(record.Normalize()); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

// ValidateLearningRecord は保存APIの入口で学習記録を検証する。
func ValidateLearningRecord(record LearningRecord) error {
	var validationErrors []error

	validateRequiredLength := func(field, value string, maxLength int) {
		if strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > maxLength {
			validationErrors = append(validationErrors, fmt.Errorf("%s must be between 1 and %d characters", field, maxLength))
		}
	}
	validateTimestamp := func(field, value string) {
		if _, err := time.Parse(time.RFC3339, value); err != nil {
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
		if len(note.CodeChanges) > MaxLearningCodeChanges {
			validationErrors = append(validationErrors, fmt.Errorf("%s.codeChanges must contain at most %d lines", prefix, MaxLearningCodeChanges))
		}
		for _, line := range note.CodeChanges {
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

	encoded, err := MarshalLearningRecord(record)
	if err != nil {
		validationErrors = append(validationErrors, fmt.Errorf("learning record could not be encoded: %w", err))
	} else if len(encoded) > MaxLearningRecordBytes {
		validationErrors = append(validationErrors, fmt.Errorf("learning record must be at most %d bytes", MaxLearningRecordBytes))
	}

	return errors.Join(validationErrors...)
}
