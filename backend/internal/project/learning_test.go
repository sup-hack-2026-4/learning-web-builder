package project

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestMarshalLearningRecordKeepsHTMLSymbols(t *testing.T) {
	// 保存先の大きさを無駄に膨らませないよう、< > & をエスケープしない。
	codeChanges := []string{`<a href="?a=1&b=2">詳しく</a>`}
	encoded, err := MarshalLearningRecord(LearningRecord{Notes: []LearningNote{{
		ID: "note-1", Target: "内容変更", Reason: "理由", CreatedAt: "2026-09-29T01:00:00Z",
		CodeChanges: &codeChanges,
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

// 画面側(frontend/src/features/site-model/learning-record.test.ts)と同じ境界値で確かめる。
// どちらかだけが受け付ける日時があると、画面の検証を通ったのに保存で400になる。
func TestValidTimestampMatchesSharedCases(t *testing.T) {
	data, err := os.ReadFile("../../../testdata/learning-timestamps.json")
	if err != nil {
		t.Fatalf("read shared timestamp cases: %v", err)
	}
	var cases struct {
		Valid   []string `json:"valid"`
		Invalid []string `json:"invalid"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("decode shared timestamp cases: %v", err)
	}
	for _, value := range cases.Valid {
		if !ValidTimestamp(value) {
			t.Errorf("expected %q to be accepted", value)
		}
	}
	for _, value := range cases.Invalid {
		if ValidTimestamp(value) {
			t.Errorf("expected %q to be rejected", value)
		}
	}
}
