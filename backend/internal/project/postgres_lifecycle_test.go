package project

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 保存→更新→復元→削除の流れと、所有者の分離を、実際のPostgreSQLで確かめる(#119)。
// 学習記録を残すかどうかはSQLのCOALESCEに、一覧から画像を落とす処理はJSONBの関数に頼っているため、
// スタブでは確かめられない。

const missingProjectID = "00000000-0000-4000-8000-000000000000"

// newTestRepositoryWithPool は、リポジトリを通さずに保存先の中身を確かめたいときに使う。
func newTestRepositoryWithPool(t *testing.T) (*PostgresRepository, *pgxpool.Pool) {
	t.Helper()
	pool := testdb.NewPool(t)
	return NewPostgresRepository(pool), pool
}

func lines(values ...string) *[]string {
	return &values
}

// illustratedSite は、画像と見出しの色を持つ作品を返す。どちらも任意項目で、保存先から戻るときに落ちやすい。
func illustratedSite(title string) site.Model {
	model := titledSite(title)
	model.Theme.Heading = "#b91c1c"
	model.Sections[1].Image = &site.SectionImage{DataURI: "data:image/jpeg;base64,/9j/4AAQSkZJRg==", FileName: "about.jpg"}
	model.Sections[2].Image = &site.SectionImage{DataURI: "data:image/jpeg;base64,/9j/2wBDAAEBAQ==", FileName: "features.jpg"}
	return model
}

func testLearningRecord() LearningRecord {
	return LearningRecord{
		Notes: []LearningNote{
			{
				ID:          "note-1",
				Target:      "デザイン変更（メインカラーを #b91c1c に）",
				Reason:      "写真部の作品が映えるよう、落ち着いた赤にした",
				CreatedAt:   "2026-09-29T01:02:03.456Z",
				CodeChanges: lines("--primary: #b91c1c;", `<h2 class="section-title">活動 &amp; 紹介</h2>`),
			},
			// 変更行が無い記録([])と、変更行を持たない記録(省略)は別のものとして戻る。
			{ID: "note-2", Target: "コンセプト", Reason: "新入生に活動の雰囲気を伝える", CreatedAt: "2026-09-29T01:00:00.000Z", CodeChanges: &[]string{}},
			{ID: "note-3", Target: "構成", Reason: "基本情報を最後に置く", CreatedAt: "2026-09-29T00:59:30+09:00"},
		},
		AIUsage: []AIUsage{
			{Provider: "gemini", Purpose: "サイト構成と仮文章の生成", GeneratedAt: "2026-09-29T00:59:00.000Z"},
		},
	}
}

func emptyLearningRecord() LearningRecord {
	return LearningRecord{}.Normalize()
}

func mustCreate(t *testing.T, repository *PostgresRepository, ownerID string, model site.Model, learning LearningRecord) Record {
	t.Helper()
	record, err := repository.Create(context.Background(), ownerID, model, learning)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}
	return record
}

func mustGet(t *testing.T, repository *PostgresRepository, ownerID, projectID string) Record {
	t.Helper()
	record, err := repository.Get(context.Background(), ownerID, projectID)
	if err != nil {
		t.Fatalf("get project: %v", err)
	}
	return record
}

func countRows(t *testing.T, pool *pgxpool.Pool, query string, arguments ...any) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(), query, arguments...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

func TestPostgresCreateThenGetRestoresSiteAndLearningRecord(t *testing.T) {
	repository := newTestRepository(t)
	model := illustratedSite("写真部の紹介")
	learning := testLearningRecord()

	created := mustCreate(t, repository, "user_1", model, learning)
	restored := mustGet(t, repository, "user_1", created.ID)

	for name, record := range map[string]Record{"保存の結果": created, "読み込みの結果": restored} {
		if !reflect.DeepEqual(record.Site, model) {
			t.Errorf("%s: expected the site to come back unchanged, got %+v", name, record.Site)
		}
		if !reflect.DeepEqual(record.Learning, learning) {
			t.Errorf("%s: expected the learning record to come back unchanged, got %+v", name, record.Learning)
		}
		if record.OwnerID != "user_1" || record.Version != 1 {
			t.Errorf("%s: expected owner user_1 at version 1, got owner %q version %d", name, record.OwnerID, record.Version)
		}
		if record.CreatedAt.IsZero() || !record.CreatedAt.Equal(record.UpdatedAt) {
			t.Errorf("%s: expected matching timestamps on a new project, got created %v updated %v", name, record.CreatedAt, record.UpdatedAt)
		}
	}
}

// 記録を送らない以前の画面から上書き保存しても、保存済みの学習記録を消さない(#114)。
func TestPostgresUpdateKeepsStoredLearningRecordWhenOmitted(t *testing.T) {
	repository := newTestRepository(t)
	learning := testLearningRecord()
	created := mustCreate(t, repository, "user_1", illustratedSite("最初の内容"), learning)
	changed := illustratedSite("書き換えた内容")

	updated, err := repository.Update(context.Background(), "user_1", created.ID, changed, nil, nil)

	if err != nil {
		t.Fatalf("update project: %v", err)
	}
	restored := mustGet(t, repository, "user_1", created.ID)
	for name, record := range map[string]Record{"保存の結果": updated, "読み込みの結果": restored} {
		if !reflect.DeepEqual(record.Learning, learning) {
			t.Errorf("%s: expected the stored learning record to stay, got %+v", name, record.Learning)
		}
		if !reflect.DeepEqual(record.Site, changed) || record.Version != 2 {
			t.Errorf("%s: expected the new site at version 2, got version %d site %+v", name, record.Version, record.Site)
		}
		if !record.CreatedAt.Equal(created.CreatedAt) || record.UpdatedAt.Before(created.UpdatedAt) {
			t.Errorf("%s: expected created %v to stay and updated to move forward, got created %v updated %v", name, created.CreatedAt, record.CreatedAt, record.UpdatedAt)
		}
	}
}

func TestPostgresUpdateReplacesLearningRecordWhenGiven(t *testing.T) {
	for name, replacement := range map[string]LearningRecord{
		"別の記録": {
			Notes:   []LearningNote{{ID: "note-9", Target: "余白", Reason: "読みやすくする", CreatedAt: "2026-10-01T09:00:00Z"}},
			AIUsage: []AIUsage{},
		},
		// 記録をすべて消した状態で保存したときは、空の記録で置き換える。残すのは送らなかったときだけ。
		"空の記録": emptyLearningRecord(),
	} {
		t.Run(name, func(t *testing.T) {
			repository := newTestRepository(t)
			created := mustCreate(t, repository, "user_1", titledSite("最初の内容"), testLearningRecord())

			updated, err := repository.Update(context.Background(), "user_1", created.ID, titledSite("最初の内容"), &replacement, version(1))

			if err != nil {
				t.Fatalf("update project: %v", err)
			}
			if !reflect.DeepEqual(updated.Learning, replacement) {
				t.Errorf("expected the update to return the new learning record, got %+v", updated.Learning)
			}
			if restored := mustGet(t, repository, "user_1", created.ID); !reflect.DeepEqual(restored.Learning, replacement) {
				t.Errorf("expected the new learning record to be stored, got %+v", restored.Learning)
			}
		})
	}
}

// 競合で断った保存は、学習記録も書き換えない。
func TestPostgresUpdateKeepsLearningRecordWhenRejectedAsStale(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()
	learning := testLearningRecord()
	created := mustCreate(t, repository, "user_1", titledSite("最初の内容"), learning)
	if _, err := repository.Update(ctx, "user_1", created.ID, titledSite("タブAの内容"), nil, version(1)); err != nil {
		t.Fatalf("first update: %v", err)
	}
	stale := emptyLearningRecord()

	_, err := repository.Update(ctx, "user_1", created.ID, titledSite("タブBの古い内容"), &stale, version(1))

	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected a conflict, got %v", err)
	}
	if restored := mustGet(t, repository, "user_1", created.ID); !reflect.DeepEqual(restored.Learning, learning) {
		t.Fatalf("expected the stored learning record to stay untouched, got %+v", restored.Learning)
	}
}

// 一覧は選択用の見出しを出すだけなので、画像と学習記録を運ばない。読み込み(Get)では両方とも戻る。
func TestPostgresListOmitsImagesAndLearningRecords(t *testing.T) {
	repository := newTestRepository(t)
	model := illustratedSite("写真部の紹介")
	created := mustCreate(t, repository, "user_1", model, testLearningRecord())

	records, err := repository.List(context.Background(), "user_1")

	if err != nil {
		t.Fatalf("list projects: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected one project, got %d", len(records))
	}
	withoutImages := illustratedSite("写真部の紹介")
	withoutImages.ID = model.ID
	for index := range withoutImages.Sections {
		withoutImages.Sections[index].Image = nil
	}
	// 画像のほかは、セクションの並びも含めて保存したままの形で返す。
	if !reflect.DeepEqual(records[0].Site, withoutImages) {
		t.Errorf("expected the site without images, got %+v", records[0].Site)
	}
	if !reflect.DeepEqual(records[0].Learning, emptyLearningRecord()) {
		t.Errorf("expected an empty learning record in the list, got %+v", records[0].Learning)
	}
	if records[0].ID != created.ID || records[0].Version != 1 {
		t.Errorf("expected project %s at version 1, got %s at version %d", created.ID, records[0].ID, records[0].Version)
	}
	if restored := mustGet(t, repository, "user_1", created.ID); !reflect.DeepEqual(restored.Site, model) {
		t.Errorf("expected the stored site to keep its images, got %+v", restored.Site)
	}
}

func TestPostgresListReturnsOnlyOwnersProjectsNewestFirst(t *testing.T) {
	repository, pool := newTestRepositoryWithPool(t)
	ctx := context.Background()
	oldest := mustCreate(t, repository, "user_1", titledSite("いちばん古い"), LearningRecord{})
	newest := mustCreate(t, repository, "user_1", titledSite("いちばん新しい"), LearningRecord{})
	middle := mustCreate(t, repository, "user_1", titledSite("その間"), LearningRecord{})
	mustCreate(t, repository, "user_2", titledSite("他人の作品"), LearningRecord{})
	// 続けて保存すると更新日時が同じになりうるため、並びを確かめられるよう日時を決めておく。
	for projectID, age := range map[string]string{oldest.ID: "3 hours", middle.ID: "2 hours", newest.ID: "1 hour"} {
		if _, err := pool.Exec(ctx, `UPDATE projects SET updated_at = NOW() - ($2::text)::interval WHERE id = $1`, projectID, age); err != nil {
			t.Fatalf("set updated_at: %v", err)
		}
	}

	records, err := repository.List(ctx, "user_1")

	if err != nil {
		t.Fatalf("list projects: %v", err)
	}
	listed := make([]string, 0, len(records))
	for _, record := range records {
		listed = append(listed, record.Site.SiteTitle)
	}
	if expected := []string{"いちばん新しい", "その間", "いちばん古い"}; !reflect.DeepEqual(listed, expected) {
		t.Fatalf("expected %v, got %v", expected, listed)
	}

	// 上書き保存した作品は、先頭へ移る。
	if _, err := repository.Update(ctx, "user_1", oldest.ID, titledSite("いちばん古い"), nil, nil); err != nil {
		t.Fatalf("update project: %v", err)
	}
	records, err = repository.List(ctx, "user_1")
	if err != nil {
		t.Fatalf("list projects after update: %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("expected three projects after the update, got %d", len(records))
	}
	if records[0].ID != oldest.ID {
		t.Fatalf("expected the updated project first, got %q", records[0].Site.SiteTitle)
	}

	if strangers, err := repository.List(ctx, "user_3"); err != nil || len(strangers) != 0 {
		t.Fatalf("expected an empty list for an owner without projects, got %d projects and error %v", len(strangers), err)
	}
}

func TestPostgresListStopsAtLimit(t *testing.T) {
	repository, pool := newTestRepositoryWithPool(t)
	ctx := context.Background()
	oldest := mustCreate(t, repository, "user_1", titledSite("あふれる作品"), LearningRecord{})
	if _, err := pool.Exec(ctx, `UPDATE projects SET updated_at = NOW() - INTERVAL '1 day' WHERE id = $1`, oldest.ID); err != nil {
		t.Fatalf("set updated_at: %v", err)
	}
	for index := range ListLimit {
		mustCreate(t, repository, "user_1", titledSite(fmt.Sprintf("作品%d", index)), LearningRecord{})
	}

	records, err := repository.List(ctx, "user_1")

	if err != nil {
		t.Fatalf("list projects: %v", err)
	}
	if len(records) != ListLimit {
		t.Fatalf("expected %d projects, got %d", ListLimit, len(records))
	}
	for _, record := range records {
		if record.ID == oldest.ID {
			t.Fatal("expected the oldest project to fall outside the list")
		}
	}
}

// 他人のプロジェクトは、存在しないものと同じ扱いにする。あることを所有者以外へ漏らさない。
func TestPostgresGetAndDeleteReturnNotFoundForOtherOwnerOrMissingProject(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()
	created := mustCreate(t, repository, "user_1", titledSite("最初の内容"), testLearningRecord())

	for name, target := range map[string]struct {
		ownerID   string
		projectID string
	}{
		"他人":    {"user_2", created.ID},
		"存在しない": {"user_1", missingProjectID},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := repository.Get(ctx, target.ownerID, target.projectID); !errors.Is(err, ErrNotFound) {
				t.Errorf("get: expected ErrNotFound, got %v", err)
			}
			if err := repository.Delete(ctx, target.ownerID, target.projectID); !errors.Is(err, ErrNotFound) {
				t.Errorf("delete: expected ErrNotFound, got %v", err)
			}
		})
	}

	if restored := mustGet(t, repository, "user_1", created.ID); restored.Version != 1 {
		t.Fatalf("expected the owner's project to stay untouched, got version %d", restored.Version)
	}
}

func TestPostgresDeleteRemovesProjectWithQualityResults(t *testing.T) {
	repository, pool := newTestRepositoryWithPool(t)
	ctx := context.Background()
	target := mustCreate(t, repository, "user_1", titledSite("消す作品"), testLearningRecord())
	kept := mustCreate(t, repository, "user_1", titledSite("残す作品"), LearningRecord{})
	for _, projectID := range []string{target.ID, kept.ID} {
		if _, err := repository.SaveQualityResults(ctx, "user_1", projectID, []QualityResultInput{{CheckKey: "alt", Passed: true, Detail: "確認"}}); err != nil {
			t.Fatalf("save quality results: %v", err)
		}
	}

	if err := repository.Delete(ctx, "user_1", target.ID); err != nil {
		t.Fatalf("delete project: %v", err)
	}

	if _, err := repository.Get(ctx, "user_1", target.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected the deleted project to be gone, got %v", err)
	}
	if remaining := countRows(t, pool, `SELECT COUNT(*) FROM quality_results WHERE project_id = $1`, target.ID); remaining != 0 {
		t.Errorf("expected the deleted project's quality results to be gone, got %d", remaining)
	}
	if err := repository.Delete(ctx, "user_1", target.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("expected deleting twice to report not found, got %v", err)
	}
	if results, err := repository.ListQualityResults(ctx, "user_1", kept.ID); err != nil || len(results) != 1 {
		t.Errorf("expected the other project to keep its quality result, got %d results and error %v", len(results), err)
	}
}

func TestPostgresQualityResultsRoundTrip(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()
	created := mustCreate(t, repository, "user_1", titledSite("最初の内容"), LearningRecord{})
	inputs := []QualityResultInput{
		{CheckKey: "headings", Passed: true, Detail: "見出しの順序が正しく並んでいます。"},
		{CheckKey: "alt", Passed: false, Detail: `代替テキストが無い画像が1件あります（<img src="about.jpg">）。`},
		{CheckKey: "mobile", Passed: true, Detail: "モバイル表示に対応しています。"},
		{CheckKey: "axe", Passed: false, Detail: "コントラストの不足が2件あります。"},
	}

	saved, err := repository.SaveQualityResults(ctx, "user_1", created.ID, inputs)

	if err != nil {
		t.Fatalf("save quality results: %v", err)
	}
	if len(saved) != len(inputs) {
		t.Fatalf("expected %d saved results, got %d", len(inputs), len(saved))
	}
	for index, result := range saved {
		if got := (QualityResultInput{CheckKey: result.CheckKey, Passed: result.Passed, Detail: result.Detail}); got != inputs[index] {
			t.Errorf("result %d: expected %+v, got %+v", index, inputs[index], got)
		}
		if result.ID == "" || result.ProjectID != created.ID || result.CheckedAt.IsZero() {
			t.Errorf("result %d: expected an id, project %s and a timestamp, got %+v", index, created.ID, result)
		}
	}

	listed, err := repository.ListQualityResults(ctx, "user_1", created.ID)
	if err != nil {
		t.Fatalf("list quality results: %v", err)
	}
	if len(listed) != len(saved) {
		t.Fatalf("expected %d listed results, got %d", len(saved), len(listed))
	}
	savedByID := make(map[string]QualityResult, len(saved))
	for _, result := range saved {
		savedByID[result.ID] = result
	}
	for _, result := range listed {
		expected, exists := savedByID[result.ID]
		if !exists || expected.CheckKey != result.CheckKey || expected.Passed != result.Passed || expected.Detail != result.Detail || !expected.CheckedAt.Equal(result.CheckedAt) {
			t.Errorf("expected the listed result to match what was saved, got %+v", result)
		}
	}
}

// 一覧は、所有者を確かめたあとにプロジェクトで絞り込む。絞り込みが外れると、
// 自分のプロジェクトを指定しただけで、他人やほかの作品の結果まで返してしまう。
func TestPostgresListQualityResultsReturnsOnlyTheProjectsOwnResults(t *testing.T) {
	repository := newTestRepository(t)
	ctx := context.Background()
	projects := map[string]struct {
		ownerID string
		input   QualityResultInput
	}{}
	for _, target := range []struct {
		ownerID string
		input   QualityResultInput
	}{
		{"user_1", QualityResultInput{CheckKey: "alt", Passed: false, Detail: "利用者1の1つ目の作品の結果"}},
		{"user_1", QualityResultInput{CheckKey: "alt", Passed: true, Detail: "利用者1の2つ目の作品の結果"}},
		{"user_2", QualityResultInput{CheckKey: "alt", Passed: true, Detail: "利用者2の作品の結果"}},
	} {
		created := mustCreate(t, repository, target.ownerID, titledSite("最初の内容"), LearningRecord{})
		if _, err := repository.SaveQualityResults(ctx, target.ownerID, created.ID, []QualityResultInput{target.input}); err != nil {
			t.Fatalf("save quality results: %v", err)
		}
		projects[created.ID] = target
	}

	for projectID, target := range projects {
		results, err := repository.ListQualityResults(ctx, target.ownerID, projectID)
		if err != nil {
			t.Fatalf("list quality results: %v", err)
		}
		if len(results) != 1 {
			t.Errorf("%s: expected only the project's own result, got %+v", target.input.Detail, results)
			continue
		}
		if got := (QualityResultInput{CheckKey: results[0].CheckKey, Passed: results[0].Passed, Detail: results[0].Detail}); got != target.input || results[0].ProjectID != projectID {
			t.Errorf("%s: expected the project's own result, got %+v", target.input.Detail, results[0])
		}
	}
}

func TestPostgresQualityResultsReturnNotFoundForOtherOwnerOrMissingProject(t *testing.T) {
	repository, pool := newTestRepositoryWithPool(t)
	ctx := context.Background()
	created := mustCreate(t, repository, "user_1", titledSite("最初の内容"), LearningRecord{})
	inputs := []QualityResultInput{{CheckKey: "alt", Passed: true, Detail: "確認"}}

	for name, target := range map[string]struct {
		ownerID   string
		projectID string
	}{
		"他人":    {"user_2", created.ID},
		"存在しない": {"user_1", missingProjectID},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := repository.SaveQualityResults(ctx, target.ownerID, target.projectID, inputs); !errors.Is(err, ErrNotFound) {
				t.Errorf("save: expected ErrNotFound, got %v", err)
			}
			if _, err := repository.ListQualityResults(ctx, target.ownerID, target.projectID); !errors.Is(err, ErrNotFound) {
				t.Errorf("list: expected ErrNotFound, got %v", err)
			}
		})
	}

	if stored := countRows(t, pool, `SELECT COUNT(*) FROM quality_results`); stored != 0 {
		t.Fatalf("expected nothing to be saved, got %d results", stored)
	}
}

// 1回の保存は、すべて入るか、まったく入らないかのどちらかにする。
// 途中まで入ると、検査の一部だけが新しい結果として残る。
func TestPostgresSaveQualityResultsSavesNothingWhenOneIsRejected(t *testing.T) {
	repository, pool := newTestRepositoryWithPool(t)
	created := mustCreate(t, repository, "user_1", titledSite("最初の内容"), LearningRecord{})

	_, err := repository.SaveQualityResults(context.Background(), "user_1", created.ID, []QualityResultInput{
		{CheckKey: "alt", Passed: true, Detail: "確認"},
		{CheckKey: "unknown", Passed: true, Detail: "テーブルの制約で断られる検査名"},
	})

	if err == nil || errors.Is(err, ErrNotFound) {
		t.Fatalf("expected the database to reject the unknown check key, got %v", err)
	}
	if stored := countRows(t, pool, `SELECT COUNT(*) FROM quality_results`); stored != 0 {
		t.Fatalf("expected nothing to be saved, got %d results", stored)
	}
}

// 学習記録の列を足す前に保存された作品も、空の記録を持つものとして読み込める。
func TestPostgresReadsProjectSavedBeforeLearningRecordMigration(t *testing.T) {
	pool := testdb.NewEmptyPool(t)
	ctx := context.Background()
	migrations := testdb.Migrations(t)
	testdb.ApplyMigration(t, pool, migrations[0])
	model := illustratedSite("以前の版で保存した作品")
	siteJSON, err := json.Marshal(model)
	if err != nil {
		t.Fatalf("marshal site: %v", err)
	}
	var projectID string
	if err := pool.QueryRow(
		ctx,
		`INSERT INTO projects (clerk_user_id, title, topic, site_model) VALUES ($1, $2, $3, $4) RETURNING id`,
		"user_1", model.SiteTitle, model.Topic, siteJSON,
	).Scan(&projectID); err != nil {
		t.Fatalf("insert project before the migration: %v", err)
	}

	for _, path := range migrations[1:] {
		testdb.ApplyMigration(t, pool, path)
	}

	repository := NewPostgresRepository(pool)
	restored := mustGet(t, repository, "user_1", projectID)
	if !reflect.DeepEqual(restored.Site, model) || !reflect.DeepEqual(restored.Learning, emptyLearningRecord()) {
		t.Fatalf("expected the site with an empty learning record, got %+v", restored)
	}
	learning := testLearningRecord()
	updated, err := repository.Update(ctx, "user_1", projectID, model, &learning, version(1))
	if err != nil || !reflect.DeepEqual(updated.Learning, learning) {
		t.Fatalf("expected the project to accept a learning record after the migration, got %+v and error %v", updated.Learning, err)
	}
}
