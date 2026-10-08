package project

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 実際のPostgreSQLで、リポジトリのSQLを確かめる。
// 上書き保存の競合検知(#118)は、照合と更新を1つのSQLで行うことに頼っているため、スタブでは確かめられない。
//
// TEST_DATABASE_URL が無ければ飛ばす。CIではbackendジョブがPostgreSQLを用意して設定する。
// 手元では compose.yaml のPostgreSQLを起動してから、次のように実行する。
//
//	TEST_DATABASE_URL=postgres://app:app@localhost:5432/learning_web_builder go test ./internal/project/
//
// テストごとに専用のスキーマを作ってマイグレーションを適用し、終わったら消す。既存のテーブルには触らない。
func newTestRepository(t *testing.T) *PostgresRepository {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		// CIで設定が外れると、テストが黙って飛ばされたまま合格になる。
		if os.Getenv("CI") != "" {
			t.Fatal("TEST_DATABASE_URL is required in CI")
		}
		t.Skip("TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	admin, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect to test database: %v", err)
	}
	schema := fmt.Sprintf("project_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop test schema: %v", err)
		}
		_ = admin.Close(ctx)
	})

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse test database url: %v", err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("open test pool: %v", err)
	}
	// スキーマを消す前に、接続を閉じる。
	t.Cleanup(pool.Close)

	migrations, err := filepath.Glob(filepath.Join("..", "..", "..", "db", "migrations", "*.sql"))
	if err != nil || len(migrations) == 0 {
		t.Fatalf("find migrations: %v (found %d)", err, len(migrations))
	}
	sort.Strings(migrations)
	for _, path := range migrations {
		statements, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read migration %s: %v", path, err)
		}
		if _, err := pool.Exec(ctx, string(statements)); err != nil {
			t.Fatalf("apply migration %s: %v", path, err)
		}
	}
	return NewPostgresRepository(pool)
}

func titledSite(title string) site.Model {
	model := site.Sample("学校の写真部")
	model.SiteTitle = title
	return model
}

func createTestProject(t *testing.T, repository *PostgresRepository, ownerID string) Record {
	t.Helper()
	record, err := repository.Create(context.Background(), ownerID, titledSite("最初の内容"), LearningRecord{})
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	if record.Version != 1 {
		t.Fatalf("expected a new project to start at version 1, got %d", record.Version)
	}
	return record
}

func version(value int) *int {
	return &value
}

func storedTitle(t *testing.T, repository *PostgresRepository, ownerID, projectID string) (string, int) {
	t.Helper()
	record, err := repository.Get(context.Background(), ownerID, projectID)
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	return record.Site.SiteTitle, record.Version
}

func TestPostgresUpdateSavesWhenBaseVersionMatches(t *testing.T) {
	repository := newTestRepository(t)
	created := createTestProject(t, repository, "user_1")

	updated, err := repository.Update(context.Background(), "user_1", created.ID, titledSite("タブAの内容"), nil, version(1))

	if err != nil {
		t.Fatalf("expected update to succeed, got %v", err)
	}
	if updated.Version != 2 || updated.Site.SiteTitle != "タブAの内容" {
		t.Fatalf("expected version 2 with the new title, got version %d title %q", updated.Version, updated.Site.SiteTitle)
	}
}

// 読み込んだあとに別の場所で保存されていたら、保存せずに、いまのバージョンを添えて断る。
func TestPostgresUpdateRejectsStaleBaseVersionWithoutSaving(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()
	created := createTestProject(t, repository, "user_1")
	if _, err := repository.Update(ctx, "user_1", created.ID, titledSite("タブAの内容"), nil, version(1)); err != nil {
		t.Fatalf("first update: %v", err)
	}

	_, err := repository.Update(ctx, "user_1", created.ID, titledSite("タブBの古い内容"), nil, version(1))

	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected a conflict, got %v", err)
	}
	if conflict.CurrentVersion != 2 {
		t.Fatalf("expected current version 2, got %d", conflict.CurrentVersion)
	}
	if title, stored := storedTitle(t, repository, "user_1", created.ID); title != "タブAの内容" || stored != 2 {
		t.Fatalf("expected the stored project to stay untouched, got version %d title %q", stored, title)
	}
}

// バージョンを送らない以前の画面からの保存は、確かめずに上書きする。
func TestPostgresUpdateSkipsVersionCheckWithoutBaseVersion(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()
	created := createTestProject(t, repository, "user_1")
	if _, err := repository.Update(ctx, "user_1", created.ID, titledSite("タブAの内容"), nil, version(1)); err != nil {
		t.Fatalf("first update: %v", err)
	}

	updated, err := repository.Update(ctx, "user_1", created.ID, titledSite("以前の画面の内容"), nil, nil)

	if err != nil {
		t.Fatalf("expected update to succeed, got %v", err)
	}
	if updated.Version != 3 || updated.Site.SiteTitle != "以前の画面の内容" {
		t.Fatalf("expected version 3 with the new title, got version %d title %q", updated.Version, updated.Site.SiteTitle)
	}
}

// 他人のプロジェクトや存在しないプロジェクトは、バージョンの指定があっても競合にせず、該当なしにする。
// 競合として返すと、プロジェクトがあることと、そのバージョンを所有者以外へ漏らしてしまう。
func TestPostgresUpdateReturnsNotFoundForOtherOwnerOrMissingProject(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()
	created := createTestProject(t, repository, "user_1")
	const missingID = "00000000-0000-4000-8000-000000000000"

	for name, target := range map[string]struct {
		ownerID     string
		projectID   string
		baseVersion *int
	}{
		"他人・バージョン一致":    {"user_2", created.ID, version(1)},
		"他人・バージョン不一致":   {"user_2", created.ID, version(9)},
		"他人・バージョンなし":    {"user_2", created.ID, nil},
		"存在しない・バージョンあり": {"user_1", missingID, version(1)},
		"存在しない・バージョンなし": {"user_1", missingID, nil},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := repository.Update(ctx, target.ownerID, target.projectID, titledSite("書き換え"), nil, target.baseVersion)
			if !errors.Is(err, ErrNotFound) {
				t.Fatalf("expected ErrNotFound, got %v", err)
			}
		})
	}

	if title, stored := storedTitle(t, repository, "user_1", created.ID); title != "最初の内容" || stored != 1 {
		t.Fatalf("expected the owner's project to stay untouched, got version %d title %q", stored, title)
	}
}

// 同じバージョンから同時に保存しても、通るのは1件だけ。残りは競合になる。
func TestPostgresUpdateLetsOnlyOneConcurrentSaveWin(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()
	created := createTestProject(t, repository, "user_1")

	const attempts = 8
	results := make([]error, attempts)
	var group sync.WaitGroup
	start := make(chan struct{})
	for index := range attempts {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			_, results[index] = repository.Update(ctx, "user_1", created.ID, titledSite(fmt.Sprintf("同時保存%d", index)), nil, version(1))
		}()
	}
	close(start)
	group.Wait()

	saved := 0
	for index, err := range results {
		var conflict *ConflictError
		switch {
		case err == nil:
			saved++
		case errors.As(err, &conflict):
			if conflict.CurrentVersion != 2 {
				t.Errorf("attempt %d: expected current version 2, got %d", index, conflict.CurrentVersion)
			}
		default:
			t.Errorf("attempt %d: expected success or a conflict, got %v", index, err)
		}
	}
	if saved != 1 {
		t.Fatalf("expected exactly one save to win, got %d", saved)
	}
	if _, stored := storedTitle(t, repository, "user_1", created.ID); stored != 2 {
		t.Fatalf("expected version 2 after one winning save, got %d", stored)
	}
}
