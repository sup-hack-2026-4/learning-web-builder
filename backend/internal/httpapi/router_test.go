package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
	projectpkg "github.com/haru-yoshi-5/learning-web-builder/backend/internal/project"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

type stubGenerator struct {
	model site.Model
	err   error
}

func (generator stubGenerator) Generate(_ context.Context, _ string) (site.Model, error) {
	return generator.model, generator.err
}

type stubAuthenticator struct {
	identity authn.Identity
}

func (authenticator stubAuthenticator) Optional(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		ctx := authn.ContextWithIdentity(request.Context(), authenticator.identity)
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}

type stubProjectRepository struct {
	record    projectpkg.Record
	err       error
	ownerID   string
	projectID string
	model     site.Model
}

func (repository *stubProjectRepository) Create(_ context.Context, ownerID string, model site.Model) (projectpkg.Record, error) {
	repository.ownerID = ownerID
	repository.model = model
	return repository.record, repository.err
}

func (repository *stubProjectRepository) Update(_ context.Context, ownerID, projectID string, model site.Model) (projectpkg.Record, error) {
	repository.ownerID = ownerID
	repository.projectID = projectID
	repository.model = model
	return repository.record, repository.err
}

func TestHealth(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	response := httptest.NewRecorder()
	NewRouter(Config{AllowedOrigins: []string{"http://localhost:5173"}}).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
}

func TestSessionReturnsGuestMode(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
	response := httptest.NewRecorder()
	NewRouter(Config{}).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"authenticated":false`) ||
		!strings.Contains(response.Body.String(), `"mode":"guest"`) {
		t.Fatalf("expected guest session response, got %s", response.Body.String())
	}
}

func TestSessionReturnsAuthenticatedIdentity(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/session", nil)
	response := httptest.NewRecorder()
	NewRouter(Config{
		Authenticator: stubAuthenticator{identity: authn.Identity{UserID: "user_123"}},
	}).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"authenticated":true`) ||
		!strings.Contains(response.Body.String(), `"userId":"user_123"`) {
		t.Fatalf("expected authenticated session response, got %s", response.Body.String())
	}
}

func TestGenerateRejectsEmptyTopic(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":""}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{}).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func TestGenerateRejectsMultipleJSONValues(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"写真部"}{"topic":"美術部"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{}).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func TestGenerateReturnsStaticSample(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"学校の写真部"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{}).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"provider":"static-sample"`) {
		t.Fatalf("expected static sample response, got %s", response.Body.String())
	}
}

func TestGenerateReturnsGeminiModel(t *testing.T) {
	generated := site.Sample("学校の写真部")
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"学校の写真部"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{Generator: stubGenerator{model: generated}}).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"provider":"gemini"`) {
		t.Fatalf("expected Gemini response, got %s", response.Body.String())
	}
}

func TestGenerateFallsBackWhenGeneratorFails(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"学校の写真部"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{Generator: stubGenerator{err: errors.New("upstream unavailable")}}).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"provider":"static-sample"`) {
		t.Fatalf("expected static fallback response, got %s", response.Body.String())
	}
}

func TestGenerateFallsBackWhenGeneratedModelIsInvalid(t *testing.T) {
	generated := site.Sample("学校の写真部")
	generated.Theme.Primary = "invalid"
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"学校の写真部"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{Generator: stubGenerator{model: generated}}).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"provider":"static-sample"`) {
		t.Fatalf("expected static fallback response, got %s", response.Body.String())
	}
}

func TestCreateProjectRequiresAuthentication(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", strings.NewReader(`{}`))
	response := httptest.NewRecorder()
	NewRouter(Config{}).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCreateProjectReturnsUnavailableWithoutDatabase(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", strings.NewReader(`{}`))
	response := httptest.NewRecorder()
	NewRouter(Config{
		Authenticator: stubAuthenticator{identity: authn.Identity{UserID: "user_123"}},
	}).ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCreateProjectSavesValidatedSiteForAuthenticatedOwner(t *testing.T) {
	model := site.Sample("学校の写真部")
	now := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	repository := &stubProjectRepository{
		record: projectpkg.Record{
			ID:        "11111111-1111-1111-1111-111111111111",
			OwnerID:   "user_123",
			Site:      model,
			Version:   1,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", projectRequestBody(t, model))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{
		Authenticator: stubAuthenticator{identity: authn.Identity{UserID: "user_123"}},
		Projects:      repository,
	}).ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	if repository.ownerID != "user_123" {
		t.Fatalf("expected authenticated owner, got %q", repository.ownerID)
	}
	if repository.model.ID != model.ID {
		t.Fatalf("expected submitted site model to be saved")
	}
	if !strings.Contains(response.Body.String(), `"version":1`) {
		t.Fatalf("expected project response, got %s", response.Body.String())
	}
}

func TestCreateProjectRejectsInvalidSite(t *testing.T) {
	model := site.Sample("学校の写真部")
	model.Theme.Primary = "blue"
	repository := &stubProjectRepository{}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects", projectRequestBody(t, model))
	response := httptest.NewRecorder()
	NewRouter(Config{
		Authenticator: stubAuthenticator{identity: authn.Identity{UserID: "user_123"}},
		Projects:      repository,
	}).ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
	if repository.ownerID != "" {
		t.Fatal("expected invalid site not to reach repository")
	}
}

func TestUpdateProjectReturnsNotFoundForOtherOwner(t *testing.T) {
	projectID := "11111111-1111-1111-1111-111111111111"
	repository := &stubProjectRepository{err: projectpkg.ErrNotFound}
	request := httptest.NewRequest(http.MethodPut, "/api/v1/projects/"+projectID, projectRequestBody(t, site.Sample("学校の写真部")))
	response := httptest.NewRecorder()
	NewRouter(Config{
		Authenticator: stubAuthenticator{identity: authn.Identity{UserID: "user_456"}},
		Projects:      repository,
	}).ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", response.Code, response.Body.String())
	}
	if repository.ownerID != "user_456" || repository.projectID != projectID {
		t.Fatalf("expected owner-scoped update, got owner=%q project=%q", repository.ownerID, repository.projectID)
	}
}

func projectRequestBody(t *testing.T, model site.Model) *strings.Reader {
	t.Helper()
	encoded, err := json.Marshal(map[string]any{"site": model})
	if err != nil {
		t.Fatalf("marshal project request: %v", err)
	}
	return strings.NewReader(string(encoded))
}
