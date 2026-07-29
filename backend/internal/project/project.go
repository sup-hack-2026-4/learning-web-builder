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

type Repository interface {
	Create(context.Context, string, site.Model) (Record, error)
	Update(context.Context, string, string, site.Model) (Record, error)
}
