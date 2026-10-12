package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
	projectpkg "github.com/haru-yoshi-5/learning-web-builder/backend/internal/project"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/testdb"
)

// 保存APIを、リクエストの検証から実際のPostgreSQLまで通して確かめる(#119)。
// ほかのテストはリポジトリをスタブに差し替えているため、APIとSQLのつなぎ目の食い違いを見つけられない。
// 認証はスタブのまま。トークンの検証は internal/auth のテストで確かめている。
//
// データベースの用意のしかたと、手元での実行方法は internal/testdb を参照。

// persistedAPI は、実際のPostgreSQLに保存するAPIを、指定した利用者として呼び出す。
type persistedAPI struct {
	t          *testing.T
	repository projectpkg.Repository
}

func newPersistedAPI(t *testing.T) persistedAPI {
	t.Helper()
	return persistedAPI{t: t, repository: projectpkg.NewPostgresRepository(testdb.NewPool(t))}
}

// call は userID の利用者としてAPIを呼ぶ。userID が空なら未ログインとして呼ぶ。
func (api persistedAPI) call(userID, method, path string, body any) *httptest.ResponseRecorder {
	api.t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			api.t.Fatalf("marshal request body: %v", err)
		}
		reader = strings.NewReader(string(encoded))
	}
	config := Config{Projects: api.repository}
	if userID != "" {
		config.Authenticator = stubAuthenticator{identity: authn.Identity{UserID: userID}}
	}
	response := httptest.NewRecorder()
	NewRouter(config).ServeHTTP(response, httptest.NewRequest(method, "/api/v1"+path, reader))
	return response
}

func (api persistedAPI) expect(response *httptest.ResponseRecorder, status int) {
	api.t.Helper()
	if response.Code != status {
		api.t.Fatalf("expected %d, got %d: %s", status, response.Code, response.Body.String())
	}
}

type persistedProject struct {
	ID      string                     `json:"id"`
	Site    site.Model                 `json:"site"`
	Notes   *[]projectpkg.LearningNote `json:"notes"`
	AIUsage *[]projectpkg.AIUsage      `json:"aiUsage"`
	Version int                        `json:"version"`
}

func (api persistedAPI) project(response *httptest.ResponseRecorder, status int) persistedProject {
	api.t.Helper()
	api.expect(response, status)
	var body persistedProject
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		api.t.Fatalf("decode project response: %v", err)
	}
	return body
}

func (api persistedAPI) projects(userID string) []persistedProject {
	api.t.Helper()
	response := api.call(userID, http.MethodGet, "/projects", nil)
	api.expect(response, http.StatusOK)
	var body struct {
		Projects []persistedProject `json:"projects"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		api.t.Fatalf("decode project list: %v", err)
	}
	return body.Projects
}

func (api persistedAPI) qualityResults(userID, projectID string) []qualityResultResponse {
	api.t.Helper()
	response := api.call(userID, http.MethodGet, "/projects/"+projectID+"/quality-results", nil)
	api.expect(response, http.StatusOK)
	var body qualityResultListResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		api.t.Fatalf("decode quality results: %v", err)
	}
	return body.Results
}

// illustratedSite は、画像と見出しの色を持つ作品を返す。どちらも任意項目で、保存先から戻るときに落ちやすい。
func illustratedSite() site.Model {
	model := site.Sample("学校の写真部")
	model.Theme.Heading = "#b91c1c"
	// JPEGの開始マーカーだけを持つ、検証を通る最小の画像。
	model.Sections[1].Image = &site.SectionImage{DataURI: "data:image/jpeg;base64,/9j/4AAQSkZJRg==", FileName: "about.jpg"}
	return model
}

func hasLearning(project persistedProject, record projectpkg.LearningRecord) bool {
	return project.Notes != nil && project.AIUsage != nil &&
		reflect.DeepEqual(*project.Notes, record.Notes) && reflect.DeepEqual(*project.AIUsage, record.AIUsage)
}

func TestPersistedProjectSurvivesSaveUpdateRestoreAndDelete(t *testing.T) {
	api := newPersistedAPI(t)
	model := illustratedSite()
	learning := sampleLearningRecord()

	// 保存
	created := api.project(api.call("user_1", http.MethodPost, "/projects", map[string]any{
		"site": model, "notes": learning.Notes, "aiUsage": learning.AIUsage,
	}), http.StatusCreated)
	if created.ID == "" || created.Version != 1 || !reflect.DeepEqual(created.Site, model) || !hasLearning(created, learning) {
		t.Fatalf("expected the saved project at version 1 with its learning record, got %+v", created)
	}
	projectPath := "/projects/" + created.ID

	// 一覧には、画像と学習記録を運ばない
	listed := api.projects("user_1")
	if len(listed) != 1 || listed[0].ID != created.ID || listed[0].Site.SiteTitle != model.SiteTitle {
		t.Fatalf("expected the saved project in the list, got %+v", listed)
	}
	if listed[0].Site.Sections[1].Image != nil || listed[0].Notes != nil || listed[0].AIUsage != nil {
		t.Fatalf("expected the list to leave out images and the learning record, got %+v", listed[0])
	}

	// 上書き保存。学習記録を送らなければ、保存済みの記録を残す
	changed := model
	changed.SiteTitle = "写真部の活動紹介"
	updated := api.project(api.call("user_1", http.MethodPut, projectPath, map[string]any{
		"site": changed, "baseVersion": 1,
	}), http.StatusOK)
	if updated.Version != 2 || updated.Site.SiteTitle != "写真部の活動紹介" || !hasLearning(updated, learning) {
		t.Fatalf("expected version 2 with the new title and the stored learning record, got %+v", updated)
	}

	// 読み込んだあとに別の場所で保存されていたら、保存せずに断る
	stale := model
	stale.SiteTitle = "別のタブの古い内容"
	conflict := api.call("user_1", http.MethodPut, projectPath, map[string]any{
		"site": stale, "notes": []projectpkg.LearningNote{}, "baseVersion": 1,
	})
	api.expect(conflict, http.StatusConflict)
	var conflictBody projectConflictResponse
	if err := json.Unmarshal(conflict.Body.Bytes(), &conflictBody); err != nil || conflictBody.CurrentVersion != 2 {
		t.Fatalf("expected the current version 2 in the conflict, got %s", conflict.Body.String())
	}

	// 復元
	restored := api.project(api.call("user_1", http.MethodGet, projectPath, nil), http.StatusOK)
	if restored.Version != 2 || !reflect.DeepEqual(restored.Site, changed) || !hasLearning(restored, learning) {
		t.Fatalf("expected the last saved project with its image and learning record, got %+v", restored)
	}

	// 品質チェック結果
	api.expect(api.call("user_1", http.MethodPost, projectPath+"/quality-results", map[string]any{
		"results": []map[string]any{{"checkKey": "alt", "passed": false, "detail": "代替テキストが無い画像が1件あります。"}},
	}), http.StatusCreated)
	results := api.qualityResults("user_1", created.ID)
	if len(results) != 1 || results[0].CheckKey != "alt" || results[0].Passed || results[0].Detail != "代替テキストが無い画像が1件あります。" || results[0].ProjectID != created.ID {
		t.Fatalf("expected the saved quality result, got %+v", results)
	}

	// 削除
	api.expect(api.call("user_1", http.MethodDelete, projectPath, nil), http.StatusNoContent)
	api.expect(api.call("user_1", http.MethodGet, projectPath, nil), http.StatusNotFound)
	api.expect(api.call("user_1", http.MethodGet, projectPath+"/quality-results", nil), http.StatusNotFound)
	api.expect(api.call("user_1", http.MethodDelete, projectPath, nil), http.StatusNotFound)
	if remaining := api.projects("user_1"); len(remaining) != 0 {
		t.Fatalf("expected an empty list after deleting, got %+v", remaining)
	}
}

// 他人のプロジェクトは、どの操作でも存在しないものと同じ扱いにし、中身を変えない。
// 未ログインでは、プロジェクトがあっても認証を先に求める。
func TestPersistedProjectIsHiddenFromOtherOwnersAndGuests(t *testing.T) {
	api := newPersistedAPI(t)
	model := illustratedSite()
	learning := sampleLearningRecord()
	created := api.project(api.call("user_1", http.MethodPost, "/projects", map[string]any{
		"site": model, "notes": learning.Notes, "aiUsage": learning.AIUsage,
	}), http.StatusCreated)
	projectPath := "/projects/" + created.ID
	overwrite := map[string]any{"site": site.Sample("他人が書き換えた内容"), "notes": []projectpkg.LearningNote{}}
	quality := map[string]any{
		"results": []map[string]any{{"checkKey": "alt", "passed": true, "detail": "確認"}},
	}

	for _, visitor := range []struct {
		name   string
		userID string
		status int
	}{
		{name: "他人", userID: "user_2", status: http.StatusNotFound},
		{name: "未ログイン", userID: "", status: http.StatusUnauthorized},
	} {
		t.Run(visitor.name, func(t *testing.T) {
			for _, attempt := range []struct {
				method string
				path   string
				body   any
			}{
				{http.MethodGet, projectPath, nil},
				{http.MethodPut, projectPath, overwrite},
				{http.MethodPost, projectPath + "/quality-results", quality},
				{http.MethodGet, projectPath + "/quality-results", nil},
				{http.MethodDelete, projectPath, nil},
			} {
				response := api.call(visitor.userID, attempt.method, attempt.path, attempt.body)
				if response.Code != visitor.status {
					t.Errorf("%s %s: expected %d, got %d: %s", attempt.method, attempt.path, visitor.status, response.Code, response.Body.String())
				}
			}
		})
	}

	if listed := api.projects("user_2"); len(listed) != 0 {
		t.Errorf("expected another owner's list to stay empty, got %+v", listed)
	}
	api.expect(api.call("", http.MethodGet, "/projects", nil), http.StatusUnauthorized)
	restored := api.project(api.call("user_1", http.MethodGet, projectPath, nil), http.StatusOK)
	if restored.Version != 1 || !reflect.DeepEqual(restored.Site, model) || !hasLearning(restored, learning) {
		t.Errorf("expected the owner's project to stay untouched, got %+v", restored)
	}
	if results := api.qualityResults("user_1", created.ID); len(results) != 0 {
		t.Errorf("expected no quality results from other visitors, got %+v", results)
	}
}

// APIが受け付ける検査名は、テーブルのCHECK制約と別々に書かれている。
// 片方だけに検査名を足すと、APIを通った保存がデータベースで断られて500になる。
func TestEveryAcceptedQualityCheckKeyIsStoredByTheDatabase(t *testing.T) {
	api := newPersistedAPI(t)
	created := api.project(api.call("user_1", http.MethodPost, "/projects", map[string]any{"site": site.Sample("学校の写真部")}), http.StatusCreated)

	for checkKey := range validQualityCheckKeys {
		response := api.call("user_1", http.MethodPost, "/projects/"+created.ID+"/quality-results", map[string]any{
			"results": []map[string]any{{"checkKey": checkKey, "passed": true, "detail": fmt.Sprintf("%sの確認", checkKey)}},
		})
		if response.Code != http.StatusCreated {
			t.Errorf("%s: expected 201, got %d: %s", checkKey, response.Code, response.Body.String())
		}
	}

	if results := api.qualityResults("user_1", created.ID); len(results) != len(validQualityCheckKeys) {
		t.Errorf("expected %d stored results, got %d", len(validQualityCheckKeys), len(results))
	}
}
