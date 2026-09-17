package site

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

var hexColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// 画像ファイル名は提出物ZIPの中でそのままパスになるため、
// ディレクトリ区切りや親ディレクトリ参照を含められない形に限定する。
var imageFileNamePattern = regexp.MustCompile(`^[a-z0-9-]{1,40}\.jpg$`)

const imageDataURIPrefix = "data:image/jpeg;base64,"

const (
	// MaxSectionImages はプロジェクト全体で持てる画像の枚数。
	MaxSectionImages = 4
	// MaxSectionImageBase64Bytes は画像1枚あたりのデータURI(base64部分)の上限。
	// 1枚だけ大きめの写真を使うこともできるよう、枚数の上限とは別に合計でも縛る。
	MaxSectionImageBase64Bytes = 200 * 1024
	// MaxTotalSectionImageBase64Bytes は全画像を合わせたデータURI(base64部分)の上限。
	// 保存APIのボディ上限は1MiBで、本文や学習メモも同じリクエストに乗るため、
	// 画像だけで使い切らないようここで余裕を残す。
	MaxTotalSectionImageBase64Bytes = 600 * 1024
)

// Validate verifies a Model at the server boundary before it is returned or persisted.
func Validate(model Model) error {
	var validationErrors []error

	validateRequiredLength := func(field, value string, maxLength int) {
		length := utf8.RuneCountInString(value)
		if strings.TrimSpace(value) == "" || length > maxLength {
			validationErrors = append(validationErrors, fmt.Errorf("%s must be between 1 and %d characters", field, maxLength))
		}
	}
	validateMaxLength := func(field, value string, maxLength int) {
		if utf8.RuneCountInString(value) > maxLength {
			validationErrors = append(validationErrors, fmt.Errorf("%s must be at most %d characters", field, maxLength))
		}
	}

	if strings.TrimSpace(model.ID) == "" {
		validationErrors = append(validationErrors, errors.New("id is required"))
	}
	validateRequiredLength("topic", model.Topic, 100)
	validateRequiredLength("siteTitle", model.SiteTitle, 80)
	validateMaxLength("tagline", model.Tagline, 160)

	for field, color := range map[string]string{
		"theme.primary":    model.Theme.Primary,
		"theme.background": model.Theme.Background,
		"theme.text":       model.Theme.Text,
	} {
		if !hexColorPattern.MatchString(color) {
			validationErrors = append(validationErrors, fmt.Errorf("%s must be a six-digit hex color", field))
		}
	}

	// 見出しの色は任意。指定された場合だけ色として検証する。
	if model.Theme.Heading != "" && !hexColorPattern.MatchString(model.Theme.Heading) {
		validationErrors = append(validationErrors, errors.New("theme.heading must be a six-digit hex color"))
	}

	switch model.Theme.FontFamily {
	case "sans", "serif", "rounded":
	default:
		validationErrors = append(validationErrors, errors.New("theme.fontFamily is invalid"))
	}
	if model.Theme.Spacing < 2 || model.Theme.Spacing > 10 {
		validationErrors = append(validationErrors, errors.New("theme.spacing must be between 2 and 10"))
	}

	if len(model.Sections) < 2 || len(model.Sections) > 8 {
		validationErrors = append(validationErrors, errors.New("sections must contain between 2 and 8 items"))
	}

	sectionIDs := make(map[string]struct{}, len(model.Sections))
	imageFileNames := make(map[string]struct{}, len(model.Sections))
	imageCount := 0
	totalImageBytes := 0
	for index, section := range model.Sections {
		prefix := fmt.Sprintf("sections[%d]", index)
		if strings.TrimSpace(section.ID) == "" {
			validationErrors = append(validationErrors, fmt.Errorf("%s.id is required", prefix))
		} else if _, exists := sectionIDs[section.ID]; exists {
			validationErrors = append(validationErrors, fmt.Errorf("%s.id must be unique", prefix))
		} else {
			sectionIDs[section.ID] = struct{}{}
		}

		switch section.Kind {
		case "hero", "about", "features", "gallery", "contact":
		default:
			validationErrors = append(validationErrors, fmt.Errorf("%s.kind is invalid", prefix))
		}

		validateRequiredLength(prefix+".title", section.Title, 80)
		validateMaxLength(prefix+".body", section.Body, 800)
		validateMaxLength(prefix+".imageAlt", section.ImageAlt, 160)

		if section.Image == nil {
			continue
		}
		imageCount++
		// contactセクションは画像を出力しないため、持たせても提出物には現れない。
		// 保存できてしまうと容量だけ消費するので、ここで弾く。
		if section.Kind == "contact" {
			validationErrors = append(validationErrors, fmt.Errorf("%s.image is not allowed for contact sections", prefix))
		}
		if !imageFileNamePattern.MatchString(section.Image.FileName) {
			validationErrors = append(validationErrors, fmt.Errorf("%s.image.fileName must be a lowercase .jpg name", prefix))
		} else if _, exists := imageFileNames[section.Image.FileName]; exists {
			validationErrors = append(validationErrors, fmt.Errorf("%s.image.fileName must be unique", prefix))
		} else {
			imageFileNames[section.Image.FileName] = struct{}{}
		}

		encoded, ok := strings.CutPrefix(section.Image.DataURI, imageDataURIPrefix)
		if !ok {
			validationErrors = append(validationErrors, fmt.Errorf("%s.image.dataUri must be a base64 JPEG data URI", prefix))
			continue
		}
		if len(encoded) > MaxSectionImageBase64Bytes {
			validationErrors = append(validationErrors, fmt.Errorf("%s.image.dataUri must be at most %d bytes", prefix, MaxSectionImageBase64Bytes))
		}
		totalImageBytes += len(encoded)

		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			validationErrors = append(validationErrors, fmt.Errorf("%s.image.dataUri must be valid base64", prefix))
			continue
		}
		// 拡張子やMIMEの申告だけでは中身を保証できないため、JPEGの開始マーカーを確かめる。
		if !bytes.HasPrefix(decoded, []byte{0xFF, 0xD8, 0xFF}) {
			validationErrors = append(validationErrors, fmt.Errorf("%s.image.dataUri must contain JPEG data", prefix))
		}
	}

	if imageCount > MaxSectionImages {
		validationErrors = append(validationErrors, fmt.Errorf("sections must contain at most %d images", MaxSectionImages))
	}
	if totalImageBytes > MaxTotalSectionImageBase64Bytes {
		validationErrors = append(validationErrors, fmt.Errorf("section images must be at most %d bytes in total", MaxTotalSectionImageBase64Bytes))
	}

	return errors.Join(validationErrors...)
}
