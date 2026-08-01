package site

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

var hexColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

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
	}

	return errors.Join(validationErrors...)
}
