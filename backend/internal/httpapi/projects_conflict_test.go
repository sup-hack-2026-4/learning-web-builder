package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	projectpkg "github.com/haru-yoshi-5/learning-web-builder/backend/internal/project"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

func updateProjectRequest(t *testing.T, model site.Model, fields string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodPut, "/api/v1/projects/"+learningProjectID, rawLearningRequestBody(t, model, fields))
}

func TestUpdateProjectPassesBaseVersionToRepository(t *testing.T) {
	model := site.Sample("学校の写真部")
	repository := learningRepository(model, projectpkg.LearningRecord{})

	response := serveProjects(repository, updateProjectRequest(t, model, `,"baseVersion":3`))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if repository.baseVersion == nil || *repository.baseVersion != 3 {
		t.Fatalf("expected base version 3 to reach repository, got %v", repository.baseVersion)
	}
}

// バージョンを送らない以前の画面からの保存は、確かめずに上書きする。
func TestUpdateProjectSkipsVersionCheckWhenBaseVersionIsOmitted(t *testing.T) {
	model := site.Sample("学校の写真部")
	for name, fields := range map[string]string{
		"省略":   ``,
		"null": `,"baseVersion":null`,
	} {
		t.Run(name, func(t *testing.T) {
			repository := learningRepository(model, projectpkg.LearningRecord{})

			response := serveProjects(repository, updateProjectRequest(t, model, fields))

			if response.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
			}
			if repository.baseVersion != nil {
				t.Fatalf("expected no base version, got %d", *repository.baseVersion)
			}
		})
	}
}

func TestUpdateProjectReturnsConflictWhenUpdatedElsewhere(t *testing.T) {
	model := site.Sample("学校の写真部")
	repository := &stubProjectRepository{err: &projectpkg.ConflictError{CurrentVersion: 5}}

	response := serveProjects(repository, updateProjectRequest(t, model, `,"baseVersion":3`))

	if response.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		Error          string `json:"error"`
		CurrentVersion int    `json:"currentVersion"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode conflict response: %v", err)
	}
	if body.Error == "" || body.CurrentVersion != 5 {
		t.Fatalf("expected error and current version 5, got %#v", body)
	}
}

func TestUpdateProjectRejectsInvalidBaseVersion(t *testing.T) {
	model := site.Sample("学校の写真部")
	for name, fields := range map[string]string{
		"0":   `,"baseVersion":0`,
		"負の数": `,"baseVersion":-1`,
		"小数":  `,"baseVersion":1.5`,
		"文字列": `,"baseVersion":"3"`,
		// DBのINTEGERに収まらない値。そのまま渡すと500になる。
		"INTEGERの上限超え": `,"baseVersion":2147483648`,
	} {
		t.Run(name, func(t *testing.T) {
			repository := learningRepository(model, projectpkg.LearningRecord{})

			response := serveProjects(repository, updateProjectRequest(t, model, fields))

			if response.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
			}
			if repository.projectID != "" {
				t.Fatal("expected repository not to be called")
			}
		})
	}
}

func TestUpdateProjectAcceptsLargestBaseVersion(t *testing.T) {
	model := site.Sample("学校の写真部")
	repository := learningRepository(model, projectpkg.LearningRecord{})

	response := serveProjects(repository, updateProjectRequest(t, model, `,"baseVersion":2147483647`))

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if repository.baseVersion == nil || *repository.baseVersion != 2147483647 {
		t.Fatalf("expected base version to reach repository, got %v", repository.baseVersion)
	}
}

// nullは省略と同じ扱い。新規保存でも断らない。
func TestCreateProjectAcceptsNullBaseVersion(t *testing.T) {
	model := site.Sample("学校の写真部")
	repository := learningRepository(model, projectpkg.LearningRecord{})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", rawLearningRequestBody(t, model, `,"baseVersion":null`))

	response := serveProjects(repository, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
}

// 新規保存には比べる相手が無い。上書きのつもりで送った誤りを、黙って新規保存にしない。
func TestCreateProjectRejectsBaseVersion(t *testing.T) {
	model := site.Sample("学校の写真部")
	repository := learningRepository(model, projectpkg.LearningRecord{})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", rawLearningRequestBody(t, model, `,"baseVersion":1`))

	response := serveProjects(repository, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
	if repository.ownerID != "" {
		t.Fatal("expected repository not to be called")
	}
}
