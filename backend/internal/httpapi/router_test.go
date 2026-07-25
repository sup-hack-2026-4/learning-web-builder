package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
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
