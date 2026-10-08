package project

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

var ErrNotFound = errors.New("project not found")

// ConflictError は、上書き保存しようとしたプロジェクトが、読み込んだあとに別の場所で更新されていたことを表す。
// そのまま保存すると、相手の編集を知らせずに消してしまうため、保存せずに返す(#118)。
type ConflictError struct {
	// CurrentVersion は、いま保存されているバージョン。
	CurrentVersion int
}

func (err *ConflictError) Error() string {
	return fmt.Sprintf("project was updated elsewhere (current version %d)", err.CurrentVersion)
}

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
	// 最後の引数は、読み込んだ時点のバージョン。保存済みのバージョンと違えば、保存せずに *ConflictError を返す。
	// nilなら確かめずに上書きする。バージョンを送らない以前の画面からでも保存できるようにするため。
	Update(context.Context, string, string, site.Model, *LearningRecord, *int) (Record, error)
	Get(context.Context, string, string) (Record, error)
	List(context.Context, string) ([]Record, error)
	Delete(context.Context, string, string) error
	SaveQualityResults(context.Context, string, string, []QualityResultInput) ([]QualityResult, error)
	ListQualityResults(context.Context, string, string) ([]QualityResult, error)
}
