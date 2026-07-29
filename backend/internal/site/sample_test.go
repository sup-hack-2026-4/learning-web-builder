package site

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSampleKeepsTitlesWithinContract(t *testing.T) {
	tests := []struct {
		name  string
		topic string
	}{
		{name: "80文字", topic: strings.Repeat("あ", 80)},
		{name: "81文字", topic: strings.Repeat("い", 81)},
		{name: "100文字", topic: strings.Repeat("う", 100)},
		{name: "絵文字を含む100文字", topic: strings.Repeat("🌱", 50) + strings.Repeat("花", 50)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			model := Sample(test.topic)

			if model.Topic != test.topic {
				t.Fatalf("expected topic to be preserved, got %q", model.Topic)
			}
			if length := utf8.RuneCountInString(model.SiteTitle); length > 80 {
				t.Fatalf("expected siteTitle to be at most 80 code points, got %d", length)
			}
			if length := utf8.RuneCountInString(model.Sections[0].Title); length > 80 {
				t.Fatalf("expected hero title to be at most 80 code points, got %d", length)
			}
			if err := Validate(model); err != nil {
				t.Fatalf("expected generated sample to satisfy the contract, got %v", err)
			}
		})
	}
}
