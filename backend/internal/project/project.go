package project

import (
	"context"
	"errors"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

var ErrNotFound = errors.New("project not found")

type Record struct {
	ID        string
	OwnerID   string
	Site      site.Model
	Version   int
	CreatedAt time.Time
	UpdatedAt time.Time
}

type QualityResultInput struct {
	CheckKey string
	Passed   bool
	Detail   string
}

type QualityResult struct {
	ID        string
	ProjectID string
	CheckKey  string
	Passed    bool
	Detail    string
	CheckedAt time.Time
}

type Repository interface {
	Create(context.Context, string, site.Model) (Record, error)
	Update(context.Context, string, string, site.Model) (Record, error)
	Get(context.Context, string, string) (Record, error)
	List(context.Context, string) ([]Record, error)
	SaveQualityResults(context.Context, string, string, []QualityResultInput) ([]QualityResult, error)
	ListQualityResults(context.Context, string, string) ([]QualityResult, error)
}
