package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
	projectpkg "github.com/haru-yoshi-5/learning-web-builder/backend/internal/project"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

func sampleLearningRecord() projectpkg.LearningRecord {
	return projectpkg.LearningRecord{
		Notes: []projectpkg.LearningNote{
			{
				ID:          "note-1",
				Target:      "デザイン変更（メインカラーを #b91c1c に）",
				Reason:      "写真部の作品が映えるよう、落ち着いた赤にした",
				CreatedAt:   "2026-09-29T01:02:03.456Z",
				CodeChanges: []string{"--primary: #b91c1c;", `<h2 class="section-title">活動紹介</h2>`},
			},
			{
				ID:        "note-2",
				Target:    "コンセプト",
				Reason:    "新入生に活動の雰囲気を伝える",
				CreatedAt: "2026-09-29T01:00:00.000Z",
			},
		},
		AIUsage: []projectpkg.AIUsage{
			{Provider: "gemini", Purpose: "サイト構成と仮文章の生成", GeneratedAt: "2026-09-29T00:59:00.000Z"},
		},
	}
}

func learningRequestBody(t *testing.T, model site.Model, record projectpkg.LearningRecord) *strings.Reader {
	t.Helper()
	encoded, err := json.Marshal(map[string]any{"site": model, "notes": record.Notes, "aiUsage": record.AIUsage})
	if err != nil {
		t.Fatalf("marshal project request: %v", err)
	}
	return strings.NewReader(string(encoded))
}

type projectDetailBody struct {
	Notes   *[]projectpkg.LearningNote `json:"notes"`
	AIUsage *[]projectpkg.AIUsage      `json:"aiUsage"`
}

func decodeProjectDetail(t *testing.T, response *httptest.ResponseRecorder) projectDetailBody {
	t.Helper()
	var body projectDetailBody
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode project response: %v", err)
	}
	return body
}

func serveProjects(repository *stubProjectRepository, request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	NewRouter(Config{
		Authenticator: stubAuthenticator{identity: authn.Identity{UserID: "user_123"}},
		Projects:      repository,
	}).ServeHTTP(response, request)
	return response
}

func TestSaveProjectKeepsLearningRecordWithSite(t *testing.T) {
	// 保存→読み込みで学習メモ・変更コード・AI利用記録が失われると、
	// 提出物ZIPから学習の成果が抜け落ちる(#114)。
	model := site.Sample("学校の写真部")
	record := sampleLearningRecord()
	now := time.Date(2026, time.September, 29, 12, 0, 0, 0, time.UTC)

	for _, testCase := range []struct {
		name   string
		method string
		path   string
		status int
	}{
		{name: "新規保存", method: http.MethodPost, path: "/api/v1/projects", status: http.StatusCreated},
		{name: "上書き保存", method: http.MethodPut, path: "/api/v1/projects/11111111-1111-1111-1111-111111111111", status: http.StatusOK},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			repository := &stubProjectRepository{
				record: projectpkg.Record{
					ID:        "11111111-1111-1111-1111-111111111111",
					OwnerID:   "user_123",
					Site:      model,
					Learning:  record,
					Version:   1,
					CreatedAt: now,
					UpdatedAt: now,
				},
			}
			request := httptest.NewRequest(testCase.method, testCase.path, learningRequestBody(t, model, record))
			response := serveProjects(repository, request)

			if response.Code != testCase.status {
				t.Fatalf("expected %d, got %d: %s", testCase.status, response.Code, response.Body.String())
			}
			if !reflect.DeepEqual(repository.learning, record) {
				t.Fatalf("expected learning record to reach repository unchanged, got %+v", repository.learning)
			}
			body := decodeProjectDetail(t, response)
			if body.Notes == nil || !reflect.DeepEqual(*body.Notes, record.Notes) {
				t.Fatalf("expected notes in response, got %s", response.Body.String())
			}
			if body.AIUsage == nil || !reflect.DeepEqual(*body.AIUsage, record.AIUsage) {
				t.Fatalf("expected aiUsage in response, got %s", response.Body.String())
			}
		})
	}
}

func TestSaveProjectTreatsMissingLearningRecordAsEmpty(t *testing.T) {
	// 記録を送らない以前の画面からでも、作品だけは保存できるようにする。
	model := site.Sample("学校の写真部")
	for name, body := range map[string]string{
		"省略":   "",
		"null": `,"notes":null,"aiUsage":null`,
	} {
		t.Run(name, func(t *testing.T) {
			siteJSON, err := json.Marshal(model)
			if err != nil {
				t.Fatalf("marshal site: %v", err)
			}
			repository := &stubProjectRepository{
				record: projectpkg.Record{ID: "11111111-1111-1111-1111-111111111111", OwnerID: "user_123", Site: model, Version: 1},
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", strings.NewReader(`{"site":`+string(siteJSON)+body+`}`))
			response := serveProjects(repository, request)

			if response.Code != http.StatusCreated {
				t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
			}
			if repository.learning.Notes == nil || repository.learning.AIUsage == nil ||
				len(repository.learning.Notes) != 0 || len(repository.learning.AIUsage) != 0 {
				t.Fatalf("expected empty learning record, got %+v", repository.learning)
			}
			// 記録が空でも、応答では省略せず [] で返す。
			if !strings.Contains(response.Body.String(), `"notes":[]`) || !strings.Contains(response.Body.String(), `"aiUsage":[]`) {
				t.Fatalf("expected empty lists in response, got %s", response.Body.String())
			}
		})
	}
}

func TestGetProjectReturnsLearningRecord(t *testing.T) {
	model := site.Sample("学校の写真部")
	record := sampleLearningRecord()
	projectID := "11111111-1111-1111-1111-111111111111"
	repository := &stubProjectRepository{
		record: projectpkg.Record{ID: projectID, OwnerID: "user_123", Site: model, Learning: record, Version: 3},
	}
	response := serveProjects(repository, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+projectID, nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	body := decodeProjectDetail(t, response)
	if body.Notes == nil || !reflect.DeepEqual(*body.Notes, record.Notes) {
		t.Fatalf("expected stored notes, got %s", response.Body.String())
	}
	if body.AIUsage == nil || !reflect.DeepEqual(*body.AIUsage, record.AIUsage) {
		t.Fatalf("expected stored aiUsage, got %s", response.Body.String())
	}
}

func TestListProjectsOmitsLearningRecord(t *testing.T) {
	// 一覧は選択用の見出しを出すだけなので、記録は運ばない。
	model := site.Sample("学校の写真部")
	repository := &stubProjectRepository{
		records: []projectpkg.Record{{ID: "11111111-1111-1111-1111-111111111111", OwnerID: "user_123", Site: model, Version: 1}},
	}
	response := serveProjects(repository, httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"notes"`) || strings.Contains(response.Body.String(), `"aiUsage"`) {
		t.Fatalf("expected list to omit learning record, got %s", response.Body.String())
	}
}

func TestSaveProjectRejectsInvalidLearningRecord(t *testing.T) {
	model := site.Sample("学校の写真部")
	for _, testCase := range []struct {
		name   string
		mutate func(*projectpkg.LearningRecord)
	}{
		{name: "理由が空", mutate: func(record *projectpkg.LearningRecord) { record.Notes[0].Reason = "  " }},
		{name: "対象が空", mutate: func(record *projectpkg.LearningRecord) { record.Notes[0].Target = "" }},
		{name: "IDが空", mutate: func(record *projectpkg.LearningRecord) { record.Notes[0].ID = "" }},
		{name: "日時の形式が違う", mutate: func(record *projectpkg.LearningRecord) { record.Notes[0].CreatedAt = "昨日" }},
		{name: "理由が長すぎる", mutate: func(record *projectpkg.LearningRecord) {
			record.Notes[0].Reason = strings.Repeat("あ", projectpkg.MaxLearningReasonLength+1)
		}},
		{name: "変更行が多すぎる", mutate: func(record *projectpkg.LearningRecord) {
			record.Notes[0].CodeChanges = make([]string, projectpkg.MaxLearningCodeChanges+1)
		}},
		{name: "メモが多すぎる", mutate: func(record *projectpkg.LearningRecord) {
			for len(record.Notes) <= projectpkg.MaxLearningNotes {
				record.Notes = append(record.Notes, record.Notes[1])
			}
		}},
		{name: "AIの種類が不明", mutate: func(record *projectpkg.LearningRecord) { record.AIUsage[0].Provider = "other" }},
		{name: "AIの用途が空", mutate: func(record *projectpkg.LearningRecord) { record.AIUsage[0].Purpose = "" }},
		{name: "記録全体が大きすぎる", mutate: func(record *projectpkg.LearningRecord) {
			// 1件ずつは上限内でも、合計が上限を超える組み合わせ。
			line := strings.Repeat("x", projectpkg.MaxLearningCodeLineLength)
			lines := make([]string, projectpkg.MaxLearningCodeChanges)
			for index := range lines {
				lines[index] = line
			}
			record.Notes[0].CodeChanges = lines
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			record := sampleLearningRecord()
			testCase.mutate(&record)
			repository := &stubProjectRepository{}
			response := serveProjects(repository, httptest.NewRequest(http.MethodPost, "/api/v1/projects", learningRequestBody(t, model, record)))

			if response.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), "learning record is invalid") {
				t.Fatalf("expected learning record error, got %s", response.Body.String())
			}
			if repository.ownerID != "" {
				t.Fatalf("expected invalid learning record not to be saved")
			}
		})
	}
}

func TestSaveProjectRejectsUnknownLearningNoteField(t *testing.T) {
	model := site.Sample("学校の写真部")
	body := projectRequestMap(t, model)
	body["notes"] = []map[string]any{{
		"id": "note-1", "target": "コンセプト", "reason": "理由", "createdAt": "2026-09-29T01:00:00Z", "score": 10,
	}}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	repository := &stubProjectRepository{}
	response := serveProjects(repository, httptest.NewRequest(http.MethodPost, "/api/v1/projects", strings.NewReader(string(encoded))))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
	if repository.ownerID != "" {
		t.Fatalf("expected request with unknown field not to be saved")
	}
}
