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
	Begin(context.Context) (pgx.Tx, error)
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

func (repository *PostgresRepository) SaveQualityResults(
	ctx context.Context,
	ownerID string,
	projectID string,
	inputs []QualityResultInput,
) ([]QualityResult, error) {
	transaction, err := repository.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin quality result transaction: %w", err)
	}
	defer func() {
		_ = transaction.Rollback(ctx)
	}()

	exists, err := projectExistsForOwner(ctx, transaction, ownerID, projectID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	results := make([]QualityResult, 0, len(inputs))
	for _, input := range inputs {
		detailsJSON, err := json.Marshal(map[string]string{"detail": input.Detail})
		if err != nil {
			return nil, fmt.Errorf("marshal quality result details: %w", err)
		}
		row := transaction.QueryRow(
			ctx,
			`INSERT INTO quality_results (project_id, check_key, passed, details)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id, project_id, check_key, passed, details, checked_at`,
			projectID,
			input.CheckKey,
			input.Passed,
			detailsJSON,
		)
		result, err := scanQualityResult(row)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if err := transaction.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit quality results: %w", err)
	}
	return results, nil
}

func (repository *PostgresRepository) ListQualityResults(
	ctx context.Context,
	ownerID string,
	projectID string,
) ([]QualityResult, error) {
	exists, err := projectExistsForOwner(ctx, repository.db, ownerID, projectID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	rows, err := repository.db.Query(
		ctx,
		`SELECT id, project_id, check_key, passed, details, checked_at
		 FROM quality_results
		 WHERE project_id = $1
		 ORDER BY checked_at DESC, id DESC`,
		projectID,
	)
	if err != nil {
		return nil, fmt.Errorf("list quality results: %w", err)
	}
	defer rows.Close()

	results := make([]QualityResult, 0)
	for rows.Next() {
		result, err := scanQualityResult(rows)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate quality results: %w", err)
	}
	return results, nil
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

type projectExistenceQuery interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func projectExistsForOwner(ctx context.Context, query projectExistenceQuery, ownerID, projectID string) (bool, error) {
	var exists bool
	if err := query.QueryRow(
		ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM projects WHERE id = $1 AND clerk_user_id = $2
		 )`,
		projectID,
		ownerID,
	).Scan(&exists); err != nil {
		return false, fmt.Errorf("check project ownership: %w", err)
	}
	return exists, nil
}

func scanQualityResult(row pgx.Row) (QualityResult, error) {
	var result QualityResult
	var detailsJSON []byte
	if err := row.Scan(
		&result.ID,
		&result.ProjectID,
		&result.CheckKey,
		&result.Passed,
		&detailsJSON,
		&result.CheckedAt,
	); err != nil {
		return QualityResult{}, fmt.Errorf("scan quality result: %w", err)
	}
	var details struct {
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(detailsJSON, &details); err != nil {
		return QualityResult{}, fmt.Errorf("decode quality result details: %w", err)
	}
	result.Detail = details.Detail
	return result, nil
}
