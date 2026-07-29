package project

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
	"github.com/jackc/pgx/v5"
)

type database interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type PostgresRepository struct {
	db database
}

func NewPostgresRepository(db database) *PostgresRepository {
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

func (repository *PostgresRepository) Get(ctx context.Context, ownerID, projectID string) (Record, error) {
	row := repository.db.QueryRow(
		ctx,
		`SELECT id, clerk_user_id, site_model, version, created_at, updated_at
		 FROM projects
		 WHERE id = $1 AND clerk_user_id = $2`,
		projectID,
		ownerID,
	)
	record, err := scanRecord(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	return record, err
}

func (repository *PostgresRepository) List(ctx context.Context, ownerID string) ([]Record, error) {
	rows, err := repository.db.Query(
		ctx,
		`SELECT id, clerk_user_id, site_model, version, created_at, updated_at
		 FROM projects
		 WHERE clerk_user_id = $1
		 ORDER BY updated_at DESC`,
		ownerID,
	)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()

	records := make([]Record, 0)
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate projects: %w", err)
	}
	return records, nil
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
