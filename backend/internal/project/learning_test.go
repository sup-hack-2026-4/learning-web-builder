package project

import (
	"strings"
	"testing"
)

func TestMarshalLearningRecordKeepsHTMLSymbols(t *testing.T) {
	// 画面側はJSON.stringifyで大きさを数えるため、< > & をエスケープすると値がずれる。
	encoded, err := MarshalLearningRecord(LearningRecord{Notes: []LearningNote{{
		ID: "note-1", Target: "内容変更", Reason: "理由", CreatedAt: "2026-09-29T01:00:00Z",
		CodeChanges: []string{`<a href="?a=1&b=2">詳しく</a>`},
	}}})
	if err != nil {
		t.Fatalf("marshal learning record: %v", err)
	}
	if !strings.Contains(string(encoded), `<a href=\"?a=1&b=2\">詳しく</a>`) {
		t.Fatalf("expected HTML symbols to stay as-is, got %s", encoded)
	}
}

func TestMarshalLearningRecordWritesEmptyLists(t *testing.T) {
	encoded, err := MarshalLearningRecord(LearningRecord{})
	if err != nil {
		t.Fatalf("marshal learning record: %v", err)
	}
	if string(encoded) != `{"notes":[],"aiUsage":[]}` {
		t.Fatalf("expected empty lists, got %s", encoded)
	}
}

func TestValidateLearningRecordAcceptsEmptyRecord(t *testing.T) {
	if err := ValidateLearningRecord(LearningRecord{}.Normalize()); err != nil {
		t.Fatalf("expected empty record to be valid, got %v", err)
	}
}

func TestValidateLearningRecordAcceptsTimestampsWithAndWithoutFraction(t *testing.T) {
	record := LearningRecord{
		Notes: []LearningNote{
			{ID: "a", Target: "対象", Reason: "理由", CreatedAt: "2026-09-29T01:02:03.456Z"},
			{ID: "b", Target: "対象", Reason: "理由", CreatedAt: "2026-09-29T10:02:03+09:00"},
		},
		AIUsage: []AIUsage{{Provider: "static-sample", Purpose: "初期サンプル", GeneratedAt: "2026-09-29T01:02:03Z"}},
	}
	if err := ValidateLearningRecord(record); err != nil {
		t.Fatalf("expected record to be valid, got %v", err)
	}
}
