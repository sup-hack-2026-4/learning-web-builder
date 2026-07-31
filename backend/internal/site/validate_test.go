package site

import (
	"strings"
	"testing"
)

func TestValidateAcceptsSample(t *testing.T) {
	if err := Validate(Sample("学校の写真部")); err != nil {
		t.Fatalf("expected sample to be valid, got %v", err)
	}
}

func TestValidateRejectsInvalidModel(t *testing.T) {
	model := Sample("学校の写真部")
	model.SiteTitle = strings.Repeat("あ", 81)
	model.Theme.Primary = "blue"
	model.Theme.Spacing = 11
	model.Sections[1].ID = model.Sections[0].ID
	model.Sections[1].Kind = "unknown"

	err := Validate(model)
	if err == nil {
		t.Fatal("expected validation error")
	}

	for _, expected := range []string{
		"siteTitle",
		"theme.primary",
		"theme.spacing",
		"id must be unique",
		"kind is invalid",
	} {
		if !strings.Contains(err.Error(), expected) {
			t.Errorf("expected error to contain %q, got %q", expected, err)
		}
	}
}

func TestValidateAcceptsModelWithoutHeading(t *testing.T) {
	// 見出しの色は任意。Geminiも初期サンプルもこの項目を返さない。
	model := Sample("学校の写真部")
	if model.Theme.Heading != "" {
		t.Fatalf("expected sample to leave heading unset, got %q", model.Theme.Heading)
	}
	if err := Validate(model); err != nil {
		t.Fatalf("expected model without heading to be valid, got %v", err)
	}
}

func TestValidateChecksHeadingWhenPresent(t *testing.T) {
	model := Sample("学校の写真部")

	model.Theme.Heading = "#b91c1c"
	if err := Validate(model); err != nil {
		t.Fatalf("expected hex heading to be valid, got %v", err)
	}

	model.Theme.Heading = "red"
	err := Validate(model)
	if err == nil {
		t.Fatal("expected non-hex heading to be rejected")
	}
	if !strings.Contains(err.Error(), "theme.heading") {
		t.Errorf("expected error to mention theme.heading, got %q", err)
	}
}

func TestValidateCountsUnicodeCodePoints(t *testing.T) {
	model := Sample("学校の写真部")
	model.SiteTitle = strings.Repeat("𠮷", 80)
	if err := Validate(model); err != nil {
		t.Fatalf("expected 80 code points to be valid, got %v", err)
	}

	model.SiteTitle += "野"
	if err := Validate(model); err == nil {
		t.Fatal("expected 81 code points to be rejected")
	}
}
