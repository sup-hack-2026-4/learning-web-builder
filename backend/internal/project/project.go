package project

import (
	"context"
	"errors"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

var ErrNotFound = errors.New("project not found")

type Record struct {
	ID      string
	OwnerID string
	Site    site.Model
	// Learning は作品と一緒に保存した学習の記録。一覧(List)では運ばないため空になる。
	Learning  LearningRecord
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
	Create(context.Context, string, site.Model, LearningRecord) (Record, error)
	// Update の学習記録がnilなら、保存済みの記録をそのまま残す。
	// 記録を送らない以前の画面から上書き保存しても、記録を消さないようにするため。
	Update(context.Context, string, string, site.Model, *LearningRecord) (Record, error)
	Get(context.Context, string, string) (Record, error)
	List(context.Context, string) ([]Record, error)
	Delete(context.Context, string, string) error
	SaveQualityResults(context.Context, string, string, []QualityResultInput) ([]QualityResult, error)
	ListQualityResults(context.Context, string, string) ([]QualityResult, error)
}
