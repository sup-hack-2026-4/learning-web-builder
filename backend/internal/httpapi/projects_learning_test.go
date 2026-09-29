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

const learningProjectID = "11111111-1111-1111-1111-111111111111"

func lines(values ...string) *[]string {
	return &values
}

func sampleLearningRecord() projectpkg.LearningRecord {
	return projectpkg.LearningRecord{
		Notes: []projectpkg.LearningNote{
			{
				ID:          "note-1",
				Target:      "デザイン変更（メインカラーを #b91c1c に）",
				Reason:      "写真部の作品が映えるよう、落ち着いた赤にした",
				CreatedAt:   "2026-09-29T01:02:03.456Z",
				CodeChanges: lines("--primary: #b91c1c;", `<h2 class="section-title">活動紹介</h2>`),
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

// rawLearningRequestBody は、notes と aiUsage の部分を与えたJSONのまま組み立てる。
// 省略・null・エスケープの書き方など、エンコーダーを通すと作れない形を試すために使う。
func rawLearningRequestBody(t *testing.T, model site.Model, learningFields string) *strings.Reader {
	t.Helper()
	siteJSON, err := json.Marshal(model)
	if err != nil {
		t.Fatalf("marshal site: %v", err)
	}
	return strings.NewReader(`{"site":` + string(siteJSON) + learningFields + `}`)
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

func learningRepository(model site.Model, record projectpkg.LearningRecord) *stubProjectRepository {
	now := time.Date(2026, time.September, 29, 12, 0, 0, 0, time.UTC)
	return &stubProjectRepository{
		record: projectpkg.Record{
			ID:        learningProjectID,
			OwnerID:   "user_123",
			Site:      model,
			Learning:  record,
			Version:   1,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
}

func TestSaveProjectKeepsLearningRecordWithSite(t *testing.T) {
	// 保存→読み込みで学習メモ・変更コード・AI利用記録が失われると、
	// 提出物ZIPから学習の成果が抜け落ちる(#114)。
	model := site.Sample("学校の写真部")
	record := sampleLearningRecord()

	for _, testCase := range []struct {
		name   string
		method string
		path   string
		status int
	}{
		{name: "新規保存", method: http.MethodPost, path: "/api/v1/projects", status: http.StatusCreated},
		{name: "上書き保存", method: http.MethodPut, path: "/api/v1/projects/" + learningProjectID, status: http.StatusOK},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			repository := learningRepository(model, record)
			request := httptest.NewRequest(testCase.method, testCase.path, learningRequestBody(t, model, record))
			response := serveProjects(repository, request)

			if response.Code != testCase.status {
				t.Fatalf("expected %d, got %d: %s", testCase.status, response.Code, response.Body.String())
			}
			if repository.learning == nil || !reflect.DeepEqual(*repository.learning, record) {
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

func TestSaveProjectKeepsEmptyCodeChangesAsEmptyList(t *testing.T) {
	// 空の一覧を送ったら、省略に変わらず空の一覧のまま往復する。
	model := site.Sample("学校の写真部")
	record := sampleLearningRecord()
	record.Notes[0].CodeChanges = &[]string{}
	repository := learningRepository(model, record)
	response := serveProjects(repository, httptest.NewRequest(http.MethodPost, "/api/v1/projects", learningRequestBody(t, model, record)))

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	saved := repository.learning.Notes
	if saved[0].CodeChanges == nil || len(*saved[0].CodeChanges) != 0 {
		t.Fatalf("expected empty codeChanges to stay empty, got %+v", saved[0].CodeChanges)
	}
	if saved[1].CodeChanges != nil {
		t.Fatalf("expected omitted codeChanges to stay omitted, got %+v", saved[1].CodeChanges)
	}
	if !strings.Contains(response.Body.String(), `"codeChanges":[]`) {
		t.Fatalf("expected empty codeChanges in response, got %s", response.Body.String())
	}
	encoded, err := projectpkg.MarshalLearningRecord(record)
	if err != nil {
		t.Fatalf("marshal learning record: %v", err)
	}
	var stored projectpkg.LearningRecord
	if err := json.Unmarshal(encoded, &stored); err != nil {
		t.Fatalf("decode stored learning record: %v", err)
	}
	if !reflect.DeepEqual(stored, record) {
		t.Fatalf("expected stored JSON to round-trip, got %s", encoded)
	}
}

func TestCreateProjectTreatsMissingLearningRecordAsEmpty(t *testing.T) {
	// 記録を送らない以前の画面からでも、作品だけは保存できるようにする。
	model := site.Sample("学校の写真部")
	for name, fields := range map[string]string{
		"省略":   "",
		"null": `,"notes":null,"aiUsage":null`,
	} {
		t.Run(name, func(t *testing.T) {
			repository := learningRepository(model, projectpkg.LearningRecord{})
			response := serveProjects(repository, httptest.NewRequest(http.MethodPost, "/api/v1/projects", rawLearningRequestBody(t, model, fields)))

			if response.Code != http.StatusCreated {
				t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
			}
			if repository.learning == nil || repository.learning.Notes == nil || repository.learning.AIUsage == nil ||
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

func TestUpdateProjectKeepsStoredLearningRecordWhenOmitted(t *testing.T) {
	// 開いたままの以前の画面から作品だけを上書き保存しても、保存済みの記録を消さない。
	model := site.Sample("学校の写真部")
	stored := sampleLearningRecord()
	for name, fields := range map[string]string{
		"省略":   "",
		"null": `,"notes":null,"aiUsage":null`,
	} {
		t.Run(name, func(t *testing.T) {
			repository := learningRepository(model, stored)
			response := serveProjects(repository, httptest.NewRequest(http.MethodPut, "/api/v1/projects/"+learningProjectID, rawLearningRequestBody(t, model, fields)))

			if response.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
			}
			if repository.learning != nil {
				t.Fatalf("expected repository to keep stored learning record, got %+v", repository.learning)
			}
			body := decodeProjectDetail(t, response)
			if body.Notes == nil || !reflect.DeepEqual(*body.Notes, stored.Notes) {
				t.Fatalf("expected stored notes in response, got %s", response.Body.String())
			}
		})
	}
}

func TestUpdateProjectReplacesLearningRecordWhenEitherListIsSent(t *testing.T) {
	// 明示的な空の一覧は「記録を空にする」という指定として扱う。
	model := site.Sample("学校の写真部")
	for name, fields := range map[string]string{
		"両方とも空":      `,"notes":[],"aiUsage":[]`,
		"notesだけ空":   `,"notes":[]`,
		"aiUsageだけ空": `,"aiUsage":[]`,
	} {
		t.Run(name, func(t *testing.T) {
			repository := learningRepository(model, projectpkg.LearningRecord{})
			response := serveProjects(repository, httptest.NewRequest(http.MethodPut, "/api/v1/projects/"+learningProjectID, rawLearningRequestBody(t, model, fields)))

			if response.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
			}
			if repository.learning == nil || len(repository.learning.Notes) != 0 || len(repository.learning.AIUsage) != 0 {
				t.Fatalf("expected learning record to be replaced with empty lists, got %+v", repository.learning)
			}
		})
	}
}

func TestGetProjectReturnsLearningRecord(t *testing.T) {
	model := site.Sample("学校の写真部")
	record := sampleLearningRecord()
	repository := learningRepository(model, record)
	response := serveProjects(repository, httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+learningProjectID, nil))

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
		records: []projectpkg.Record{{ID: learningProjectID, OwnerID: "user_123", Site: model, Version: 1}},
	}
	response := serveProjects(repository, httptest.NewRequest(http.MethodGet, "/api/v1/projects", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"notes"`) || strings.Contains(response.Body.String(), `"aiUsage"`) {
		t.Fatalf("expected list to omit learning record, got %s", response.Body.String())
	}
}

func TestSaveProjectAcceptsLongGeneratedCodeLine(t *testing.T) {
	// 本文(800文字)の & はHTMLで &amp; になり、変更行は本文の上限より長くなる。
	// 通常の編集で作られた記録が保存できなくならないことを確かめる。
	model := site.Sample("学校の写真部")
	record := sampleLearningRecord()
	record.Notes[0].CodeChanges = lines("+ <p>" + strings.Repeat("&amp;", 800) + "</p>")
	repository := learningRepository(model, record)
	response := serveProjects(repository, httptest.NewRequest(http.MethodPost, "/api/v1/projects", learningRequestBody(t, model, record)))

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
}

func TestSaveProjectMeasuresLearningRecordAsReceived(t *testing.T) {
	// 大きさは受け取ったJSONのまま数える。サーバーでエンコードし直すと
	// U+2028 が6バイトのエスケープ表記になり、画面側(JSON.stringifyでは3バイト)と数え方がずれる。
	model := site.Sample("学校の写真部")
	lineSeparator := string(rune(0x2028))
	line := strings.Repeat(lineSeparator, 2000)
	codeLines := make([]string, 30)
	for index := range codeLines {
		codeLines[index] = line
	}
	notes, err := json.Marshal([]map[string]any{{
		"id": "note-1", "target": "内容変更", "reason": "理由", "createdAt": "2026-09-29T01:00:00Z", "codeChanges": codeLines,
	}})
	if err != nil {
		t.Fatalf("marshal notes: %v", err)
	}
	// Goのエンコーダーは U+2028 をエスケープするため、画面と同じ生の文字へ戻して送る。
	rawNotes := strings.ReplaceAll(string(notes), `\u2028`, lineSeparator)
	if len(rawNotes) > projectpkg.MaxLearningRecordBytes || len(notes) <= projectpkg.MaxLearningRecordBytes {
		t.Fatalf("test data must fit only when measured as received: raw=%d escaped=%d", len(rawNotes), len(notes))
	}
	repository := learningRepository(model, projectpkg.LearningRecord{})
	response := serveProjects(repository, httptest.NewRequest(http.MethodPost, "/api/v1/projects", rawLearningRequestBody(t, model, `,"notes":`+rawNotes)))

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
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
		{name: "日時に秒が無い", mutate: func(record *projectpkg.LearningRecord) { record.Notes[0].CreatedAt = "2026-09-29T01:02Z" }},
		{name: "理由が長すぎる", mutate: func(record *projectpkg.LearningRecord) {
			record.Notes[0].Reason = strings.Repeat("あ", projectpkg.MaxLearningReasonLength+1)
		}},
		{name: "変更行が長すぎる", mutate: func(record *projectpkg.LearningRecord) {
			record.Notes[0].CodeChanges = lines(strings.Repeat("x", projectpkg.MaxLearningCodeLineLength+1))
		}},
		{name: "変更行が多すぎる", mutate: func(record *projectpkg.LearningRecord) {
			tooMany := make([]string, projectpkg.MaxLearningCodeChanges+1)
			record.Notes[0].CodeChanges = &tooMany
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
			for index := range record.Notes {
				record.Notes[index].Reason = strings.Repeat("x", projectpkg.MaxLearningReasonLength)
			}
			for len(record.Notes) < 40 {
				record.Notes = append(record.Notes, record.Notes[0])
			}
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
	repository := &stubProjectRepository{}
	fields := `,"notes":[{"id":"note-1","target":"コンセプト","reason":"理由","createdAt":"2026-09-29T01:00:00Z","score":10}]`
	response := serveProjects(repository, httptest.NewRequest(http.MethodPost, "/api/v1/projects", rawLearningRequestBody(t, model, fields)))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
	if repository.ownerID != "" {
		t.Fatalf("expected request with unknown field not to be saved")
	}
}
