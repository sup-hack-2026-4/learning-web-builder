package site

import (
	"encoding/base64"
	"fmt"
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

// jpegImage は指定したbase64長になるダミーのJPEGデータURIを作る。
// 検証はJPEGの開始マーカーとサイズだけを見るため、中身は0埋めで足りる。
func jpegImage(t *testing.T, fileName string, base64Length int) *SectionImage {
	t.Helper()
	if base64Length%4 != 0 {
		t.Fatalf("base64の長さは4の倍数で指定してください: %d", base64Length)
	}

	decodedLength := base64Length / 4 * 3
	payload := make([]byte, decodedLength)
	copy(payload, []byte{0xFF, 0xD8, 0xFF})

	return &SectionImage{
		DataURI:  "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(payload),
		FileName: fileName,
	}
}

func TestValidateAcceptsSectionImage(t *testing.T) {
	model := Sample("学校の写真部")
	model.Sections[1].Image = jpegImage(t, "about.jpg", 1024)

	if err := Validate(model); err != nil {
		t.Fatalf("expected model with an image to be valid, got %v", err)
	}
}

func TestValidateAcceptsModelWithoutImages(t *testing.T) {
	// 画像は任意項目。保存済みの古いプロジェクトはこの項目を持たない。
	model := Sample("学校の写真部")
	for index, section := range model.Sections {
		if section.Image != nil {
			t.Fatalf("expected sample section %d to leave image unset", index)
		}
	}
	if err := Validate(model); err != nil {
		t.Fatalf("expected model without images to be valid, got %v", err)
	}
}

func TestValidateRejectsImageOnContactSection(t *testing.T) {
	model := Sample("学校の写真部")
	contactIndex := len(model.Sections) - 1
	if model.Sections[contactIndex].Kind != "contact" {
		t.Fatalf("expected the last sample section to be contact, got %q", model.Sections[contactIndex].Kind)
	}
	model.Sections[contactIndex].Image = jpegImage(t, "contact.jpg", 1024)

	err := Validate(model)
	if err == nil {
		t.Fatal("expected an image on a contact section to be rejected")
	}
	if !strings.Contains(err.Error(), "not allowed for contact sections") {
		t.Errorf("expected error to mention contact sections, got %q", err)
	}
}

func TestValidateRejectsInvalidImageFileName(t *testing.T) {
	for _, fileName := range []string{"About.jpg", "about.png", "../about.jpg", "images/about.jpg", "about.jpg.exe", ""} {
		model := Sample("学校の写真部")
		model.Sections[1].Image = jpegImage(t, fileName, 1024)

		err := Validate(model)
		if err == nil {
			t.Fatalf("expected file name %q to be rejected", fileName)
		}
		if !strings.Contains(err.Error(), "image.fileName") {
			t.Errorf("expected error to mention image.fileName for %q, got %q", fileName, err)
		}
	}
}

func TestValidateRejectsDuplicateImageFileName(t *testing.T) {
	model := Sample("学校の写真部")
	model.Sections[1].Image = jpegImage(t, "photo.jpg", 1024)
	model.Sections[2].Image = jpegImage(t, "photo.jpg", 1024)

	err := Validate(model)
	if err == nil {
		t.Fatal("expected duplicate image file names to be rejected")
	}
	if !strings.Contains(err.Error(), "must be unique") {
		t.Errorf("expected error to mention uniqueness, got %q", err)
	}
}

func TestValidateRejectsNonJPEGImageData(t *testing.T) {
	tests := []struct {
		name     string
		dataURI  string
		expected string
	}{
		{
			name:     "データURIではない",
			dataURI:  "https://example.com/photo.jpg",
			expected: "must be a base64 JPEG data URI",
		},
		{
			name:     "PNGのデータURI",
			dataURI:  "data:image/png;base64,iVBORw0KGgo=",
			expected: "must be a base64 JPEG data URI",
		},
		{
			name:     "base64として壊れている",
			dataURI:  "data:image/jpeg;base64,!!!!",
			expected: "must be valid base64",
		},
		{
			name:     "JPEGの開始マーカーがない",
			dataURI:  "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte("plain text")),
			expected: "must contain JPEG data",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			model := Sample("学校の写真部")
			model.Sections[1].Image = &SectionImage{DataURI: test.dataURI, FileName: "about.jpg"}

			err := Validate(model)
			if err == nil {
				t.Fatal("expected invalid image data to be rejected")
			}
			if !strings.Contains(err.Error(), test.expected) {
				t.Errorf("expected error to contain %q, got %q", test.expected, err)
			}
		})
	}
}

func TestValidateRejectsOversizedImage(t *testing.T) {
	model := Sample("学校の写真部")
	model.Sections[1].Image = jpegImage(t, "about.jpg", MaxSectionImageBase64Bytes+4)

	err := Validate(model)
	if err == nil {
		t.Fatal("expected an oversized image to be rejected")
	}
	if !strings.Contains(err.Error(), "at most") {
		t.Errorf("expected error to mention the size limit, got %q", err)
	}
}

func TestValidateRejectsTooManyImages(t *testing.T) {
	model := Sample("学校の写真部")
	// contactは画像を持てないため、画像を置ける枠を先に増やす。
	model.Sections = append(model.Sections[:len(model.Sections)-1], Section{
		ID: "gallery-1", Kind: "gallery", Title: "写真", Body: "", ImageAlt: "", Visible: true,
	}, Section{
		ID: "gallery-2", Kind: "gallery", Title: "写真2", Body: "", ImageAlt: "", Visible: true,
	}, Section{
		ID: "gallery-3", Kind: "gallery", Title: "写真3", Body: "", ImageAlt: "", Visible: true,
	})
	for index := range model.Sections {
		model.Sections[index].Image = jpegImage(t, fmt.Sprintf("photo-%d.jpg", index), 1024)
	}
	if len(model.Sections) <= MaxSectionImages {
		t.Fatalf("expected more than %d sections to exercise the limit, got %d", MaxSectionImages, len(model.Sections))
	}

	err := Validate(model)
	if err == nil {
		t.Fatal("expected too many images to be rejected")
	}
	if !strings.Contains(err.Error(), "at most 4 images") {
		t.Errorf("expected error to mention the image count limit, got %q", err)
	}
}

func TestValidateRejectsOversizedImagesInTotal(t *testing.T) {
	// 1枚ずつは上限内でも、合計では超える組み合わせを弾けることを確かめる。
	model := Sample("学校の写真部")
	model.Sections = append(model.Sections[:len(model.Sections)-1], Section{
		ID: "gallery-1", Kind: "gallery", Title: "写真", Body: "", ImageAlt: "", Visible: true,
	})
	for index := range model.Sections {
		model.Sections[index].Image = jpegImage(t, fmt.Sprintf("photo-%d.jpg", index), MaxSectionImageBase64Bytes)
	}

	err := Validate(model)
	if err == nil {
		t.Fatal("expected images exceeding the total size to be rejected")
	}
	if !strings.Contains(err.Error(), "in total") {
		t.Errorf("expected error to mention the total size limit, got %q", err)
	}
	if strings.Contains(err.Error(), "at most 4 images") {
		t.Errorf("expected the image count to stay within the limit, got %q", err)
	}
}
