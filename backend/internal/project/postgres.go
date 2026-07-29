package project

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
	"github.com/jackc/pgx/v5"
)

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type PostgresRepository struct {
	db queryRower
}

func NewPostgresRepository(db queryRower) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (repository *PostgresRepository) Create(ctx context.Context, ownerID string, model site.Model) (Record, error) {
	siteJSON, err := json.Marshal(model)
	if err != nil {
		return Record{}, fmt.Errorf("marshal site model: %w", err)
	}

	row := repository.db.QueryRow(
		ctx,
		`INSERT INTO projects (clerk_user_id, title, topic, site_model)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, clerk_user_id, site_model, version, created_at, updated_at`,
		ownerID,
		model.SiteTitle,
		model.Topic,
		siteJSON,
	)
	return scanRecord(row)
}

func (repository *PostgresRepository) Update(ctx context.Context, ownerID, projectID string, model site.Model) (Record, error) {
	siteJSON, err := json.Marshal(model)
	if err != nil {
		return Record{}, fmt.Errorf("marshal site model: %w", err)
	}

	row := repository.db.QueryRow(
		ctx,
		`UPDATE projects
		 SET title = $3, topic = $4, site_model = $5, version = version + 1, updated_at = NOW()
		 WHERE id = $1 AND clerk_user_id = $2
		 RETURNING id, clerk_user_id, site_model, version, created_at, updated_at`,
		projectID,
		ownerID,
		model.SiteTitle,
		model.Topic,
		siteJSON,
	)
	record, err := scanRecord(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	return record, err
}

func scanRecord(row pgx.Row) (Record, error) {
	var record Record
	var siteJSON []byte
	if err := row.Scan(
		&record.ID,
		&record.OwnerID,
		&siteJSON,
		&record.Version,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return Record{}, fmt.Errorf("scan project: %w", err)
	}
	if err := json.Unmarshal(siteJSON, &record.Site); err != nil {
		return Record{}, fmt.Errorf("decode stored site model: %w", err)
	}
	return record, nil
}
