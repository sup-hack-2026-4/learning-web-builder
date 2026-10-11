// Package testdb は、実際のPostgreSQLを使うテストのためのデータベースを用意する。
//
// TEST_DATABASE_URL が無ければテストを飛ばす。CIではbackendジョブがPostgreSQLを用意して設定する。
// 手元では compose.yaml のPostgreSQLを起動してから、次のように実行する。
//
//	TEST_DATABASE_URL=postgres://app:app@localhost:5432/learning_web_builder go test ./...
//
// テストごとに専用のスキーマを作り、終わったら消す。既存のテーブルには触らない。
package testdb

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupLockKey は、スキーマの準備と片付けを1つずつ行うためのアドバイザリロックの鍵。
// go test ./... はパッケージを並行に走らせる。マイグレーションの CREATE EXTENSION IF NOT EXISTS は
// 同時に走ると片方が一意制約の違反で失敗するため、順番に通す。
const setupLockKey = 1190119

// NewPool は、すべてのマイグレーションを適用した専用スキーマにつながる接続プールを返す。
func NewPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := NewEmptyPool(t)
	for _, path := range Migrations(t) {
		ApplyMigration(t, pool, path)
	}
	return pool
}

// NewEmptyPool は、マイグレーションを適用していない専用スキーマにつながる接続プールを返す。
// マイグレーションを途中まで適用した状態を作るときに使う。
func NewEmptyPool(t *testing.T) *pgxpool.Pool {
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
	// 時刻だけで名前を付けると、並行に走る別のパッケージのテストと重なりうる。
	schema := "test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		// 拡張は最初に適用したスキーマに入り、スキーマと一緒に消える。準備と重ならないようロックの中で消す。
		if _, err := admin.Exec(ctx, "SELECT pg_advisory_lock($1)", setupLockKey); err != nil {
			t.Errorf("lock test database: %v", err)
		}
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop test schema: %v", err)
		}
		// ロックは接続を閉じると外れる。
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
	return pool
}

// Migrations は、マイグレーションのファイルを適用する順に返す。
func Migrations(t *testing.T) []string {
	t.Helper()
	migrations, err := filepath.Glob(filepath.Join(migrationsDirectory(t), "*.sql"))
	if err != nil || len(migrations) == 0 {
		t.Fatalf("find migrations: %v (found %d)", err, len(migrations))
	}
	sort.Strings(migrations)
	return migrations
}

// ApplyMigration は、マイグレーションを1つ適用する。
func ApplyMigration(t *testing.T, pool *pgxpool.Pool, path string) {
	t.Helper()
	statements, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration %s: %v", path, err)
	}

	ctx := context.Background()
	connection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire connection for migration %s: %v", path, err)
	}
	defer connection.Release()
	if _, err := connection.Exec(ctx, "SELECT pg_advisory_lock($1)", setupLockKey); err != nil {
		t.Fatalf("lock test database: %v", err)
	}
	defer func() {
		if _, err := connection.Exec(ctx, "SELECT pg_advisory_unlock($1)", setupLockKey); err != nil {
			t.Errorf("unlock test database: %v", err)
		}
	}()
	if _, err := connection.Exec(ctx, string(statements)); err != nil {
		t.Fatalf("apply migration %s: %v", path, err)
	}
}

// migrationsDirectory は、テストを実行しているパッケージの場所から上へたどって db/migrations を探す。
// go test は作業ディレクトリをパッケージの場所にするため、呼び出し元の階層が違っても同じ場所に行き着く。
func migrationsDirectory(t *testing.T) string {
	t.Helper()
	directory, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	for {
		candidate := filepath.Join(directory, "db", "migrations")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			t.Fatal("db/migrations was not found above the working directory")
		}
		directory = parent
	}
}
